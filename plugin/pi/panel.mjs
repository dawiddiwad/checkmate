import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
import { planLinesOf, waitingOf } from '../panel/rows.mjs'

const cli = fileURLToPath(new URL('../dist/checkmate.js', import.meta.url))
const refreshMilliseconds = 15_000
const statusKey = 'checkmate'
const overlay = { anchor: 'top-right', width: '45%', minWidth: 48, maxHeight: '85%', margin: 1 }

function read(cwd, args) {
	return new Promise((resolve, reject) => {
		execFile(
			'node',
			[cli, ...args, '--json'],
			{ cwd, env: { ...process.env, CHECKMATE_HARNESS: 'pi', CHECKMATE_HOST_SESSION: '1' }, timeout: 30_000 },
			(error, stdout, stderr) => {
				const line = stdout.trim() || stderr.trim()
				let reply
				try {
					reply = JSON.parse(line)
				} catch {
					return reject(new Error(line.split('\n')[0] || error?.message || 'The command gave no reply.'))
				}
				if (reply.status !== 'completed') return reject(new Error(reply.reasons?.join(' ') || reply.status))
				resolve(reply)
			}
		)
	})
}

async function readSnapshot(cwd) {
	if (!existsSync(join(cwd, '.checkmate', 'checkmate.db'))) return null
	try {
		const inbox = await read(cwd, ['inbox'])
		const list = await read(cwd, ['plan', 'list'])
		return { waiting: waitingOf(inbox), plans: planLinesOf(list), problem: null }
	} catch (error) {
		return { waiting: [], plans: [], problem: error.message }
	}
}

function statusLines(status) {
	const label = (name, values) => values.flatMap((value) => [`${name}: ${value}`])
	return [
		`State: ${status.state.replaceAll('_', ' ')}`,
		`Waits on: ${status.waitsOn}`,
		...(status.revision === null ? [] : [`Revision: ${status.revision}`]),
		...(status.approval ? [`Approval: ${status.approval}`] : []),
		...(status.latestRun ? [`Latest run: ${status.latestRun.runId}`] : []),
		...label('Why', status.why),
		...label(
			'Blocker',
			status.qa.blockers.map((blocker) => `${blocker.kind} ${blocker.id}: ${blocker.text}`)
		),
		...label(
			'Open run',
			status.openRuns.map((run) => `${run.runId} build ${run.build}`)
		),
		...label('Next', status.next),
	]
}

async function readDetail(cwd, row) {
	const own = row.kind ? [`${row.kind} ${row.id}`, row.detail, row.text, ''] : []
	try {
		return {
			planId: row.planId,
			lines: [...own, `Plan ${row.planId}`, ...statusLines(await read(cwd, ['status', row.planId]))],
		}
	} catch (error) {
		return { planId: row.planId, lines: [...own, `Could not read the status of ${row.planId}: ${error.message}`] }
	}
}

function statusText(snapshot) {
	const count = snapshot?.waiting.length ?? 0
	return count ? `Checkmate: ${count} waiting for a decision` : undefined
}

class Panel {
	focused = true
	handle = null
	snapshot = undefined
	selected = 0
	detail = null
	detailRow = null
	scroll = 0

	constructor(tui, theme, ctx, done) {
		this.tui = tui
		this.theme = theme
		this.ctx = ctx
		this.done = done
		this.timer = setInterval(() => void this.refresh(), refreshMilliseconds)
		void this.refresh()
	}

	rows() {
		return this.snapshot ? [...this.snapshot.waiting, ...this.snapshot.plans] : []
	}

	async refresh() {
		this.snapshot = await readSnapshot(this.ctx.cwd)
		this.selected = Math.min(this.selected, Math.max(0, this.rows().length - 1))
		if (this.detailRow) this.detail = await readDetail(this.ctx.cwd, this.detailRow)
		this.ctx.ui.setStatus(statusKey, statusText(this.snapshot))
		this.tui.requestRender()
	}

	async openDetail() {
		const row = this.rows()[this.selected]
		if (!row) return
		this.detailRow = row
		this.scroll = 0
		this.detail = await readDetail(this.ctx.cwd, row)
		this.tui.requestRender()
	}

	move(step) {
		if (this.detailRow) this.scroll = Math.max(0, this.scroll + step)
		else this.selected = Math.max(0, Math.min(this.rows().length - 1, this.selected + step))
	}

	handleInput(data) {
		if (matchesKey(data, 'escape')) {
			if (!this.detailRow) return this.done()
			this.detailRow = null
			this.detail = null
		} else if (matchesKey(data, 'tab')) this.handle?.unfocus()
		else if (matchesKey(data, 'up')) this.move(-1)
		else if (matchesKey(data, 'down')) this.move(1)
		else if (matchesKey(data, 'return') && !this.detailRow) void this.openDetail()
		else if (data === 'r') void this.refresh()
		else return
		this.tui.requestRender()
	}

