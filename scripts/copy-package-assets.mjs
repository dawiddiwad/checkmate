import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { URL } from 'node:url'

const packageRoot = new URL('../', import.meta.url)
const packageAssets = [
	['src/contracts/schemas/checkmate-config.v1.json', 'schemas/checkmate-config.v1.json'],
	['src/contracts/schemas/run-request.v1.json', 'schemas/run-request.v1.json'],
	['src/contracts/schemas/run-result.v1.json', 'schemas/run-result.v1.json'],
	['src/contracts/schemas/validation-result.v1.json', 'schemas/validation-result.v1.json'],
	['src/contracts/schemas/describe-result.v1.json', 'schemas/describe-result.v1.json'],
	['src/contracts/schemas/driver-descriptor.v1.json', 'schemas/driver-descriptor.v1.json'],
	['src/drivers/web/checkmate-driver.json', 'dist/drivers/web/checkmate-driver.json'],
]

await mkdir(new URL('schemas/', packageRoot), { recursive: true })
for (const [sourcePath, destinationPath] of packageAssets) {
	const source = new URL(sourcePath, packageRoot)
	const destination = new URL(destinationPath, packageRoot)
	JSON.parse(await readFile(source, 'utf8'))
	await mkdir(new URL('./', destination), { recursive: true })
	await copyFile(source, destination)
}
