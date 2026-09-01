# Roadmap

## Current State (0.5.0):

- ✅ `ai.step({ action, expect })` is the only way to run a step. It always creates its own
  `test.step`, always attaches `checkmate-step.json`, and always ends in a stated `category` and
  `reason` — including when it terminates early on a turn cap, step timeout, or loop detection.
- ✅ `@xoxoai/checkmate/core` never imports `@playwright/test`. `createRunner().run(step)`
  resolves a `StepReport` and is drivable from a plain script.
- ✅ Configuration is flat `checkmate*` option fixtures in `playwright.config.ts`, resolved per
  project and overridable per test.
- ✅ Every step is bounded: a turn cap and a self-clamping step timer terminate before Playwright's
  own test timeout can, so evidence still attaches even when a step doesn't converge.
- ✅ Tiered evidence (`checkmateEvidence`), capture-time secret redaction, per-step attachment
  names, and a readable step tree — one `ai:` row per step with its turns collapsed underneath.
- ✅ A retry that disagrees with itself is reported: a step that failed `app` on one attempt and
  passed on the next is marked `assertionUnstable`, with no reporter required.
- ✅ `npx checkmate init` writes the `mergeTests` fixtures file and an agent instruction file, and
  prints the `playwright.config.ts` block to paste. `create-examples` remains for greenfield use.
- ✅ A cost comparison against an MCP-driven agent, and separately against a general-purpose
  coding agent — see `docs/BENCHMARK.md`.
- ✅ Extension-composed runtime via `createRunner({ extensions })`
- ✅ Clear top-level module boundaries: `runtime`, `ai`, `tools`, `integrations`, `config`, `logging`
- ✅ Explicit tool registration and dispatch
- ✅ Browser snapshot filtering with semantic scoring
- ✅ Token tracking, retry handling, loop detection, and screenshot support
- ✅ Salesforce login integration through the SF CLI
- ✅ Published subpath entry points for `@xoxoai/checkmate/core`, `@xoxoai/checkmate/playwright`, and `@xoxoai/checkmate/salesforce`

## Near Term

Focus: Stability, extension points, and better contributor ergonomics.

- ✅ Custom tool registration API for external integrations
- ✅ Better public examples for programmatic runner usage
- ✅ Publishable npm package layout with dedicated `core`, `playwright`, and `salesforce` entry points
- ✅ Visual interactions (click, drag, etc.) in the Playwright extension
- [ ] Snapshot filtering tuning hooks beyond top-percent selection
- [ ] Better reporting around filtered snapshot size and selected branches

## Mid Term

Focus: Product usability and broader workflow support.

- [ ] UI layer for recording, editing, and replaying AI-driven steps
- [ ] Flow-level execution mode for multi-step business journeys
- ✅ Richer debugging output for model/tool reasoning failures
- [ ] Better parallel execution support across large suites
- [ ] A Playwright reporter for run-level auditing, e.g. sweeping for passes that did no
      meaningful tool work — not required for anything shipped today, since `assertionUnstable`
      and the per-step evidence already work without one

## Long Term

Focus: Production hardening and ecosystem.

- [ ] Stronger observability and explainable AI
- [ ] Test generation from specs and recorded user behavior
- [ ] Advanced reporting with AI-assisted failure summaries
- [ ] Enterprise-focused environment and secret management support

## Ongoing Research

- 🔄 Faster local retrieval/filtering for very large page snapshots
- 🔄 Hybrid semantic plus structural ranking for element selection
- 🔄 Multi-agent execution models for planning and validation
- 🔄 Confidence signals for tool selection and assertions
