# Driver Authoring

A driver gives the harness a model-visible interaction surface while Checkmate retains scenario sequencing, limits, verdict tools, result categories, evidence policy, and stdout behavior.

## Registration And Static Discovery

An installed driver package exports both its executable module and `./checkmate-driver.json`. The manifest maps a trusted stable ID to the package. `describe` and `validate` resolve only the descriptor export as data; executable code is imported only after a validated `run` allocates identity and latches `targetMutation` to `possibly-mutated`.

The descriptor declares:

- `id` and `driverContractVersion: 1`
- Strict JSON Schemas for request-owned target and policy-owned settings
- Required local secret slot names
- The exact runtime tool-name set
- Permitted evidence kinds, media types, and text/opaque classification

At startup, the executable ID and contract version must match the descriptor. Runtime tools must have exact set equality with descriptor tools and may not be duplicated or collide with the harness-owned `pass_test_step` and `fail_test_step` tools.

## Executable Contract

```typescript
import type { CheckmateDriverV1 } from '@xoxoai/checkmate/driver'

export const checkmateDriver: CheckmateDriverV1 = {
	id: 'database',
	driverContractVersion: 1,
	async start(input) {
		const connection = await connect(input.secrets.read('connection'))
		return {
			tools: databaseTools(connection),
			instructions: ['Use read-only queries to inspect application state.'],
			buildInitialContext: async ({ signal }) => currentSchema(connection, signal),
			handleToolResponses: async ({ signal }) => currentSchema(connection, signal),
			close: async () => connection.close(),
		}
	},
}
```

`DriverStartInput` supplies validated `target` and `settings`, a slot-limited secret reader, a descriptor-limited evidence sink, an invocation logger, and an abort signal. The session supplies tools, instructions, initial context, post-tool context, and one idempotent close operation.

## Tools

Use `defineDriverTool()` for Zod-backed tool arguments. Tool wire names remain local names such as `database_query`; they are not prefixed with the driver ID because one scenario has one driver session.

A returned `{ status: 'error', response }` is a recoverable target observation. It is sent to the model and the step continues. A thrown or rejected tool operation means the driver boundary is unsafe and terminates the step as `infra / tool-error`. Drivers cannot return assertions; only harness-owned result tools decide whether an expectation passed or failed.

## Context

Driver context is provider-neutral text or image data. `ephemeral: true` marks current target state that should replace prior ephemeral state after actions. Explicit summaries may be durable. Checkmate applies policy-owned model-egress redaction, opaque-content permission, and byte limits before provider adaptation.

Every awaited executable boundary is wrapped by a harness-owned absolute deadline:

- Driver module import and `start`: remaining scenario deadline
- Initial context, tools, and post-tool context: current step deadline
- Runner teardown and session close: one shared cleanup deadline

Abort signals are cooperative. The CLI parent terminates a worker that does not settle within its containment bound.

## Secrets, Logs, And Evidence

Drivers read only descriptor-declared secret slots. Logger messages are exact-secret and pattern sanitized before leaving the worker. Direct writes to stdout or stderr are discarded.

Drivers submit evidence by declared kind and media type, never by path. The sink validates attribution and lifecycle, enforces 10 MiB candidate and 64 MiB per-invocation accepted-buffer limits, applies redaction and retention, writes atomically, and publishes a reference only after durability confirmation.

## Built-In Web Driver

`@xoxoai/checkmate/driver-web` owns Playwright browser, context, pages, snapshots, screenshots, tab/popup state, dialogs, transient DOM state, network recording, and fourteen browser tools. It accepts target `{ "baseUrl": "https://..." }` and these optional policy settings:

- `headless`
- `logLevel`: `debug`, `info`, `warn`, `error`, or `off` (default)
- `logsAsEvidence`: persist selected logs as `web-driver-log` evidence (default `false`)
- `snapshotFilter`
- `snapshotTopPercent` in `(0, 100]`
- `screenshotsInModelContext`

The selected `logLevel` applies to web-driver, model/tool-loop, retry, and OpenAI SDK logs. The CLI writes enabled logs to stderr as sanitized `worker.log.<level>` diagnostics. With `logsAsEvidence: true`, the same enabled, sanitized messages are collected into one scenario-level `text/plain` artifact. Evidence retention and redaction policy still apply; no empty artifact is created when no messages are emitted.

Importing the root contract or driver-authoring entry does not load Playwright. Only selecting and executing the web driver imports the browser runtime.
