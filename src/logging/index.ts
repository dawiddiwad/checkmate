import { CheckmateLogger, LogLevel } from './logger.js'

export const logger = CheckmateLogger.create('checkmate', 'off')

/**
 * Points the shared console logger at the level a runner was configured with.
 *
 * Verbosity is a `checkmate*` option like everything else, but the logger itself is
 * process-wide, so the runner pushes its level here instead of the logger reading config.
 */
export function setLogLevel(level: LogLevel): void {
	logger.level = level
}
