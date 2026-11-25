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

// How Checkmate starts the MCP server of a recipe of kind mcp. args and cwd can contain {session} and {workFolder}.
export type ToolServer = { command: string; args: string[]; cwd: string }

export type Recipe = {
	name: string
	capability: string
	kind: 'cli' | 'mcp'
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
	// Kind mcp only: the server that Checkmate starts, and the exact names of its tools that a tester can call.
	server?: ToolServer
	tools?: string[]
	// Kind mcp only: the arguments that a call of a tool may not give, by tool name, for example {"run": ["dir"]}.
	refusedArguments?: Record<string, string[]>
	// Kind mcp only: arguments that must have the value of an instance entry, for example {"device_id": "device"}.
	// A call without the argument gets the entry value.
	entryArguments?: Record<string, string>
}

// "view" reads what the tool shows now; it does not show that a stored state changed. "state" reads the stored state.
export type ObserveReading = 'view' | 'state'

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
	if (recipe.kind !== 'cli' && recipe.kind !== 'mcp') refuse('kind must be cli or mcp.')
	if (recipe.kind === 'mcp') readServer(recipe, refuse)
	else if (recipe.server !== undefined || recipe.tools !== undefined)
		refuse('server and tools are only for a recipe of kind mcp.')
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
			!Object.values(extensions).every((kind) => recipe.evidence?.includes(kind)))
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

