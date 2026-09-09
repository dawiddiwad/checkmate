export function serializeJson(value: unknown): string {
	return `${writeJson(value, 0, new Set())}\n`
}

function writeJson(value: unknown, depth: number, ancestors: Set<object>): string {
	if (value === null || typeof value === 'boolean') {
		return String(value)
	}

	if (typeof value === 'string') {
		return JSON.stringify(value)
	}

	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new TypeError('Cannot serialize a non-finite number')
		}
		return JSON.stringify(value)
	}

	if (typeof value !== 'object') {
		throw new TypeError(`Cannot serialize ${typeof value}`)
	}

	if (ancestors.has(value)) {
		throw new TypeError('Cannot serialize a circular value')
	}

	ancestors.add(value)
	try {
		return Array.isArray(value) ? writeArray(value, depth, ancestors) : writeObject(value, depth, ancestors)
	} finally {
		ancestors.delete(value)
	}
}

function writeArray(value: unknown[], depth: number, ancestors: Set<object>): string {
	for (let index = 0; index < value.length; index++) {
		if (!Object.hasOwn(value, index)) {
			throw new TypeError('Cannot serialize a sparse array')
		}
	}

	const ownKeys = Reflect.ownKeys(value)
	if (
		ownKeys.length !== value.length + 1 ||
		ownKeys.some((key) => key !== 'length' && !isArrayIndex(key, value.length))
	) {
		throw new TypeError('Cannot serialize an array with extra properties')
	}

	if (value.length === 0) {
		return '[]'
	}

	const members: string[] = []
	for (let index = 0; index < value.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
		if (!descriptor.enumerable || !('value' in descriptor)) {
			throw new TypeError('Cannot serialize a non-data array element')
		}
		members.push(`${indent(depth + 1)}${writeJson(descriptor.value, depth + 1, ancestors)}`)
	}

	return `[\n${members.join(',\n')}\n${indent(depth)}]`
}

function writeObject(value: object, depth: number, ancestors: Set<object>): string {
	const prototype = Object.getPrototypeOf(value)
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Cannot serialize a non-plain object')
	}

	const ownKeys = Reflect.ownKeys(value)
	if (ownKeys.some((key) => typeof key === 'symbol')) {
		throw new TypeError('Cannot serialize symbol keys')
	}

	const keys = (ownKeys as string[]).sort(compareUtf16)
	if (keys.length === 0) {
		return '{}'
	}

	const members = keys.map((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)
		if (!descriptor?.enumerable || !('value' in descriptor)) {
			throw new TypeError('Cannot serialize non-enumerable or accessor properties')
		}
		return `${indent(depth + 1)}${JSON.stringify(key)}: ${writeJson(descriptor.value, depth + 1, ancestors)}`
	})

	return `{\n${members.join(',\n')}\n${indent(depth)}}`
}

function isArrayIndex(key: string | symbol, length: number): boolean {
	if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)) {
		return false
	}
	const index = Number(key)
	return Number.isSafeInteger(index) && index < length
}

function compareUtf16(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0
}

function indent(depth: number): string {
	return '  '.repeat(depth)
}
