import { spawnSync } from 'node:child_process'
import { linkSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, type Locator, type Page } from 'playwright-core'
import { startUi } from '../plugin/src/ui/server.ts'
import { human, seedShowcase } from './ui-demo.ts'

// Records docs/media/ui/review.gif from the real review UI on the seedShowcase records of scripts/ui-demo.ts.
// The chat scene asks a live Claude Code model, so Claude Code must be on PATH. FFmpeg must be on PATH, or set FFMPEG.

const root = process.cwd()
const output = resolve(process.argv[2] ?? join(root, 'docs/media/ui/review.gif'))
const executablePath = process.env.CHECKMATE_BROWSER_EXECUTABLE
const ffmpeg = process.env.FFMPEG || 'ffmpeg'
const fps = 10
const width = 1440
const height = 900
const chatQuestion = 'Answer gap G2 of the checkout plan: a customer can refund an order within 14 days of delivery.'

type Still = { file: string; seconds: number }

const checkoutPage = `<!doctype html><html><body style="margin:0;font:18px/1.5 Helvetica,Arial,sans-serif;background:#f6f7f5;color:#1b2420">
<header style="background:#1b2420;color:#fff;padding:18px 40px;font-weight:700;font-size:22px">Shop · Checkout</header>
<main style="margin:32px 40px;background:#fff;border:1px solid #dde3df;border-radius:10px;padding:28px 32px">
<h1 style="margin:0 0 20px;font-size:26px">Order summary</h1>
<table style="width:100%;border-collapse:collapse;font-size:20px">
<tr><td style="padding:10px 0">LAMP-01 · Desk lamp</td><td style="text-align:right">400.00 PLN</td></tr>
<tr><td style="padding:10px 0;color:#2c6150">Coupon SPRING40</td><td style="text-align:right;color:#2c6150">−160.00 PLN</td></tr>
<tr><td style="padding:10px 0;color:#2c6150">Coupon WELCOME10</td><td style="text-align:right;color:#2c6150">−40.00 PLN</td></tr>
<tr style="border-top:2px solid #1b2420;font-weight:700;font-size:24px"><td style="padding:14px 0">Total</td><td style="text-align:right">200.00 PLN</td></tr>
</table>
<p style="margin:24px 0 0;color:#5b6862">2 coupons applied</p>
</main></body></html>`

const cursorScript = `
addEventListener('DOMContentLoaded', () => {
	const cursor = document.createElement('div')
	cursor.id = 'rec-cursor'
	cursor.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M4 2 L4 22 L9.5 16.8 L13.4 25.5 L17 24 L13.2 15.4 L20.5 15.4 Z" fill="#ffffff" stroke="#0a0d12" stroke-width="1.6" stroke-linejoin="round"/></svg><i></i>'
	cursor.style.cssText = 'position:fixed;left:0;top:0;width:28px;height:28px;pointer-events:none;z-index:2147483647'
	const ring = cursor.querySelector('i')
	ring.style.cssText = 'position:absolute;left:-14px;top:-14px;width:36px;height:36px;border-radius:50%;border:3px solid #7fd3ee;opacity:0'
	document.body.append(cursor)
	const at = JSON.parse(sessionStorage.getItem('rec-cursor') || '[720,450]')
	cursor.style.transform = 'translate(' + at[0] + 'px,' + at[1] + 'px)'
	addEventListener('mousemove', (event) => {
		cursor.style.transform = 'translate(' + event.clientX + 'px,' + event.clientY + 'px)'
		sessionStorage.setItem('rec-cursor', JSON.stringify([event.clientX, event.clientY]))
	})
	addEventListener('mousedown', () => (ring.style.opacity = '1'))
	addEventListener('mouseup', () => setTimeout(() => (ring.style.opacity = '0'), 150))
})
`

if (!executablePath) throw Error('Set CHECKMATE_BROWSER_EXECUTABLE to Chromium.')
if (spawnSync(ffmpeg, ['-version']).error) throw Error('Put FFmpeg on PATH, or set FFMPEG to its path.')
if (spawnSync('claude', ['--version']).error) throw Error('Put Claude Code on PATH. The chat scene asks it.')

const work = mkdtempSync(join(tmpdir(), 'checkmate-review-ui-'))
const frames = join(work, 'frames')
const workspace = join(work, 'shop')
mkdirSync(frames)
mkdirSync(workspace)
const stills: Still[] = []
const browser = await chromium.launch({ executablePath, headless: true })
try {
	seedShowcase(workspace, await checkoutScreenshot())
	await record()
	assemble()
} finally {
	await browser.close()
	rmSync(work, { recursive: true, force: true })
}

