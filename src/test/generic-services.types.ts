import { z } from 'zod/v4'
import {
	CheckmateBrowserService,
	CheckmateExtension,
	CheckmateProfile,
	CheckmateRunner,
	CheckmateServices,
	defineCheckmateTool,
	extensions,
	profiles,
} from '../index'
import type { Step } from '../runtime/types'

type JiraService = {
	getIssue(issueKey: string): Promise<{ summary: string; status: string }>
}

type ExtendedBrowserService = CheckmateBrowserService & {
	clickByTestId(testId: string, step: Step): Promise<string>
}

type AppServices = CheckmateServices & {
	jira?: JiraService
	browser?: ExtendedBrowserService
}

const jiraToolSchema = z
	.object({
		issueKey: z.string(),
	})
	.strict()

const clickByTestIdSchema = z
	.object({
		testId: z.string(),
	})
	.strict()

const jiraLookupTool = defineCheckmateTool<typeof jiraToolSchema, AppServices>({
	name: 'jira_lookup',
	description: 'Read a Jira issue',
	schema: jiraToolSchema,
	handler: async ({ issueKey }, { services }) => {
		const issue = await services.jira?.getIssue(issueKey)
		return { response: issue ? issue.summary : 'missing jira' }
	},
})

const clickByTestIdTool = defineCheckmateTool<typeof clickByTestIdSchema, AppServices>({
	name: 'browser_click_by_test_id',
	description: 'Click an element by test id',
	schema: clickByTestIdSchema,
	handler: ({ testId }, { services, step }) => {
		return services.browser?.clickByTestId(testId, step)
	},
})

const jiraExtension: CheckmateExtension<AppServices> = {
	name: 'jira',
	requires: ['jira'],
	setup: () => ({
		tools: [jiraLookupTool],
	}),
}

const browserExtrasExtension: CheckmateExtension<AppServices> = {
	name: 'browser-extras',
	requires: ['browser'],
	setup: ({ services }) => ({
		tools: [clickByTestIdTool],
		initialContext: [async (step) => services.browser?.getInitialContext(step)],
	}),
}

const typedProfile: CheckmateProfile<AppServices> = {
	name: 'typed-web',
	extensions: [extensions.browser<AppServices>(), jiraExtension, browserExtrasExtension],
}

const typedWebRunner = new CheckmateRunner<AppServices>({
	profile: profiles.web<AppServices>(),
	extensions: [jiraExtension],
	services: {
		jira: {
			getIssue: async () => ({ summary: 'summary', status: 'done' }),
		},
	},
})

const typedProfileRunner = new CheckmateRunner<AppServices>({
	profile: typedProfile,
	services: {
		browser: {
			page: {} as CheckmateBrowserService['page'],
			navigateToUrl: async () => 'ok',
			clickElement: async () => 'ok',
			typeOrSelectInElement: async () => 'ok',
			pressKey: async () => 'ok',
			captureCurrentSnapshot: async () => 'snapshot',
			wait: async () => 'ok',
			getInitialContext: async (): Promise<[]> => [],
			getScreenshotContextItem: async () => ({
				kind: 'image' as const,
				name: 'browser.screenshot',
				mimeType: 'image/png',
				data: 'YmFzZTY0',
			}),
			clickByTestId: async () => 'clicked',
		},
	},
})

void typedWebRunner
void typedProfileRunner
