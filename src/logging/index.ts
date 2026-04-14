import { RuntimeConfig } from '../config/runtime-config'
import { CheckmateLogger } from './logger'

export const logger = CheckmateLogger.create('checkmate', new RuntimeConfig().getLogLevel())
