import { existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
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

export type RecipeEntry = {
	source: 'built-in' | 'custom'
	path: string
	recipe: Recipe
	jsonText: string
	usagePath: string
	usageText: string
}

let builtIn: RecipeEntry[] | undefined

function isIdentifier(value: unknown): value is string {
	return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value)
}

function isText(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== ''
}

function readRecipe(path: string, source: RecipeEntry['source']): RecipeEntry {
	const file = basename(path)
	const refuse = (problem: string): never => {
		throw Error(`Tool recipe ${path} is not valid: ${problem}`)
	}
	let recipe: Partial<Recipe> = {}
	let jsonText = ''
	if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) refuse('give a regular JSON file.')
	try {
		jsonText = readFileSync(path, 'utf8')
		recipe = JSON.parse(jsonText)
	} catch (error) {
		refuse(`it is not JSON (${(error as Error).message}).`)
	}
	if (typeof recipe !== 'object' || recipe === null || Array.isArray(recipe)) refuse('it is not a JSON object.')
	if (!isIdentifier(recipe.name) || `${recipe.name}.json` !== file)
		refuse('name must match the file name without .json and use letters, numbers, dashes, or underscores.')
	if (!isIdentifier(recipe.capability))
		refuse('capability must use 1 to 96 letters, digits, dashes, or underscores, starting with a letter or digit.')
	if (recipe.kind !== 'cli' && recipe.kind !== 'mcp') refuse('kind must be cli or mcp.')
	if (recipe.kind === 'mcp') readServer(recipe, refuse)
	else if (
		[recipe.server, recipe.tools, recipe.refusedArguments, recipe.entryArguments].some(
			(value) => value !== undefined
		)
	)
		refuse('server, tools, refusedArguments, and entryArguments are only for a recipe of kind mcp.')
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
	if (
		!Array.isArray(recipe.workspaceFolders) ||
		!recipe.workspaceFolders.every(
			(name) =>
				isText(name) &&
				/^[a-zA-Z0-9._-]+$/.test(name) &&
				!['.', '..', '.checkmate', '.git'].includes(name.toLowerCase())
		)
	)
		refuse('workspaceFolders must list top-level tool folder names. Use a name other than .checkmate or .git.')
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
	const usage = recipe.usage
	if (typeof usage !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/.test(usage))
		return refuse('usage must name a Markdown file beside the recipe.')
	const usagePath = join(dirname(path), usage)
	if (!lstatSync(usagePath, { throwIfNoEntry: false })?.isFile())
		return refuse(`usage must name a regular Markdown file beside the recipe: ${usagePath}.`)
	try {
		return {
			source,
			path,
			recipe: recipe as Recipe,
			jsonText,
			usagePath,
			usageText: readFileSync(usagePath, 'utf8'),
		}
	} catch (error) {
		return refuse(`usage could not read ${usagePath}: ${(error as Error).message}`)
	}
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
			!isIdentifier(entry.name) ||
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

function readRecipes(folder: string, source: RecipeEntry['source']) {
	return readdirSync(folder)
		.filter((file) => file.endsWith('.json'))
		.sort()
		.map((file) => readRecipe(join(folder, file), source))
}

function checkRecipes(found: RecipeEntry[]) {
	const names = new Map<string, RecipeEntry>()
	const serverNames = new Set<string>()
	for (const entry of found) {
		const { name, kind } = entry.recipe
		const known = names.get(name.toLowerCase())
		if (known)
			throw Error(
				`Tool recipe ${entry.path} is not valid: name ${name} is in use by the ${known.source} recipe ${known.path}. Choose a different name.`
			)
		names.set(name.toLowerCase(), entry)
		if (kind !== 'mcp') continue
		const server = serverName(entry.recipe)
		if (serverNames.has(server.toLowerCase()))
			throw Error(
				`Tool recipe ${entry.path} is not valid: name ${name} gives the MCP server name ${server}, which is in use. Choose a different name.`
			)
		serverNames.add(server.toLowerCase())
	}
	// One observeFrom value has one reading in every recipe, so a check reads the same in each target.
	const readings = new Map<string, { reading: ObserveReading; from: string }>()
	for (const { recipe, path } of found)
		for (const [value, reading] of Object.entries(recipe.observeFrom)) {
			const known = readings.get(value)
			if (known && known.reading !== reading)
				throw Error(
					`Tool recipe ${path} is not valid: observeFrom ${value} is ${reading}, but it is ${known.reading} in ${known.from}.`
				)
			readings.set(value, { reading, from: `recipe ${recipe.name}` })
		}
	// One entry point name means the same in every recipe: the same kind, purpose, and pattern.
	const entryPoints = new Map<string, { entry: string; from: string }>()
	for (const { recipe, path } of found)
		for (const entry of recipe.entryPoints ?? []) {
			const text = JSON.stringify([entry.kind, entry.purpose, entry.pattern ?? null])
			const known = entryPoints.get(entry.name)
			if (known && known.entry !== text)
				throw Error(
					`Tool recipe ${path} is not valid: entry point ${entry.name} differs from the one in ${known.from}.`
				)
			entryPoints.set(entry.name, { entry: text, from: `recipe ${recipe.name}` })
		}
	// One file extension has one default evidence kind in every recipe.
	const kinds = new Map<string, { kind: string; from: string }>()
	for (const { recipe, path } of found)
		for (const [extension, kind] of Object.entries(recipe.evidenceExtensions ?? {})) {
			const known = kinds.get(extension)
			if (known && known.kind !== kind)
				throw Error(
					`Tool recipe ${path} is not valid: evidenceExtensions ${extension} is ${kind}, but it is ${known.kind} in ${known.from}.`
				)
			kinds.set(extension, { kind, from: `recipe ${recipe.name}` })
		}
	return found
}

