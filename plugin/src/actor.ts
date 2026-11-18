import { execFileSync } from 'node:child_process'
import { userInfo } from 'node:os'

export const requestVariable = 'CHECKMATE_REQUEST'

export function requestOfEnv(env: Record<string, string | undefined>) {
	const named = env[requestVariable]?.trim()
	return named && /^R[1-9][0-9]{0,8}$/.test(named) ? named : undefined
}

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
