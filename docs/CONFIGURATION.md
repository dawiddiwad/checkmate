# Configuration Reference

`checkmate.config.json` is the sole operator-controlled configuration source. It separates approved package registration and logical secret bindings from policy-owned execution behavior.

## Lookup

- Default: `$PWD/checkmate.config.json`
- Explicit: `--config <path>`, resolved from `$PWD`
- Invocation root: always `$PWD`, even when the config file is elsewhere
- No ancestor search, package metadata fallback, TypeScript config, or low-level environment override layer

Relative output paths and driver package resolution remain anchored to the invocation root.

## Manifest Sections

| Field             | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `schemaVersion`   | Must be `1`                                                    |
| `outputDirectory` | Relative run root; defaults to `.checkmate/runs`               |
| `defaultPolicy`   | Policy selected when a request omits `scenario.policy`         |
| `secretBindings`  | Logical names mapped to environment variable names             |
| `policies`        | Model egress, bounds, evidence, and enabled-driver settings    |
| `drivers`         | Stable driver IDs mapped to approved packages and secret slots |

Unknown fields are rejected. Validation does not coerce, strip, default inside input documents, or clamp values.

## Model Egress

Each policy owns:

| Field                      | Meaning                                                 |
| -------------------------- | ------------------------------------------------------- |
| `provider.id`              | `openai` in v1                                          |
| `provider.model`           | Provider model identifier                               |
| `provider.baseUrl`         | Optional OpenAI-compatible endpoint                     |
| `provider.apiKeyBinding`   | Logical binding, never a secret value                   |
| `provider.temperature`     | Optional non-negative number                            |
| `provider.reasoningEffort` | Optional `low`, `medium`, or `high`                     |
| `textRedaction`            | `on` or `off` for provider-bound text                   |
| `allowOpaque`              | Whether provider-bound opaque/image context is allowed  |
| `maxStepBytes`             | Maximum complete provider request bytes for a step      |
| `maxMessageBytes`          | Maximum serialized bytes for one provider-bound message |

The complete-request limit covers messages, tools, and JSON framing, not HTTP headers. Requests cannot override any model-egress field.

## Bounds

| Field                |           Valid value | Scope                                                |
| -------------------- | --------------------: | ---------------------------------------------------- |
| `scenarioTimeoutMs`  |          Integer >= 1 | Entire worker scenario, including import and startup |
| `stepTimeoutMs`      |          Integer >= 1 | One model/tool step                                  |
| `turnsPerStep`       |          Integer >= 1 | Model turns per step                                 |
| `requestTimeoutMs`   |          Integer >= 1 | One provider request                                 |
| `maxRetries`         |          Integer >= 0 | Provider-level retries                               |
| `loopMaxRepetitions` |          Integer >= 1 | Repeated tool-call pattern bound                     |
| `cleanupTimeoutMs`   |          Integer >= 1 | Shared runner/session cleanup deadline               |
| `budgetTokens`       | Optional integer >= 1 | Cumulative scenario token ceiling                    |

A request may only tighten `scenarioTimeoutMs` through `limits.timeoutMs`, and may tighten or introduce `limits.budgetTokens`. Attempts to raise a policy ceiling are invalid. V1 has no USD budget, cost calculation, or pricing table.

## Evidence Policy

- `retention`: `on`, `retain-on-failure`, or `off`
- `redaction`: `on` or `off`
- `allowOpaque`: explicit permission for binary evidence that cannot be text-redacted

Requests cannot weaken these settings.

## Driver Policy

The root `drivers` entry approves a package and maps its descriptor-declared secret slots to logical bindings. `policies.<id>.drivers.<driverId>` enables that registered driver, supplies settings validated against its static descriptor, and provides `tools.allowed`.

`["*"]` exposes every descriptor-declared tool. An explicit list exposes only those names. Unknown names, undeclared secret slots, missing slot bindings, unknown drivers, and drivers not enabled by the selected policy are invalid before executable import.

The built-in web driver accepts `logLevel` (`debug`, `info`, `warn`, `error`, or `off`) and `logsAsEvidence` in its policy-owned settings. Both default to disabled behavior: `logLevel: "off"` and `logsAsEvidence: false`. For example:

```json
{
	"settings": {
		"headless": true,
		"logLevel": "debug",
		"logsAsEvidence": true
	}
}
```

Enabled logs are sanitized and written by the CLI to stderr. When evidence logging is enabled, the same selected messages are also subject to the policy's evidence retention and redaction settings.

## Secret Handling

Preflight reads a binding only long enough to verify that its environment value is a non-empty string. It does not return, retain, serialize, log, persist, derive from, or send that value over IPC. The worker resolves values independently for execution. Secret values never enter the prepared plan, request, result, checkpoint, evidence reference, or `describe` output.

JavaScript heap erasure is not guaranteed. Registered executable code remains trusted and can access the host environment outside Checkmate's reader.

## Fixed Ingestion Limits

Checkmate applies fixed parent-side limits before expensive validation, executable import, identity allocation, secret resolution, or worker creation:

- 256 KiB each for request, manifest, and descriptor documents
- Parsed depth 64 and 10,000 aggregate values
- 100 scenario steps
- 128 characters for IDs, 256 for scenario names
- 16 KiB UTF-8 each for action and expectation text
- 100 diagnostics and 64 KiB of serialized diagnostics
- 1 MiB serialized worker start frame
