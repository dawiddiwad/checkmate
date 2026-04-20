# Architecture

## Top-Level Layout

- `src/core.ts`: published core entry point for `createRunner`, extensions, and tool contracts
- `src/cli.ts`: published CLI entry point for scaffolding example projects
- `src/playwright.ts`: published Playwright entry point for `test`, `expect`, `web()`, and `createPlaywrightRunner`
- `src/salesforce.ts`: published Salesforce entry point for `test`, `expect`, `salesforce()`, and `createSalesforceRunner`
- `src/runtime/`: public execution flow and step lifecycle
- `src/ai/`: model client, response processing, history, rate limiting, token tracking
- `src/tools/`: tool contracts, registry, dispatcher, browser tools, step tools, salesforce tools
- `src/integrations/`: external system adapters
- `src/config/`: runtime configuration
- `src/logging/`: shared logging
- `docs/`: user and contributor documentation

## Rules

- `runtime` orchestrates.
- `runtime` owns extension composition.
- `ai` talks to the model.
- `tools` execute actions.
- `integrations` wrap external systems.
- Shared infrastructure must not depend on orchestration modules.

## Tool Model

Tools are single-function contracts:

- one definition
- one Zod schema
- one `execute` function

Entry point:

- `src/tools/define-agent-tool.ts`
- exported publicly as `defineTool` from `src/core.ts`

## Extension Model

Extensions can contribute:

- tools
- system instructions
- initial step context messages
- post-tool hooks
- capabilities for other extensions
- teardown hooks

Core runner logic must stay agnostic to browser and Salesforce-specific behavior.

## Snapshot Filtering

Snapshot filtering lives under:

- `src/tools/browser/snapshot-filter/`

Current behavior:

- query comes from `search` if provided, otherwise `action + expect`
- selection is based on `topPercent`
- hard score threshold is internal fallback only

## Public API

- `createRunner`
- `CheckmateRunner`
- `defineExtension`
- `defineTool`
- `@xoxoai/checkmate/core`
- `@xoxoai/checkmate/playwright` fixture export
- `@xoxoai/checkmate/playwright` `web()` and `createPlaywrightRunner`
- `@xoxoai/checkmate/salesforce` `test`, `expect`, `salesforce()`, and `createSalesforceRunner`
- `Step`
- `StepResult`
