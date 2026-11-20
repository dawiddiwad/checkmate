export default function (pi) {
	pi.registerCommand('checkmate-permission-ready', { handler: async () => {} })
	pi.on('tool_call', async (event, ctx) => {
		let hook
		try {
			hook = JSON.parse(process.env.CHECKMATE_PI_HOOK || '')
			if (
				!Number.isInteger(hook.port) ||
				typeof hook.token !== 'string' ||
				!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(hook.explorationId) ||
				!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(hook.who)
			)
				throw new Error('Invalid hook')
			const base = `http://127.0.0.1:${hook.port}/hooks`
			const body = { tool_name: event.toolName, tool_input: event.input, cwd: ctx.cwd }
			const send = (kind, name, timeout) =>
				fetch(`${base}/${kind}/${hook.explorationId}/${hook.who}`, {
					method: 'POST',
					headers: { Authorization: `Bearer ${hook.token}`, 'Content-Type': 'application/json' },
					body: JSON.stringify({ ...body, hook_event_name: name }),
					signal: AbortSignal.timeout(timeout),
				})
			await send('activity', 'PreToolUse', 5000).catch(() => {})
			if (Array.isArray(hook.allow) && hook.allow.includes(event.toolName)) return
			const response = await send('permission', 'PermissionRequest', 600000)
			if (!response.ok) throw new Error('Permission request failed')
			const answer = await response.json()
			const decision = answer?.hookSpecificOutput?.decision
			if (decision?.behavior === 'allow') return
			return { block: true, reason: decision?.message || 'Permission was not granted.' }
		} catch {
			return { block: true, reason: 'Checkmate could not get permission for this tool.' }
		}
	})
}
