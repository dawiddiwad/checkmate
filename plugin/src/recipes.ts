import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pluginRoot } from './sessions.ts'

// An entry point that an instance of a target needs when its tools use this recipe. Setup names it in the profile.
// The optional pattern is the format check of its value, a regular expression that setup tests the value with.
export type RecipeEntryPoint = { name: string; kind: 'url' | 'command' | 'value'; purpose: string; pattern?: string }

// How setup checks that an instance answers. All checks of the recipes of the target tools must pass.
// "http" fetches the value of an entry (it counts as answering below HTTP 500). "command" runs a program
// and passes on exit code 0, and, when "contains" is given, only when its output has each text.
// In "run" and "contains", {<entry name>} stands for the value of that entry. Core knows only these two kinds.
export type ReachCheck = { check: 'http'; entry: string } | { check: 'command'; run: string[]; contains?: string[] }

export type Recipe = {
	name: string
	capability: string
	kind: 'cli'
	purpose: string
	detect: 'path' | 'runtime'
	// What the target needs. A recipe without entry points fits every target.
	entryPoints?: RecipeEntryPoint[]
	reachable?: ReachCheck[]
	environment: Record<string, string>
	shellInstruction?: string
	delegatedInstruction?: string
	closeSession?: string[]
	workspaceFolders: string[]
	observeFrom: Record<string, ObserveReading>
	evidence: string[]
	evidenceExtensions?: Record<string, string>
	usage: string
}

// "view" reads what the tool shows now; it does not show that a stored state changed. "state" reads the stored state.
export type ObserveReading = 'view' | 'state'

// The values that every target accepted up to 0.8.2, before tools had recipes. They stay accepted for all targets:
// plans and results stored before recipes must stay valid, and a tester can use a host tool that no recipe describes.
// Do not add to these lists. A new value comes only from a recipe.
export const compatibleObserveFrom: Record<string, ObserveReading> = { page: 'view', reload: 'state', api: 'state' }
export const compatibleEvidence = ['observation', 'http_exchange', 'screenshot', 'trace']
export const compatibleExtensions: Record<string, string> = {
	'.png': 'screenshot',
	'.jpg': 'screenshot',
	'.jpeg': 'screenshot',
	'.webp': 'screenshot',
	'.zip': 'trace',
	'.trace': 'trace',
}
const compatibleSource = 'accepted for all targets'

export type SessionValues = { session: string; workFolder: string }

let loaded: Recipe[] | undefined

function isText(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== ''
}

