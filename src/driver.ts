import { z } from 'zod/v4'
import type { RuntimeLogger } from './logging/types.js'

export type DriverLogger = RuntimeLogger

export type StepIntent = Readonly<{
	id: string
	action: string
	expect: string
}>

export type DriverSecretReader = Readonly<{
	read(slot: string): string
}>

export type DriverEvidenceSink = Readonly<{
	capture(input: {
		kind: string
		mediaType: string
		content: string | Uint8Array
		stepId?: string
	}): Promise<{ status: 'accepted' | 'discarded' }>
}>

export type DriverStartInput = Readonly<{
	target: unknown
	settings: unknown
	secrets: DriverSecretReader
	evidence: DriverEvidenceSink
	logger: DriverLogger
	signal: AbortSignal
}>

export type DriverStepContext = Readonly<{
	step: StepIntent
	signal: AbortSignal
}>

export type DriverToolContext = Readonly<{
	step: StepIntent
	turn: number
	signal: AbortSignal
}>

export type DriverToolResult = string | void | { response: string; status?: 'success' | 'error' }

export type DriverToolDefinition = Readonly<{
	name: string
	description: string
	parameters: Record<string, unknown>
	strict: boolean
}>

export type DriverTool = Readonly<{
	definition: DriverToolDefinition
	execute(args: unknown, context: DriverToolContext): Promise<DriverToolResult> | DriverToolResult
}>

export type DriverToolExecution = Readonly<{
	toolCallId: string
	name: string
	arguments: unknown
	response: string
	status: 'success' | 'error'
}>

export type ToolResponseContext = DriverStepContext &
	Readonly<{
		turn: number
		toolResponses: readonly DriverToolExecution[]
	}>

export type DriverCloseContext = Readonly<{
	signal: AbortSignal
}>

export type DriverContextMessage = Readonly<{
	content:
		| string
		| ReadonlyArray<
				Readonly<{ type: 'text'; text: string }> | Readonly<{ type: 'image'; mediaType: string; data: string }>
		  >
	ephemeral: boolean
}>

export type DriverSession = Readonly<{
	tools: readonly DriverTool[]
	instructions: readonly string[]
	buildInitialContext(input: DriverStepContext): Promise<DriverContextMessage[]>
	handleToolResponses(input: ToolResponseContext): Promise<DriverContextMessage[]>
	close(input: DriverCloseContext): Promise<void>
}>

export type CheckmateDriverV1 = Readonly<{
	id: string
	driverContractVersion: 1
	start(input: DriverStartInput): Promise<DriverSession>
}>

export function defineDriverTool<TSchema extends z.ZodType>(input: {
	name: string
	description: string
	schema: TSchema
	strict?: boolean
	handler: (args: z.infer<TSchema>, context: DriverToolContext) => Promise<DriverToolResult> | DriverToolResult
}): DriverTool {
	const parameters = z.toJSONSchema(input.schema) as Record<string, unknown>
	delete parameters.$schema

	return {
		definition: {
			name: input.name,
			description: input.description,
			parameters,
			strict: input.strict ?? true,
		},
		execute: async (args, context) => {
			const parsed = input.schema.safeParse(args)
			if (!parsed.success) {
				return {
					response: JSON.stringify({ error: `Invalid args for '${input.name}': ${parsed.error.message}` }),
					status: 'error',
				}
			}
			return input.handler(parsed.data, context)
		},
	}
}