async function checkoutScreenshot() {
	const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 })
	try {
		await page.setContent(checkoutPage)
		return await page.screenshot()
	} finally {
		await page.close()
	}
}

async function record() {
	const ui = await startUi({ workspace })
	const context = await browser.newContext({
		viewport: { width, height },
		deviceScaleFactor: 1,
		reducedMotion: 'reduce',
		colorScheme: 'dark',
	})
	try {
		await context.addCookies([{ name: 'checkmate_actor', value: human, url: ui.url }])
		await context.addInitScript(cursorScript)
		const tab = await context.newPage()
		await scenes(tab, ui.url)
	} finally {
		await context.close()
		await ui.close()
	}
}

async function scenes(tab: Page, url: string) {
	let index = 0
	let x = width / 2
	let y = height / 2
	const shot = async (seconds: number) => {
		const file = join(frames, `u-${String(index++).padStart(5, '0')}.png`)
		await tab.screenshot({ path: file })
		stills.push({ file, seconds })
	}
	const settle = async () => {
		await tab.locator('[data-live]:not([hidden])').first().waitFor()
		await tab.evaluate(() => document.fonts.ready)
		await tab.mouse.move(x, y)
	}
	const open = async (path: string) => {
		await tab.goto(new URL(path, url).href)
		await settle()
	}
	const glide = async (target: Locator, seconds = 0.6) => {
		const box = await target.boundingBox()
		if (!box) throw Error('The target is not visible.')
		const toX = box.x + Math.min(box.width / 2, 60)
		const toY = box.y + box.height / 2
		const steps = Math.round(seconds * fps)
		for (let step = 1; step <= steps; step++) {
			const t = step / steps
			const eased = t * t * (3 - 2 * t)
			await tab.mouse.move(x + (toX - x) * eased, y + (toY - y) * eased)
			await shot(1 / fps)
		}
		x = toX
		y = toY
	}
	const click = async (target: Locator, seconds = 0.6) => {
		await glide(target, seconds)
		await tab.mouse.down()
		await shot(0.2)
		await tab.mouse.up()
	}
	const submit = async (target: Locator, seconds = 0.6) => {
		const loaded = tab.waitForNavigation()
		await click(target, seconds)
		await loaded
		await settle()
	}
	const type = async (target: Locator, text: string, seconds = 1.2) => {
		await target.focus()
		const chunks = Math.round(seconds * fps)
		const size = Math.ceil(text.length / chunks)
		for (let at = 0; at < text.length; at += size) {
			await target.pressSequentially(text.slice(at, at + size))
			await shot(1 / fps)
		}
	}
	const row = (text: string) => tab.locator('[role=listitem]').filter({ hasText: text }).first()

	await open('/')
	await shot(1.5)
	await submit(tab.getByText('Verify checkout totals', { exact: false }).first())
	await shot(1.6)

	await click(row('Two coupons stack'))
	await tab.locator('[data-drawer]').waitFor()
	await settle()
	await shot(1.5)
	await click(tab.locator('[data-drawer] .sp-file').filter({ hasText: 'a1-checkout.png' }).first())
	const pane = tab.locator('[data-viewer-pane]')
	await pane.waitFor()
	await settle()
	const image = pane.locator('[data-vfig="0"] img')
	await image.waitFor()
	if (!(await image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)))
		throw Error('The evidence screenshot did not load.')
	await shot(2.2)
	await click(pane.locator('[data-vfile="1"]'), 0.5)
	const quote = pane.locator('[data-vfig="1"] pre')
	await quote.waitFor()
	if (!(await quote.innerText()).includes('WELCOME10')) throw Error('The evidence JSON did not show.')
	await shot(2)
	await click(pane.locator('[data-close]').first(), 0.5)
	await tab.locator('[data-drawer]').waitFor()
	await settle()
	await shot(0.4)
	const before = await needYou(tab)
	const defects = await openDefects(tab)
	await submit(tab.locator('[data-drawer] [data-option]').filter({ hasText: 'Yes, a defect' }).first())
	if ((await openDefects(tab)) !== defects + 1) throw Error('The finding did not become a defect.')
	if ((await needYou(tab)) !== before - 1) throw Error('Needs you did not drop after the defect decision.')
	await shot(1.6)

	await click(row('Must the banner text wrap'), 0.6)
	await tab.locator('[data-drawer]').filter({ hasText: 'G4' }).waitFor()
	await settle()
	await shot(0.5)
	await glide(tab.locator('[data-drawer] [data-option]').filter({ hasText: 'Different' }).first(), 0.5)
	await shot(0.3)
	const answer = tab.locator('[data-drawer] textarea').first()
	await click(answer, 0.4)
	await type(answer, 'The banner text wraps to a second line.')
	await shot(0.4)
	await submit(
		tab
			.locator('[data-drawer] button')
			.filter({ hasText: /send the answer/i })
			.first(),
		0.5
	)
	const listed = await tab.locator('[role=list]').first().innerText()
	if (listed.includes('Must the banner text wrap') || !listed.includes('Approve checkout@3'))
		throw Error('The gap answer did not take effect.')
	await shot(1.6)

	await open('/chats')
	await click(tab.getByRole('link', { name: /new chat/i }).first(), 0.5)
	await settle()
	await type(tab.locator('#chat-text'), chatQuestion, 1)
	await shot(0.3)
	await click(tab.locator('[data-chat-composer] button[type=submit]'), 0.5)
	await tab.waitForFunction(() => document.querySelector('[data-chat-terminal]'), null, { timeout: 240000 })
	await settle()
	const saved = await tab.locator('[data-chat-saved]').last().innerText()
	if (!saved.includes('G2'))
		throw Error(`The chat did not save the answer to G2: ${await tab.locator('main').innerText()}`)
	checkPrivacy(await tab.locator('main').innerText())
	await tab.locator('[data-chat-saved]').last().scrollIntoViewIfNeeded()
	await shot(2.8)

	await moreSlide(tab)
	await shot(3)
}

