import { execFileSync } from 'node:child_process'
import { userInfo } from 'node:os'

export function defaultActor(workspace: string, env: Record<string, string | undefined>) {
	const named = env.CHECKMATE_ACTOR?.trim()
	if (named) return named
	try {
		const name = execFileSync('git', ['config', 'user.name'], {
			cwd: workspace,
			env,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim()
		if (name) return name
	} catch {}
	try {
		return userInfo().username
	} catch {
		return undefined
	}
}
