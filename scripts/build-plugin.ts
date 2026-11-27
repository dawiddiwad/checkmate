import { build } from 'esbuild'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const shared = {
	absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
	bundle: true,
	legalComments: 'none',
	write: false,
} as const
const cli = await build({
	...shared,
	entryPoints: [fileURLToPath(new URL('../cli/src/main.ts', import.meta.url))],
	platform: 'node',
	format: 'esm',
	target: 'node24',
	banner: { js: '#!/usr/bin/env node' },
})
const client = await build({
	...shared,
	entryPoints: [fileURLToPath(new URL('../plugin/src/ui/client/main.js', import.meta.url))],
	platform: 'browser',
	format: 'iife',
})
// The review UI serves one stylesheet: these files of plugin/src/ui/, joined in this order.
// tokens.css comes first. The order after it keeps the cascade: when two rules in different files
// can set the same property of one element with the same specificity, the file of the rule that
// must win comes later. Check the cascade before you move a file.
const stylesheets = [
	'tokens.css',
	'base.css',
	'components/key.css',
	'components/brand.css',
	'components/status-bar.css',
	'components/status-mark.css',
	'components/empty-state.css',
	'components/button.css',
	'components/panel.css',
	'components/facts.css',
	'components/fold.css',
	'components/field.css',
	'components/data-table.css',
	'components/menu.css',
	'components/nav-rail.css',
	'components/board.css',
	'components/evidence-viewer.css',
	'components/drawer.css',
	'components/bulk-bar.css',
	'components/notice.css',
	'components/keys-help.css',
	'components/find-palette.css',
	'components/record-list.css',
	'components/list-row.css',
	'layout.css',
	'components/plan-tile.css',
	'components/radio-group.css',
	'components/metric.css',
	'components/banner.css',
	'components/confirm-dialog.css',
	'components/chips.css',
	'components/tabs.css',
	'components/filters.css',
	'components/glyph.css',
	'print.css',
	'forced-colors.css',
	'pressed.css',
	'components/stepper.css',
	'components/request-record.css',
	'components/start-form.css',
	'components/code-block.css',
	'components/chat-workspace.css',
	'components/chat-turn.css',
	'components/composer.css',
	'components/tester-card.css',
	'screens/catalogue.css',
]
const ui = new URL('../plugin/src/ui/', import.meta.url)
const found = (await readdir(ui, { recursive: true })).filter((name) => name.endsWith('.css')).sort()
assert.deepEqual(
	found,
	[...stylesheets].sort(),
	'List each stylesheet of plugin/src/ui/ once in scripts/build-plugin.ts'
)
const parts = await Promise.all(
	stylesheets.map(async (name) => `/* ${name} */\n${await readFile(new URL(name, ui), 'utf8')}`)
)
const style = parts.join('\n')
const outputs: Array<[URL, string]> = [
	[new URL('../plugin/dist/checkmate.js', import.meta.url), cli.outputFiles[0].text],
	[new URL('../plugin/dist/client.js', import.meta.url), client.outputFiles[0].text],
	[new URL('../plugin/dist/style.css', import.meta.url), style],
]
for (const [output, text] of outputs) {
	if (process.argv.includes('--check')) {
		assert.equal(await readFile(output, 'utf8').catch(() => ''), text, 'Run npm run build')
	} else {
		await mkdir(new URL('.', output), { recursive: true })
		await writeFile(output, text)
	}
}
