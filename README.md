## _Checkmate_ ⋅ _test harness for running acceptance scenarios_

Think of it like QA contracts for software factories. Policies define the bounds of execution, while scenarios describe the intent to verify through a domain driver. It aims to patch the gap between fully coded tests and freelance agent testing.

<!-- <img src="https://raw.github.com/dawiddiwad/checkmate/main/docs/img/onboarding.gif" alt="onboarding" width="50%" centered/> -->
<img src="docs/img/onboarding.gif" alt="onboarding" width="50%" centered/>

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

## Configuration

Execution is configured through `checkmate.config.json`.

Policies keep execution settings outside test intent. For example, a policy can define limits, evidence retention, and allowed driver tools:

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
				"allowOpaque": false
			},
			"bounds": {
				"stepTimeoutMs": 120000,
				"turnsPerStep": 20,
				"maxRetries": 3,
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

The full configuration also defines available drivers, model settings, and secret bindings.

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
