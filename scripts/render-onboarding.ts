import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

// Renders two GIFs: docs/img/onboarding.gif from docs/media/onboarding.html (the factory storyboard)
// and docs/img/onboarding-calm.gif from docs/media/onboarding-calm.html (a slower, simpler version).
// FFmpeg must be on PATH, or set FFMPEG to its path.

const root = process.cwd()
const gifs = [
	{ page: 'onboarding.html', output: 'onboarding.gif', width: 900, height: 756 },
	{ page: 'onboarding-calm.html', output: 'onboarding-calm.gif', width: 900, height: 420 },
]
const executablePath = process.env.CHECKMATE_BROWSER_EXECUTABLE
const ffmpeg = process.env.FFMPEG || 'ffmpeg'
const fps = 8

type Animation = { DURATION: number; measure: () => void; renderFrame: (seconds: number) => void }

if (!executablePath) throw Error('Set CHECKMATE_BROWSER_EXECUTABLE to Chromium.')
if (spawnSync(ffmpeg, ['-version']).error) throw Error('Put FFmpeg on PATH, or set FFMPEG to its path.')

const work = mkdtempSync(join(tmpdir(), 'checkmate-onboarding-'))
const browser = await chromium.launch({ executablePath, headless: true })
try {
	for (const gif of gifs) {
		const frames = join(work, gif.output)
		mkdirSync(frames)
		const count = await renderFrames(gif, frames)
		assemble(count, frames, join(root, 'docs/img', gif.output))
	}
} finally {
	await browser.close()
	rmSync(work, { recursive: true, force: true })
}

async function renderFrames(gif: (typeof gifs)[number], frames: string) {
	const page = await browser.newPage({ viewport: { width: gif.width, height: gif.height }, deviceScaleFactor: 1 })
	await page.goto(pathToFileURL(join(root, 'docs/media', gif.page)).href)
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

function assemble(count: number, frames: string, output: string) {
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
