# Architecture

## Public Surface

- `src/index.ts` exports `run`, `validate`, `describe`, `CheckmateOperationalError`, and versioned contract types.
- `src/driver.ts` exports provider-neutral driver contracts and `defineDriverTool`.
- `src/drivers/web/index.ts` exports the built-in web driver. Only this driver loads Playwright.
- `bin/checkmate.js` invokes `src/cli/main.ts` after compilation.
- Six hand-authored schemas in `src/contracts/schemas` are copied to package-root `schemas`; the web descriptor is copied beside its compiled driver.

The export map permits only the root, `./driver`, `./driver-web`, its static descriptor, and `./schemas/*`. Root and driver-contract imports remain browser-free until selected-driver execution. There are no Playwright Test fixtures, Salesforce entry points, extension adapters, or scaffolding commands.

## Runtime Ownership

`src/api/prepare-run.ts` validates the operator manifest, request, policy, static descriptor, and secret availability. It neither imports executable driver code nor allocates a run. Static `validate` and `describe` return versioned envelopes.

`src/api/allocate-run-identity.ts` allocates one invocation directory. `src/api/execute-prepared-run.ts` imports only the selected trusted driver and owns scenario execution and terminal finalization. The CLI parent performs preparation and allocation once, then sends the prepared input to a managed worker. The in-process API executes the same workflow without hard process containment.

The CLI worker never repeats preparation or identity allocation. The parent alone writes public stdout, discards raw worker streams, and accepts only validated terminal bytes before its monotonic cutoff. Parent-authored containment does not fabricate execution steps or claim committed evidence. The in-process API returns expected invalid input as data but rejects operational preparation/allocation failures; it does not return CLI-parent containment envelopes.

- `src/runtime/` owns scenario sequencing, deadline controls, bounded driver awaits, internal step reports, and raw token usage.
- `src/ai/` owns provider requests, turn processing, message history, and request retry behavior.
- `src/tools/` owns the private registry, dispatcher, and assertion-bearing result tools.
- `src/drivers/web/` owns browser lifecycle, fourteen browser tools, snapshots, screenshots, and network/transient-state recording.
- `src/config/` owns the sole manifest configuration boundary, package resolution, policy tightening, and invocation-local secret readers.
- `src/evidence/` owns buffering, retention, atomic commitment, and terminal result persistence.
- `src/logging/` and `src/redaction/` provide invocation-local level filtering, sanitized diagnostics, bounded optional log transcripts, and policy-controlled content redaction.

## Driver Contract

One trusted driver session serves all ordered steps in a scenario. Its tools must match its static descriptor exactly and obey the selected policy allowlist. Drivers contribute instructions, initial and post-tool context, evidence, and cleanup. They cannot contribute harness assertions through the public tool contract.

Execution stops at the first failure and reports every declared step. Cleanup failures can change the top-level route without rewriting completed steps. No whole-scenario retry, target rollback, resume, cost estimate, or suite scheduling is provided.

## Snapshot Filtering

`src/drivers/web/tools/snapshot-filter/` filters the browser snapshot. Each public step contains only its ID, action, and expectation; requests do not configure search or filtering. The manifest policy owns `snapshotFilter` and `snapshotTopPercent`. The web driver derives its query from action and expectation. Browser service tests live in `src/test/drivers/web/`.

## Configuration And Evidence

`checkmate.config.json` is the sole non-secret configuration source. An explicit config path does not change the invocation root. Policies own model selection, egress controls, driver settings, tools, bounds, and evidence behavior; requests can select a policy and tighten scenario timeout or token budget. There are no implicit model defaults or USD budgets.

Model-egress redaction and evidence redaction are separate policies. Evidence redaction transforms content-bearing fields, not structural metadata. With evidence redaction off, finalized content may remain raw in durable results, API returns, and byte-identical CLI stdout. Diagnostic sanitization remains mandatory. Driver settings may select diagnostic verbosity and request a bounded scenario-level log transcript only when the descriptor declares that evidence kind; evidence retention and redaction remain policy-owned. The terminal finalizer alone commits the final result; checkpoints are partial and never terminal or resumable.

## Trust Boundary

Drivers and providers are trusted host-identity code, not sandboxed plugins. CLI lifetime containment and stdout isolation do not provide hostile-code isolation. In-process cancellation bounds awaited asynchronous work but cannot interrupt synchronous blocking code. Evidence references are published only after durable commitment beneath the invocation-owned POSIX output tree.