async function openDefects(tab: Page) {
	const match = (await tab.locator('main').innerText()).match(/(\d+) open defects?/)
	if (!match) throw Error('The plan does not show its open defects.')
	return Number(match[1])
}

async function needYou(tab: Page) {
	const text = await tab.locator('body').innerText()
	const match = text.match(/(\d+) NEED YOU/i)
	if (!match) throw Error('The page does not show the Needs you count.')
	return Number(match[1])
}

async function moreSlide(tab: Page) {
	await tab.evaluate(() => {
		const features = [
			['Runs', 'a verdict and the observed value for each check'],
			['Rule map', 'each rule of the plan against its last builds'],
			['Plans', 'revisions, test edits, and plan approval'],
			['Activity', 'live tests, follow-ups, and chats'],
			['Permissions', 'tester requests that wait for your answer'],
			['Settings', 'targets and instances, Claude Code or Pi, models, tool rules'],
			['New change', 'start a test from a ticket, or test a new build'],
			['Find and keys', 'search, keyboard shortcuts, and bulk decisions'],
		]
		const main = document.querySelector('main')
		if (!main) throw Error('The page has no main element.')
		const element = (tag: string, styles: Record<string, string>, text = '') => {
			const node = document.createElement(tag)
			Object.assign(node.style, styles)
			node.textContent = text
			return node
		}
		const section = element('section', { padding: '88px 120px' })
		section.append(element('h1', { fontSize: '44px', margin: '0 0 36px' }, '…and many more:'))
		const list = element('ul', { listStyle: 'none', margin: '0', padding: '0', borderTop: '1px solid var(--hair)' })
		for (const [name, text] of features) {
			const item = element('li', {
				display: 'flex',
				gap: '32px',
				padding: '14px 0',
				borderBottom: '1px solid var(--hair)',
			})
			item.append(
				element(
					'span',
					{
						width: '240px',
						flex: 'none',
						fontFamily: 'var(--font-mono)',
						color: 'var(--accent)',
						textTransform: 'uppercase',
						letterSpacing: '1px',
						fontSize: '18px',
						lineHeight: '32px',
					},
					name
				),
				element('span', { color: 'var(--ink)', fontSize: '22px', lineHeight: '32px' }, text)
			)
			list.append(item)
		}
		section.append(list)
		main.replaceChildren(section)
		document.getElementById('rec-cursor')?.remove()
	})
}

function checkPrivacy(text: string) {
	for (const leak of [userInfo().username, homedir(), work, tmpdir(), root]) {
		if (leak.length > 3 && text.includes(leak)) throw Error(`Refusing to record text that shows ${leak}.`)
	}
}

function assemble() {
	const sequence = join(work, 'sequence')
	mkdirSync(sequence)
	let index = 0
	for (const still of stills) {
		const copies = Math.max(1, Math.round(still.seconds * fps))
		for (let copy = 0; copy < copies; copy++)
			linkSync(still.file, join(sequence, `f-${String(index++).padStart(5, '0')}.png`))
	}
	const result = spawnSync(
		ffmpeg,
		[
			'-y',
			'-loglevel',
			'error',
			'-framerate',
			String(fps),
			'-i',
			join(sequence, 'f-%05d.png'),
			'-filter_complex',
			'split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
			'-loop',
			'0',
			output,
		],
		{ stdio: 'inherit' }
	)
	if (result.status !== 0) throw Error('FFmpeg failed.')
	console.log(`Rendered ${(index / fps).toFixed(1)} seconds into ${output}.`)
}
