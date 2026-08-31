export { CheckmateRunner, createRunner } from './runtime/runner.js'
export type { CheckmateRunnerOptions } from './runtime/runner.js'
export { defineExtension } from './runtime/extension.js'
export type {
	CheckmateExtension,
	ExtensionDefinition,
	ExtensionInitialMessagesBuilder,
	ExtensionOverride,
	ExtensionSetupApi,
	ExtensionTeardown,
	ExtensionToolResponsesHook,
	ToolExecution,
} from './runtime/extension.js'
export { defineAgentTool, defineTool } from './tools/define-agent-tool.js'
export type {
	AgentTool,
	AgentToolContext,
	AgentToolDefinition,
	AgentToolResponse,
	AgentToolResult,
	ToolCall,
	ToolResponse,
} from './tools/tool-contract.js'
export type {
	ContextMessage,
	Step,
	StepAssertion,
	StepCategory,
	StepReport,
	StepToolCall,
	StepUsage,
	TerminationReason,
	TranscriptEntry,
} from './runtime/types.js'