function readRecipe(folder: string, file: string): Recipe {
	const refuse = (problem: string): never => {
		throw Error(`Tool recipe ${join(folder, file)} is not valid: ${problem}`)
	}
	let recipe: Partial<Recipe> = {}
	try {
		recipe = JSON.parse(readFileSync(join(folder, file), 'utf8'))
	} catch (error) {
		refuse(`it is not JSON (${(error as Error).message}).`)
	}
	if (typeof recipe !== 'object' || recipe === null || Array.isArray(recipe)) refuse('it is not a JSON object.')
	if (!isText(recipe.name) || `${recipe.name}.json` !== file) refuse('name must be the file name without .json.')
	if (!isText(recipe.capability)) refuse('capability must be a text.')
	if (recipe.kind !== 'cli') refuse('kind must be cli.')
	if (!isText(recipe.purpose)) refuse('purpose must be a text.')
	if (recipe.detect !== 'path' && recipe.detect !== 'runtime') refuse('detect must be path or runtime.')
	const environment: unknown = recipe.environment
	if (
		typeof environment !== 'object' ||
		environment === null ||
		Array.isArray(environment) ||
		Object.values(environment).some((value) => typeof value !== 'string')
	)
		refuse('environment must be an object of texts.')
	if (recipe.entryPoints !== undefined) readEntryPoints(recipe.entryPoints, refuse)
	if (recipe.reachable !== undefined) readReachable(recipe, refuse)
	if (recipe.shellInstruction !== undefined && !isText(recipe.shellInstruction))
		refuse('shellInstruction must be a text when it is given.')
	if (recipe.delegatedInstruction !== undefined && !isText(recipe.delegatedInstruction))
		refuse('delegatedInstruction must be a text when it is given.')
	if (
		recipe.closeSession !== undefined &&
		(!Array.isArray(recipe.closeSession) || !recipe.closeSession.length || !recipe.closeSession.every(isText))
	)
		refuse('closeSession must be a list of arguments when it is given.')
	if (!Array.isArray(recipe.workspaceFolders) || !recipe.workspaceFolders.every(isText))
		refuse('workspaceFolders must be a list of folder names.')
	const observeFrom: unknown = recipe.observeFrom
	if (
		typeof observeFrom !== 'object' ||
		observeFrom === null ||
		Array.isArray(observeFrom) ||
		!Object.keys(observeFrom).every(isValueName) ||
		!Object.values(observeFrom).every((reading) => reading === 'view' || reading === 'state')
	)
		refuse('observeFrom must be an object that maps each value name to view or state.')
	if (!Array.isArray(recipe.evidence) || !recipe.evidence.every(isValueName))
		refuse('evidence must be a list of evidence kind names.')
	const extensions: unknown = recipe.evidenceExtensions
	if (
		extensions !== undefined &&
		(typeof extensions !== 'object' ||
			extensions === null ||
			Array.isArray(extensions) ||
			!Object.keys(extensions).every((extension) => /^\.[a-z0-9]{1,10}$/.test(extension)) ||
			!Object.values(extensions).every(
				(kind) => recipe.evidence?.includes(kind) || compatibleEvidence.includes(kind)
			))
	)
		refuse('evidenceExtensions must map each file extension, for example .mp4, to an evidence kind of the recipe.')
	if (!isText(recipe.usage) || !existsSync(join(folder, recipe.usage)))
		refuse('usage must name a file in the folder.')
	return recipe as Recipe
}

function readEntryPoints(value: unknown, refuse: (problem: string) => never) {
	const entryPointProblem =
		'entryPoints must be a list of {name, kind (url, command, or value), purpose, pattern (optional regular expression)}.'
	if (!Array.isArray(value) || !value.length) refuse(entryPointProblem)
	const names = new Set<string>()
	for (const entry of value as Array<Record<string, unknown>>) {
		if (
			typeof entry !== 'object' ||
			entry === null ||
			typeof entry.name !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(entry.name) ||
			!['url', 'command', 'value'].includes(entry.kind as string) ||
			!isText(entry.purpose) ||
			Object.keys(entry).some((key) => !['name', 'kind', 'purpose', 'pattern'].includes(key))
		)
			refuse(entryPointProblem)
		if (names.has(entry.name as string)) refuse(`entryPoints names ${entry.name} twice.`)
		names.add(entry.name as string)
		if (entry.pattern !== undefined) {
			try {
				if (!isText(entry.pattern)) throw Error('not a text')
				new RegExp(entry.pattern)
			} catch {
				refuse(`the pattern of entry point ${entry.name} is not a regular expression.`)
			}
		}
	}
}

function readReachable(recipe: Partial<Recipe>, refuse: (problem: string) => never) {
	const problem =
		'reachable must be a list of {check: "http", entry} or {check: "command", run (list of arguments), contains (optional list of texts)}.'
	const checks: unknown = recipe.reachable
	if (!Array.isArray(checks) || !checks.length) refuse(problem)
	const entries = (recipe.entryPoints ?? []).map((entry) => entry.name)
	for (const check of checks as Array<Record<string, unknown>>) {
		if (typeof check !== 'object' || check === null) refuse(problem)
		if (check.check === 'http') {
			if (Object.keys(check).some((key) => key !== 'check' && key !== 'entry') || !isText(check.entry))
				refuse(problem)
			if (!entries.includes(check.entry as string))
				refuse(`reachable names the entry ${check.entry}, which entryPoints does not give.`)
		} else if (check.check === 'command') {
			if (
				Object.keys(check).some((key) => !['check', 'run', 'contains'].includes(key)) ||
				!Array.isArray(check.run) ||
				!check.run.length ||
				!check.run.every(isText) ||
				(check.contains !== undefined && (!Array.isArray(check.contains) || !check.contains.every(isText)))
			)
				refuse(problem)
		} else refuse(problem)
	}
}

