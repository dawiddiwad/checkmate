import { chromium } from 'playwright-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const framesPerSecond = 10
const media = (name: string) => pathToFileURL(join(process.cwd(), 'docs/media', name)).href
const frames = await mkdtemp(join(tmpdir(), 'checkmate-animation-'))
const browser = await chromium.launch({
	executablePath: process.env.CHECKMATE_BROWSER_EXECUTABLE ?? '/usr/bin/chromium',
	headless: true,
})
type Animation = { DURATION: number; measure: () => void; renderFrame: (seconds: number) => void }
try {
	const page = await browser.newPage({ viewport: { width: 900, height: 756 }, deviceScaleFactor: 1 })
	await page.goto(media('onboarding.html'))
	await page.evaluate(() => document.fonts.ready)
	await page.evaluate(() => (window as unknown as Animation).measure())
	const duration = await page.evaluate(() => (window as unknown as Animation).DURATION)
	const count = Math.round(duration * framesPerSecond)
	for (let frame = 0; frame < count; frame++) {
		await page.evaluate(
			(seconds) => (window as unknown as Animation).renderFrame(seconds),
			(frame + 0.5) / framesPerSecond
		)
		await page.screenshot({ path: join(frames, `frame-${String(frame).padStart(4, '0')}.png`) })
	}
	execFileSync(
		'ffmpeg',
		[
			'-y',
			'-loglevel',
			'error',
			'-framerate',
			String(framesPerSecond),
			'-i',
			join(frames, 'frame-%04d.png'),
			'-filter_complex',
			'split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
			'-loop',
			'0',
			'docs/img/onboarding.gif',
		],
		{ stdio: 'inherit' }
	)
	console.log(`Rendered a ${duration}-second onboarding animation.`)
} finally {
	await browser.close()
	await rm(frames, { recursive: true, force: true })
}
