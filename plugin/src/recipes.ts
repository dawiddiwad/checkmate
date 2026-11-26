import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pluginRoot } from './sessions.ts'
import { Refusal } from './contracts.ts'

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
	usage?: string[]
	// Kind mcp only: the server that Checkmate starts.
	server?: ToolServer
}

// "view" reads what the tool shows now; it does not show that a stored state changed. "state" reads the stored state.
export type ObserveReading = 'view' | 'state'

export type SessionValues = { session: string; workFolder: string }

export const requiredRecipeFields = [
	'name',
	'capability',
	'kind',
	'purpose',
	'detect',
	'environment',
	'workspaceFolders',
	'observeFrom',
	'evidence',
] as const satisfies ReadonlyArray<keyof Recipe>

export type RecipeEntry = {
	source: 'built-in' | 'custom'
	path: string
	recipe: Recipe
	jsonText: string
}

let builtIn: Array<RecipeEntry | InvalidRecipe> | undefined

function isIdentifier(value: unknown): value is string {
	return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value)
}

function isText(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== ''
}

function invalidRecipe(path: string, problems: string[], recipe?: Partial<Recipe>): InvalidRecipe {
	return {
		source: 'custom',
		name: basename(path, '.json'),
		path,
		problems,
		...(recipe ? { entryNames: entryNames(recipe) } : {}),
		...(isIdentifier(recipe?.name) ? { declaredName: recipe.name } : {}),
	}
}

function readRecipe(path: string, source: RecipeEntry['source']): RecipeEntry | InvalidRecipe {
	const file = basename(path)
	let recipe: Partial<Recipe>
	let jsonText: string
	try {
		if (!lstatSync(path, { throwIfNoEntry: false })?.isFile())
			return invalidRecipe(path, ['Use a regular JSON file.'])
		jsonText = readFileSync(path, 'utf8')
		recipe = JSON.parse(jsonText)
	} catch (error) {
		return invalidRecipe(path, [`Cannot read JSON: ${(error as Error).message}`])
	}
	if (typeof recipe !== 'object' || recipe === null || Array.isArray(recipe))
		return invalidRecipe(path, ['Use a JSON object.'])
	const problems: string[] = []
	const refuse = (problem: string) => problems.push(problem)
	for (const field of requiredRecipeFields)
		if (!Object.hasOwn(recipe, field)) refuse(`give the required field ${field}.`)
	for (const field of ['tools', 'refusedArguments', 'entryArguments'])
		if (Object.hasOwn(recipe, field))
			refuse(`${field} is not a recipe field. Put tool limits in the target or skill.`)
	if (recipe.name !== undefined && (!isIdentifier(recipe.name) || `${recipe.name}.json` !== file))
		refuse('name must match the file name without .json and use letters, numbers, dashes, or underscores.')
	if (recipe.capability !== undefined && !isIdentifier(recipe.capability))
		refuse('capability must use 1 to 96 letters, digits, dashes, or underscores, starting with a letter or digit.')
	if (recipe.kind !== undefined && recipe.kind !== 'cli' && recipe.kind !== 'mcp') refuse('kind must be cli or mcp.')
	if (recipe.kind === 'mcp') readServer(recipe, refuse)
	else if (recipe.kind === 'cli' && recipe.server !== undefined) refuse('server is only for a recipe of kind mcp.')
	if (recipe.purpose !== undefined && !isText(recipe.purpose)) refuse('purpose must be a text.')
	if (recipe.detect !== undefined && recipe.detect !== 'path' && recipe.detect !== 'runtime')
		refuse('detect must be path or runtime.')
	const environment = recipe.environment
	if (environment !== undefined) {
		if (typeof environment !== 'object' || environment === null || Array.isArray(environment))
			refuse('environment must be an object of texts.')
		else
			for (const [name, value] of Object.entries(environment)) {
				if (typeof value !== 'string') {
					refuse(`environment.${name} must be text.`)
					continue
				}
				for (const [placeholder, key] of value.matchAll(/\{([A-Za-z0-9][A-Za-z0-9_-]*)\}/g))
					if (key !== 'session' && key !== 'workFolder')
						refuse(
							`environment.${name} cannot use ${placeholder}. Use {session} or {workFolder}, or pass the entry as a tool argument.`
						)
			}
	}
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
		recipe.workspaceFolders !== undefined &&
		(!Array.isArray(recipe.workspaceFolders) ||
			!recipe.workspaceFolders.every(
				(name) =>
					isText(name) &&
					/^[a-zA-Z0-9._-]+$/.test(name) &&
					!['.', '..', '.checkmate', '.git'].includes(name.toLowerCase())
			))
	)
		refuse('workspaceFolders must list top-level tool folder names. Use a name other than .checkmate or .git.')
	const observeFrom: unknown = recipe.observeFrom
	if (
		observeFrom !== undefined &&
		(typeof observeFrom !== 'object' ||
			observeFrom === null ||
			Array.isArray(observeFrom) ||
			!Object.keys(observeFrom).every(isValueName) ||
			!Object.values(observeFrom).every((reading) => reading === 'view' || reading === 'state'))
	)
		refuse('observeFrom must be an object that maps each value name to view or state.')
	if (recipe.evidence !== undefined && (!Array.isArray(recipe.evidence) || !recipe.evidence.every(isValueName)))
		refuse('evidence must be a list of evidence kind names.')
	const extensions: unknown = recipe.evidenceExtensions
	if (
		extensions !== undefined &&
		(typeof extensions !== 'object' ||
			extensions === null ||
			Array.isArray(extensions) ||
			!Object.keys(extensions).every((extension) => /^\.[a-z0-9]{1,10}$/.test(extension)) ||
			!Object.values(extensions).every(
				(kind) => Array.isArray(recipe.evidence) && recipe.evidence.includes(kind)
			))
	)
		refuse('evidenceExtensions must map each file extension, for example .mp4, to an evidence kind of the recipe.')
	const usage = recipe.usage
	if (
		usage !== undefined &&
		(!Array.isArray(usage) || !usage.every((line) => typeof line === 'string') || !usage.some(isText))
	)
		refuse('usage must be a non-empty list of Markdown lines.')
	if (problems.length) return invalidRecipe(path, [...new Set(problems)], recipe)
	return { source, path, recipe: recipe as Recipe, jsonText }
}

