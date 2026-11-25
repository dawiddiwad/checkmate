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
	usage: string
}

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
	if (!isText(recipe.usage) || !existsSync(join(folder, recipe.usage)))
		refuse('usage must name a file in the folder.')
	return recipe as Recipe
}

function readRecipes(folder: string) {
	return readdirSync(folder)
		.filter((file) => file.endsWith('.json'))
		.sort()
		.map((file) => readRecipe(folder, file))
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
