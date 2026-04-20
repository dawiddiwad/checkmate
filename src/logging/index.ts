import { RuntimeConfig } from '../config/runtime-config.js'
import { CheckmateLogger } from './logger.js'

export const logger = CheckmateLogger.create('checkmate', new RuntimeConfig().getLogLevel())
