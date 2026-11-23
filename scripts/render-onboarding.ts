import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright-core'
import { startUi } from '../plugin/src/ui/server.ts'

// Records docs/img/onboarding.gif from real runs. The CLI steps run in a disposable workspace
// against a loopback demo shop, and the review UI scenes are recorded in Chromium on that workspace.
// Needs: a built CLI (node scripts/build-cli.ts), Claude Code on PATH, Chromium in
// CHECKMATE_BROWSER_EXECUTABLE, and FFmpeg on PATH. The planner, revise, and execute steps call Claude.
// The planner writes different gaps on each run, so the gap answers come from the record.

const root = process.cwd()
const cli = join(root, 'cli/dist/checkmate.js')
const output = join(root, 'docs/img/onboarding.gif')
const executablePath = process.env.CHECKMATE_BROWSER_EXECUTABLE
const shopPort = Number(process.env.CHECKMATE_ONBOARDING_PORT ?? 4173)
const width = 1000
const height = 640
const fps = 20

type Frame = { caption: string; command: string; live: boolean; out: string }
type Still = { file: string; seconds: number }

if (!executablePath) throw Error('Set CHECKMATE_BROWSER_EXECUTABLE to Chromium.')
if (spawnSync('ffmpeg', ['-version']).error) throw Error('Put FFmpeg on PATH.')
const claude = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim()

const work = mkdtempSync(join(tmpdir(), 'checkmate-onboarding-'))
const bin = join(work, 'bin')
const frames = join(work, 'frames')
const workspace = join(work, 'shop-app')
mkdirSync(bin, { recursive: true })
mkdirSync(frames, { recursive: true })
mkdirSync(workspace, { recursive: true })
symlinkSync(claude, join(bin, 'claude'))
symlinkSync(process.execPath, join(bin, 'node'))
writeFileSync(join(bin, 'checkmate'), `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`, { mode: 0o755 })
writeFileSync(
	join(workspace, 'ticket.md'),
	[
		'# SHOP-12: Checkout quote and refunds',
		'',
		'The shop API has read-only endpoints. The demo shop keeps no records.',
		'',
		'- GET /quote with no code returns totalPLN 400 for the 400 PLN item.',
		'- GET /quote with code SPRING40 returns the quote with the promotion applied. SPRING40 takes 40 percent off the item price.',
		'- Customers can refund eligible orders. GET /refund?daysSinceDelivery=N reports whether an order is eligible.',
		'',
	].join('\n')
)
const env = {
	...process.env,
	PATH: `${bin}:/usr/bin:/bin`,
	CHECKMATE_ACTOR: 'qa-lead',
	PI_CODING_AGENT_DIR: join(work, 'pi-agent'),
}

function quiet(command: string) {
	const result = spawnSync('sh', ['-c', command], {
		cwd: workspace,
		env,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	})
	if (result.status !== 0) throw Error(`Query failed: ${command}\n${result.stdout}${result.stderr}`)
	return result.stdout
}

const transcript: Frame[] = []
function record(caption: string, command: string, live = false) {
	const result = spawnSync('sh', ['-c', command], {
		cwd: workspace,
		env,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	})
	const out = (result.stdout + result.stderr).replace(/\s+$/, '')
	if (result.status !== 0 && !command.includes('; echo')) throw Error(`Step failed: ${command}\n${out}`)
	transcript.push({ caption, command, live, out })
}

function answerFor(question: string) {
	if (/tax|round/i.test(question)) return 'totalPLN adds no tax and is rounded to whole PLN.'
	if (/refund|eligib|day|window|deliver/i.test(question))
		return 'An order is eligible when daysSinceDelivery is 14 or less. Day 14 is included.'
	return 'Use the ticket as written.'
}

function openGaps(plan: string) {
	const record = JSON.parse(quiet(`checkmate plan show ${plan} --json`))
	return (record.plan.gaps as Array<{ id: string; question: string; status: string; severity: string }>).filter(
		(gap) => gap.status === 'open' && gap.severity === 'blocking'
	)
}

