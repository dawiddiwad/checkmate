export type RuntimeLogger = Readonly<{
	debug(message: string, ...details: unknown[]): unknown
	info(message: string, ...details: unknown[]): unknown
	warn(message: string, ...details: unknown[]): unknown
	error(message: string, ...details: unknown[]): unknown
}>

export const silentLogger: RuntimeLogger = {
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined,
}
