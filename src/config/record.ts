export function hasOwn(record: object, key: PropertyKey): boolean {
	return Object.prototype.hasOwnProperty.call(record, key)
}

export function ownValue<T>(record: Record<string, T>, key: string): T | undefined {
	return hasOwn(record, key) ? record[key] : undefined
}

export function compareUtf16(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0
}
