# Roadmap

## Current State:

- ✅ Provider-neutral runtime entry point via `CheckmateRunner`
- ✅ Clear top-level module boundaries: `runtime`, `ai`, `tools`, `integrations`, `config`, `logging`
- ✅ Explicit tool registration and dispatch
- ✅ Browser snapshot filtering with semantic scoring
- ✅ Token tracking, retry handling, loop detection, and screenshot support
- ✅ Salesforce login integration through the SF CLI

## Near Term

Focus: Stability, extension points, and better contributor ergonomics.

- ✅ Custom tool registration API for external integrations
- ✅ Better public examples for programmatic runner usage
- [ ] Move from mono-repo to NPM package structure
- [ ] More focused unit tests around runtime/session boundaries
- [ ] Snapshot filtering tuning hooks beyond top-percent selection
- [ ] Better reporting around filtered snapshot size and selected branches

## Mid Term

Focus: Product usability and broader workflow support.

- [ ] UI layer for recording, editing, and replaying AI-driven steps
- [ ] Flow-level execution mode for multi-step business journeys
- [ ] API testing tools that can participate in the same runtime/tool loop
- [ ] Richer debugging output for model/tool reasoning failures
- [ ] Better parallel execution support across large suites

## Long Term

Focus: Production hardening and ecosystem.

- [ ] Stronger determinism controls for sensitive suites
- [ ] Test generation from specs and recorded user behavior
- [ ] Advanced reporting with AI-assisted failure summaries
- [ ] Enterprise-focused environment and secret management support

## Ongoing Research

- 🔄 Faster local retrieval/filtering for very large page snapshots
- 🔄 Hybrid semantic plus structural ranking for element selection
- 🔄 Multi-agent execution models for planning and validation
- 🔄 Confidence signals for tool selection and assertions
