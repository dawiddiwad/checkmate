import type { Html } from './html.ts'
import type { Page } from './layout.ts'
import type { InvalidRecipe, ReachCheck, Recipe, RecipeCatalog, RecipeEntry } from '../recipes.ts'
import { listRecipes, projectRecipeFolder, recipeProblem, toolExecutable } from '../recipes.ts'
import { html, join } from './html.ts'
import { banner, emptyNotice, heading } from './layout.ts'
import { settingsPage } from './settings.ts'
import { listRow } from './lists.ts'

const agentOnly = '\n> **Agent only:** This file contains repository or workflow instructions for coding agents.\n\n'

function readCatalog(workspace: string): RecipeCatalog & { error: string | null } {
	try {
		return { ...listRecipes(workspace), error: null }
	} catch (error) {
		return { recipes: [], invalid: [], error: (error as Error).message }
	}
}

function fileName(path: string) {
	return path.split(/[\\/]/).at(-1)!
}

function invalidHref(item: InvalidRecipe) {
	return `/settings/invalid-recipes?file=${encodeURIComponent(fileName(item.path))}`
}

function invalidPill() {
	return html`<span class="sp-pill fail" data-source="invalid">Invalid</span>`
}

const sourceLabel = { 'built-in': 'Built-in', custom: 'Custom' }

function sourcePill(source: RecipeEntry['source']) {
	return html`<span class="sp-pill${source === 'custom' ? ' run' : ''}" data-source="${source}"
		>${sourceLabel[source]}</span
	>`
}

function codes(items: string[]) {
	return items.length
		? join(
				items.map((item) => html`<code>${item}</code>`),
				' '
			)
		: html`<span class="muted">none</span>`
}

