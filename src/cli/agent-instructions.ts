import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Default file `init` writes the agent instruction section into, when `--target` is not given.
 */
export const DEFAULT_INSTRUCTIONS_TARGET = 'AGENTS.md'

/**
 * Other agent-instruction conventions `init` looks for so it can point at them.
 *
 * `init` never writes to these on its own — a project with one of these already present has
 * already chosen its convention, and `init` only mentions it so `--target` can be pointed there.
 */
export const DETECTABLE_INSTRUCTION_TARGETS: readonly string[] = [
	'.cursor/rules',
	'CLAUDE.md',
	'.github/copilot-instructions.md',
]

const SECTION_START = '<!-- checkmate:instructions:start -->'
const SECTION_END = '<!-- checkmate:instructions:end -->'

/**
 * How the target file changed.
 *
 * - `created` — the file did not exist; it now contains only the Checkmate section.
 * - `replaced` — the file existed with a prior Checkmate section, which was swapped in place.
 * - `appended` — the file existed without a Checkmate section, which was added to the end.
 */
export type InstructionsAction = 'created' | 'replaced' | 'appended'

export type WriteAgentInstructionsOptions = {
	/**
	 * Directory the target path is resolved against.
	 */
	cwd: string

	/**
	 * Overrides {@link DEFAULT_INSTRUCTIONS_TARGET}, relative to `cwd`.
	 */
	target?: string
}

export type WriteAgentInstructionsResult = {
	/**
	 * The target path that was written, relative to `cwd`.
	 */
	target: string

	/**
	 * How the target file changed.
	 */
	action: InstructionsAction

	/**
	 * Other instruction-file conventions found in the project, excluding `target` itself.
	 */
	detected: string[]
}

/**
 * Writes or updates the Checkmate agent instruction section in a project.
 *
 * The section is delimited, so re-running replaces only what `init` owns and leaves the rest
 * of the file untouched — including a file that predates `init`, like this repository's own
 * `AGENTS.md`.
 *
 * @example
 * ```ts
 * const result = await writeAgentInstructions({ cwd: process.cwd() })
 * console.log(result.target, result.action, result.detected)
 * ```
 */
export async function writeAgentInstructions({
	cwd,
	target,
}: WriteAgentInstructionsOptions): Promise<WriteAgentInstructionsResult> {
	const targetRelative = target ?? DEFAULT_INSTRUCTIONS_TARGET
	const targetPath = path.join(cwd, targetRelative)

	const section = await buildSection()
	const existing = await readFileIfExists(targetPath)
	const { content, action } = mergeSection(existing, section)

	await mkdir(path.dirname(targetPath), { recursive: true })
	await writeFile(targetPath, content)

	const detected: string[] = []
	for (const candidate of DETECTABLE_INSTRUCTION_TARGETS) {
		if (isSameOrAncestor(candidate, targetRelative)) {
			continue
		}
		if (await pathExists(path.join(cwd, candidate))) {
			detected.push(candidate)
		}
	}

	return { target: targetRelative, action, detected }
}

async function buildSection(): Promise<string> {
	const templatePath = fileURLToPath(new URL('../../templates/checkmate-agent.md', import.meta.url))
	const template = (await readFile(templatePath, 'utf8')).trimEnd()
	return `${SECTION_START}\n${template}\n${SECTION_END}`
}

function mergeSection(existing: string | undefined, section: string): { content: string; action: InstructionsAction } {
	if (existing === undefined) {
		return { content: `${section}\n`, action: 'created' }
	}

	const startIndex = existing.indexOf(SECTION_START)
	const endIndex = existing.indexOf(SECTION_END)
	if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
		const before = existing.slice(0, startIndex)
		const after = existing.slice(endIndex + SECTION_END.length)
		return { content: `${before}${section}${after}`, action: 'replaced' }
	}

	const trimmed = existing.replace(/\s+$/, '')
	const separator = trimmed.length === 0 ? '' : '\n\n'
	return { content: `${trimmed}${separator}${section}\n`, action: 'appended' }
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
	try {
		return await readFile(filePath, 'utf8')
	} catch {
		return undefined
	}
}

/**
 * Whether `candidate` is the path `target` was written to, or a directory containing it —
 * the case where `--target` was pointed inside a detectable convention on purpose.
 */
function isSameOrAncestor(candidate: string, target: string): boolean {
	const normalizedCandidate = path.normalize(candidate)
	const normalizedTarget = path.normalize(target)
	return normalizedCandidate === normalizedTarget || normalizedTarget.startsWith(`${normalizedCandidate}${path.sep}`)
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath)
		return true
	} catch {
		return false
	}
}