// A recipe of kind mcp runs a command: Checkmate starts its server for each tester session that uses it.
function readServer(recipe: Partial<Recipe>, refuse: (problem: string) => never) {
	const server: unknown = recipe.server
	if (
		typeof server !== 'object' ||
		server === null ||
		Array.isArray(server) ||
		Object.keys(server).some((key) => !['command', 'args', 'cwd'].includes(key)) ||
		!isText((server as ToolServer).command) ||
		!Array.isArray((server as ToolServer).args) ||
		!(server as ToolServer).args.every(isText) ||
		!isText((server as ToolServer).cwd)
	)
		refuse('server must be {command, args (list of arguments), cwd} for a recipe of kind mcp.')
	if (
		!Array.isArray(recipe.tools) ||
		!recipe.tools.length ||
		!recipe.tools.every((name) => typeof name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(name))
	)
		refuse('tools must list the names of the server tools that a tester can call.')
	if (recipe.closeSession !== undefined || recipe.shellInstruction !== undefined)
		refuse('a recipe of kind mcp has no closeSession or shellInstruction: Checkmate stops its server.')
	const refused: unknown = recipe.refusedArguments
	if (
		refused !== undefined &&
		(typeof refused !== 'object' ||
			refused === null ||
			Array.isArray(refused) ||
			!Object.keys(refused).every((tool) => recipe.tools?.includes(tool)) ||
			!Object.values(refused).every((names) => Array.isArray(names) && names.length && names.every(isText)))
	)
		refuse('refusedArguments must map a tool of the recipe to the names of the arguments that it may not give.')
	const entries = (recipe.entryPoints ?? []).map((entry) => entry.name)
	const pinned: unknown = recipe.entryArguments
	if (
		pinned !== undefined &&
		(typeof pinned !== 'object' ||
			pinned === null ||
			Array.isArray(pinned) ||
			!Object.keys(pinned).every(isText) ||
			!Object.values(pinned).every((entry) => entries.includes(entry)))
	)
		refuse('entryArguments must map an argument name to an entry point of the recipe.')
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
	const readings = new Map<string, { reading: ObserveReading; from: string }>()
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
	const kinds = new Map<string, { kind: string; from: string }>()
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

// The environment of a recipe of kind mcp is the environment of its server, not of the tester.
export function testerEnvironment(values: SessionValues) {
	return Object.fromEntries(
		recipes()
			.filter((recipe) => recipe.kind === 'cli')
			.flatMap((recipe) =>
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

// The program that detection looks for on PATH.
export function toolExecutable(recipe: Recipe) {
	return recipe.server?.command ?? recipe.name
}

// The tools that one tester session uses. When two recipes of the tools give one capability, the tester gets one:
// the recipe of kind mcp where Checkmate attaches its server, and the other recipe where it cannot. A tester
// with only the recipe of kind mcp keeps it; its usage text says what to do when the server is missing.
export function testerTools(toolNames: string[], attached: boolean) {
	const given = recipesFor(toolNames)
	const dropped = given.filter((recipe) => {
		const others = given.filter((other) => other !== recipe && other.capability === recipe.capability)
		if (!others.length) return false
		return attached ? recipe.kind !== 'mcp' && others.some((other) => other.kind === 'mcp') : recipe.kind === 'mcp'
	})
	return toolNames.filter((name) => !dropped.some((recipe) => recipe.name === name))
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

function choices(toolNames: string[], values: (recipe: Recipe) => string[]): Choice[] {
	const found = new Map<string, string[]>()
	for (const recipe of recipesFor(toolNames))
		for (const value of values(recipe)) found.set(value, [...(found.get(value) ?? []), `recipe ${recipe.name}`])
	return [...found].map(([value, from]) => ({ value, from }))
}

export function observeFromChoices(toolNames: string[]) {
	return choices(toolNames, (recipe) => Object.keys(recipe.observeFrom))
}

export function evidenceChoices(toolNames: string[]) {
	return [{ value: 'observation', from: ['built in'] }, ...choices(toolNames, (recipe) => recipe.evidence)]
}

export function allObserveFrom() {
	return observeFromChoices(recipes().map((recipe) => recipe.name)).map((choice) => choice.value)
}

export function allEvidence() {
	return evidenceChoices(recipes().map((recipe) => recipe.name)).map((choice) => choice.value)
}

export type ObserveValue = { value: string; reading: ObserveReading; tool: string }

export function observeFromValues(toolNames: string[]): ObserveValue[] {
	const all = recipesFor(toolNames).flatMap((recipe) =>
		Object.entries(recipe.observeFrom).map(([value, reading]) => ({ value, reading, tool: recipe.name }))
	)
	return all.filter((item, index) => all.findIndex((other) => other.value === item.value) === index)
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
	const values = observeFromValues(toolNames)
	if (!values.length) return `Omit ${q('observeFrom')}. The tools of this target give no values for it.`
	const listed = values.map(({ value, reading }) => `${q(value)} (${reading}: ${readingText[reading]})`).join(', ')
	return [
		`An assertion on a state-changing action (add, apply, clear, delete, save) checks the source of truth: the stored state. What the tool shows now does not show that the state changed. Set ${q('observeFrom')} to one of the values of the tools of this target: ${listed}.`,
		'Use a state value for a check of a state change. Use a view value only for a check that is not a state change. A state-changing test whose checks all use a view value is refused once and then saved as not ready.',
	].join(' ')
}

export function observeReading(value: string): ObserveReading | undefined {
	return recipes().find((recipe) => Object.hasOwn(recipe.observeFrom, value))?.observeFrom[value]
}

// The recipes that give a value, for example "recipe maestro". A value can come from no recipe and no tool of a target.
export function givenBy(value: string) {
	const names = recipes()
		.filter((recipe) => Object.hasOwn(recipe.observeFrom, value) || recipe.evidence.includes(value))
		.map((recipe) => `recipe ${recipe.name}`)
	return names.length ? `${names.join(' and ')} ${names.length === 1 ? 'gives' : 'give'} it` : 'no recipe gives it'
}

export function choiceText(found: Choice[]) {
	return found.map((choice) => `${choice.value} (${choice.from.join(', ')})`).join(', ') || 'none'
}

export function evidenceKindOfFile(toolNames: string[], extension: string) {
	const recipe = recipesFor(toolNames).find((recipe) => recipe.evidenceExtensions?.[extension])
	return recipe?.evidenceExtensions?.[extension]
}