	listLines() {
		const { theme, snapshot } = this
		if (snapshot === undefined) return { lines: [theme.fg('dim', 'Reading the record.')], selectedLine: 0 }
		if (snapshot === null)
			return {
				lines: [
					theme.fg('dim', 'No Checkmate record in this folder.'),
					theme.fg('dim', 'Run /checkmate to start.'),
				],
				selectedLine: 0,
			}
		if (snapshot.problem)
			return {
				lines: [theme.fg('error', `Could not read the Checkmate record: ${snapshot.problem}`)],
				selectedLine: 0,
			}
		const mark = (index) => (index === this.selected && this.focused ? theme.fg('accent', '> ') : '  ')
		const waiting = snapshot.waiting.map(
			(item, index) => `${mark(index)}${item.kind} ${item.id} ${theme.fg('dim', item.text)}`
		)
		const plans = snapshot.plans.map(
			(plan, index) =>
				`${mark(snapshot.waiting.length + index)}${plan.planId} ${plan.state} ${theme.fg('dim', `waits on ${plan.waitsOn}`)}`
		)
		return {
			lines: [
				theme.bold(`Waiting for a decision (${waiting.length})`),
				...(waiting.length ? waiting : [theme.fg('dim', '  Nothing waits for a decision.')]),
				'',
				theme.bold(`Plans (${plans.length})`),
				...(plans.length ? plans : [theme.fg('dim', '  No plans yet.')]),
			],
			selectedLine:
				this.selected < waiting.length
					? 1 + this.selected
					: 4 + Math.max(1, waiting.length) + (this.selected - waiting.length),
		}
	}

	bodyLines(inner, height) {
		if (this.detailRow) {
			const lines = (this.detail?.lines ?? ['Reading the status.']).flatMap((line) =>
				line ? wrapTextWithAnsi(line, inner) : ['']
			)
			this.scroll = Math.min(this.scroll, Math.max(0, lines.length - height))
			return lines.slice(this.scroll, this.scroll + height)
		}
		const { lines, selectedLine } = this.listLines()
		const wrapped =
			this.snapshot?.problem || !this.snapshot ? lines.flatMap((line) => wrapTextWithAnsi(line, inner)) : lines
		const start = Math.max(0, Math.min(selectedLine - Math.floor(height / 2), wrapped.length - height))
		return wrapped.slice(start, start + height)
	}

	hint() {
		if (!this.focused) return '/checkmate-panel to focus'
		return this.detailRow
			? 'up/down scroll, r refresh, tab to chat, esc back'
			: 'up/down move, enter details, r refresh, tab to chat, esc close'
	}

	render(width) {
		const { theme } = this
		const inner = Math.max(1, width - 4)
		const height = Math.max(4, Math.floor(this.tui.terminal.rows * 0.85) - 6)
		const border = (text) => theme.fg(this.focused ? 'accent' : 'border', text)
		const row = (text) => `${border('│')} ${truncateToWidth(text, inner, '…', true)} ${border('│')}`
		const title = ' Checkmate, read only '
		return [
			border(`╭─${title}${'─'.repeat(Math.max(0, width - 3 - title.length))}╮`),
			...this.bodyLines(inner, height).map(row),
			row(''),
			row(theme.fg('dim', this.hint())),
			border(`╰${'─'.repeat(Math.max(0, width - 2))}╯`),
		].map((line) => truncateToWidth(line, width))
	}

	invalidate() {}

	dispose() {
		clearInterval(this.timer)
	}
}

export default function checkmatePanel(pi) {
	let open = null

	async function refreshStatus(ctx) {
		if (ctx.mode !== 'tui') return
		if (open) return open.refresh()
		ctx.ui.setStatus(statusKey, statusText(await readSnapshot(ctx.cwd)))
	}

	pi.on('session_start', (_event, ctx) => void refreshStatus(ctx))
	pi.on('agent_end', (_event, ctx) => void refreshStatus(ctx))
	pi.on('session_shutdown', () => open?.done())

	pi.registerCommand('checkmate-panel', {
		description: 'Show the Checkmate inbox and plan status in a read-only panel',
		handler: async (_args, ctx) => {
			if (ctx.mode !== 'tui') {
				ctx.ui.notify('The Checkmate panel needs the interactive terminal of Pi.', 'warning')
				return
			}
			if (open) {
				open.handle?.focus()
				return
			}
			void ctx.ui
				.custom(
					(tui, theme, _keybindings, done) => {
						open = new Panel(tui, theme, ctx, done)
						return open
					},
					{
						overlay: true,
						overlayOptions: overlay,
						onHandle: (handle) => {
							if (open) open.handle = handle
						},
					}
				)
				.finally(() => {
					open = null
				})
		},
	})
}