// A value name is a lower-case word, for example page or http_exchange.
function isValueName(value: unknown) {
	return typeof value === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(value)
}

export function readRecipes(folder: string) {
	const found = readdirSync(folder)
		.filter((file) => file.endsWith('.json'))
		.sort()
		.map((file) => readRecipe(folder, file))
	// One observeFrom value has one reading in every recipe, so a check reads the same in each target.
	const readings = new Map(
		Object.entries(compatibleObserveFrom).map(([value, reading]) => [
			value,
			{ reading, from: 'the values accepted for all targets' },
		])
	)
	for (const recipe of found)
		for (const [value, reading] of Object.entries(recipe.observeFrom)) {
			const known = readings.get(value)
			if (known && known.reading !== reading)
				throw Error(
					`Tool recipe ${join(folder, `${recipe.name}.json`)} is not valid: observeFrom ${value} is ${reading}, but it is ${known.reading} in ${known.from}.`
				)
			readings.set(value, { reading, from: `recipe ${recipe.name}` })
		}
	// One entry point name means the same in every recipe: the same kind, purpose, and pattern.
	const entryPoints = new Map<string, { entry: string; from: string }>()
	for (const recipe of found)
		for (const entry of recipe.entryPoints ?? []) {
			const text = JSON.stringify([entry.kind, entry.purpose, entry.pattern ?? null])
			const known = entryPoints.get(entry.name)
			if (known && known.entry !== text)
				throw Error(
					`Tool recipe ${join(folder, `${recipe.name}.json`)} is not valid: entry point ${entry.name} differs from the one in ${known.from}.`
				)
			entryPoints.set(entry.name, { entry: text, from: `recipe ${recipe.name}` })
		}
	// One file extension has one default evidence kind in every recipe.
	const kinds = new Map(
		Object.entries(compatibleExtensions).map(([extension, kind]) => [
			extension,
			{ kind, from: 'the kinds accepted for all targets' },
		])
	)
	for (const recipe of found)
		for (const [extension, kind] of Object.entries(recipe.evidenceExtensions ?? {})) {
			const known = kinds.get(extension)
			if (known && known.kind !== kind)
				throw Error(
					`Tool recipe ${join(folder, `${recipe.name}.json`)} is not valid: evidenceExtensions ${extension} is ${kind}, but it is ${known.kind} in ${known.from}.`
				)
			kinds.set(extension, { kind, from: `recipe ${recipe.name}` })
		}
	return found
}

export function recipes() {
	loaded ??= readRecipes(join(pluginRoot, 'recipes'))
	return loaded
}

export function filled(text: string, values: SessionValues) {
	return text.replaceAll('{session}', values.session).replaceAll('{workFolder}', values.workFolder)
}

export function testerEnvironment(values: SessionValues) {
	return Object.fromEntries(
		recipes().flatMap((recipe) =>
			Object.entries(recipe.environment).map(([name, value]) => [name, filled(value, values)])
		)
	)
}

export function shellInstructions(values: SessionValues) {
	return recipes().flatMap((recipe) => (recipe.shellInstruction ? [filled(recipe.shellInstruction, values)] : []))
}

// The recipes of the named tools, in recipe order. A tool without a recipe has none.
export function recipesFor(toolNames: string[]) {
	return recipes().filter((recipe) => toolNames.includes(recipe.name))
}

// The entry points that the recipes declare, by name. The same name has the same meaning in every recipe.
export function declaredEntryPoints() {
	const found = new Map<string, RecipeEntryPoint>()
	for (const recipe of recipes()) for (const entry of recipe.entryPoints ?? []) found.set(entry.name, entry)
	return found
}

// A recipe fits a set of entry names when each entry point of the recipe is in the set.
export function fitsEntries(recipe: Recipe, names: string[]) {
	return (recipe.entryPoints ?? []).every((entry) => names.includes(entry.name))
}

export function toolFolders() {
	return recipes().flatMap((recipe) => recipe.workspaceFolders)
}

// The full paths of the usage texts of the named tools that have a recipe, in recipe order.
export function usageFiles(toolNames: string[]) {
	return recipesFor(toolNames).map((recipe) => join(pluginRoot, 'recipes', recipe.usage))
}

