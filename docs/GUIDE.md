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

- **Runner**: The object that executes steps. The main API entry point is `createRunner()` from `@xoxoai/checkmate/core`.
- **Step**: A plain object with `action`, `expect`, and an optional `name`. This is the main unit of execution.
- **Step report**: The versioned `checkmate-step.json` every step attaches. It carries the assertion, the layer that produced it (`app`, `model`, or `infra`), the termination reason, the tool calls, the turn count, and the cost.
- **Extensions**: Composable modules that add tools and runtime behavior. Built-ins include `web()` and `salesforce()`.
- **Fixtures**: Convenience [Playwright](https://playwright.dev/docs/test-fixtures) entry points that provide an `ai` runner in tests.

Published entry points:

- `@xoxoai/checkmate/core`: Build your own runner with extensions.
- `@xoxoai/checkmate/playwright`: The mergeable `checkmate` test object, a bundled `test`, and `expect`.
- `@xoxoai/checkmate/salesforce`: Use the built-in web + Salesforce extensions with the same `ai` fixture shape.

The documented path adds one line to a fixtures file the team already owns:

```typescript
// fixtures.ts
import { mergeTests } from '@playwright/test'
import { checkmate } from '@xoxoai/checkmate/playwright'
import { test as baseTest } from './my-existing-fixtures'

export const test = mergeTests(baseTest, checkmate)
```

```typescript
import { test } from './fixtures'

test('search flow', async ({ ai }) => {
	await ai.step({
		name: 'search the docs',
		action: `Type 'documentation' in the search bar and press Enter`,
		expect: `At least 5 search results are displayed`,
	})
})
```

Two other entry points ship but are not the documented path:

- A bundled `test` — `import { test, expect } from '@xoxoai/checkmate/playwright'`. Zero setup, but it takes over the test object, so it collides with a suite that already has custom fixtures. This is what the scaffolded greenfield examples use.
- A factory — `createAi(page)`. No fixture integration at all, usable inside a helper or page object, at the cost of caller-owned `teardown()`.

### Every step is a Playwright step

`ai.step` always creates its own `test.step`, labelled `ai: <name>` so a reviewer scanning a
report can see which steps were nondeterministic, and always attaches `checkmate-step.json` —
on passes as well as failures, because with a model-owned assertion the dangerous failure is a
false pass and keeping the evidence on green steps is what makes it detectable.

```jsonc
{
	"schemaVersion": 1,
	"name": "apply promo code",
	"action": "apply the seasonal promo code SPRING25 at checkout",
	"expect": "the order total drops and the discount is itemised",
	"outcome": "failed",
	"category": "app",
	"reason": "failed-expectation",
	"actual": "the order total stayed at $40.00",
	"turns": 7,
	"durationMs": 46900,
	"usage": { "promptTokens": 18320, "cachedPromptTokens": 14208, "completionTokens": 812, "costUsd": 0.006 },
	"toolCalls": [{ "turn": 3, "name": "browser_click_or_hover", "arguments": { "ref": "e17" }, "status": "ok" }],
	"transcript": [{ "turn": 3, "role": "tool", "content": "browser_click_or_hover -> clicked Apply" }],
}
```

Every step ends in a **category** and a **reason**. The category is what a triage agent routes on;
the reason is the specific event:

| Category | Reason                  | What it is evidence of                                                             |
| -------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `app`    | `met-expectation`       | The model observed the app and judged the expectation met.                         |
| `app`    | `failed-expectation`    | The model observed the app and judged the expectation unmet.                       |
| `model`  | `loop-detected`         | The same tool call repeated — the model is stuck, or the UI state is unreachable.  |
| `model`  | `turn-cap-exceeded`     | The model used its configured turns without asserting either way.                  |
| `model`  | `step-timeout`          | The configured wall-clock budget for this step expired.                            |
| `infra`  | `test-budget-exhausted` | The enclosing Playwright test ran out of time before the step's configured budget. |
| `infra`  | `tool-error`            | A tool threw unrecoverably, or the model named a tool that does not exist.         |
| `infra`  | `provider-error`        | The model provider failed after retries, or returned an unusable response.         |
| `infra`  | `budget-exceeded`       | A token or cost budget was crossed.                                                |

Checkmate classifies the layer, not the meaning. An `app` outcome says the evidence points at the
product under test — not whether that is a legitimate UI change or a bug.

### A retry that disagrees with itself is reported

Playwright's `retries` option (`playwright.config.ts:retries`, or `test.describe.configure({ retries })`)
reruns a failed test in a fresh worker and, if the rerun passes, marks it **flaky** rather than failed —
most triage treats a flaky label as noise to rerun past, not evidence to read. With a model-owned
assertion that hides a specific hazard: a genuine regression caught on attempt 1, absorbed by a lucky
attempt 2. Checkmate does not change retry behaviour; it changes what a retried step tells you
afterwards.

Each attempt's `ai.step` calls append their assertions to a small ledger keyed by the test, kept
alongside Playwright's own `test-results/` output and wiped at the start of every run. When a step
passes after an earlier attempt of that same step failed at the `app` layer, its report is marked:

```jsonc
{
	"outcome": "passed",
	"category": "app",
	"reason": "met-expectation",
	"assertionUnstable": true,
}
```

`assertionUnstable` only appears on a pass, and only when a prior attempt's failure was `app` —
a `model` or `infra` failure on an earlier attempt means the loop never reached an assertion at
all, not that it disagreed with itself. This lands in the same `checkmate-step.json` a triage agent
already opens, so nothing about it requires a reporter: the whole install is still `mergeTests` plus
config.

## Configuration Reference

Checkmate is configured in [Playwright's](https://playwright.dev/docs/test-configuration) standard
[config](../playwright.config.ts) as flat `checkmate*` options, set per project and overridable per test.
Only the provider secrets stay in the environment.

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'
import type { CheckmateOptions } from '@xoxoai/checkmate/playwright'

export default defineConfig<CheckmateOptions>({
	use: { checkmateModel: 'gpt-5-mini', checkmateTurnCap: 20 },
	projects: [
		{
			name: 'smoke',
			use: { checkmateModel: 'gpt-5-mini', checkmateTurnCap: 15, checkmateStepTimeout: 60_000 },
		},
		{
			name: 'unstable-areas',
			use: { checkmateModel: 'gpt-5', checkmateTurnCap: 30, checkmateBudgetUsd: 2 },
		},
	],
})
```

```ts
// hard-flows.spec.ts — overrides the model only; the project's limits stay in force
test.use({ checkmateModel: 'gpt-5' })
```

Resolution is Playwright's, per key: package default, then `projects[].use`, then `test.use()`. The keys
are flat rather than one nested object because Playwright resolves options one key at a time and never
deep-merges — a nested option would make the `test.use()` above silently discard `checkmateTurnCap`.

### Provider Secrets

| Variable                   | Default | Description                                                             |
| -------------------------- | ------- | ----------------------------------------------------------------------- |
| `CHECKMATE_OPENAI_API_KEY` | -       | **Required** - Your API key (OpenAI, or any OpenAI-compatible provider) |

Not an option, because a config file is checked in and an API key is not. The base URL for an
OpenAI-compatible provider is `checkmateOpenaiBaseUrl` below — it isn't a secret, so it lives with
the rest of the configuration.

### AI Options

| Option                        | Default             | Description                                                                        |
| ----------------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `checkmateModel`              | `gpt-5-mini`        | Which model runs the step: gpt-5, gemini-2.5-flash, claude-4-5-sonnet, etc.        |
| `checkmateOpenaiBaseUrl`      | unset               | Base URL of the OpenAI-compatible endpoint. Unset uses the provider default        |
| `checkmateReasoningEffort`    | unset               | Provider reasoning effort, when supported: `low`, `medium`, `high`                 |
| `checkmateTemperature`        | `0`                 | Sampling temperature sent with every request                                       |
| `checkmateTurnCap`            | `20`                | Model turns before the step is terminated                                          |
| `checkmateStepTimeout`        | `120_000`           | Wall-clock budget for one step, in milliseconds                                    |
| `checkmateBudgetUsd`          | unset               | USD ceiling per test. Must be positive                                             |
| `checkmateBudgetTokens`       | unset               | Token ceiling per test. Must be a positive integer                                 |
| `checkmateSnapshotFilter`     | `false`             | Whether semantic ARIA snapshot filtering is applied                                |
| `checkmateSnapshotTopPercent` | `10`                | How much of the scored snapshot is kept when filtering, as a percent from 1 to 100 |
| `checkmateEvidence`           | `retain-on-failure` | How much evidence attaches per step: `on`, `retain-on-failure`, `off`              |
| `checkmateRedact`             | `true`              | Whether captured evidence is scrubbed. Turning it off is a local-only escape hatch |
| `checkmateScreenshots`        | `false`             | Include a compressed screenshot of the active page with each snapshot              |
| `checkmateToolChoice`         | `required`          | How the provider is told to pick tools: `auto`, `required`, `none`                 |
| `checkmateAllowedTools`       | `[]`                | Tool names the model may call. Empty means every registered tool                   |
| `checkmateMaxRetries`         | `3`                 | Provider retries with backoff (1s, 10s, 60s) for rate limits and server errors     |
| `checkmateRequestTimeout`     | `60_000`            | Timeout for one provider request, in milliseconds                                  |
| `checkmateLoopMaxRepetitions` | `5`                 | Repeated tool-call patterns tolerated before the step is reported `model` / stuck  |
| `checkmateRateLimitDelay`     | `0`                 | Fixed delay before each provider request, in milliseconds                          |
| `checkmateLogLevel`           | `off`               | Console verbosity: `debug`, `info`, `warn`, `error`, `off`                         |

`checkmateTemperature` defaults to `0` rather than the provider default, so a rerun differs as little
as the model allows — including through loop-detection recovery, which no longer randomises it. Some
models accept only their own default and answer any other value with a 400 — OpenAI's `gpt-5` family
among them. Checkmate detects that response, drops the parameter, and continues on the provider
default for the rest of the run, so setting `checkmateTemperature` against those models has no effect.

Each step stops at `checkmateTurnCap` or `checkmateStepTimeout`. Inside Playwright, the step timeout is
clamped to the test's remaining time minus 10 seconds, preserving time to attach `checkmate-step.json`.
The configured timeout reports `model` / `step-timeout`; a clamp reports `infra` /
`test-budget-exhausted`.

An option value that cannot be used fails the test that set it, with every problem listed at once,
rather than falling back to a default.

## Writing Effective Tests

### Best Practices

1. **Be Specific** - Clear expectations help the AI validate success
2. **One Action Per Step** - Break complex flows into discrete steps
3. **Include Context** - Mention relevant UI elements and expected behavior
4. **Add Timing Hints** - For slow operations, mention expected wait times
5. **Handle Popups and Dialogs** - Explicitly mention consent dialogs, modals, and JavaScript alert/confirm/prompt dialogs. For JavaScript dialogs, say whether to accept, dismiss, or provide prompt text before the triggering action.

### Basic Example

```typescript
import { expect } from '@playwright/test'
import { test } from './fixtures'

test('search for playwright documentation', async ({ page, ai }) => {
	await ai.step({
		name: 'Navigate to Google',
		action: `Open the browser and navigate to google.com`,
		expect: `google.com is loaded and the search bar is visible`,
	})

	await ai.step({
		name: 'Search for Playwright',
		action: `Type 'playwright test automation' in the search bar and press Enter`,
		expect: `Search results contain the playwright.dev link`,
	})

	await expect(page.getByRole('link', { name: /playwright/i }).first()).toBeVisible()
})
```

### Complex Interactions

```typescript
await ai.step({
	name: 'Fill form and submit',
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
```

### Programmatic Composition

Use `@xoxoai/checkmate/core` when you want to build your own runner explicitly:

```typescript
import { createRunner } from '@xoxoai/checkmate/core'
import { web } from '@xoxoai/checkmate/playwright'
import { jira, notion, database } from 'your-own-extension-examples'

const runner = createRunner({
	extensions: [web({ page }), jira(), notion(), database()],
})

const report = await runner.run({
	action: 'Open the pricing page',
	expect: 'Pricing details are visible',
})
```

`@xoxoai/checkmate/core` never imports `@playwright/test`. `runner.run()` resolves a `StepReport`
rather than asserting, so the same loop can be driven from a plain script. Inside a Playwright
test, `ai.step` runs that loop and turns the report into a test result.

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

You can set one or both token budget options to enforce limits during a single test.

- `checkmateBudgetUsd` — a USD budget (e.g. `0.5`) per test. Checkmate checks the current estimated cost (input + output tokens) and terminates the step as `infra` / `budget-exceeded` when it is crossed.
- `checkmateBudgetTokens` — a token limit (e.g. `100_000`). Checkmate tracks input and output tokens across the test and terminates when the total exceeds it.

Notes:

- Both are unset by default, which means no ceiling.
- A non-positive value fails the test that set it rather than being silently treated as disabled.

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
await ai.step({
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

Filtering is controlled by the `checkmateSnapshotFilter` option (default: `false`). Set it to `true` in `playwright.config.ts`, or per file with `test.use({ checkmateSnapshotFilter: true })`. `checkmateSnapshotTopPercent` sets how much of the scored snapshot is kept by default; a step's `search` is an explicit keyword query override, and its `topPercent` overrides the option for that step.

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

- 14 browser tools for navigation and interaction on the active tab/page
- automatic active-tab switching when an action opens a new tab or popup
- tab tools to list, select, and close tabs/popups during OAuth, payment, or "open in new tab" flows
- one-shot JavaScript dialog handling for alert, confirm, and prompt dialogs
- network request visibility for API assertions on the calls an action triggered
- initial page snapshots and optional screenshots
- `checkmate`, `test`, `expect`, `web()`, `createAi(page)`, and `createPlaywrightRunner(page)` exports

```typescript
import { test } from '@xoxoai/checkmate/playwright'

test('search flow', async ({ ai }) => {
	await ai.step({
		action: 'Search for playwright documentation',
		expect: 'Search results are displayed',
	})
})
```

All browser tools operate on the active tab/page. New tabs and popups opened by an action become active automatically. If a flow must return to an earlier page or close an OAuth/payment popup, the agent can use `browser_list_tabs`, `browser_select_tab`, and `browser_close_tab`.

Unarmed JavaScript dialogs are dismissed automatically. If a flow needs OK/Cancel or prompt input, describe it in the step, for example: "accept the Delete confirmation" or "enter 'Alice' in the prompt". The agent will arm the dialog response before clicking the control that opens it.

### Network assertions

`browser_network_requests` lists the fetch/XHR calls the browser made during the last browser action, so an `expect` can assert on backend behavior instead of DOM state alone. The buffer resets at the start of every browser action, so the list always describes the action immediately before it.

```typescript
await ai.step({
	action: `Click "Place Order"`,
	expect: `Order confirmation is displayed and the checkout API call returned a successful status`,
})
```

Output looks like this:

```text
Network requests since the last browser action (call again after the next action; numbers shown here become stale once you do):
1. [POST] https://shop.example.com/api/checkout => [200] OK (231ms)
2. [GET] https://shop.example.com/api/cart => [500] Internal Server Error (87ms)
```

Images, fonts, stylesheets, and other static resources are hidden by default. The agent can pass `static: true` to see them.

To assert on a specific response payload, the agent can follow up with `browser_network_request`, passing the number shown by `browser_network_requests` and the `part` to read (`detail` for headers and timing, `request-body`, or `response-body`):

```typescript
await ai.step({
	action: `Click "Place Order"`,
	expect: `Order confirmation is displayed, the checkout API call returned a successful status,
	and the response body includes an order id.`,
})
```

`browser_network_request` with `part: 'response-body'` for the checkout call returns:

```text
1. [POST] https://shop.example.com/api/checkout response body (application/json):
{"orderId":"ORD-8231","total":129.99,"status":"confirmed"}
```

Numbers only stay valid for the buffer's current contents - they go stale as soon as the next browser action resets it.

## Salesforce Extension

`@xoxoai/checkmate/salesforce` builds on the web extension. It adds Salesforce-specific tools and keeps the same `ai` fixture shape as the Playwright entry point.

What it adds:

- the built-in `salesforce()` extension
- `checkmate`, `test`, `expect`, `createSalesforceAi(page)`, and `createSalesforceRunner(page)` exports
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
	await ai.step({
		name: 'Login to Salesforce',
		action: 'Login to Salesforce org and open Test QA Application',
		expect: 'Test QA homepage is displayed',
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

### Model does not call tools or sends invalid tool arguments

**Symptoms**: A step fails because the model returned text, called an unknown tool, or sent malformed tool arguments.

**Solutions**:

- Set `checkmateLogLevel: 'debug'` to see response summaries, tool calls, available tools, and recent message summaries
- Check the failure output for the step `action` / `expect`, tool name, raw arguments, and provider error details
- Make the step action more direct and mention the expected interaction target
- If you restrict tools with `checkmateAllowedTools` and need JavaScript dialog control, include `browser_set_dialog_response` with the browser action tools.
- If a restricted-tool test needs tab or popup control, include `browser_list_tabs`, `browser_select_tab`, and `browser_close_tab`.
- If a restricted-tool test asserts on backend calls, include `browser_network_requests`, and `browser_network_request` if the test needs to inspect a specific request's headers or body.

### Tests loop during step execution

**Symptoms**: The AI repeats the same actions or gets stuck in a loop, consuming tokens unnecessarily.

**Solutions**:

- `checkmateTemperature` defaults to `0`, so a rerun differs as little as the model allows — lower it further only for a specific reason; models that reject the value fall back to their own default
- Use a reasoning/thinking model (if available) to improve planning and avoid repetitive loops
- Lower `checkmateLoopMaxRepetitions` so a stuck step is reported sooner instead of burning turns

### High token costs

**Symptoms**: Tests consume more tokens than expected, leading to high API costs.

**Solutions**:

- Set a lower reasoning effort: `checkmateReasoningEffort`
- Consider leaving `checkmateScreenshots` off
- Set `checkmateBudgetUsd` per project so a runaway step is stopped rather than paid for
- Use a cheaper model, lower-end models often perform well (e.g., `gemini-2.5-flash-lite` or `gpt-5-nano`)

### Rate limiting errors

**Symptoms**: API calls fail with 429 errors or rate limit messages.

**Solutions**:

- The framework automatically retries with backoff (1s, 10s, 60s)
- Upgrade your API plan with your provider
- Reduce concurrent test execution
- Add a `checkmateRateLimitDelay` when your provider is sensitive to burst traffic
- Increase `checkmateRequestTimeout` if needed

### Timeout errors

**Symptoms**: Tests fail with timeout errors before completing actions.

**Solutions**:

- Increase `checkmateRequestTimeout` in `playwright.config.ts`
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
│   ├── StepEvidence
│   ├── StepDeadline
│   └── ExtensionHost
│
├── ai/
│   ├── AiClient
│   ├── TurnProcessor
│   ├── MessageHandler
│   ├── ToolResponseHandler
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
- Tests written in natural language via the `ai.step()` fixture

**Core Engine**

- **createRunner**: Public composition entry point for building runners from extensions
- **CheckmateRunner**: Runtime instance returned by `createRunner`
- **AiClient**: Stateless provider adapter that sends one request and returns the completion, with retries
- **StepExecution**: Owns one step's message history, loop detector, and evidence, and iterates turns until the step terminates
- **TurnProcessor**: Parses one model turn, dispatches its tool calls, and answers with a `TurnOutcome`
- **StepEvidence**: Accumulates turns, tool calls, transcript, and usage into the `StepReport`
- **ExtensionHost**: Registers tools, instructions, step context builders, and post-tool hooks from extensions
- **Tool Registry**: Owns Zod-defined tool declarations and explicit tool resolution

**Tools**

- **Core Tools**: Step control (pass/fail step assertions)
- **Web Extension**: Playwright-powered browser tools, active tab/popup tracking, snapshots, and screenshots
- **Salesforce Extension**: SF CLI login flow layered on top of the web extension

**Cost Optimization**

- Token tracking with budget enforcement
- History filtering (removes old snapshots)
- Snapshot minification and screenshot compression
- Loop detection and mitigation

**Configuration**

- Test, reporting, browser, and `checkmate*` settings: [playwright.config.ts](../playwright.config.ts)
- Provider secrets only: `.env` file

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
