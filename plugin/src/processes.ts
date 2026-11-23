// Checkmate signals only the process groups it started, and only while the group leader is still the process it
// recorded. A PID alone is not enough: a PID can be reused by another process, which can be a group leader too.
import { spawnSync, type ChildProcess } from 'node:child_process'

// The start time of the process that leads group pid, from ps. Undefined when no such leader exists.
export function startOfGroup(pid: number): number | undefined {
	if (!Number.isInteger(pid) || pid <= 1) return undefined
	const result = spawnSync('ps', ['-p', String(pid), '-o', 'pgid=', '-o', 'lstart='], {
		encoding: 'utf8',
		env: { ...process.env, LC_ALL: 'C' },
	})
	const [group, ...started] = (result.stdout ?? '').trim().split(/\s+/)
	if (Number(group) !== pid) return undefined
	const born = Date.parse(started.join(' '))
	return Number.isFinite(born) ? born : undefined
}

// True when pid leads a group that started at born. Without a recorded start time nothing can be verified.
export function isRecordedGroup(pid: number, born: number | undefined) {
	return born !== undefined && startOfGroup(pid) === born
}

// Signals the group led by pid, if the recorded leader is still there. Refuses, and says so, when it cannot verify.
export function signalRecordedGroup(pid: number, born: number | undefined, signal: NodeJS.Signals): boolean {
	if (!isRecordedGroup(pid, born)) {
		process.stderr.write(`checkmate: not sending ${signal} to process group ${pid}: its start cannot be verified\n`)
		return false
	}
	// Members are read before the signal, so a process that shares the group and dies with it is in the record.
	const members = groupMembers(pid)
	try {
		process.kill(-pid, signal)
		process.stderr.write(
			`checkmate: sent ${signal} to process group ${pid} (leader started ${new Date(born!).toISOString()}); members: ${members.join(' | ') || 'none'}\n`
		)
		return true
	} catch {
		return false
	}
}

// Records the start time of the group a child just started. Call right after spawn, while the child runs.
const startedGroups = new WeakMap<ChildProcess, number | undefined>()

export function trackGroup(child: ChildProcess) {
	if (child.pid !== undefined) startedGroups.set(child, startOfGroup(child.pid))
}

// Signals a child that Checkmate spawned. A child that has exited is never signalled: its PID may be reused.
export function signalChild(child: ChildProcess, signal: NodeJS.Signals) {
	if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
	signalRecordedGroup(child.pid, startedGroups.get(child), signal)
}

// The members of group pgid right now: pid, session and command. Logged at every signal, so a process that
// shares the group, such as a target app started inside a child's shell, is visible in the record.
export function groupMembers(pgid: number): string[] {
	const result = spawnSync('ps', ['-g', String(pgid), '-o', 'pid=,sess=,comm='], {
		encoding: 'utf8',
		env: { ...process.env, LC_ALL: 'C' },
	})
	return (result.stdout ?? '')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
}
