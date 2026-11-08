# Contracts and configuration

The JSON Schemas in `plugin/contracts/` are authoritative. The package exports matching TypeScript types. Use `contractVersion: "toolkit-1"`.

## Files

The caller selects file paths in each request. A typical workspace contains:

```text
.checkmate/profile.json
.checkmate/plans/checkout/v1.json
.checkmate/plans/checkout/v1.md
.checkmate/requests/execute.json
.checkmate/runs/run-1/invocation.json
.checkmate/runs/run-1/evidence/
.checkmate/runs/run-1/result.json
.checkmate/runs/run-1/report.md
.checkmate/runs/run-1/report.html
```

The launcher uses `.checkmate/candidates/` for temporary candidates. The run registry uses `.checkmate/run-ids/` to prevent duplicate run IDs across output directories. Ignore run data, candidates, and browser authentication state in Git. Plans can be committed. Do not put credentials in these files.

References contain a relative `path` and the SHA-256 digest of the exact saved bytes. A changed byte requires a new reference. A digest detects change. It does not authenticate the caller.

## Target profile

A profile records target identity, revision, URL, capabilities, actual tool versions, credential references, permitted operations, startup ownership, and cleanup guidance.

Use one tooling entry per capability. The `browser` capability uses Playwright CLI. The `http` capability can use Node.js fetch.

`authentication.references` contains environment variable names or browser-state references. It never contains credential values. The host resolves them at runtime.

The caller normally owns application startup. A configured startup command is guidance for an authorized host. The deterministic scripts do not start it.

## Plans and decisions

Each requirement has an ID, text, and source. Each test maps to requirements and specifies a capability, permitted operations, prerequisites, action, expected result, and oracle kind.

Use `deterministic` for a direct assertion. Use `agent_observation` when an agent interprets the evidence. Record that distinction in the result.

A gap can be blocking or non-blocking. An unknown expected result is blocking. A gap with empty requirement and test lists affects the whole plan. Otherwise a gap affects the tests it names and every test of the requirements it names.

`save-plan` sets each test's readiness from the gaps that affect it. A deferred gap makes the test `deferred`. An open blocking gap makes it `blocked`. Otherwise the test is `ready`. A readiness value in the candidate is replaced. `save-plan` also calculates the plan coverage.

The caller can clarify, accept an assumption, or defer coverage. Each decision needs an actor and rationale. Clarification needs a source. An accepted assumption remains visible in the plan.

Revision preserves the requirement inventory and its provenance. It changes only affected test details and gap dispositions. Use a new plan for a different scope. An immutable write refuses a path collision. A revise request must reference the latest saved revision.

## Execution

Selection is explicit and non-empty. The default `partialExecution` is `wait_for_resolution`. Any open blocking gap prevents execution.

`ready_only` permits an explicit selection of ready tests. It does not make a blocked test ready. Include prerequisite tests in the same selection. Prior results do not satisfy prerequisites automatically.

Every result lists every planned test once. An observation must list each selected test. The finalizer adds each omitted unselected test as `not_run`. Omitted and deferred tests remain visible. Coverage is relative to the full declared requirement inventory.

Use `onNewBlocker: return_to_caller` to stop after a new blocker. Use `continue_independent` to permit unrelated tests. These action-order rules depend on the host workflow; the finalizer cannot observe arbitrary external tool calls.

A retest uses a new run ID and build identity. It references the prior result with `retestOf`. A narrow retest retains uncovered requirements.
