import { createLogger, format, transports } from 'winston'
const { combine, timestamp, label, printf } = format

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off'

export class CheckmateLogger {
	static create(labelName: string, level: LogLevel) {
		const plainFormat = printf(({ level, message, label, timestamp }) => {
			return `${timestamp} [${label}] ${level}: ${message}`
		})
		return createLogger({
			level: level,
			format: combine(label({ label: labelName }), timestamp(), plainFormat),
			transports: [new transports.Console()],
		})
	}
}
