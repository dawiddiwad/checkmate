# Checkmate

Checkmate is a CLI-first quality harness for orchestration agents. It accepts one versioned JSON scenario, runs bounded model-driven steps through an approved driver, and emits one versioned JSON result that another program can route without parsing human output.

- One stateful driver session per scenario
- Ordered natural-language actions and expectations
- First-failure stopping with every declared step reported
- Stable application, model, infrastructure, and invalid-invocation routes
- Policy-owned model egress, limits, tools, evidence, and redaction
- Exactly one final JSON document on stdout

Checkmate v1 supports Linux and macOS. Windows process, signal, file-mode, and durability semantics are not part of the v1 contract.

## Install

```bash
npm install @xoxoai/checkmate
npx playwright install chromium
```

The Chromium install is required only when the built-in `web` driver is selected.

## Configure The Environment

Create `checkmate.config.json` in the directory from which the agent will invoke Checkmate. The manifest is the sole non-secret configuration source. It registers trusted driver packages, logical secret bindings, named policies, model egress, bounds, tool allowlists, and evidence behavior.

```json
{
	"schemaVersion": 1,
	"outputDirectory": ".checkmate/runs",
	"defaultPolicy": "ci",
	"secretBindings": {
		"openai-api-key": {
			"source": "environment",
			"name": "CHECKMATE_OPENAI_API_KEY"
		}
	},
	"policies": {
		"ci": {
			"modelEgress": {
				"provider": {
					"id": "openai",
					"model": "gpt-5-mini",
					"apiKeyBinding": "openai-api-key",
					"temperature": 0
				},
				"textRedaction": "on",
				"allowOpaque": false,
				"maxStepBytes": 1048576,
				"maxMessageBytes": 262144
			},
			"bounds": {
				"scenarioTimeoutMs": 180000,
				"stepTimeoutMs": 120000,
				"turnsPerStep": 20,
				"requestTimeoutMs": 60000,
				"maxRetries": 3,
				"loopMaxRepetitions": 5,
				"cleanupTimeoutMs": 10000,
				"budgetTokens": 200000
			},
			"evidence": {
				"retention": "retain-on-failure",
				"redaction": "on",
				"allowOpaque": false
			},
			"drivers": {
				"web": {
					"settings": {
						"headless": true,
						"snapshotFilter": false,
						"snapshotTopPercent": 10,
						"screenshotsInModelContext": false
					},
					"tools": { "allowed": ["*"] }
				}
			}
		}
	},
	"drivers": {
		"web": {
			"package": "@xoxoai/checkmate/driver-web",
			"secrets": {}
		}
	}
}
```

Set the environment variable named by the logical binding before validation or execution:

```bash
export CHECKMATE_OPENAI_API_KEY="..."
```

Requests cannot choose packages, environment-variable names, credentials, providers, models, raw tools, retry behavior, or redaction policy.

## Author A Scenario

One request is one scenario attempt. Its steps share the same driver session.

```json
{
	"schemaVersion": 1,
	"scenario": {
		"id": "checkout-promo",
		"name": "A shopper applies a valid promotion",
		"driver": {
			"id": "web",
			"target": { "baseUrl": "https://staging.example.test" }
		},
		"policy": "ci",
		"limits": { "timeoutMs": 150000, "budgetTokens": 150000 },
		"steps": [
			{
				"id": "open-cart",
				"action": "Open the cart containing the seeded item",
				"expect": "The cart shows one item with a subtotal of $40"
			},
			{
				"id": "apply-promo",
				"action": "Apply promotion code SPRING25",
				"expect": "The order total is reduced by 25%"
			}
		]
	}
}
```

Step IDs are caller-owned correlation keys. Array order controls execution. A request may omit the policy to use `defaultPolicy`, and may only tighten the selected policy's scenario timeout or token budget.

## Discover, Validate, Run

```bash
checkmate describe
checkmate validate request.json
checkmate run request.json
cat request.json | checkmate run -
```

Use `--config <path>` to select an explicit manifest. The current working directory remains the invocation root for request paths, output paths, and package resolution; Checkmate never searches parent directories.

`describe` reads static descriptors without importing driver code or probing secrets. `validate` checks the manifest, request, selected policy, descriptor, target, settings, limits, and secret availability without allocating a run or starting a session. `run` performs the same preparation, allocates one run directory, executes in an isolated worker, tears down, commits `result.json`, and writes those exact deterministic bytes to stdout. Unexpected preparation and identity-allocation failures return `infra / pre-execution-error` with exit `3`, `targetMutation: "not-attempted"`, and no fabricated scenario or execution state.

Human diagnostics use stderr. Approved driver code cannot corrupt public stdout: direct worker stdout and stderr are drained and discarded.

## Route Results

| Exit | Category  | Meaning                                                                                |
| ---: | --------- | -------------------------------------------------------------------------------------- |
|  `0` | `passed`  | Every step passed                                                                      |
|  `1` | `app`     | The observed application did not meet an expectation                                   |
|  `2` | `model`   | The model reached a turn, loop, or step-time bound                                     |
|  `3` | `infra`   | Driver, provider, environment, evidence, cleanup, interruption, or containment failure |
|  `4` | `invalid` | Request, manifest, policy, driver selection, or invocation is invalid                  |

The JSON envelope is authoritative. Every execution result includes `status`, `category`, a stable `reason`, `targetMutation`, effective limits, aggregate token usage, all declared step IDs, and evidence references. Steps after the first failed step are `not-run` and name the failed step in `blockedBy`.

Checkmate does not automatically retry a whole scenario. Read the reason-specific routing returned by `checkmate describe`, inspect `targetMutation`, and start a new run only after the caller has repaired or inspected the relevant state.

## Evidence

Valid runs write beneath `.checkmate/runs` by default. `invocation.json`, `checkpoint.json`, retained evidence, and `result.json` belong to one random run ID. Follow only paths listed in `result.evidence.references`, and always inspect `result.evidence.state` before assuming optional evidence is complete.

`retain-on-failure` keeps heavy evidence only for failed steps, `on` keeps it for every step, and `off` keeps compact result data only. Text redaction is on by default in the example policy. Opaque artifacts such as screenshots additionally require operator-controlled `allowOpaque: true`.

See [Evidence](docs/EVIDENCE.md) for durability, retention, and redaction semantics.

## Drivers

The built-in `web` driver owns its browser, context, pages, fourteen browser tools, state snapshots, and cleanup. Custom drivers participate through the same static descriptor and `CheckmateDriverV1` contract. Requests select only a manifest-registered driver ID; they cannot load arbitrary code.

See [Drivers](docs/DRIVERS.md) for registration, descriptors, tool behavior, secrets, evidence, and lifecycle rules.

## Reference

- [CLI](docs/CLI.md)
- [Configuration](docs/CONFIGURATION.md)
- [Drivers](docs/DRIVERS.md)
- [Evidence](docs/EVIDENCE.md)
- [Development](docs/DEVELOPMENT.md)

Authoritative JSON Schemas ship under `@xoxoai/checkmate/schemas/*`. `checkmate describe` returns their package-relative paths and the supported contract versions.

## Scope And Trust

Checkmate owns one scenario attempt, not suite scheduling, parallelism, aggregation, target rollback, whole-scenario retry, or fleet-wide budgets. The CLI worker provides lifetime containment and stdout isolation, not a security sandbox. Registered drivers and providers are trusted code with the host process identity. Use the CLI when hard process containment is required; the TypeScript embedding API can bound awaited asynchronous work but cannot interrupt synchronous blocking code.

## License

[MIT](LICENSE)
