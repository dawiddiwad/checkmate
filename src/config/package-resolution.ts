import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { Diagnostic, Validation } from '../contracts/types.js'

export function resolveDriverDescriptorPath(
	invocationRoot: string,
	packageName: string,
	driverPath: string
): Validation<string> {
	try {
		const require = createRequire(resolve(invocationRoot, 'package.json'))
		return { ok: true, value: require.resolve(`${packageName}/checkmate-driver.json`) }
	} catch {
		return {
			ok: false,
			diagnostics: [
				{
					code: 'driver.descriptor-unavailable',
					path: driverPath,
					message: `could not resolve the static descriptor for registered package '${packageName}'`,
				},
			],
		}
	}
}

export function packageDiagnostic(path: string, message: string): Diagnostic {
	return { code: 'driver.descriptor-unavailable', path, message }
}