function entryNames(recipe: Partial<Recipe>) {
	return Array.isArray(recipe.entryPoints)
		? recipe.entryPoints.flatMap((point) => (isIdentifier(point?.name) ? [point.name] : []))
		: []
}

function readEntryPoints(value: unknown, refuse: (problem: string) => void) {
	const entryPointProblem =
		'entryPoints must be a list of {name, kind (url, command, or value), purpose, pattern (optional regular expression)}.'
	if (!Array.isArray(value) || !value.length) return refuse(entryPointProblem)
	const names = new Set<string>()
	for (const entry of value as Array<Record<string, unknown>>) {
		if (
			typeof entry !== 'object' ||
			entry === null ||
			!isIdentifier(entry.name) ||
			!['url', 'command', 'value'].includes(entry.kind as string) ||
			!isText(entry.purpose) ||
			Object.keys(entry).some((key) => !['name', 'kind', 'purpose', 'pattern'].includes(key))
		) {
			refuse(entryPointProblem)
			continue
		}
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

function readReachable(recipe: Partial<Recipe>, refuse: (problem: string) => void) {
	const problem =
		'reachable must be a list of {check: "http", entry} or {check: "command", run (list of arguments), contains (optional list of texts)}.'
	const checks: unknown = recipe.reachable
	if (!Array.isArray(checks) || !checks.length) return refuse(problem)
	const entries = entryNames(recipe)
	for (const check of checks as Array<Record<string, unknown>>) {
		if (typeof check !== 'object' || check === null) {
			refuse(problem)
			continue
		}
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
function readServer(recipe: Partial<Recipe>, refuse: (problem: string) => void) {
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
	if (recipe.closeSession !== undefined || recipe.shellInstruction !== undefined)
		refuse('a recipe of kind mcp has no closeSession or shellInstruction: Checkmate stops its server.')
}

// A value name is a lower-case word, for example page or http_exchange.
function isValueName(value: unknown) {
	return typeof value === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(value)
}

export type InvalidRecipe = {
	source: 'custom'
	name: string
	path: string
	problems: string[]
	entryNames?: string[]
	declaredName?: string
}

export type RecipeCatalog = { recipes: RecipeEntry[]; invalid: InvalidRecipe[] }

export function recipeProblem(item: InvalidRecipe) {
	return `Tool recipe ${item.path} is not valid: ${item.problems.join(' ')}`
}

export function refuseInvalidRecipes(items: InvalidRecipe[]) {
	if (!items.length) return
	throw new Refusal(
		'prohibited',
		items.map(recipeProblem).join(' '),
		`Edit ${items.map((item) => item.path).join(', ')} to fix the listed problems. Edits apply immediately. Retry the refused action. Run setup again only if the target needs different entries or tools. Run checkmate recipe list to check the files.`
	)
}

function recipeFiles(folder: string) {
	return readdirSync(folder)
		.filter((file) => file.endsWith('.json'))
		.sort()
		.map((file) => join(folder, file))
}

function conflicts(recipe: Recipe, accepted: RecipeEntry[]) {
	const problems: string[] = []
	if (recipe.kind === 'mcp') {
		const server = serverName(recipe).toLowerCase()
		if (accepted.some(({ recipe }) => recipe.kind === 'mcp' && serverName(recipe).toLowerCase() === server))
			problems.push(`MCP server name ${serverName(recipe)} is in use. Choose a different recipe name.`)
	}
	for (const [value, reading] of Object.entries(recipe.observeFrom)) {
		const known = accepted.find((other) => (other.recipe.observeFrom[value] ?? reading) !== reading)
		if (known)
			problems.push(
				`observeFrom ${value} is ${reading}, but it is ${known.recipe.observeFrom[value]} in recipe ${known.recipe.name}.`
			)
	}
	const shape = (point: RecipeEntryPoint) => JSON.stringify([point.kind, point.purpose, point.pattern ?? null])
	for (const point of recipe.entryPoints ?? []) {
		const known = accepted.find((other) =>
			other.recipe.entryPoints?.some((item) => item.name === point.name && shape(item) !== shape(point))
		)
		if (known) problems.push(`entry point ${point.name} differs from the one in recipe ${known.recipe.name}.`)
	}
	for (const [extension, kind] of Object.entries(recipe.evidenceExtensions ?? {})) {
		const known = accepted.find((other) => (other.recipe.evidenceExtensions?.[extension] ?? kind) !== kind)
		if (known)
			problems.push(
				`evidenceExtensions ${extension} is ${kind}, but it is ${known.recipe.evidenceExtensions![extension]} in recipe ${known.recipe.name}.`
			)
	}
	return problems
}

function checkRecipes(found: Array<RecipeEntry | InvalidRecipe>): RecipeCatalog {
	const reserved = new Map<string, string>()
	const catalog: RecipeCatalog = { recipes: [], invalid: [] }
	for (const item of found) {
		const invalid = 'problems' in item
		const name = invalid ? item.name : item.recipe.name
		const declaredName = (invalid ? (item.declaredName ?? name) : name).toLowerCase()
		const owner = reserved.get(declaredName)
		const problems = invalid ? [...item.problems] : conflicts(item.recipe, catalog.recipes)
		if (owner)
			problems.push(`Name ${declaredName} is in use by ${owner}. Rename the file and update its name field.`)
		if (problems.length) {
			const issue = invalid ? { ...item, problems } : invalidRecipe(item.path, problems, item.recipe)
			if (item.source === 'built-in') throw Error(recipeProblem(issue))
			catalog.invalid.push(issue)
		} else if (!invalid) catalog.recipes.push(item)
		if (!reserved.has(name.toLowerCase()))
			reserved.set(name.toLowerCase(), `the ${item.source} recipe ${item.path}`)
	}
	return catalog
}

export function projectRecipeFolder(workspace: string) {
	return join(workspace, '.checkmate', 'recipes')
}

function customFolder(workspace: string) {
	const checkmate = join(workspace, '.checkmate')
	const folder = projectRecipeFolder(workspace)
	for (const path of [checkmate, folder]) {
		const entry = lstatSync(path, { throwIfNoEntry: false })
		if (entry && !entry.isDirectory()) throw Error(`Tool recipes require a directory at ${path}.`)
	}
	return folder
}

function catalogFiles(workspace: string) {
	builtIn ??= recipeFiles(join(pluginRoot, 'recipes')).map((path) => {
		const item = readRecipe(path, 'built-in')
		if ('problems' in item) throw Error(recipeProblem(item))
		return item
	})
	const folder = customFolder(workspace)
	return [...builtIn, ...(existsSync(folder) ? recipeFiles(folder).map((path) => readRecipe(path, 'custom')) : [])]
}

export function listRecipes(workspace: string): RecipeCatalog {
	return checkRecipes(catalogFiles(workspace))
}

export function recipes(workspace: string) {
	return listRecipes(workspace).recipes.map(({ recipe }) => recipe)
}

export function filled(text: string, values: SessionValues) {
	return text.replaceAll('{session}', values.session).replaceAll('{workFolder}', values.workFolder)
}

// The environment of a recipe of kind mcp is the environment of its server, not of the tester.
export function testerEnvironment(workspace: string, values: SessionValues, toolNames: string[]) {
	return Object.fromEntries(
		listRecipes(workspace)
			.recipes.filter(
				({ source, recipe }) =>
					recipe.kind === 'cli' && (source === 'built-in' || toolNames.includes(recipe.name))
			)
			.flatMap(({ recipe }) =>
				Object.entries(recipe.environment).map(([name, value]) => [name, filled(value, values)])
			)
	)
}

export function shellInstructions(workspace: string, values: SessionValues, toolNames: string[]) {
	return listRecipes(workspace).recipes.flatMap(({ recipe, source }) =>
		recipe.shellInstruction && (source === 'built-in' || toolNames.includes(recipe.name))
			? [filled(recipe.shellInstruction, values)]
			: []
	)
}

// Refuses tool names whose custom recipe is invalid. A tool without a recipe is allowed.
export function requireValidRecipes(workspace: string, toolNames: string[]) {
	const { recipes, invalid } = listRecipes(workspace)
	const broken = invalid.filter(
		(item) => toolNames.includes(item.name) && !recipes.some(({ recipe }) => recipe.name === item.name)
	)
	refuseInvalidRecipes(broken)
	return recipes
}

// The recipes of the named tools, in recipe order. A tool without a recipe has none.
export function recipesFor(workspace: string, toolNames: string[]) {
	return requireValidRecipes(workspace, toolNames)
		.map(({ recipe }) => recipe)
		.filter((recipe) => toolNames.includes(recipe.name))
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
	return listRecipes(workspace).recipes.flatMap(({ recipe, source }) =>
		source === 'built-in' || toolNames.includes(recipe.name) ? recipe.workspaceFolders : []
	)
}

export function serverName(recipe: Recipe) {
	return recipe.name.replaceAll('-', '_')
}

// The paths of the named tools’ recipes that contain usage notes, in recipe order.
export function recipeFilesFor(workspace: string, toolNames: string[]) {
	return requireValidRecipes(workspace, toolNames)
		.filter(({ recipe }) => recipe.usage !== undefined && toolNames.includes(recipe.name))
		.map(({ path }) => path)
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
