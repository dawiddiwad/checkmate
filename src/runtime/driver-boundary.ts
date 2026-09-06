import type { ControlExpirationReason, StepControl } from './scenario-control.js'

export class DriverBoundaryError extends Error {
	constructor(
		readonly operation: string,
		readonly reason: ControlExpirationReason
	) {
		super(`Driver boundary '${operation}' expired: ${reason}`)
		this.name = 'DriverBoundaryError'
	}
}

export async function awaitDriverBoundary<T>(input: {
	operation: string
	signal: AbortSignal
	deadline: number
	call: (signal: AbortSignal) => Promise<T> | T
	now?: () => number
	reason?: () => ControlExpirationReason
}): Promise<T> {
	const now = input.now ?? Date.now
	if (input.signal.aborted || now() >= input.deadline) {
		throw new DriverBoundaryError(input.operation, input.reason?.() ?? signalReason(input.signal))
	}
	const controller = new AbortController()
	const reason = () => input.reason?.() ?? signalReason(input.signal)
	const timeout = Math.max(0, input.deadline - now())
	let timer: ReturnType<typeof setTimeout>
	let onAbort: () => void
	const boundaryPromise = new Promise<never>((_, reject) => {
		onAbort = () => {
			const expiration = reason()
			controller.abort(expiration)
			reject(new DriverBoundaryError(input.operation, expiration))
		}
		if (input.signal.aborted) queueMicrotask(onAbort)
		else input.signal.addEventListener('abort', onAbort, { once: true })
		timer = setTimeout(onAbort, timeout)
	})

	let callPromise: Promise<T>
	try {
		callPromise = Promise.resolve(input.call(controller.signal))
	} catch (error) {
		callPromise = Promise.reject(error)
	}
	void callPromise.catch((): void => undefined)

	try {
		const value = await Promise.race([callPromise, boundaryPromise])
		if (input.signal.aborted || now() >= input.deadline) {
			const expiration = reason()
			controller.abort(expiration)
			throw new DriverBoundaryError(input.operation, expiration)
		}
		return value
	} finally {
		clearTimeout(timer!)
		input.signal.removeEventListener('abort', onAbort!)
	}
}

export function awaitStepDriverBoundary<T>(
	operation: string,
	control: StepControl,
	call: (signal: AbortSignal) => Promise<T> | T
): Promise<T> {
	return awaitDriverBoundary({
		operation,
		signal: control.signal,
		deadline: control.deadline,
		reason: () => {
			const state = control.poll()
			return state.expired ? state.reason : 'step-timeout'
		},
		call,
	})
}

function signalReason(signal: AbortSignal): ControlExpirationReason {
	return signal.reason === 'interrupted' || signal.reason === 'scenario-timeout' ? signal.reason : 'step-timeout'
}
