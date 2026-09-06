import { test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
	BrowserTool,
	BrowserToolRuntime as DriverBrowserToolRuntime,
	createBrowserTools as createDriverBrowserTools,
} from '../../drivers/web/tools/tool.js'
import type { ResolvedConfig } from '../../config/resolved-config.js'
import { logger } from '../../logging/index.js'
import type { AgentTool, AgentToolContext, AgentToolResult } from '../types.js'

export { BrowserTool }

export class BrowserToolRuntime extends DriverBrowserToolRuntime {
	constructor(page: Page, config: ResolvedConfig) {
		super(page, config, logger)
	}
}

export function createBrowserTools(runtime: BrowserToolRuntime): AgentTool[] {
	return createDriverBrowserTools(runtime).map(withTurnStep)
}

function withTurnStep(tool: AgentTool): AgentTool {
	return {
		...tool,
		execute: (args: unknown, context: AgentToolContext): Promise<AgentToolResult> =>
			isInsideTestWorker()
				? test.step(turnStepTitle(context.turn, tool.definition.name), () => tool.execute(args, context))
				: Promise.resolve(tool.execute(args, context)),
	}
}

function turnStepTitle(turn: number | undefined, toolName: string): string {
	return turn === undefined ? toolName : `turn ${turn} · ${toolName}`
}

function isInsideTestWorker(): boolean {
	try {
		test.info()
		return true
	} catch {
		return false
	}
}
