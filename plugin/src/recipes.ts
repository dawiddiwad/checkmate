import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pluginRoot } from './sessions.ts'

export type Recipe = {
	name: string
	capability: string
	kind: 'cli'
	purpose: string
	detect: 'path' | 'runtime'
	environment: Record<string, string>
	shellInstruction?: string
	workspaceFolders: string[]
	observeFrom: Record<string, ObserveReading>
	evidence: string[]
	usage: string
}

// "view" reads what the tool shows now; it does not show that a stored state changed. "state" reads the stored state.
export type ObserveReading = 'view' | 'state'

// The values that every target accepted up to 0.8.2, before tools had recipes. They stay accepted for all targets:
// plans and results stored before recipes must stay valid, and a tester can use a host tool that no recipe describes.
// Do not add to these lists. A new value comes only from a recipe.
export const compatibleObserveFrom: Record<string, ObserveReading> = { page: 'view', reload: 'state', api: 'state' }
export const compatibleEvidence = ['observation', 'http_exchange', 'screenshot', 'trace']
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
	if (recipe.shellInstruction !== undefined && !isText(recipe.shellInstruction))
		refuse('shellInstruction must be a text when it is given.')
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
	if (!isText(recipe.usage) || !existsSync(join(folder, recipe.usage)))
		refuse('usage must name a file in the folder.')
	return recipe as Recipe
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
	return found
}

export function recipes() {
	loaded ??= readRecipes(join(pluginRoot, 'recipes'))
	return loaded
}

function filled(text: string, values: SessionValues) {
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

export function toolFolders() {
	return recipes().flatMap((recipe) => recipe.workspaceFolders)
}

export type Choice = { value: string; from: string[] }

// The values that a target accepts: the values of the recipes of its tools, and the compatible values.
// Each value names where it comes from, so that a refusal can say it.
function choices(toolNames: string[], compatible: string[], values: (recipe: Recipe) => string[]): Choice[] {
	const found = new Map<string, string[]>(compatible.map((value) => [value, [compatibleSource]]))
	for (const recipe of recipes().filter((recipe) => toolNames.includes(recipe.name)))
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

export function observeReading(value: string): ObserveReading | undefined {
	return compatibleObserveFrom[value] ?? recipes().find((recipe) => recipe.observeFrom[value])?.observeFrom[value]
}

// For example: page (accepted for all targets, recipe playwright-cli), api (accepted for all targets, recipe node).
export function choiceText(found: Choice[]) {
	return found.map((choice) => `${choice.value} (${choice.from.join(', ')})`).join(', ')
}
