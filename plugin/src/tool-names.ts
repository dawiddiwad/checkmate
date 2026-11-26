import type { Actions } from './types.ts'

// The names that hosts call the Checkmate action tools by. Every place that names a tool takes the name from here,
// so a renamed or removed action fails the TypeScript build.
const toolPrefix = 'checkmate_'

// Claude Code names a plugin MCP tool mcp__plugin_<plugin>_<server>__<tool>.
// The plugin is checkmate (plugin/.claude-plugin/plugin.json) and the server is actions (plugin/.mcp.json).
export const claudeToolPrefix = 'mcp__plugin_checkmate_actions__'

// The name of an action tool. Pi registers it with this name, and Claude Code adds claudeToolPrefix.
export function toolName(name: keyof Actions) {
	return `${toolPrefix}${name}`
}

export function claudeToolName(name: keyof Actions) {
	return `${claudeToolPrefix}${toolName(name)}`
}

export function isActionTool(tool: string) {
	return tool.startsWith(toolPrefix)
}

export function actionOfTool(tool: string) {
	return (isActionTool(tool) ? tool.slice(toolPrefix.length) : tool) as keyof Actions
}