const shop = spawn(process.execPath, [join(root, 'scripts/onboarding/shop.mjs'), String(shopPort)], {
	stdio: ['ignore', 'pipe', 'inherit'],
})
const browser: Browser = await chromium.launch({ executablePath, headless: true })
try {
	await once(shop.stdout, 'data')
	record('Load the CLI', 'checkmate --version | head -n 1')
	record(
		'Set up the target and its data policy',
		`checkmate setup --url http://127.0.0.1:${shopPort} --target shop --data environment --policy "The demo shop keeps no records."`
	)
	record('Give the ticket to Checkmate', 'cat ticket.md')
	record(
		'Give the ticket to Checkmate',
		'checkmate plan open checkout --target shop@1 --objective "Check the checkout quote and refunds." --source ticket.md'
	)
	record(
		'The planner writes the rules, tests, and gaps',
		'checkmate delegate plan checkout --allow Read --allow Bash',
		true
	)
	record('The plan waits for the oracle', 'checkmate status checkout')
	const gaps = openGaps('checkout@1')
	if (!gaps.length) throw Error('The planner raised no blocking gap. Run the recorder again.')
	for (const gap of gaps) {
		const value = answerFor(gap.question)
		record(
			'Answer each blocking gap',
			`checkmate gap answer checkout ${gap.id} --kind clarify --source ticket.md --value "${value}" --rationale "Product owner decision."`
		)
	}
	record('The planner saves the next revision', 'checkmate delegate revise checkout --allow Read --allow Bash', true)
	record('The plan is ready to run', 'checkmate status checkout')
	const revision = JSON.parse(quiet('checkmate plan show checkout --json')).revision
	record(
		'Start the run on the new build',
		`checkmate run begin run-1 checkout@${revision} --build shop-b1 --instance local --partial ready_only`
	)
	record('Each test runs in its own child', 'checkmate delegate execute run-1 --allow Read --allow Bash', true)
	record('The result shows the defect and the gate', 'checkmate run show run-1 --gate; echo "exit $?"')
	record('Status names the next owner', 'checkmate status checkout')
	checkPrivacy(transcript.map((frame) => frame.out).join('\n'))
	const stills: Still[] = []
	await renderTerminal(stills)
	await recordUi(stills)
	assemble(stills)
	rmSync(work, { recursive: true, force: true })
} finally {
	await browser.close()
	const closed = once(shop, 'exit')
	shop.kill('SIGTERM')
	await closed
}

function checkPrivacy(text: string) {
	for (const leak of [userInfo().username, homedir(), work, root]) {
		if (leak.length > 3 && text.includes(leak)) throw Error(`Refusing to record output that shows ${leak}.`)
	}
}

function terminalHtml() {
	const font = pathToFileURL(join(root, 'docs/media/fonts/jetbrains-mono.woff2')).href
	return `<!doctype html><meta charset="utf-8"><style>
	@font-face { font-family: 'Terminal Mono'; src: url('${font}') format('woff2'); }
	html, body { margin: 0; background: #0f151d; }
	.window { width: ${width}px; height: ${height}px; box-sizing: border-box; padding: 16px 22px; color: #d8dee6; font: 15px/21px 'Terminal Mono', monospace; display: flex; flex-direction: column; }
	.title { color: #7fd1a5; font-size: 16px; margin-bottom: 8px; }
	.screen { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; }
	.cmd { white-space: pre-wrap; word-break: break-all; margin-top: 10px; }
	.cmd b { color: #7fd1a5; font-weight: 400; }
	.out { white-space: pre-wrap; word-break: break-word; margin: 2px 0 0; color: #aab4c0; }
	.live { color: #e0b96b; margin-top: 10px; }
	.cursor::after { content: '▌'; color: #7fd1a5; }
	</style><div class="window"><div class="title" id="title"></div><div class="screen" id="screen"></div></div>
	<script>
	const esc = (text) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
	window.draw = (state) => {
		document.getElementById('title').textContent = state.title
		const blocks = state.blocks.map((block) =>
			'<div class="cmd"><b>$</b> ' + esc(block.command) + '</div>' + (block.out ? '<pre class="out">' + esc(block.out) + '</pre>' : '')
		)
		if (state.typing !== undefined) blocks.push('<div class="cmd"><b>$</b> <span class="cursor">' + esc(state.typing) + '</span></div>')
		if (state.live) blocks.push('<div class="live">running…</div>')
		document.getElementById('screen').innerHTML = blocks.join('')
	}
	</script>`
}

