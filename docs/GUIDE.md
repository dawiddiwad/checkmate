# **_checkmate_** docs

Technical documentation for **_checkmate_** - AI test automation with Playwright.

## Table of Contents

- [Core Concepts](#core-concepts)
- [Configuration Reference](#configuration-reference)
- [Writing Effective Tests](#writing-effective-tests)
- [Cost Management](#cost-management)
- [Salesforce Testing](#salesforce-testing)
- [Test Reports](#test-reports)
- [Troubleshooting](#troubleshooting)
- [Architecture](#architecture)
- [Advanced Topics](#advanced-topics)
- [Extensibility](#extensibility)

## Core Concepts

### What Checkmate Is

- A natural-language test runner built on top of Playwright.
- A tool-using runtime where the model observes state, calls tools, and decides when a step passed or failed.
- A framework for browser-led end-to-end workflows, with room for domain extensions like Salesforce, Jira, or custom business tools.

### What Checkmate Is Not

- Not a replacement for Playwright. Playwright still owns the browser, fixtures, config, traces, and test process.
- Not a unit test framework, API client, or visual regression tool by itself.
- Not an autonomous crawler that invents its own goals. It follows the step intent with `action` and `expect`.
- Not magic around flaky apps. Slow pages, unstable environments, and unclear expectations still produce unreliable tests.

### Main Assumptions

- Humans or external agents define the intent. Each step should clearly say what to do and what success looks like.
- The model works best when the UI exposes meaningful accessible structure, stable labels, and predictable flows.
- Most tests should stay business-focused. Use Checkmate for user workflows, not for tiny implementation details.
- Smaller, clearer steps are easier to execute and easier to debug than vague multi-goal prompts.
- The runtime should expose only the tools and services needed for the domain you are testing.

### Main Building Blocks

- `CheckmateRunner`: executes one step at a time and owns the model loop.
- `Step`: the natural-language contract for a single action and expected result.
- `Tool`: an action the model is allowed to call, such as navigate, click, type, or mark pass/fail.
- `Profile`: a named runtime setup such as `web` or `salesforce`.
- `Extension`: reusable behavior that adds tools, prompt guidance, initial context, and optional services.
- `Service`: a shared runtime surface such as `browser`, `salesforce`, `jira`, `api`, or `db`.
- `hints`: optional per-step tuning.

### Practical Mental Model

Think of Checkmate like this:

1. You write the intent for a step.
2. Checkmate sends the current context to the model.
3. The model calls tools to interact with the app.
4. The runtime keeps the loop bounded and records state.
5. The model eventually marks the step as pass or fail.

## Configuration Reference

### AI API Settings

| Variable                                | Default      | Description                                                                                               |
| --------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                        | -            | **Required** - Your OpenAI API key (or compatible provider)                                               |
| `OPENAI_BASE_URL`                       | -            | Optional - Override for compatible providers (Claude, Gemini, local LLMs)                                 |
| `OPENAI_MODEL`                          | `gpt-5-mini` | Model: gpt-5, gemini-2.5-flash, claude-4-5-sonnet etc.                                                    |
| `OPENAI_TEMPERATURE`                    | `1.0`        | Creativity (below 0.5 = deterministic, above 0.5 = creative)                                              |
| `OPENAI_REASONING_EFFORT`               | -            | Optional - Reasoning effort for models: low, medium, high                                                 |
| `OPENAI_TIMEOUT_SECONDS`                | `60`         | API request timeout in seconds                                                                            |
| `OPENAI_API_RATE_LIMIT_DELAY_SECONDS`   | `0`          | Optional fixed delay before each API call, useful when your provider is sensitive to burst traffic        |
| `OPENAI_RETRY_MAX_ATTEMPTS`             | `3`          | Max retries with backoff (1s, 10s, 60s) for rate limits and server errors                                 |
| `OPENAI_TOOL_CHOICE`                    | `required`   | Tool choice: auto, required, none                                                                         |
| `OPENAI_ALLOWED_TOOLS`                  | -            | Comma-separated list of allowed tools (if not set, all tools available)                                   |
| `OPENAI_INCLUDE_SCREENSHOT_IN_SNAPSHOT` | `false`      | Include compressed screenshots in snapshot responses                                                      |
| `OPENAI_API_TOKEN_BUDGET_USD`           | -            | Optional - USD budget for total OpenAI API spend per test run. Only positive decimal values are enforced. |
| `OPENAI_API_TOKEN_BUDGET_COUNT`         | -            | Optional - Token count limit for total tokens per test run. Only positive integers are enforced.          |
| `OPENAI_LOOP_MAX_REPETITIONS`           | `5`          | Number of repetitive tool call patterns to detect before triggering loop recovery with random temperature |
| `CHECKMATE_LOG_LEVEL`                   | `off`        | Logging verbosity: debug, info, warn, error, off                                                          |
| `CHECKMATE_SNAPSHOT_FILTERING`          | `false`      | Enable semantic page snapshot filtering before requests are sent to the model                             |

### Playwright Configuration

Browser settings (viewport, headless mode, video recording, timeouts, etc.) are configured in [playwright.config.ts](../playwright.config.ts) using Playwright's [standard](https://playwright.dev/docs/test-configuration) configuration mechanism.

## Writing Effective Tests

### Best Practices

1. **Be Specific** - Clear expectations help the AI validate success
2. **One Action Per Step** - Break complex flows into discrete steps
3. **Include Context** - Mention relevant UI elements and expected behavior
4. **Add Timing Hints** - For slow operations, mention expected wait times
5. **Handle Popups** - Explicitly mention consent dialogs or modals

### Basic Example

```typescript
import { expect, test } from '@alepoco/checkmate/playwright'

test('search for playwright documentation', async ({ page, ai }) => {
	await test.step('Navigate to Google', async () => {
		await ai.run({
			action: `Open the browser and navigate to google.com`,
			expect: `google.com is loaded and the search bar is visible`,
		})
	})

	await test.step('Search for Playwright', async () => {
		await ai.run({
			action: `Type 'playwright test automation' in the search bar and press Enter`,
			expect: `Search results contain the playwright.dev link`,
		})
	})
})
```

### Complex Interactions Example

Multiple actions and assertions can be handled in a single step. Here's an example of a more complex interaction that includes waiting for elements, handling popups, and filling out a form:

```typescript
await test.step('Fill form and submit', async () => {
	await ai.run({
		action: `
            Wait for the newsletter popup (takes ~30 seconds), 
            then close it by clicking the X button.
            Scroll to the comment section and click to activate it.
            Type 'Great article!' into the comment textarea.
            Click the Submit button.
        `,
		expect: `
            The comment is submitted, 
            and either a success message appears 
            or a login form is displayed if not authenticated.
        `,
	})
})
```

### Browser Hints

Tests can be fine-tuned with browser-specific hints that help to guide the AI's interactions with the page by reducing page snapshot noise and focusing on relevant elements. These hints are provided under `hints.browser`, example of using search terms and top-percent filtering to optimize the snapshot content sent to the model:

```typescript
await ai.run({
	action: `Click on the link that leads to playwright.dev`,
	expect: `The playwright.dev homepage is displayed`,
	hints: {
		browser: {
			search: ['playwright', 'docs'],
			topPercent: 20,
		},
	},
})
```

## Cost Management

**_checkmate_** includes built-in token usage monitoring:

```json
{
	"response input": "2543 @ $0.00$",
	"response output": "456 @ $0.00$",
	"history (estimated)": 45234,
	"step input": "5123 @ $0.00$",
	"step output": "892 @ $0.00$",
	"test input": "25678 @ $0.01$",
	"test output": "4521 @ $0.01$"
}
```

### Cost Optimization Features

1. **Smart Snapshots** - Instead of full HTML, only the ARIA accessibility tree is sent to the AI
2. **History Filtering** - Continuously filters old page snapshots (reduces token usage by up to 50%)
3. **Snapshot Minification** - Removes unnecessary whitespace and quotes from ARIA snapshots
4. **Snapshot Filtering** - Local semantic filtering of page snapshots using the current step description (reduces token usage by up to 90%)
5. **Screenshots** - Normalized and compressed locally, helps vision models understand UI better
6. **Chat Recycling** - New session per step to prevent context bloat and isolation
7. **Token Counting** - Real-time usage tracking per step and test with budgets
8. **Loop Detection** - Detects and mitigates repetitive tool call patterns, preventing AI runaway costs

### Budgeting & Cost Limits

You can set one or both token budget environment variables to enforce limits during a single test run.

- `OPENAI_API_TOKEN_BUDGET_USD` — Sets a USD budget (e.g. 0.50) per test execution. The framework checks the current estimated cost (input+output tokens) and throws an error if the budget is exceeded.
- `OPENAI_API_TOKEN_BUDGET_COUNT` — Sets a token limit (e.g. 100000). The framework tracks input and output tokens across the test and throws an error when the total exceeds this limit.

Notes:

- Only positive numbers are enforced; `0` or non-positive values are effectively treated as disabled.
- If the env var is unset or invalid (non-number), it is ignored.

### Using Snapshot Filtering for Token Optimization

When snapshot filtering is enabled, **_checkmate_** scores the page snapshot locally with a semantic embedding model and keeps the most relevant branches of the accessibility tree.

Default behavior:

- Build one query from `action + expect`
- Score snapshot keys and string leaves against that query
- If `search` is provided on the step, use those keywords instead of semantic `action + expect`
- Keep the top `10%` of scored elements by default
- If top-percent selection yields nothing, fall back to hard threshold `0.3`

**This feature significantly reduces the payload size, minimizing costs while improving AI determinism, reliability and speed.**

```typescript
await ai.run({
	action: `Click on the link that leads to playwright.dev`,
	expect: `The playwright.dev homepage is displayed`,

	// optional snapshot filtering override
	hints: {
		browser: {
			topPercent: 20,
		},
	},
})
```

```
debug: Scored 107 elements
debug: Filtered to 21 elements from top 20%
debug: Reduced snapshot from 4283 to 326 chars (92% reduction)
```

Feature is controlled by the `CHECKMATE_SNAPSHOT_FILTERING` environment variable (default: `false`). Set it explicitly to `true` to enable filtering. `hints.browser.search` is an explicit keyword query override, and `hints.browser.topPercent` lets you tune how much of the scored snapshot should be kept for a specific step.

The model can still request a full snapshot with the browser snapshot tool if the filtered tree is insufficient, so steps should not fail just because the initial snapshot was compact.

For optimal results, write concrete `action` and `expect` text. Use `hints.browser.topPercent` as a real percentage from `1` to `100` when you need to keep more or less of the scored snapshot. Optional `hints.browser.search` terms still help when you want direct keyword control.

**Tips for effective step text:**

- Include relevant UI element types (button, input, link, checkbox, etc.)
- Include key text that appears on the page
- Include action-related terms (search, filter, submit, etc.)
- Keep the step focused on one user intent
- Use `hints.browser.topPercent` only when you need to tune how aggressively snapshot content is pruned

### Estimated Costs

**Gemini-2.5-flash / GPT-5-mini**:

- Simple test (~5 steps): ~$0.01 - $0.05
- Complex test (~20 steps): ~$0.10 - $0.40
- Full E2E suite (~50 complex tests): ~$5.00 - $20.00

**GPT-OSS-20B via groq**:

- Simple test (~5 steps): ~$0.001 - $0.01
- Complex test (~20 steps): ~$0.01 - $0.05
- Full E2E suite (~50 complex tests): ~$1.00 - $2.00

_Costs vary based on model, screenshot size and count, and page complexity_

## Salesforce Testing

**_checkmate_** includes native Salesforce support using the SF CLI.

For Playwright fixtures that default to the Salesforce profile, import from:

```typescript
import { expect, test } from '@alepoco/checkmate/salesforce'
```

### Prerequisites

```bash
# Install Salesforce CLI
npm install -g @salesforce/cli

# Authenticate to your org and set is as default
sf org login web --alias my-checkmate-org --set-default
```

### Example Salesforce Test

```typescript
test('create and configure itinerary', async ({ ai }) => {
	await test.step('Login to Salesforce', async () => {
		await ai.run({
			action: `Login to Salesforce org and open Test QA Application`,
			expect: `Test QA homepage is displayed`,
		})
	})

	await test.step('Create new itinerary', async () => {
		await ai.run({
			action: `
                Click 'New', select 'Quote' record type, 
                fill 'Itinerary Name' = 'AI Test', 
                'Account' = 'Test Account', 
                'Group Size' = '5', 
                then Save
            `,
			expect: `New itinerary is saved and details page is displayed`,
		})
	})
})
```

### Authentication Flow

The `login_to_salesforce_org` tool handles the complete Salesforce authentication flow:

1. Retrieves a front-door URL from the authenticated SF CLI session
2. Automatically navigates the browser to login

No manual URL handling needed - just call "Login to Salesforce" in your test action.

## Test Reports

Multiple report formats are generated after each run:

- **HTML Report**: `test-reports/html/index.html` (interactive - no screenshots/video yet though)
- **JUnit XML**: `test-reports/junit/results.xml` (CI/CD integration)
- **Console Output**: Real-time step results and token usage

```bash
# Open HTML report in browser
npx playwright show-report test-reports/html
```

## Troubleshooting

### AI makes incorrect decisions

**Symptoms**: The AI clicks wrong elements, misinterprets the page, or fails to complete actions correctly.

**Solutions**:

- Provide more precise descriptions in `action` and more focused assertions in `expect`
- Reference specific element identifiers and roles (for example: text, label, button, list)
- Break complex workflows into single-action steps; use a step-by-step approach

### Tests loop during step execution

**Symptoms**: The AI repeats the same actions or gets stuck in a loop, consuming tokens unnecessarily.

**Solutions**:

- Increase `OPENAI_TEMPERATURE` to encourage exploration
- Use a reasoning/thinking model (if available) to improve planning and avoid repetitive loops

### High token costs

**Symptoms**: Tests consume more tokens than expected, leading to high API costs.

**Solutions**:

- Set a lower reasoning effort: `OPENAI_REASONING_EFFORT`
- Consider disabling `OPENAI_INCLUDE_SCREENSHOT_IN_SNAPSHOT`
- Use a cheaper model, lower-end models often perform well (e.g., `gemini-2.5-flash-lite` or `gpt-5-nano`)

### Rate limiting errors

**Symptoms**: API calls fail with 429 errors or rate limit messages.

**Solutions**:

- The framework automatically retries with backoff (1s, 10s, 60s)
- Upgrade your API plan with your provider
- Reduce concurrent test execution
- Increase `OPENAI_TIMEOUT_SECONDS` if needed

### Timeout errors

**Symptoms**: Tests fail with timeout errors before completing actions.

**Solutions**:

- Increase `OPENAI_TIMEOUT_SECONDS` in your `.env` file
- Mention expected wait times in your action descriptions
- Break long-running actions into smaller steps

## Architecture

**_checkmate_** combines multiple components to enable AI-driven test automation:

```
Playwright Test
│
└── ai.run(step)
    │
    └── runtime/
        ├── CheckmateRunner
        └── StepExecution
            │
            ├── ai/
            │   ├── AiClient
            │   ├── ResponseProcessor
            │   ├── MessageHistory
            │   └── TokenTracker
            │
            ├── tools/
            │   ├── browser/
            │   │   ├── BrowserToolRuntime
            │   │   ├── SnapshotService
            │   │   └── snapshot-filter/
            │   ├── step/
            │   │   └── StepResultTools
            │   └── salesforce/
            │       └── SalesforceTools
            │
            ├── integrations/
            │   └── salesforce/
            │
            ├── config/
            └── logging/
```

### Key Components

**Test Layer**

- Playwright Test framework manages test execution, reporting, and fixtures
- Tests written in natural language via `ai.run()` fixture

**Core Engine**

- **CheckmateRunner**: Public runtime entry point for executing steps
- **AiClient**: Manages model interactions, retries, and tool-calling requests
- **Response Processor**: Handles tool responses, snapshot minification, and history filtering
- **Tool Registry**: Owns Zod-defined tool declarations and explicit tool resolution

**Tools**

- **Browser Tools**: Playwright Test for web automation (click, type, navigate, etc.)
- **Step Result Tools**: Test control (pass/fail step assertions)
- **Salesforce Tools**: SF CLI integration for Salesforce testing

**Cost Optimization**

- Token tracking with budget enforcement
- History filtering (removes old snapshots)
- Snapshot minification and screenshot compression
- Loop detection and mitigation

**Configuration**

- Test, Reporting and Browser settings: [playwright.config.ts](../playwright.config.ts)
- API & AI settings: `.env` file

## Advanced Topics

### Custom Tool Integration

**_checkmate_**'s tool registry can be extended with custom tools for specific testing needs. Tools are now defined as single-function contracts with:

- one OpenAI tool definition
- one Zod schema
- one `execute` function

Use `src/tools/define-agent-tool.ts` as the entry point for new tools and see `src/tools/` for examples.

### Performance Optimization

For large test suites:

- Use faster models for simple tests (e.g., `gemini-2.5-flash-lite`)
- Set token budgets to prevent runaway costs
- Disable screenshots in snapshots when visual context isn't needed
- Consider parallel test execution with Playwright's workers

### CI/CD Integration

**_checkmate_** generates JUnit XML reports compatible with most CI/CD systems:

```yaml
# Example GitHub Actions
- name: Run Tests
  run: npm test

- name: Upload Reports
  uses: actions/upload-artifact@v3
  with:
    name: test-reports
    path: test-reports/
```

## Extensibility

Checkmate keeps the runtime model small. The core is responsible for execution, while extensions add domain-specific behavior and tools. Services are the shared runtime surfaces those extensions use.

### Extensibility Basics

Most users only need `new CheckmateRunner({ page })`.

- `CheckmateRunner`: executes steps and owns the model loop.
- `profile`: a named, ordered setup such as `profiles.web()` or `profiles.salesforce()`.
- `extension`: reusable behavior that adds tools, prompt guidance, initial context, and optional services.
- `service`: a shared named runtime client such as `browser`, `salesforce`, `jira`, `api`, or `db`.

Use them in this order:

1. Start with the default web runner.
2. Switch to a built-in profile if one matches your domain.
3. Add extensions when you need custom behavior.
4. Add services only when tools or extensions need a shared external client or typed runtime surface.

### Mental Model

```text
CheckmateRunner
├─ profile
│  ├─ browser extension
│  │  └─ browser service (actions via playwright)
│  ├─ salesforce extension
│  │  └─ salesforce service (front-door URL via SF CLI)
│  └─ custom extension
│     └─ API service
│     └─ DB service
│     └─ etc...
└─ runtime core
   ├─ builds prompt
   ├─ gathers context
   ├─ dispatches tools
   ├─ tracks retries
   └─ resolves pass/fail
```

Read it from top to bottom:

- the **runner** executes steps
- a **profile** picks the extension set
- each **extension** adds behavior
- **services** are the shared runtime surfaces those extensions use
- the **runtime core** stays responsible for execution

### Common Setups

```typescript
import { CheckmateRunner, extensions, profiles } from '@alepoco/checkmate'

const web = new CheckmateRunner({ page })

const salesforce = new CheckmateRunner({
	page,
	profile: profiles.salesforce(),
})

const custom = new CheckmateRunner({
	page,
	profile: profiles.web(),
	extensions: [extensions.salesforce()],
})
```

If you prefer Playwright-first setup, use the fixture subpaths:

```typescript
import { expect, test } from '@alepoco/checkmate/playwright'
```

```typescript
import { expect, test } from '@alepoco/checkmate/salesforce'
```

Choose the simplest shape that fits:

- use the default runner for normal web flows
- use a built-in profile for a named ready-made setup
- add extensions when you need custom behavior on top

### Creating A Custom Extension

Create an extension when you want to add a tool, prompt guidance, or initial context.

```typescript
import { defineCheckmateTool } from '@alepoco/checkmate'
import type { CheckmateExtension } from '@alepoco/checkmate'
import { z } from 'zod/v4'

const readAccountLogs = defineCheckmateTool({
	name: 'read_account_logs',
	description: 'Read detailed debug logs from the database for a given account',
	schema: z
		.object({
			accountId: z.string().describe('account id to query logs for'),
		})
		.strict(),
	handler: ({ accountId }) => ({
		_mocked_response: `Queried logs for Account ID: ${accountId}`,
	}),
})

export const debugKit: CheckmateExtension = {
	name: 'debug-kit',
	setup: () => ({
		tools: [readAccountLogs],
		prompt: ['Always analyze logs when encountering issues related to accounts.'],
	}),
}
```

Compose it into a runner:

```typescript
import { CheckmateRunner } from '@alepoco/checkmate'
import { debugKit } from './debug-kit-extension'

const runner = new CheckmateRunner({
	profile: profiles.web(),
	extensions: [debugKit],
})
```

### Typed Custom Service

If you want autocomplete on custom services, define one shared service type and reuse it everywhere.

```typescript
import { CheckmateRunner, defineCheckmateTool } from '@alepoco/checkmate'
import type { CheckmateExtension, CheckmateServices } from '@alepoco/checkmate'
import { z } from 'zod/v4'

type JiraService = {
	getIssue(issueKey: string): Promise<{ summary: string; status: string }>
}

type AppServices = CheckmateServices & {
	jira?: JiraService
	notion?: NotionService
	// etc - keep all custom services in this single type for easy reuse across extensions and tools
}

const schema = z
	.object({
		issueKey: z.string().describe('Jira issue key'),
	})
	.strict()

const jiraLookupTool = defineCheckmateTool<typeof schema, AppServices>({
	name: 'jira_lookup_issue',
	description: 'Read a Jira issue by key',
	schema,
	handler: async ({ issueKey }, { services }) => {
		const jira = services.jira
		if (!jira) {
			return {
				response: 'Jira service is not configured',
				status: 'error',
			}
		}

		const issue = await jira.getIssue(issueKey)
		return {
			response: `${issueKey}: ${issue.summary} (${issue.status})`,
		}
	},
})

export const jiraExtension: CheckmateExtension<AppServices> = {
	name: 'jira',
	requires: ['jira'],
	setup: () => ({
		tools: [jiraLookupTool],
		prompt: [
			'Use the Jira lookup tool when a step refers to a ticket, bug, or release issue, so the latest information can be retrieved and included in the context.',
		],
	}),
}

const runner = new CheckmateRunner<AppServices>({
	page,
	extensions: [jiraExtension],
	services: {
		jira: jiraClient,
	},
})
```

### Extending The Built-in Browser Service

If the built-in browser service doesn't meet your needs, you can extend it with additional methods while keeping the existing contract for built-in tools.

```typescript
import { CheckmateRunner, defineCheckmateTool, extensions, profiles } from '@alepoco/checkmate'
import type { CheckmateBrowserService, CheckmateExtension, CheckmateServices } from '@alepoco/checkmate'
import type { Step } from '@alepoco/checkmate'
import { z } from 'zod/v4'

type ExtendedBrowserService = CheckmateBrowserService & {
	clickByTestId(testId: string, step: Step): Promise<string>
}

type AppServices = CheckmateServices & {
	browser?: ExtendedBrowserService
}

const schema = z
	.object({
		testId: z.string().describe('Stable test id to click'),
	})
	.strict()

const clickByTestIdTool = defineCheckmateTool<typeof schema, AppServices>({
	name: 'browser_click_by_test_id',
	description: 'Click an element by test id',
	schema,
	handler: ({ testId }, { services, step }) => {
		return services.browser?.clickByTestId(testId, step)
	},
})

const browserExtras: CheckmateExtension<AppServices> = {
	name: 'browser-extras',
	requires: ['browser'],
	setup: () => ({
		tools: [clickByTestIdTool],
	}),
}

const runner = new CheckmateRunner<AppServices>({
	page,
	profile: profiles.web<AppServices>(),
	extensions: [browserExtras],
	services: {
		browser: myExtendedBrowserService,
	},
})
```

The built-in browser tools still use the base browser service contract. Your extension can add new methods to the browser service, and your tools can use those methods while built-in tools remain unaffected.

### Creating A Custom Profile

Wrap a reusable extension composition in a profile when multiple suites should share the same setup.

```typescript
import { CheckmateRunner, extensions } from '@alepoco/checkmate'
import type { CheckmateProfile } from '@alepoco/checkmate'
import { debugKit } from './debug-kit-extension'
import { browserExtras } from './browser-extras-extension'
import { jiraExtension } from './jira-extension'

const webDevProfile: CheckmateProfile = {
	name: 'web-development',
	extensions: [extensions.browser(), debugKit, jiraExtension, browserExtras],
}

const runner = new CheckmateRunner({
	page,
	profile: webDevProfile,
})
```

### Extension Rules

- Keep domain behavior in extensions, not in the core runner.
- Prefer services over reaching into internal runtime classes.
- Treat profiles as stable entry points and extensions as reusable building blocks.
- Namespace custom tool names to avoid collisions.

---

See [readme](../README.md) for more information and getting started guide.
