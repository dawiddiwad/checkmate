#### □ □ ■ □

## _Checkmate - a harness for agentic acceptance_

<img src="docs/img/onboarding.gif" alt="onboarding" width="50%" centered/>

#

Think of it like QA contracts for software factories: policies define the bounds of execution, where scenarios describe the intent to verify through a domain driver. It aims to patch the gap between fully coded tests and freelance agent testing.

## Install

Requires Node `>=22.18.0`. For web runs, provision an extension-compatible Chrome/Chromium separately; Stagehand discovers `CHROME_PATH`, then platform installations/PATH. Missing browsers fail startup. The old Playwright installer and `checkmate:install` are removed. Select a provider/model supporting strict JSON-schema responses in the manifest; observation, action, extraction, and metadata inference share the scenario's token budget.

```bash
npm install @xoxoai/checkmate
```

## Usage

#### Scenario is a JSON document:

This inspection example assumes an existing order with the promotion already applied. For interactive scenarios, the web driver can also discover controls with `browser_observe` and perform individual actions with `browser_act`, then extract the resulting facts before a verdict.

```json
{
	"schemaVersion": 1,
	"scenario": {
		"id": "inspect spring promo",
		"driver": {
			"id": "web",
			"target": {
				"baseUrl": "https://staging.example.test/orders/demo"
			}
		},
		"policy": "ci",
		"steps": [
			{
				"id": "inspect order",
				"action": "Read the existing order's product and original total",
				"expect": "The order has one product with an original total of $40"
			},
			{
				"id": "inspect promo",
				"action": "Read the applied promotion code and discount",
				"expect": "The order total is reduced by 25%"
			},
			{
				"id": "verify total",
				"action": "Extract the final order total",
				"expect": "The order total reflects the applied promotion"
			}
		]
	}
}
```

#### Run:

```bash
checkmate describe
checkmate validate scenario.json
checkmate run scenario.json
```

Checkmate writes one JSON result to stdout. Outcomes distinguish application, model, infrastructure, and invalid-invocation failures.

<details>
<summary>Example Results</summary>

A successful run of the scenario above:

```json
{
	"kind": "run-result",
	"schemaVersion": 1,
	"runId": "0123456789abcdef",
	"scenarioId": "inspect spring promo",
	"status": "passed",
	"category": "passed",
	"reason": "scenario-complete",
	"targetMutation": "possibly-mutated",
	"startedAt": "2026-09-04T12:00:00.000Z",
	"durationMs": 12600,
	"driver": { "id": "web", "contractVersion": 1 },
	"policy": {
		"id": "ci",
		"effectiveLimits": {
			"scenarioTimeoutMs": 180000,
			"stepTimeoutMs": 120000,
			"turnsPerStep": 20,
			"requestTimeoutMs": 60000,
			"maxRetries": 3,
			"loopMaxRepetitions": 5,
			"cleanupTimeoutMs": 10000,
			"budgetTokens": 200000
		}
	},
	"usage": {
		"promptTokens": 3600,
		"cachedPromptTokens": 1200,
		"completionTokens": 300,
		"totalTokens": 3900,
		"state": "complete"
	},
	"steps": [
		{
			"id": "inspect order",
			"status": "passed",
			"category": "app",
			"reason": "met-expectation",
			"actual": "The order page displays one product with a $40 original total.",
			"turns": 3,
			"durationMs": 4000,
			"usage": { "promptTokens": 1200, "cachedPromptTokens": 400, "completionTokens": 100, "totalTokens": 1300 },
			"toolCalls": [
				{
					"turn": 1,
					"driverId": "web",
					"name": "browser_navigate",
					"arguments": { "url": "https://staging.example.test/orders/demo" },
					"status": "ok"
				},
				{
					"turn": 2,
					"driverId": "web",
					"name": "browser_extract",
					"arguments": { "instruction": "Read the product count and original order total" },
					"status": "ok"
				}
			]
		},
		{
			"id": "inspect promo",
			"status": "passed",
			"category": "app",
			"reason": "met-expectation",
			"actual": "SPRING25 is applied and the order total is reduced from $40 to $30.",
			"turns": 2,
			"durationMs": 4000,
			"usage": { "promptTokens": 1200, "cachedPromptTokens": 400, "completionTokens": 100, "totalTokens": 1300 },
			"toolCalls": [
				{
					"turn": 1,
					"driverId": "web",
					"name": "browser_extract",
					"arguments": { "instruction": "Read the applied promotion code and discount" },
					"status": "ok"
				}
			]
		},
		{
			"id": "verify total",
			"status": "passed",
			"category": "app",
			"reason": "met-expectation",
			"actual": "The order page displays the discounted total of $30.",
			"turns": 2,
			"durationMs": 4000,
			"usage": { "promptTokens": 1200, "cachedPromptTokens": 400, "completionTokens": 100, "totalTokens": 1300 },
			"toolCalls": [
				{
					"turn": 1,
					"driverId": "web",
					"name": "browser_extract",
					"arguments": { "instruction": "Read the final order total" },
					"status": "ok"
				}
			]
		}
	],
	"evidence": { "state": "complete", "references": [] },
	"diagnostics": []
}
```

</details>

## Configuration

Execution is configured through `checkmate.config.json`.

Policies keep execution settings outside test intent. For example, a policy can define limits, evidence retention, and allowed driver tools:

<details>
<summary>Example Configuration</summary>

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
					"apiKeyBinding": "openai-api-key"
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
						"headless": true
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

</details>

## Drivers

#### Checkmate is designed around domain-specific drivers.

A driver defines how the model interacts with a particular system while the harness keeps scenario execution, policies, results, and evidence consistent.

The included `web` driver is a simple yet very capable reference implementation based on stagehand. Other domains can be integrated through the same public driver contract.

The Stagehand web driver exposes exactly `browser_navigate`, `browser_observe`, `browser_act`, `browser_extract`, and `browser_diagnostics`. Observe when the next action is unclear; act directly only when it is unambiguous. Actions accept an instruction, not selector replay objects. Action success is not a verdict: extract the resulting facts before passing or failing.

`["*"]` permits all five tools and enables a bounded, sanitized in-memory diagnostic buffer. To allow all four browser operations while discarding traces locally, use `["browser_navigate", "browser_observe", "browser_act", "browser_extract"]`. Both modes route Stagehand telemetry to the driver's authenticated loopback receiver. Diagnostic reads are partial debugging context, not complete console/network logs or proof that no errors occurred. See [Drivers](docs/DRIVERS.md) for limits, lifecycle, and migration details.

## Commands

```text
checkmate run <request.json|->
checkmate validate <request.json>
checkmate describe
checkmate --help
checkmate --version
```

`describe` returns the drivers, policies, and contract versions available in the current environment.

## Docs

[Configuration](docs/CONFIGURATION.md)  
[Evidence](docs/EVIDENCE.md)  
[Drivers](docs/DRIVERS.md)  
[CLI](docs/CLI.md)  
[Dev](docs/DEVELOPMENT.md)

## License

[MIT](LICENSE)
