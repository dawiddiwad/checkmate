import type { Page } from '@playwright/test'
import type { ResolvedConfig } from '../../config/resolved-config.js'
import {
	SnapshotService as DriverSnapshotService,
	type SnapshotServiceOptions,
} from '../../drivers/web/tools/snapshot-service.js'
import { logger } from '../../logging/index.js'
import type { Step } from '../../runtime/types.js'

export type { BrowserSnapshot, SnapshotServiceOptions } from '../../drivers/web/tools/snapshot-service.js'

export class SnapshotService extends DriverSnapshotService {
	constructor(page: Page | null, config: ResolvedConfig, step?: Step, options: SnapshotServiceOptions = {}) {
		super(page, config, logger, step, options)
	}
}