export type Choice = { value: string; from: string[] }

// The values that a target accepts: the values of the recipes of its tools, and the compatible values.
// Each value names where it comes from, so that a refusal can say it.
function choices(toolNames: string[], compatible: string[], values: (recipe: Recipe) => string[]): Choice[] {
	const found = new Map<string, string[]>(compatible.map((value) => [value, [compatibleSource]]))
	for (const recipe of recipesFor(toolNames))
		for (const value of values(recipe)) found.set(value, [...(found.get(value) ?? []), `recipe ${recipe.name}`])
	return [...found].map(([value, from]) => ({ value, from }))
}

export function observeFromChoices(toolNames: string[]) {
	return choices(toolNames, Object.keys(compatibleObserveFrom), (recipe) => Object.keys(recipe.observeFrom))
}

export function evidenceChoices(toolNames: string[]) {
	return choices(toolNames, compatibleEvidence, (recipe) => recipe.evidence)
}

// Every value that some recipe or the compatible list gives. The contracts list these values; npm run generate writes them.
export function allObserveFrom() {
	return observeFromChoices(recipes().map((recipe) => recipe.name)).map((choice) => choice.value)
}

export function allEvidence() {
	return evidenceChoices(recipes().map((recipe) => recipe.name)).map((choice) => choice.value)
}

export type ObserveValue = { value: string; reading: ObserveReading; tool: string }

// The observeFrom values that the recipes of the named tools give, with their reading. Not the compatible list:
// a planner is told only what the tools of its target give.
export function observeFromValues(toolNames: string[]): ObserveValue[] {
	return recipesFor(toolNames).flatMap((recipe) =>
		Object.entries(recipe.observeFrom).map(([value, reading]) => ({ value, reading, tool: recipe.name }))
	)
}

const readingText: Record<ObserveReading, string> = {
	view: 'reads only what the tool shows now',
	state: 'reads the stored state',
}

// The rule of a plan prompt for the observeFrom of an assertion on a state-changing action. It lists exactly the
// values that the recipes of the target tools give, each with its reading. The quote is the quote mark that the
// prompt uses around a value.
export function observeFromRule(toolNames: string[], quote = '"') {
	const q = (value: string) => `${quote}${value}${quote}`
	const listed = observeFromValues(toolNames)
		.map(({ value, reading }) => `${q(value)} (${reading}: ${readingText[reading]})`)
		.join(', ')
	return [
		`An assertion on a state-changing action (add, apply, clear, delete, save) checks the source of truth: the stored state. What the tool shows now does not show that the state changed. Set ${q('observeFrom')} to one of the values of the tools of this target: ${listed}.`,
		'Use a state value for a check of a state change. Use a view value only for a check that is not a state change. A state-changing test whose checks all use a view value is refused once and then saved as not ready.',
	].join(' ')
}

export function observeReading(value: string): ObserveReading | undefined {
	return compatibleObserveFrom[value] ?? recipes().find((recipe) => recipe.observeFrom[value])?.observeFrom[value]
}

// The recipes that give a value, for example "recipe maestro". A value can come from no recipe and no tool of a target.
export function givenBy(value: string) {
	const names = recipes()
		.filter((recipe) => value in recipe.observeFrom || recipe.evidence.includes(value))
		.map((recipe) => `recipe ${recipe.name}`)
	return names.length ? `${names.join(' and ')} ${names.length === 1 ? 'gives' : 'give'} it` : 'no recipe gives it'
}

// For example: page (accepted for all targets, recipe playwright-cli), api (accepted for all targets, recipe node).
export function choiceText(found: Choice[]) {
	return found.map((choice) => `${choice.value} (${choice.from.join(', ')})`).join(', ')
}

// The evidence kind of a file without a given kind: from the recipes of the target's tools, then the compatible list.
export function evidenceKindOfFile(toolNames: string[], extension: string) {
	const recipe = recipesFor(toolNames).find((recipe) => recipe.evidenceExtensions?.[extension])
	return recipe?.evidenceExtensions?.[extension] ?? compatibleExtensions[extension]
}
