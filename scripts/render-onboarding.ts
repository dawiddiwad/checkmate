import { spawnSync } from 'node:child_process'
import { linkSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Page } from 'playwright-core'
import { startUi } from '../plugin/src/ui/server.ts'
import { human, seedDemo } from './ui-demo.ts'

// Renders docs/img/onboarding.gif: the factory storyboard in docs/media/onboarding.html,
// then a showcase of the real review UI on the sample records of scripts/ui-demo.ts.
// The chat scenes ask Claude Code, so Claude Code must be on PATH. FFmpeg must be on PATH.

const root = process.cwd()
const output = join(root, 'docs/img/onboarding.gif')
const executablePath = process.env.CHECKMATE_BROWSER_EXECUTABLE
const fps = 8
const width = 900
const height = 756

type Animation = { DURATION: number; measure: () => void; renderFrame: (seconds: number) => void }
type Still = { file: string; seconds: number }

if (!executablePath) throw Error('Set CHECKMATE_BROWSER_EXECUTABLE to Chromium.')
if (spawnSync('ffmpeg', ['-version']).error) throw Error('Put FFmpeg on PATH.')

const work = mkdtempSync(join(tmpdir(), 'checkmate-onboarding-'))
const frames = join(work, 'frames')
const workspace = join(work, 'shop')
mkdirSync(frames)
mkdirSync(workspace)
seedDemo(workspace)
const stills: Still[] = []
const browser = await chromium.launch({ executablePath, headless: true })
try {
	await renderStoryboard()
	await recordUi()
	assemble()
	rmSync(work, { recursive: true, force: true })
} finally {
	await browser.close()
}

async function renderStoryboard() {
	const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
	await page.goto(pathToFileURL(join(root, 'docs/media/onboarding.html')).href)
	await page.evaluate(() => document.fonts.ready)
	await page.evaluate(() => (window as unknown as Animation).measure())
	const duration = await page.evaluate(() => (window as unknown as Animation).DURATION)
	for (let frame = 0; frame < Math.round(duration * fps); frame++) {
		await page.evaluate((seconds) => (window as unknown as Animation).renderFrame(seconds), (frame + 0.5) / fps)
		const file = join(frames, `s-${String(frame).padStart(4, '0')}.png`)
		await page.screenshot({ path: file })
		stills.push({ file, seconds: 1 / fps })
	}
	await page.close()
}

async function recordUi() {
	const ui = await startUi({ workspace })
	const context = await browser.newContext({
		viewport: { width, height },
		deviceScaleFactor: 1,
		reducedMotion: 'reduce',
		colorScheme: 'dark',
	})
	try {
		await context.addCookies([{ name: 'checkmate_actor', value: human, url: ui.url }])
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
	const send = () => tab.locator('[data-chat-composer] button[type=submit]').click()
	const turnsDone = (count: number) =>
		tab.waitForFunction((n) => document.querySelectorAll('[data-chat-terminal]').length >= n, count, {
			timeout: 180000,
		})
	await open('/plans/checkout@2')
	await still(2.5)
	await open('/runs/run-7')
	await still(1.5)
	await tab.getByText('The promotion stacks with the loyalty credit').first().click()
	await tab.mouse.move(width / 2, height / 2)
	await tab.mouse.wheel(0, 560)
	await tab.waitForTimeout(300)
	await still(2.5)
	await open('/chats')
	await newChat()
	await tab.locator('#chat-text').fill('Why did run-7 fail? Answer in two short sentences.')
	await still(1)
	await send()
	await turnsDone(1)
	await still(2.5)
	await tab
		.locator('#chat-text')
		.fill('Answer gap G2 of the checkout plan: a customer can refund an order within 14 days of delivery.')
	await still(1)
	await send()
	await turnsDone(2)
	const saved = await tab.locator('[data-chat-saved]').last().innerText()
	if (!saved.includes('G2')) throw Error(`The chat did not save the answer: ${saved}`)
	checkPrivacy(await tab.locator('[data-chat-view]').innerText())
	await still(2.5)
	await newChat()
	await tab.locator('[data-chat-model-search]').fill('sonnet')
	await tab.locator('[data-chat-model]').selectOption({ label: 'Sonnet 5.5' })
	await still(1.5)
	await open('/plans/checkout')
	await still(2)
}

function checkPrivacy(text: string) {
	for (const leak of [userInfo().username, homedir(), work, root]) {
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
			'-filter_complex',
			'split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
			'-loop',
			'0',
			resolve(output),
		],
		{ stdio: 'inherit' }
	)
	if (ffmpeg.status !== 0) throw Error('FFmpeg failed.')
	const ui = stills.filter((still) => still.file.includes('/u-')).reduce((total, still) => total + still.seconds, 0)
	console.log(`Rendered ${(index / fps).toFixed(1)} seconds (${ui} seconds of UI) into ${output}.`)
}
