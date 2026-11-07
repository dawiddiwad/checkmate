import { chromium } from 'playwright-core'
import { mkdtemp, rm, copyFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const frames = await mkdtemp(join(tmpdir(), 'checkmate-animation-'))
const browser = await chromium.launch({
	executablePath: process.env.CHECKMATE_BROWSER_EXECUTABLE ?? '/usr/bin/chromium',
	headless: true,
})
try {
	const page = await browser.newPage({ viewport: { width: 700, height: 1120 }, deviceScaleFactor: 1 })
	await page.setContent(await readFile('docs/media/onboarding.html', 'utf8'))
	for (let frame = 0; frame < 256; frame++) {
		await page.evaluate(
			({ scene, progress }) => {
				const render = (window as unknown as { renderFrame: (scene: number, progress: number) => void })
					.renderFrame
				render(scene, progress)
			},
			{ scene: Math.floor(frame / 32), progress: ((frame % 32) + 0.5) / 32 }
		)
		await page.screenshot({ path: join(frames, `frame-${String(frame).padStart(4, '0')}.png`) })
	}
	await copyFile(join(frames, 'frame-0016.png'), 'docs/img/onboarding-poster.png')
	execFileSync(
		'ffmpeg',
		[
			'-y',
			'-loglevel',
			'error',
			'-framerate',
			'8',
			'-i',
			join(frames, 'frame-%04d.png'),
			'-filter_complex',
			'split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
			'-loop',
			'0',
			'docs/img/onboarding.gif',
		],
		{ stdio: 'inherit' }
	)
	console.log('Rendered 32-second onboarding animation.')
} finally {
	await browser.close()
	await rm(frames, { recursive: true, force: true })
}