function commandText(args: string[]) {
	return args.map((arg) => (/[\s"'\\]/.test(arg) ? JSON.stringify(arg) : arg)).join(' ')
}

function kindText(recipe: Recipe) {
	return recipe.kind === 'mcp' ? 'MCP server' : 'command-line tool'
}

function detection(recipe: Recipe) {
	return recipe.detect === 'runtime'
		? html`The Node.js that runs Checkmate`
		: html`<code>${toolExecutable(recipe)}</code> on <code>PATH</code>`
}

export function recipesPage(workspace: string): Page {
	const { recipes, invalid, error } = readCatalog(workspace)
	const rows = recipes.map(({ source, recipe }) =>
		listRow(`recipe:${recipe.name}`, `/settings/recipes/${recipe.name}`, recipe.name, sourcePill(source), [
			recipe.purpose,
			html`<span class="muted"
				><code>${recipe.capability}</code> · ${kindText(recipe)} · ${detection(recipe)}</span
			>`,
		])
	)
	const invalidRows = invalid.map((item) =>
		listRow(`invalid:${fileName(item.path)}`, invalidHref(item), item.name, invalidPill(), [
			'Checkmate does not use this recipe.',
			html`<span class="reason">${recipeProblem(item)}</span>`,
		])
	)
	const custom = recipes.some((entry) => entry.source === 'custom') || invalid.length
	const body = html`${heading(
			'Recipes',
			html`Tool descriptions for Checkmate. The target sets what testers may do. Built-in recipes come with
				Checkmate. Custom recipes come from <code>.checkmate/recipes/</code> in this workspace.`
		)}
		<div data-region="recipes">
			${error ? banner('fail', html`Checkmate cannot read the recipes. ${error}`) : ''}
			${
				rows.length + invalidRows.length
					? html`<ul class="q-items l-rows">
							${rows} ${invalidRows}
						</ul>`
					: ''
			}
			${
				custom || error
					? ''
					: emptyNotice(
							'No custom recipe yet.',
							html`Drop a recipe JSON file in <code>${projectRecipeFolder(workspace)}</code>.`
						)
			}
		</div>`
	return settingsPage('/settings/recipes', 'Recipes', ['recipes'], body)
}

function entryPoints(recipe: Recipe) {
	if (!recipe.entryPoints?.length) return html`<p class="none">No entry point. The recipe fits every target.</p>`
	return html`<ul class="plain">
		${recipe.entryPoints.map(
			(entry) =>
				html`<li>
					<code>${entry.name}</code>
					<span class="muted"
						>· ${entry.kind}${entry.pattern ? html` · format <code>${entry.pattern}</code>` : ''}</span
					>
					<br />${entry.purpose}
				</li>`
		)}
	</ul>`
}

function checkText(check: ReachCheck) {
	if (check.check === 'http')
		return html`HTTP request to the <code>${check.entry}</code> entry. It answers below HTTP 500.`
	return html`Command <code>${commandText(check.run)}</code> exits with code
		0${check.contains?.length ? html`, and its output contains ${codes(check.contains)}` : ''}.`
}

function reachability(recipe: Recipe) {
	if (!recipe.reachable?.length)
		return html`<p class="none">No check. Setup leaves the instance of the target not checked.</p>`
	return html`<ul class="plain">
		${recipe.reachable.map((check) => html`<li>${checkText(check)}</li>`)}
	</ul>`
}

function fact(label: string, value: Html | string, look = '') {
	return html`<dt>${label}</dt>
		<dd class="${look}">${value}</dd>`
}

function pairs(values: Record<string, string>) {
	const entries = Object.entries(values)
	return entries.length
		? html`<span class="kv">${entries.map(([key, value]) => html`<span class="tag">${key}=${value}</span>`)}</span>`
		: html`<span class="muted">none</span>`
}

function recipeFacts({ source, path, recipe }: RecipeEntry) {
	const server = recipe.server
	return html`<dl class="facts">
		${fact('Source', sourcePill(source))}
		${source === 'custom' ? fact('File', html`<code>${path}</code>`, 'path') : ''}
		${fact('Tool for', html`<code>${recipe.capability}</code> · ${kindText(recipe)}`)}
		${fact('Detection', detection(recipe))}
		${server ? fact('Server', html`<code>${commandText([server.command, ...server.args])}</code> in <code>${server.cwd}</code>`) : ''}
	</dl>`
}

function testingFacts(recipe: Recipe) {
	const observe = Object.entries(recipe.observeFrom).map(([value, reading]) => `${value} (${reading})`)
	return html`<dl class="facts">
		${fact('Observes from', codes(observe))} ${fact('Evidence', codes(recipe.evidence))}
		${recipe.evidenceExtensions ? fact('Evidence files', pairs(recipe.evidenceExtensions)) : ''}
		${fact('Environment', pairs(recipe.environment))} ${fact('Tool folders', codes(recipe.workspaceFolders))}
		${recipe.closeSession ? fact('Close session', html`<code>${commandText(recipe.closeSession)}</code>`) : ''}
		${recipe.shellInstruction ? fact('Shell notes', recipe.shellInstruction) : ''}
		${recipe.delegatedInstruction ? fact('Delegated notes', recipe.delegatedInstruction) : ''}
	</dl>`
}

function catalogFailure(title: string, error: string) {
	return settingsPage(
		'/settings/recipes',
		title,
		['recipes'],
		html`<div data-region="recipe">${banner('fail', html`Checkmate cannot read the recipes. ${error}`)}</div>`
	)
}

export function invalidRecipePage(workspace: string, file: string): Page | null {
	const { invalid, error } = readCatalog(workspace)
	if (error) return catalogFailure(file, error)
	const item = invalid.find((candidate) => fileName(candidate.path) === file)
	if (!item) return null
	const body = html`<div data-region="recipe">
		${heading(item.name, 'Checkmate does not use this recipe. A target, plan, run, or test that names it is refused.', html`<div class="meta">${invalidPill()}</div>`)}
		<div class="main-col">
			<section aria-labelledby="error">
				<h2 id="error">Error</h2>
				<pre class="sp-code" tabindex="0" data-error>${recipeProblem(item)}</pre>
			</section>
			<dl class="facts">
				${fact('Source', sourcePill(item.source))} ${fact('File', html`<code>${item.path}</code>`, 'path')}
				${fact('Fix', html`Edit this JSON file to fix the listed problems. The recipe appears in the list when it is valid.`)}
			</dl>
			<p class="back"><a href="/settings/recipes">All recipes</a></p>
		</div>
	</div>`
	return settingsPage('/settings/recipes', file, ['recipes'], body)
}

export function recipePage(workspace: string, name: string): Page | null {
	const { recipes, error } = readCatalog(workspace)
	if (error) return catalogFailure(name, error)
	const entry = recipes.find(({ recipe }) => recipe.name === name)
	if (!entry) return null
	const { recipe, jsonText } = entry
	const usage = recipe.usage?.join('\n')
	const usageText = entry.source === 'built-in' ? usage?.replace(agentOnly, '\n') : usage
	const body = html`<div data-region="recipe">
		${heading(recipe.name, recipe.purpose, html`<div class="meta">${sourcePill(entry.source)}</div>`)}
		<div class="main-col">
			<nav class="jump" aria-label="On this page">
				<a href="#recipe">Recipe</a><a href="#requires">Requires</a
				><a href="#testing">Testing</a>${usage !== undefined ? html`<a href="#usage">Usage</a>` : null}<a
					href="#json"
					>JSON</a
				>
			</nav>
			<section aria-labelledby="recipe">
				<h2 id="recipe">Recipe</h2>
				${recipeFacts(entry)}
			</section>
			<section aria-labelledby="requires">
				<h2 id="requires">Requires</h2>
				<h3>Entry points <span class="n">${recipe.entryPoints?.length ?? 0}</span></h3>
				${entryPoints(recipe)}
				<h3>Setup reachability checks</h3>
				${reachability(recipe)}
			</section>
			<section aria-labelledby="testing">
				<h2 id="testing">Testing</h2>
				${testingFacts(recipe)}
			</section>
			${
				usage !== undefined
					? html`<section aria-labelledby="usage">
							<h2 id="usage">Usage</h2>
							<pre class="sp-code" tabindex="0" data-usage>${usageText}</pre>
						</section>`
					: null
			}
			<details class="fold" data-open-key="section:json">
				<summary><h2 id="json">Recipe JSON</h2></summary>
				<div class="fold-b"><pre class="sp-code" tabindex="0" data-json>${jsonText}</pre></div>
			</details>
			<p class="back"><a href="/settings/recipes">All recipes</a></p>
		</div>
	</div>`
	return settingsPage('/settings/recipes', recipe.name, ['recipes'], body)
}
