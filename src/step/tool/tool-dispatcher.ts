import { ToolRegistry, ToolResponse } from './tool-registry'
import { StepStatusCallback } from '../types'
import { LoopDetector } from './loop-detector'
import { ConfigurationManager } from '../configuration-manager'
import { ToolCall } from './openai-tool'

export class ToolDispatcher {
	private readonly toolRegistry: ToolRegistry
	private readonly loopDetector: LoopDetector

	constructor(toolRegistry: ToolRegistry) {
		this.toolRegistry = toolRegistry
		this.loopDetector = new LoopDetector(new ConfigurationManager().getLoopMaxRepetitions())
	}

	public async dispatch(toolCall: ToolCall, stepStatusCallback: StepStatusCallback): Promise<ToolResponse | null> {
		this.loopDetector.recordToolCall(toolCall)
		const { name } = toolCall

		if (name.includes('browser')) {
			return this.toolRegistry.executeBrowserTool(toolCall)
		} else if (name.includes('test_step')) {
			this.toolRegistry.executeStepTool(toolCall, stepStatusCallback)
			return null
		} else if (name.includes('salesforce')) {
			return this.toolRegistry.executeSalesforceTool(toolCall)
		} else {
			throw new Error(`Invalid tool name, received call\n: ${JSON.stringify(toolCall, null, 2)}`)
		}
	}
}
