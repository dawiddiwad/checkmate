import { JsonValue, JsonObject, JsonArray, ScoredElement } from './scorer'

export function reconstructTree(originalJson: JsonValue, selectedElements: ScoredElement[]): JsonValue {
	if (selectedElements.length === 0) {
		return originalJson
	}

	const allPaths = collectAllRequiredPaths(selectedElements)
	return buildFilteredTree(originalJson, allPaths, [])
}

function collectAllRequiredPaths(elements: ScoredElement[]): Set<string> {
	const paths = new Set<string>()

	for (const element of elements) {
		for (let i = 0; i <= element.path.length; i++) {
			const ancestorPath = element.path.slice(0, i)
			paths.add(JSON.stringify(ancestorPath))
		}

		const elementPath = JSON.stringify(element.path)
		paths.add(elementPath)
	}

	return paths
}

function buildFilteredTree(
	value: JsonValue,
	requiredPaths: Set<string>,
	currentPath: (string | number)[]
): JsonValue | undefined {
	const currentPathKey = JSON.stringify(currentPath)

	if (!isPathOrAncestorRequired(currentPath, requiredPaths)) {
		return undefined
	}

	if (value === null || typeof value !== 'object') {
		return value
	}

	if (Array.isArray(value)) {
		return buildFilteredArray(value, requiredPaths, currentPath)
	}

	return buildFilteredObject(value as JsonObject, requiredPaths, currentPath)
}

function isPathOrAncestorRequired(path: (string | number)[], requiredPaths: Set<string>): boolean {
	const pathKey = JSON.stringify(path)

	if (requiredPaths.has(pathKey)) {
		return true
	}

	for (const requiredPath of requiredPaths) {
		const parsed = JSON.parse(requiredPath) as (string | number)[]
		if (isAncestorOf(path, parsed)) {
			return true
		}
	}

	return false
}

function isAncestorOf(potentialAncestor: (string | number)[], descendant: (string | number)[]): boolean {
	if (potentialAncestor.length >= descendant.length) {
		return false
	}

	return potentialAncestor.every((segment, index) => segment === descendant[index])
}

function buildFilteredArray(
	value: JsonArray,
	requiredPaths: Set<string>,
	currentPath: (string | number)[]
): JsonArray | undefined {
	const filteredItems: JsonValue[] = []

	for (let i = 0; i < value.length; i++) {
		const childPath = [...currentPath, i]
		const filteredChild = buildFilteredTree(value[i], requiredPaths, childPath)

		if (filteredChild !== undefined) {
			filteredItems.push(filteredChild)
		}
	}

	if (filteredItems.length === 0) {
		return includeDirectChildren(value, requiredPaths, currentPath) ? (value as JsonArray) : undefined
	}

	return filteredItems
}

function buildFilteredObject(
	value: JsonObject,
	requiredPaths: Set<string>,
	currentPath: (string | number)[]
): JsonObject | undefined {
	const filteredObject: JsonObject = {}
	let hasContent = false

	for (const key of Object.keys(value)) {
		const childPath = [...currentPath, key]
		const filteredChild = buildFilteredTree(value[key], requiredPaths, childPath)

		if (filteredChild !== undefined) {
			filteredObject[key] = filteredChild
			hasContent = true
		}
	}

	if (!hasContent && includeDirectChildren(value, requiredPaths, currentPath)) {
		return value
	}

	return hasContent ? filteredObject : undefined
}

function includeDirectChildren(
	value: JsonValue,
	requiredPaths: Set<string>,
	currentPath: (string | number)[]
): boolean {
	const currentPathKey = JSON.stringify(currentPath)

	for (const requiredPath of requiredPaths) {
		const parsed = JSON.parse(requiredPath) as (string | number)[]
		if (parsed.length === currentPath.length && currentPathKey === requiredPath) {
			return true
		}
	}

	return false
}
