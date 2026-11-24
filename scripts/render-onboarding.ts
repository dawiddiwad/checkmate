import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

// Renders docs/img/onboarding.gif from docs/media/onboarding.html: the factory storyboard,
// then one scene for each way to run Checkmate. FFmpeg must be on PATH, or set FFMPEG to its path.

const root = process.cwd()
const output = join(root, 'docs/img/onboarding.gif')
const executablePath = process.env.CHECKMATE_BROWSER_EXECUTABLE
const ffmpeg = process.env.FFMPEG || 'ffmpeg'
const fps = 8
const width = 900
const height = 756

type Animation = { DURATION: number; measure: () => void; renderFrame: (seconds: number) => void }

if (!executablePath) throw Error('Set CHECKMATE_BROWSER_EXECUTABLE to Chromium.')
if (spawnSync(ffmpeg, ['-version']).error) throw Error('Put FFmpeg on PATH, or set FFMPEG to its path.')

const work = mkdtempSync(join(tmpdir(), 'checkmate-onboarding-'))
const frames = join(work, 'frames')
mkdirSync(frames)
const browser = await chromium.launch({ executablePath, headless: true })
try {
	const count = await renderFrames()
	assemble(count)
} finally {
	await browser.close()
	rmSync(work, { recursive: true, force: true })
}

async function renderFrames() {
	const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
	await page.goto(pathToFileURL(join(root, 'docs/media/onboarding.html')).href)
	await page.evaluate(() => document.fonts.ready)
	await page.evaluate(() => (window as unknown as Animation).measure())
	const duration = await page.evaluate(() => (window as unknown as Animation).DURATION)
	const count = Math.round(duration * fps)
	for (let frame = 0; frame < count; frame++) {
		await page.evaluate((seconds) => (window as unknown as Animation).renderFrame(seconds), (frame + 0.5) / fps)
		await page.screenshot({ path: join(frames, `f-${String(frame).padStart(5, '0')}.png`) })
	}
	await page.close()
	return count
}

function assemble(count: number) {
	const result = spawnSync(
		ffmpeg,
		[
			'-y',
			'-loglevel',
			'error',
			'-framerate',
			String(fps),
			'-i',
			join(frames, 'f-%05d.png'),
			'-filter_complex',
			'split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
			'-loop',
			'0',
			output,
		],
		{ stdio: 'inherit' }
	)
	if (result.status !== 0) throw Error('FFmpeg failed.')
	console.log(`Rendered ${(count / fps).toFixed(1)} seconds into ${output}.`)
}