function customFolder(workspace: string) {
	const checkmate = join(workspace, '.checkmate')
	const folder = join(checkmate, 'recipes')
	for (const path of [checkmate, folder]) {
		const entry = lstatSync(path, { throwIfNoEntry: false })
		if (entry && !entry.isDirectory()) throw Error(`Tool recipes require a directory at ${path}.`)
	}
	return folder
}

export function listRecipes(workspace: string): RecipeEntry[] {
	builtIn ??= readRecipes(join(pluginRoot, 'recipes'), 'built-in')
	const folder = customFolder(workspace)
	return checkRecipes([...builtIn, ...(existsSync(folder) ? readRecipes(folder, 'custom') : [])])
}

export function addRecipe(workspace: string, path: string) {
	const entry = readRecipe(path, 'custom')
	const folder = customFolder(workspace)
	const destination = join(folder, basename(path))
	const usagePath = join(folder, basename(entry.usagePath))
	mkdirSync(folder, { recursive: true })
	const lock = join(folder, '.add')
	try {
		mkdirSync(lock)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST')
			throw Error(`Another recipe add is using ${folder}. Run the command again after it finishes.`, {
				cause: error,
			})
		throw error
	}
	try {
		checkRecipes([...listRecipes(workspace), entry])
		if (existsSync(usagePath))
			throw Error(`usage file ${usagePath} already exists. Choose a different usage file name.`)
		const json = join(lock, basename(path))
		const usage = join(lock, basename(usagePath))
		writeFileSync(json, entry.jsonText)
		writeFileSync(usage, entry.usageText)
		linkSync(usage, usagePath)
		try {
			linkSync(json, destination)
		} catch (error) {
			rmSync(usagePath)
			throw error
		}
		return { ...entry, path: destination, usagePath }
	} finally {
		rmSync(lock, { recursive: true, force: true })
	}
}

export function recipes(workspace: string) {
	return listRecipes(workspace).map(({ recipe }) => recipe)
}

export function filled(text: string, values: SessionValues) {
	return text.replaceAll('{session}', values.session).replaceAll('{workFolder}', values.workFolder)
}

// The environment of a recipe of kind mcp is the environment of its server, not of the tester.
export function testerEnvironment(workspace: string, values: SessionValues, toolNames: string[]) {
	return Object.fromEntries(
		listRecipes(workspace)
			.filter(
				({ source, recipe }) =>
					recipe.kind === 'cli' && (source === 'built-in' || toolNames.includes(recipe.name))
			)
			.flatMap(({ recipe }) =>
				Object.entries(recipe.environment).map(([name, value]) => [name, filled(value, values)])
			)
	)
}

export function shellInstructions(workspace: string, values: SessionValues, toolNames: string[]) {
	return listRecipes(workspace).flatMap(({ recipe, source }) =>
		recipe.shellInstruction && (source === 'built-in' || toolNames.includes(recipe.name))
			? [filled(recipe.shellInstruction, values)]
			: []
	)
}

// The recipes of the named tools, in recipe order. A tool without a recipe has none.
export function recipesFor(workspace: string, toolNames: string[]) {
	return recipes(workspace).filter((recipe) => toolNames.includes(recipe.name))
}

// The program that detection looks for on PATH.
export function toolExecutable(recipe: Recipe) {
	return recipe.server?.command ?? recipe.name
}