async function renderTerminal(stills: Still[]) {
	const terminal = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
	await terminal.setContent(terminalHtml())
	await terminal.evaluate(() => document.fonts.ready)
	let index = 0
	const still = async (state: object, seconds: number) => {
		await terminal.evaluate((value) => (window as unknown as { draw: (state: object) => void }).draw(value), state)
		const file = join(frames, `t-${String(index++).padStart(4, '0')}.png`)
		await terminal.screenshot({ path: file })
		stills.push({ file, seconds })
	}
	let screen: Array<{ command: string; out: string }> = []
	let caption = ''
	for (const frame of transcript) {
		if (frame.caption !== caption) screen = []
		caption = frame.caption
		const title = `Checkmate · ${frame.caption}`
		for (let end = 1; end < frame.command.length; end += 8)
			await still({ title, blocks: screen, typing: frame.command.slice(0, end) }, 0.05)
		await still({ title, blocks: screen, typing: frame.command }, 0.4)
		if (frame.live) await still({ title, blocks: screen, live: true }, 1)
		screen = [...screen, { command: frame.command, out: frame.out }]
		await still({ title, blocks: screen }, Math.min(3, Math.max(1.6, frame.out.split('\n').length * 0.16)))
	}
	await terminal.close()
}

async function recordUi(stills: Still[]) {
	const ui = await startUi({ workspace })
	const context = await browser.newContext({
		viewport: { width, height },
		deviceScaleFactor: 1,
		reducedMotion: 'reduce',
	})
	try {
		await context.addCookies([{ name: 'checkmate_actor', value: 'qa-lead', url: ui.url }])
		const tab = await context.newPage()
		let index = 0
		const still = async (seconds: number) => {
			const file = join(frames, `u-${String(index++).padStart(4, '0')}.png`)
			await tab.screenshot({ path: file })
			stills.push({ file, seconds })
		}
		await uiScenes(tab, ui.url, still)
	} finally {
		await context.close()
		await ui.close()
	}
}

async function uiScenes(tab: Page, url: string, still: (seconds: number) => Promise<void>) {
	const open = async (path: string) => {
		await tab.goto(new URL(path, url).href)
		await tab.locator('[data-live]:not([hidden])').waitFor()
		await tab.evaluate(() => document.fonts.ready)
	}
	const newChat = () =>
		tab
			.getByRole('link', { name: /new chat/i })
			.or(tab.getByRole('button', { name: /new chat/i }))
			.first()
			.click()
	const turnsDone = (count: number) =>
		tab.waitForFunction((n) => document.querySelectorAll('[data-chat-terminal]').length >= n, count, {
			timeout: 180000,
		})
	const send = () => tab.locator('[data-chat-composer] button[type=submit]').click()
	await open('/')
	await still(2)
	await open('/plans/checkout@2')
	await still(2.5)
	await open('/runs/run-1')
	await still(2)
	await tab.getByText('F-T2-1').first().click()
	await still(2.5)
	await open('/chats')
	await newChat()
	await tab.locator('#chat-text').fill('Why did T2 fail? Answer in two short sentences.')
	await still(1)
	await send()
	await turnsDone(1)
	await still(2.5)
	await tab
		.locator('#chat-text')
		.fill(
			'Run checkmate result accept run-1 with the rationale: the record is correct, and defect F-T2-1 matches the evidence.'
		)
	await still(1)
	await send()
	await turnsDone(2)
	const saved = await tab.locator('[data-chat-saved]').last().innerText()
	if (!saved.includes('result accept')) throw Error(`The chat did not save the acceptance: ${saved}`)
	await still(2.5)
	await newChat()
	await tab.locator('[data-chat-model-search]').fill('sonnet')
	await tab.locator('[data-chat-model]').selectOption({ label: 'Sonnet 5.5' })
	await still(2)
	await open('/')
	await still(2)
}

function assemble(stills: Still[]) {
	const sequence = join(work, 'sequence')
	mkdirSync(sequence)
	let index = 0
	for (const still of stills) {
		const copies = Math.max(1, Math.round(still.seconds * fps))
		for (let copy = 0; copy < copies; copy++)
			linkSync(still.file, join(sequence, `f-${String(index++).padStart(5, '0')}.png`))
	}
	const ffmpeg = spawnSync(
		'ffmpeg',
		[
			'-y',
			'-loglevel',
			'error',
			'-framerate',
			String(fps),
			'-i',
			join(sequence, 'f-%05d.png'),
			'-vf',
			'split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
			'-loop',
			'0',
			resolve(output),
		],
		{ stdio: 'inherit' }
	)
	if (ffmpeg.status !== 0) throw Error('FFmpeg failed.')
	console.log(`Rendered ${index} frames at ${fps} per second into ${output}.`)
}
