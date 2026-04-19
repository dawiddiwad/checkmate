# Architecture

## Top-Level Layout

- `src/runtime/`: public execution flow and step lifecycle
- `src/playwright.ts`: published Playwright fixture wrapper for `test` and `expect`
- `src/salesforce.ts`: published Salesforce Playwright fixture wrapper
- `src/modules/`: built-in browser and Salesforce extensions plus profiles
- `src/ai/`: model client, response processing, history, rate limiting, token tracking
- `src/tools/`: tool contracts, registry, dispatcher, browser tools, step tools, salesforce tools
- `src/integrations/`: external system adapters
- `src/config/`: runtime configuration
- `src/logging/`: shared logging
- `docs/`: user and contributor documentation

## Rules

- `runtime` orchestrates.
- `ai` talks to the model.
- `tools` execute actions.
- `integrations` wrap external systems.
- Shared infrastructure must not depend on orchestration extensions.

## Tool Model

Tools are single-function contracts:

- one definition
- one Zod schema
- one `execute` function

Entry point:

- `src/tools/define-agent-tool.ts`

## Snapshot Filtering

Snapshot filtering lives under:

- `src/tools/browser/snapshot-filter/`

Current behavior:

- query comes from `search` if provided, otherwise `action + expect`
- selection is based on `topPercent`
- hard score threshold is internal fallback only

## Public API

- `CheckmateRunner`
- `@alepoco/checkmate/playwright` fixture export
- `@alepoco/checkmate/salesforce` fixture export
- `extensions`
- `profiles`
- `Step`
- `StepResult`