// The tools that one tester session uses. When two recipes of the tools give one capability, the tester gets one:
// the recipe of kind mcp where Checkmate attaches its server, and the other recipe where it cannot. A tester
// with only the recipe of kind mcp keeps it; its usage text says what to do when the server is missing.
export function testerTools(workspace: string, toolNames: string[], attached: boolean) {
	const given = recipesFor(workspace, toolNames)
	const dropped = given.filter((recipe) => {
		const others = given.filter((other) => other !== recipe && other.capability === recipe.capability)
		if (!others.length) return false
		return attached ? recipe.kind !== 'mcp' && others.some((other) => other.kind === 'mcp') : recipe.kind === 'mcp'
	})
	return toolNames.filter((name) => !dropped.some((recipe) => recipe.name === name))
}

// The entry points that the recipes declare, by name. The same name has the same meaning in every recipe.
export function declaredEntryPoints(catalog: Recipe[]) {
	const found = new Map<string, RecipeEntryPoint>()
	for (const recipe of catalog) for (const entry of recipe.entryPoints ?? []) found.set(entry.name, entry)
	return found
}

// A recipe fits a set of entry names when each entry point of the recipe is in the set.
export function fitsEntries(recipe: Recipe, names: string[]) {
	return (recipe.entryPoints ?? []).every((entry) => names.includes(entry.name))
}

export function toolFolders(workspace: string, toolNames: string[]) {
	return listRecipes(workspace).flatMap(({ recipe, source }) =>
		source === 'built-in' || toolNames.includes(recipe.name) ? recipe.workspaceFolders : []
	)
}

export function serverName(recipe: Recipe) {
	return recipe.name.replaceAll('-', '_')
}

// The full paths of the usage texts of the named tools that have a recipe, in recipe order.
export function usageFiles(workspace: string, toolNames: string[]) {
	return listRecipes(workspace)
		.filter(({ recipe }) => toolNames.includes(recipe.name))
		.map(({ usagePath }) => usagePath)
}

export type Choice = { value: string; from: string[] }

function choices(workspace: string, toolNames: string[], values: (recipe: Recipe) => string[]): Choice[] {
	const found = new Map<string, string[]>()
	for (const recipe of recipesFor(workspace, toolNames))
		for (const value of values(recipe)) found.set(value, [...(found.get(value) ?? []), `recipe ${recipe.name}`])
	return [...found].map(([value, from]) => ({ value, from }))
}

export function observeFromChoices(workspace: string, toolNames: string[]) {
	return choices(workspace, toolNames, (recipe) => Object.keys(recipe.observeFrom))
}

export function evidenceChoices(workspace: string, toolNames: string[]) {
	return [{ value: 'observation', from: ['built in'] }, ...choices(workspace, toolNames, (recipe) => recipe.evidence)]
}

export function allEvidence(workspace: string) {
	return ['observation', ...recipes(workspace).flatMap((recipe) => recipe.evidence)]
}

export type ObserveValue = { value: string; reading: ObserveReading; tool: string }

export function observeFromValues(workspace: string, toolNames: string[]): ObserveValue[] {
	const all = recipesFor(workspace, toolNames).flatMap((recipe) =>
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
export function observeFromRule(workspace: string, toolNames: string[], quote = '"') {
	const q = (value: string) => `${quote}${value}${quote}`
	const values = observeFromValues(workspace, toolNames)
	if (!values.length) return `Omit ${q('observeFrom')}. The tools of this target give no values for it.`
	const listed = values.map(({ value, reading }) => `${q(value)} (${reading}: ${readingText[reading]})`).join(', ')
	return [
		`An assertion on a state-changing action (add, apply, clear, delete, save) checks the source of truth: the stored state. What the tool shows now does not show that the state changed. Set ${q('observeFrom')} to one of the values of the tools of this target: ${listed}.`,
		'Use a state value for a check of a state change. Use a view value only for a check that is not a state change. A state-changing test whose checks all use a view value is refused once and then saved as not ready.',
	].join(' ')
}

export function observeReading(workspace: string, value: string): ObserveReading | undefined {
	return recipes(workspace).find((recipe) => Object.hasOwn(recipe.observeFrom, value))?.observeFrom[value]
}

// The recipes that give a value, for example "recipe maestro". A value can come from no recipe and no tool of a target.
export function givenBy(workspace: string, value: string) {
	const names = recipes(workspace)
		.filter((recipe) => Object.hasOwn(recipe.observeFrom, value) || recipe.evidence.includes(value))
		.map((recipe) => `recipe ${recipe.name}`)
	return names.length ? `${names.join(' and ')} ${names.length === 1 ? 'gives' : 'give'} it` : 'no recipe gives it'
}

export function choiceText(found: Choice[]) {
	return found.map((choice) => `${choice.value} (${choice.from.join(', ')})`).join(', ') || 'none'
}

export function evidenceKindOfFile(workspace: string, toolNames: string[], extension: string) {
	const recipe = recipesFor(workspace, toolNames).find((recipe) => recipe.evidenceExtensions?.[extension])
	return recipe?.evidenceExtensions?.[extension]
}
