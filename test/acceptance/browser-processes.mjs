import { execFile, spawn } from 'node:child_process'
import process from 'node:process'
import { setInterval, clearInterval } from 'node:timers'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export async function runTracked(command, args, cwd, env, onStart = () => {}) {
	const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
	const browserPids = new Set()
	let stdout = ''
	let stderr = ''
	let sampling
	const sample = () =>
		(sampling ??= sampleBrowserDescendants(child.pid, browserPids).finally(() => {
			sampling = undefined
		}))
	const interval = setInterval(() => {
		void sample().catch(() => {})
	}, 50)
	child.stdout.setEncoding('utf8').on('data', (chunk) => {
		stdout += chunk
	})
	child.stderr.setEncoding('utf8').on('data', (chunk) => {
		stderr += chunk
	})
	onStart(child)
	try {
		const code = await new Promise((resolve, reject) => {
			child.once('error', reject)
			child.once('close', resolve)
		})
		await sampling
		return { code, stdout, stderr, browserPids }
	} finally {
		clearInterval(interval)
	}
}

async function sampleBrowserDescendants(rootPid, browserPids) {
	if (!rootPid) return
	const listing = await exec('ps', ['-axo', 'pid=,ppid=,command='])
	const processes = listing.stdout
		.split('\n')
		.map((line) => /^(\s*\d+)\s+(\d+)\s+(.+)$/.exec(line))
		.filter(Boolean)
		.map((match) => ({ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }))
	const descendants = new Set([rootPid])
	for (;;) {
		const before = descendants.size
		for (const entry of processes) if (descendants.has(entry.parent)) descendants.add(entry.pid)
		if (descendants.size === before) break
	}
	for (const entry of processes) {
		if (descendants.has(entry.pid) && /chrom(?:e|ium)|headless_shell/i.test(entry.command))
			browserPids.add(entry.pid)
	}
}

export async function assertProcessesExited(pids) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if ([...pids].every((pid) => !processExists(pid))) return
		await delay(50)
	}
	throw new Error('Built-in web driver left an observed browser process running')
}

function processExists(pid) {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		if (error?.code === 'ESRCH') return false
		throw error
	}
}
