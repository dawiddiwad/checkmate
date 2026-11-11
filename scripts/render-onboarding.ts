import { chromium } from 'playwright-core'
import type { Browser } from 'playwright-core'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFileSync } from 'node:child_process'

const framesPerSecond = 10
const onlyOnboarding = process.argv.slice(2).join(' ') === '--only onboarding'
const server = createServer(async (request, response) => {
	const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
	if (!/^\/(?:docs\/media\/[a-z-]+\.(?:html|css)|cli\/fonts\/[a-z-]+\.woff2)$/.test(path)) {
		response.writeHead(404).end()
		return
	}
	try {
		const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2' }
		const bytes = await readFile(join(process.cwd(), path))
		response.writeHead(200, { 'Content-Type': types[extname(path)] }).end(bytes)
	} catch {
		response.writeHead(404).end()
	}
})
await new Promise<void>((resolve, reject) => {
	server.once('error', reject)
	server.listen(0, '127.0.0.1', resolve)
})
const port = (server.address() as AddressInfo).port
const media = (name: string) => `http://127.0.0.1:${port}/docs/media/${name}`
const frames = await mkdtemp(join(tmpdir(), 'checkmate-animation-'))
let browser: Browser | undefined
type Animation = { DURATION: number; measure: () => void; renderFrame: (seconds: number) => void }
try {
	browser = await chromium.launch({
		executablePath: process.env.CHECKMATE_BROWSER_EXECUTABLE ?? '/usr/bin/chromium',
		headless: true,
	})
	if (!onlyOnboarding) {
		const overview = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 })
		await overview.goto(media('infographic.html'))
		await overview.evaluate(() => document.fonts.ready)
		await overview.locator('main').screenshot({ path: 'docs/img/checkmate-infographic.png' })
	}

	const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 })
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
	console.log(`Rendered ${onlyOnboarding ? '' : 'the infographic and '}a ${duration}-second onboarding animation.`)
} finally {
	await browser?.close()
	await new Promise<void>((resolve) => server.close(() => resolve()))
	await rm(frames, { recursive: true, force: true })
}
