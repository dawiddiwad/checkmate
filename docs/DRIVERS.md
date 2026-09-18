# Driver Authoring

A driver gives the harness a model-visible interaction surface while Checkmate retains scenario sequencing, limits, verdict tools, result categories, evidence policy, and stdout behavior.

## Registration And Static Discovery

An installed driver package exports both its executable module and `./checkmate-driver.json`. The manifest maps a trusted stable ID to the package. `describe` and `validate` resolve only the descriptor export as data; executable code is imported only after a validated `run` allocates identity and latches `targetMutation` to `possibly-mutated`.

The descriptor declares:

- `id` and `driverContractVersion: 1` (the only supported driver contract)
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

## Structured Generation

Export a `CheckmateDriverV1` with `driverContractVersion: 1`, return a `DriverSession`, and define its tools with `defineDriverTool`. Structured generation is part of this single contract; no separate driver version or helper is needed. The static descriptor must also select version 1. Descriptor and result envelopes use the separate `schemaVersion: 1` boundary and the same six schema paths. Other driver contract versions are rejected.

Startup also receives frozen `allowlistedTools`, expanded from the validated policy in descriptor order for `*`, and `diagnostics.sanitizeText(value)`, bound to the invocation's exact-secret and credential-pattern sanitizer. No secret values are passed through this capability. Return every descriptor-declared tool even if disallowed: the harness checks parity before filtering and dispatch remains policy-owned.

Tool handlers receive `context.generateStructured({ messages, schemaName, schema })`. Messages have role `system`, `user`, or `assistant` and an array of `{ type: 'text', text }` parts. User messages may also carry `{ type: 'image', mediaType, data }` parts with base64 image data when opaque model egress is allowed. Images in other roles and other message/block forms are rejected explicitly. `schemaName` is 1-64 letters, digits, underscores, or hyphens. `schema` is a strict, locally compilable JSON Schema object (2020-12); unresolved external references are rejected without fetching them.

The promise returns `{ value, usage? }` with schema-validated data and, only when reported, raw `inputTokens`, `outputTokens`, `totalTokens`, and optional `cachedInputTokens`. Checkmate already records this usage; drivers must not record it again. The capability accepts no model, endpoint, credentials, temperature, stop, or tool overrides. It is unavailable during startup and context hooks.

The capability belongs to one active tool operation. Await each request sequentially; concurrent calls or returning with generation pending fail the step. After the tool ends, retained callbacks reject without contacting the provider. Cancellation aborts outstanding transport and retry backoff; late settlements cannot alter finalized usage. Provider, usage, egress, refusal, malformed JSON, and schema failures are fatal `provider-error`; crossing the shared budget is `token-budget-exceeded`. An expired step/scenario or interruption takes precedence. These failures remain fatal even if driver code catches them or returns a recoverable error. There is no free-text fallback or model repair loop for structured output.

Nested prompts are not automatically added to the harness transcript or evidence. Explicit driver tool results use the existing transcript and evidence policy paths.

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

`@xoxoai/checkmate/driver-web` uses pinned Stagehand 4.1.0 with one locally owned browser per ordered scenario and driver contract 1. It exposes exactly five tools:

| Tool                  | Arguments            | Result                                                                           |
| --------------------- | -------------------- | -------------------------------------------------------------------------------- |
| `browser_navigate`    | `{ url }`            | Deterministic navigation of the managed active page; no inference                |
| `browser_observe`     | `{ instruction? }`   | Serializable Stagehand action candidates, including selectors; no mutation       |
| `browser_act`         | `{ instruction }`    | Explicit Stagehand action data; unsuccessful actions are recoverable tool errors |
| `browser_extract`     | `{ instruction }`    | Text-only `{ extraction: string }`; no custom schema or screenshot               |
| `browser_diagnostics` | `{ after?, limit? }` | Bounded snapshot of diagnostics received so far; no inference or flush           |

