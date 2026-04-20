# **_checkmate_** docs

Technical documentation for **_checkmate_** - AI test automation with Playwright.

## Table of Contents

- [Core Concepts](#core-concepts)
- [Configuration Reference](#configuration-reference)
- [Writing Effective Tests](#writing-effective-tests)
- [Cost Management](#cost-management)
- [Web Extension](#web-extension)
- [Salesforce Extension](#salesforce-extension)
- [Test Reports](#test-reports)
- [Troubleshooting](#troubleshooting)
- [Architecture](#architecture)
- [Advanced Topics](#advanced-topics)

## Core Concepts

**_checkmate_** is an AI-driven test runner. You describe a step in natural language, **_checkmate_** runs a tool loop, and the step passes or fails based on the observed result.

Main building blocks:

- **Runner**: The object that executes steps. The main programmatic entry point is `createRunner()` from `@xoxoai/checkmate/core`.
- **Step**: A plain object with `action` and `expect`. This is the main unit of execution.
- **Extensions**: Composable modules that add tools and runtime behavior. Built-ins include `web()` and `salesforce()`.
- **Fixtures**: Convenience Playwright entry points that provide an `ai` runner in tests.

Published entry points:

- `@xoxoai/checkmate/core`: Build your own runner with extensions.
- `@xoxoai/checkmate/playwright`: Use the built-in web extension with Playwright `test` and `expect`.
- `@xoxoai/checkmate/salesforce`: Use the built-in web + Salesforce extensions with the same `ai` fixture shape.

Most users start here:

```typescript
import { test } from '@xoxoai/checkmate/playwright'

test('search flow', async ({ ai }) => {
	await ai.run({
		action: 'Search for playwright documentation',
		expect: 'Search results are displayed',
	})
})
```

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
import { expect, test } from '@xoxoai/checkmate/playwright'

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

	await expect(page.getByRole('link', { name: /playwright/i }).first()).toBeVisible()
})
```

### Complex Interactions

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

### Programmatic Composition

Use `@xoxoai/checkmate/core` when you want to build your own runner explicitly:

```typescript
import { createRunner } from '@xoxoai/checkmate/core'
import { web } from '@xoxoai/checkmate/playwright'
import { jira, notion, database } from 'your-own-extension-examples'

const ai = createRunner({
	extensions: [web({ page }), jira(), notion(), database()],
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
	topPercent: 20,
})
```

```
debug: Scored 107 elements
debug: Filtered to 21 elements from top 20%
debug: Reduced snapshot from 4283 to 326 chars (92% reduction)
```

Feature is controlled by the `CHECKMATE_SNAPSHOT_FILTERING` environment variable (default: `false`). Set it explicitly to `true` to enable filtering. `search` is now an explicit keyword query override, and `topPercent` lets you tune how much of the scored snapshot should be kept for a specific step.

The model can still request a full snapshot with the browser snapshot tool if the filtered tree is insufficient, so steps should not fail just because the initial snapshot was compact.

For optimal results, write concrete `action` and `expect` text. Use `topPercent` as a real percentage from `1` to `100` when you need to keep more or less of the scored snapshot. Optional `search` terms still help when you want direct keyword control.

**Tips for effective step text:**

- Include relevant UI element types (button, input, link, checkbox, etc.)
- Include key text that appears on the page
- Include action-related terms (search, filter, submit, etc.)
- Keep the step focused on one user intent
- Use `topPercent` only when you need to tune how aggressively snapshot content is pruned

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

## Web Extension

`@xoxoai/checkmate/playwright` is the pre-built web entry point. It composes the core runner with the built-in `web()` extension and exposes a Playwright-friendly `ai` fixture.

What it adds:

- browser tools for navigation and interaction
- initial page snapshots and optional screenshots
- `test`, `expect`, `web()`, and `createPlaywrightRunner(page)` exports

```typescript
import { test } from '@xoxoai/checkmate/playwright'

test('search flow', async ({ ai }) => {
	await ai.run({
		action: 'Search for playwright documentation',
		expect: 'Search results are displayed',
	})
})
```

## Salesforce Extension

`@xoxoai/checkmate/salesforce` builds on the web extension. It adds Salesforce-specific tools and keeps the same `ai` fixture shape as the Playwright entry point.

What it adds:

- the built-in `salesforce()` extension
- `test`, `expect`, and `createSalesforceRunner(page)` exports
- the `login_to_salesforce_org` tool backed by the Salesforce CLI

Prerequisites:

```bash
# Install Salesforce CLI
npm install -g @salesforce/cli

# Authenticate to your org and set is as default
sf org login web --alias my-checkmate-org --set-default
```

```typescript
import { test } from '@xoxoai/checkmate/salesforce'

test('create and configure itinerary', async ({ ai }) => {
	await test.step('Login to Salesforce', async () => {
		await ai.run({
			action: 'Login to Salesforce org and open Test QA Application',
			expect: 'Test QA homepage is displayed',
		})
	})
})
```

The `login_to_salesforce_org` tool handles the authentication flow by retrieving a front-door URL from the authenticated SF CLI session and navigating the browser for you.

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
@xoxoai/checkmate/core
│
├── createRunner({ extensions })
├── runtime/
│   ├── CheckmateRunner
│   ├── StepExecution
│   └── ExtensionHost
│
├── ai/
│   ├── AiClient
│   ├── ResponseProcessor
│   ├── MessageHistory
│   └── TokenTracker
│
├── tools/
│   └── step/
│       └── StepResultTools
│
├── @xoxoai/checkmate/playwright
│   └── web()
│       ├── BrowserToolRuntime
│       ├── SnapshotService
│       └── Browser tools
│
└── @xoxoai/checkmate/salesforce
    └── salesforce()
        ├── SalesforceTools
        └── Salesforce CLI integration
```

### Key Components

**Test Layer**

- Playwright Test framework manages test execution, reporting, and fixtures
- Tests written in natural language via `ai.run()` fixtures

**Core Engine**

- **createRunner**: Public composition entry point for building runners from extensions
- **CheckmateRunner**: Runtime instance returned by `createRunner`
- **AiClient**: Manages model interactions, retries, and tool-calling requests
- **Response Processor**: Handles tool responses, append-only history, and retries through the step loop
- **ExtensionHost**: Registers tools, instructions, step context builders, and post-tool hooks from extensions
- **Tool Registry**: Owns Zod-defined tool declarations and explicit tool resolution

**Tools**

- **Core Tools**: Step control (pass/fail step assertions)
- **Web Extension**: Playwright-powered browser tools, snapshots, and screenshots
- **Salesforce Extension**: SF CLI login flow layered on top of the web extension

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

For custom tools, extensions, built-in extension composition, and custom runners, see the dedicated [Extensions guide](./EXTENSIONS.md).

### Performance Optimization

For large test suites:

- Use faster models for simple tests (e.g., `gemini-3-flash-preview` or `gpt-5-mini`)
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

## See Also

- [EXTENSIONS](./EXTENSIONS.md)
- [README](../README.md)
