#### □ □ ■ □

## _Checkmate - a harness for agentic acceptance_

<img src="docs/img/onboarding.gif" alt="onboarding" width="50%" centered/>

#

Think of it like QA contracts for software factories: policies define the bounds of execution, where scenarios describe the intent to verify through a domain driver. It aims to patch the gap between fully coded tests and freelance agent testing.

## Install

```bash
npm install @xoxoai/checkmate
```

## Usage

#### Scenario is a JSON document:

```json
{
	"schemaVersion": 1,
	"scenario": {
		"id": "checkout spring promo",
		"driver": {
			"id": "web",
			"target": {
				"baseUrl": "https://staging.example.test"
			}
		},
		"policy": "ci",
		"steps": [
			{
				"id": "start checkout",
				"action": "Add a product to the cart",
				"expect": "The checkout page is displayed"
			},
			{
				"id": "apply promo",
				"action": "Apply promotion code SPRING25",
				"expect": "The order total is reduced by 25%"
			},
			{
				"id": "verify total",
				"action": "Proceed to the payment step",
				"expect": "The order total reflects the applied promotion"
			}
		]
	}
}
```

#### Run:

```bash
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
	"scenarioId": "checkout spring promo",
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
			"id": "start checkout",
			"status": "passed",
			"category": "app",
			"reason": "met-expectation",
			"actual": "The checkout page displays one product with a $40 order total.",
			"turns": 3,
			"durationMs": 4000,
			"usage": { "promptTokens": 1200, "cachedPromptTokens": 400, "completionTokens": 100, "totalTokens": 1300 },
			"toolCalls": [
				{
					"turn": 1,
					"driverId": "web",
					"name": "browser_click_or_hover",
					"arguments": { "ref": "e12", "name": "Add to cart", "hover": false, "goal": "Add a product to the cart" },
					"status": "ok"
				},
				{
					"turn": 2,
					"driverId": "web",
					"name": "browser_click_or_hover",
					"arguments": { "ref": "e18", "name": "Checkout", "hover": false, "goal": "Open the checkout page" },
					"status": "ok"
				}
			]
		},
		{
			"id": "apply promo",
			"status": "passed",
			"category": "app",
			"reason": "met-expectation",
			"actual": "SPRING25 is applied and the order total is reduced from $40 to $30.",
			"turns": 3,
			"durationMs": 4000,
			"usage": { "promptTokens": 1200, "cachedPromptTokens": 400, "completionTokens": 100, "totalTokens": 1300 },
			"toolCalls": [
				{
					"turn": 1,
					"driverId": "web",
					"name": "browser_type_or_select",
					"arguments": {
						"elements": [
							{ "ref": "e24", "name": "Promotion code", "text": "SPRING25", "clear": true, "select": false }
						],
						"goal": "Enter the promotion code"
					},
					"status": "ok"
				},
				{
					"turn": 2,
					"driverId": "web",
					"name": "browser_click_or_hover",
					"arguments": { "ref": "e25", "name": "Apply", "hover": false, "goal": "Apply the promotion code" },
					"status": "ok"
				}
			]
		},
		{
			"id": "verify total",
			"status": "passed",
			"category": "app",
			"reason": "met-expectation",
			"actual": "The payment step displays the discounted order total of $30.",
			"turns": 2,
			"durationMs": 4000,
			"usage": { "promptTokens": 1200, "cachedPromptTokens": 400, "completionTokens": 100, "totalTokens": 1300 },
			"toolCalls": [
				{
					"turn": 1,
					"driverId": "web",
					"name": "browser_click_or_hover",
					"arguments": {
						"ref": "e30",
						"name": "Continue to payment",
						"hover": false,
						"goal": "Verify the discounted total at the payment step"
					},
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
						"headless": true,
						"snapshotFilter": false
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

The included `web` driver is a simple reference implementation. Other domains can be integrated through the same public driver contract.

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
[Dev :)](docs/DEVELOPMENT.md)

## License

[MIT](LICENSE)