Only optional `headless` (default `true`) remains in policy settings. The target remains `{ "baseUrl": "https://..." }`. Old tool aliases and snapshot/screenshot settings are rejected. There are no compatibility promises for old tab, dialog, upload, network, or ARIA-reference tools. Migrate interaction instructions to observation/action followed by explicit extraction.

Arguments are locally strict: unknown keys, blank instructions, caller-supplied schemas, and action replay objects are rejected. Observation can omit its instruction. Observation and diagnostics use provider tool `strict: false` to preserve optional arguments; their local validators remain strict. Actions accept only an instruction, never returned selectors or model overrides. Self-healing is disabled at SDK initialization (Stagehand 4.1.0 does not accept that option per action). A normal `success: false` result remains model-visible and permits recovery; latched gateway failures remain fatal even if the SDK returns an unsuccessful action. SDK metadata usage is never counted again.

Install Node `>=22.18.0` and provision an extension-compatible Chrome/Chromium executable separately. Stagehand discovers `CHROME_PATH`, then platform installations/PATH. This is an SDK browser prerequisite, not a Checkmate model/config override. Missing or incompatible browsers fail driver startup. There is no browser downloader, `checkmate:install`, attached-CDP mode, or Browserbase credential requirement. The local launcher is trusted host-identity code and inherits the host environment; provider secrets are not isolated from child processes.

Stagehand receives only the scoped generation callback, never provider credentials or a model override. Observation, action, extraction, and its separate metadata generation use the policy-selected strict structured-output provider and share the outer loop's usage, deadlines, and token ceiling. Session operations are serialized; callbacks outside their operation reject. Ordered steps share browser state but have separate usage deltas and transcripts. Importing the root or driver-authoring entry, `describe`, and `validate` never loads Stagehand; only selected-driver execution imports it.

There is no automatic page context or driver evidence. Observe when the next action is unclear; act directly only when it is unambiguous. Extract the facts needed for an expectation before issuing a harness verdict. Neither navigation nor action success alone verifies an expectation. Explicit tool results can be retained in harness transcripts. This instruction is model guidance, not a mechanical proof of adequate verification. Harness-owned `pass_test_step` and `fail_test_step` remain outside the driver descriptor.

### Local Diagnostics

The driver starts an authenticated `127.0.0.1` receiver on an ephemeral port before Stagehand, configures the SDK exporter to use it, and keeps logging off and caching disabled. It never uses Stagehand's external default destination or forwards traces. Receiver failure ends the session rather than changing destinations. Authentication limits accidental cross-session injection, not hostile code running with the same host identity.

`*` or explicit permission for `browser_diagnostics` enables normalized, sanitized in-memory collection. Without that permission, the receiver drains bounded requests without parsing or retaining trace events; direct diagnostic reads reject. Both modes still involve Stagehand's internal trace buffers and transient local request bytes. This is local discard, not telemetry generation opt-out.

To allow all browser operations without diagnostic retention, set `tools.allowed` to `["browser_navigate", "browser_observe", "browser_act", "browser_extract"]` in the web policy entry. `*` resolves to the five current tools and enables diagnostic buffering.

Received events are sanitized before retention even when model and evidence redaction are off. The receiver accepts only authenticated OTLP JSON, with no compression or permissive CORS, at most 256 KiB per request, a two-second request deadline, and eight concurrent requests. It retains at most 256 events/256 KiB. Reads default to 20 events, accept at most 50, and return at most 16 KiB, with `nextCursor`, `truncated`, `evicted`, and `partial: true`.

Use the session-local cursor as `after` for the next read. Delivery is asynchronous, lossy, and has no operation flush barrier. These are selected trace summaries, not a complete console/network log. An empty result does not prove no errors occurred. A read in step B may contain delayed events from step A; transcript attribution identifies the inspection call, not the originating step.

Only inspected results enter the ordinary transcript; there are no raw trace files or standalone diagnostic evidence. Close revokes generation, closes Stagehand then its owned browser, closes receiver sockets, and erases retained events. Cancellation forces browser/receiver closure even if SDK shutdown stalls; late acquisitions are disposed. In-process cancellation remains cooperative, while the CLI retains hard worker containment.
