import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, type Browser } from 'playwright-core'
import pngjs from 'pngjs'

const { PNG } = pngjs
const root = fileURLToPath(new URL('..', import.meta.url))
const reportOnly = process.argv.includes('--report-only') || process.env.CHECKMATE_CATALOGUE_ACCEPT === 'true'

function git(...args: string[]) {
	return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function baselineRevision() {
	const pushedFrom = process.env.CHECKMATE_CATALOGUE_BASELINE
	if (pushedFrom && !/^0+$/.test(pushedFrom)) return git('rev-parse', '--verify', pushedFrom + '^{commit}')
	const upstream = git('rev-parse', 'origin/main')
	return git('rev-parse', 'HEAD') === upstream ? git('rev-parse', 'HEAD^1') : git('merge-base', 'HEAD', upstream)
}

async function capture(browser: Browser, source: string, workspace: string) {
	const server: typeof import('../plugin/src/ui/server.ts') = await import(
		pathToFileURL(join(source, 'plugin/src/ui/server.ts')).href
	)
	const ui = await server.startUi({ workspace, catalogue: true })
	try {
		const images = new Map<string, Buffer>()
		for (const theme of ['light', 'dark']) {
			const context = await browser.newContext({
				viewport: { width: 1280, height: 900 },
				deviceScaleFactor: 1,
				reducedMotion: 'reduce',
			})
			try {
				await context.addCookies([{ name: 'checkmate_theme', value: theme, url: ui.url }])
				await context.route('**/settings/harness/models?*', (route) =>
					route.fulfill({ json: { models: [], primary: null, defaultModel: null } })
				)
				await context.addInitScript(() => {
					Object.defineProperty(window, 'EventSource', {
						value: class extends EventTarget {
							onopen?: () => void
							constructor() {
								super()
								queueMicrotask(() => this.onopen?.())
							}
							close() {}
						},
					})
				})
				const page = await context.newPage()
				const address = new URL('/catalogue', ui.url).href
				const response = await page.goto(address)
				assert.ok(response?.ok(), `Catalogue route at ${address} returned HTTP ${response?.status()}`)
				await page.locator('[data-live]:not([hidden])').first().waitFor()
				assert.equal(await page.locator('html').getAttribute('data-theme'), theme)
				await page.evaluate(() => document.fonts.ready)
				assert.ok(
					await page.evaluate(() =>
						['IBM Plex Sans', 'IBM Plex Mono'].every((family) =>
							[...document.fonts].some(
								(face) => face.family.replace(/"/g, '') === family && face.status === 'loaded'
							)
						)
					),
					'IBM Plex fonts did not load'
				)
				const height = await page.evaluate(() => document.documentElement.scrollHeight)
				await page.setViewportSize({ width: 1280, height: height + 200 })
				await page.mouse.move(0, 0)

				const entries = await page.locator('[data-catalogue-entry]').all()
				assert.ok(entries.length, 'Catalogue has no component entries')
				for (const entry of entries) {
					const name = await entry.getAttribute('data-catalogue-entry')
					assert.ok(name && /^[a-z0-9-]+$/.test(name), `Invalid component name: ${name}`)
					const key = `${theme}/${name}`
					assert.ok(!images.has(key), `Duplicate catalogue entry: ${key}`)
					images.set(key, await entry.screenshot({ animations: 'disabled', caret: 'hide' }))
				}
			} finally {
				await context.close()
			}
		}
		return images
	} finally {
		await ui.close()
	}
}

function compare(before: Buffer, after: Buffer) {
	const a = PNG.sync.read(before)
	const b = PNG.sync.read(after)
	if (a.width === b.width && a.height === b.height && a.data.equals(b.data)) return null

	const diff = new PNG({ width: Math.max(a.width, b.width), height: Math.max(a.height, b.height) })
	let pixels = 0
	for (let y = 0; y < diff.height; y++) {
		for (let x = 0; x < diff.width; x++) {
			const left = x < a.width && y < a.height ? (y * a.width + x) * 4 : -1
			const right = x < b.width && y < b.height ? (y * b.width + x) * 4 : -1
			if (left === -1 && right === -1) continue
			const offset = (y * diff.width + x) * 4
			if (left === -1 || right === -1 || a.data.readUInt32BE(left) !== b.data.readUInt32BE(right)) {
				pixels++
				diff.data.writeUInt32BE(0xff00ffff, offset)
			} else {
				const grey = Math.round(180 + (b.data[right] + b.data[right + 1] + b.data[right + 2]) / 12)
				diff.data.fill(grey, offset, offset + 3)
				diff.data[offset + 3] = 255
			}
		}
	}
	return { pixels, image: PNG.sync.write(diff) }
}

function write(output: string, key: string, side: string, image: Buffer) {
	const directory = join(output, key)
	mkdirSync(directory, { recursive: true })
	writeFileSync(join(directory, side + '.png'), image)
}

function report(before: Map<string, Buffer>, after: Map<string, Buffer>) {
	const output = process.env.CHECKMATE_CATALOGUE_OUTPUT ?? mkdtempSync(join(tmpdir(), 'checkmate-catalogue-diff-'))
	let changed = 0
	let unpaired = 0
	for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
		const a = before.get(key)
		const b = after.get(key)
		if (!a || !b) {
			unpaired++
			console.log(`${key}: ${a ? 'removed' : 'new'}`)
			if (a) write(output, key, 'before', a)
			if (b) write(output, key, 'after', b)
			continue
		}
		const difference = compare(a, b)
		if (!difference) continue
		changed++
		console.log(`${key}: ${difference.pixels} changed pixels`)
		write(output, key, 'before', a)
		write(output, key, 'after', b)
		write(output, key, 'diff', difference.image)
	}
	if (changed || unpaired) console.log(`Catalogue images: ${output}`)
	else if (!process.env.CHECKMATE_CATALOGUE_OUTPUT) rmSync(output, { recursive: true })
	console.log(`Catalogue comparison: ${changed} changed, ${unpaired} new or removed.`)
	if (changed && !reportOnly) {
		throw Error('Catalogue pixels changed. Review before.png, after.png and diff.png in the image output.')
	}
	if (changed) console.log('Catalogue differences accepted in report-only mode.')
}

async function main() {
	const revision = baselineRevision()
	console.log(`Catalogue baseline ${revision} vs working tree at ${git('rev-parse', 'HEAD')}`)
	const scratch = mkdtempSync(join(tmpdir(), 'checkmate-catalogue-'))
	const source = join(scratch, 'baseline')
	try {
		git('worktree', 'add', '--detach', source, revision)
		try {
			if (readFileSync(join(root, 'package-lock.json')).equals(readFileSync(join(source, 'package-lock.json')))) {
				symlinkSync(join(root, 'node_modules'), join(source, 'node_modules'), 'dir')
			} else {
				execFileSync('npm', ['ci'], { cwd: source, stdio: 'inherit' })
			}
			execFileSync('npm', ['run', 'build'], { cwd: source, stdio: 'inherit' })
			const browser = await chromium.launch()
			try {
				const before = await capture(browser, source, join(scratch, 'before'))
				const after = await capture(browser, root, join(scratch, 'after'))
				report(before, after)
			} finally {
				await browser.close()
			}
		} finally {
			git('worktree', 'remove', '--force', source)
		}
	} finally {
		rmSync(scratch, { recursive: true, force: true })
	}
}

try {
	await main()
} catch (error) {
	console.error('Could not pass the catalogue comparison.', error)
	process.exitCode = 1
}
