# Roadmap

## Current State:

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
- [ ] Visual interactions (click, drag, etc.) in the Playwright extension
- [ ] Snapshot filtering tuning hooks beyond top-percent selection
- [ ] Better reporting around filtered snapshot size and selected branches

## Mid Term

Focus: Product usability and broader workflow support.

- [ ] UI layer for recording, editing, and replaying AI-driven steps
- [ ] Flow-level execution mode for multi-step business journeys
- [ ] Richer debugging output for model/tool reasoning failures
- [ ] Better parallel execution support across large suites

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
