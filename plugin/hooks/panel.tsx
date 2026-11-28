import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { planLinesOf, waitingOf } from '../panel/rows.mjs'
import type { Inbox, PlanList } from '../panel/rows.mjs'
import type { Snapshot } from '../types'

const pane = 'checkmate'
const title = 'Checkmate'
const command = 'checkmate-panel'
const refreshMilliseconds = 15000

const snapshot = atom({ plugin: 'checkmate', key: 'snapshot' } as const, null, { shape: 'snapshot-1' })

type Reply = { status: string; reasons: string[] }

async function checkmate<Data>($: EngineInterface, cwd: string, ...args: string[]) {
	const ran = await $.process.run(['node', `${$.plugin.root}/dist/checkmate.js`, ...args, '--json'], { cwd })
	const line = ran.stdout.trim() || ran.stderr.trim()
	let reply: Reply & Data
	try {
		reply = JSON.parse(line)
	} catch {
		throw Error(line.split('\n')[0] || `checkmate ${args.join(' ')} gave no reply`)
	}
	if (reply.status !== 'completed') throw Error(reply.reasons?.join(' ') || reply.status)
	return reply
}

async function readSnapshot($: EngineInterface): Promise<Snapshot | null> {
	const cwd = await $.session.cwd()
	const hasRecord = await $.fs.stat(`${cwd}/.checkmate/checkmate.db`).then(
		() => true,
		() => false
	)
	if (!hasRecord) return null
	try {
		const inbox = await checkmate<Inbox>($, cwd, 'inbox')
		const list = await checkmate<PlanList>($, cwd, 'plan', 'list')
		return { waiting: waitingOf(inbox), plans: planLinesOf(list), problem: null }
	} catch (error) {
		return { waiting: [], plans: [], problem: (error as Error).message }
	}
}

async function refresh($: EngineInterface) {
	const fresh = await readSnapshot($)
	if (JSON.stringify(fresh) !== JSON.stringify(await read($, snapshot))) await update($, snapshot, () => fresh)
	const count = fresh?.waiting.length ?? 0
	$.ui.status(count ? `${count} waiting for a decision` : undefined)
}

async function refreshOpenPane($: EngineInterface) {
	const panes = await $.ui.panes()
	if (panes.some((open) => open.id === pane)) await refresh($)
}

export const register: Register = (on) => {
	on('session.start', async ($, e, next) => {
		await $.command.register({ name: command, description: 'Show the Checkmate inbox and plan status in a pane' })
		if (e.isInteractive) {
			void refresh($).catch(() => {})
			$.clock.every(refreshMilliseconds, () => void refreshOpenPane($).catch(() => {}))
		}
		return next(e)
	})

	on('command.run', { command }, async ($) => {
		await refresh($)
		await $.ui.open({ id: pane, title })
		return { text: 'Checkmate pane opened. It is read only.' }
	})

	on('turn.complete', async ($, e, next) => {
		void refresh($).catch(() => {})
		return next(e)
	})

	on('ui.render', { component: 'Pane', requestId: pane }, async ($, e) => {
		const { Box, Button, Text } = $.ui.resolve(e)
		const shown = await read($, snapshot)
		const refreshButton = <Button key="refresh" label="Refresh" onPress={() => refresh($)} />

		if (shown === null) {
			return (
				<Box flexDirection="column" gap={1}>
					<Text dimColor>No Checkmate record in this folder. Run /checkmate:test to start.</Text>
					{refreshButton}
				</Box>
			)
		}
		if (shown.problem !== null) {
			return (
				<Box flexDirection="column" gap={1}>
					<Text color="error">Could not read the Checkmate record: {shown.problem}</Text>
					{refreshButton}
				</Box>
			)
		}
		return (
			<Box flexDirection="column" gap={1}>
				<Box flexDirection="column">
					<Text bold>Waiting for a decision ({shown.waiting.length})</Text>
					{shown.waiting.length === 0 && <Text dimColor>Nothing waits for a decision.</Text>}
					{shown.waiting.map((item) => (
						<Box flexDirection="column">
							<Text>
								{item.kind} {item.id} <Text dimColor>{item.detail}</Text>
							</Text>
							<Text dimColor> {item.text}</Text>
						</Box>
					))}
				</Box>
				<Box flexDirection="column">
					<Text bold>Plans ({shown.plans.length})</Text>
					{shown.plans.length === 0 && <Text dimColor>No plans yet.</Text>}
					{shown.plans.map((plan) => (
						<Box flexDirection="column">
							<Text>
								{plan.planId} {plan.state} <Text dimColor>waits on {plan.waitsOn}</Text>
							</Text>
							<Text dimColor> {plan.detail}</Text>
						</Box>
					))}
				</Box>
				<Text dimColor>Read only. To decide, open the review UI with /checkmate:ui.</Text>
				{refreshButton}
			</Box>
		)
	})
}
