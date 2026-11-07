#### □ □ ■ □

## _Checkmate - QA workflows for Claude_

<img src="docs/img/onboarding.gif" alt="onboarding" width="50%"/>

#

Think of it like a QA contract for agent testing: Claude Code drives your running application with real tools, and Checkmate keeps the record strict. A plan maps each requirement to a test or an open question, the caller answers what is unclear, and every verdict needs saved evidence. It aims to patch the gap between fully coded tests and freelance agent testing.

## Install

```text
/plugin marketplace add dawiddiwad/checkmate
/plugin install checkmate@checkmate
```

Use Node.js 24.12.0 or later. The plugin has no npm dependencies and no build step. Browser tests use [Playwright CLI](plugin/references/browser.md).

## Usage

#### A plan request is a JSON document:

```json
{
	"contractVersion": "toolkit-1",
	"requestId": "req-plan-1",
	"operation": "plan",
	"caller": "factory-agent",
	"objective": "Verify checkout and identify missing acceptance decisions.",
	"target": {
		"path": "profile.json",
		"sha256": "d2c76c324a66b6fabf788ac059d556a62204edf68d0472f2c982e2368962da70"
	},
	"requirements": [
		{
			"id": "R1",
			"text": "A standard order for a 400 PLN item has a total of 400 PLN.",
			"source": "caller://checkout-brief#standard"
		},
		{
			"id": "R2",
			"text": "A 40 percent promotion is applied during checkout; stacking behaviour is unspecified.",
			"source": "caller://checkout-brief#promotion"
		},
		{
			"id": "R3",
			"text": "Refund behaviour must be checked; eligibility rules are unspecified.",
			"source": "caller://checkout-brief#refund"
		}
	],
	"sourceContext": [
		{
			"uri": "caller://checkout-brief",
			"content": "Fixture checkout sells one item at 400 PLN. Promotion is 40 percent. Existing loyalty reduction can be 20 PLN. Confirm stacking and refund eligibility before asserting them."
		}
	],
	"outputPlanId": "checkout",
	"planDirectory": "plans/checkout"
}
```

#### Run:

```text
/checkmate:plan plan-request.json
```

The request pins the target profile that `/checkmate:setup` saved. Checkmate saves `plans/checkout/v1.json` and returns a response. Unclear requirements come back as blocking gaps with `status: "needs_decision"`. The caller answers them with `/checkmate:revise`, then runs the plan with `/checkmate:execute`.

<details>
<summary>Example documents</summary>

The documents describe an illustrative local checkout. They are not evidence from a live application. File digests refer to the exact files in [docs/examples](docs/examples).

<details>
<summary>Configuration: target profile</summary>

The profile records the target, tool versions, access references, and permitted operations.

```json
{
	"contractVersion": "toolkit-1",
	"targetId": "checkout-local",
	"revision": 1,
	"baseUrl": "http://127.0.0.1:4173",
	"environment": "local_fixture",
	"capabilities": ["browser", "http"],
	"tooling": [
		{
			"capability": "browser",
			"executable": "playwright-cli",
			"version": "0.1.23"
		},
		{
			"capability": "http",
			"executable": "node",
			"version": "v24.22.1"
		}
	],
	"authentication": {
		"kind": "none",
		"references": []
	},
	"allowedOperations": ["read_catalog", "create_fixture_order", "apply_fixture_discount"],
	"startup": {
		"owner": "caller",
		"command": null
	},
	"cleanup": "Close the run browser session. The fixture stores no records.",
	"readyForLiveExecution": true
}
```

</details>

<details>
<summary>Input: caller decisions</summary>

The caller clarifies the discount rule and defers refund coverage. The next plan revision preserves these decisions.

```json
{
	"contractVersion": "toolkit-1",
	"requestId": "revise-1",
	"caller": "test-caller",
	"operation": "revise",
	"basePlan": {
		"path": "plans/checkout/v1.json",
		"sha256": "df4e09ebcc886104a3ceb2760f7a251238f8ddceae71094c7d90c1c33955b32d"
	},
	"baseRevision": 1,
	"decisions": [
		{
			"id": "D1",
			"gapId": "G1",
			"kind": "clarify",
			"actor": "factory-agent",
			"rationale": "Product acceptance decision supplied by dispatcher.",
			"value": "Promotion replaces loyalty. Apply 40 percent to the undiscounted 400 PLN subtotal; expected total is 240 PLN.",
			"source": "caller://acceptance-decisions/checkout#promotion"
		},
		{
			"id": "D2",
			"gapId": "G2",
			"kind": "defer",
			"actor": "factory-agent",
			"rationale": "Refund policy is outside this delivery; preserve the uncovered requirement.",
			"value": "Do not execute refund checks in this scope.",
			"source": null
		}
	]
}
```

</details>

<details>
<summary>Input: execution request</summary>

The request selects two tests and pins the target and plan by digest. It uses the default execution policy.

```json
{
	"contractVersion": "toolkit-1",
	"requestId": "execute-1",
	"caller": "test-caller",
	"operation": "execute",
	"runId": "run-1",
	"plan": {
		"path": "plans/checkout/v2.json",
		"sha256": "2f9c2ef09130a0f4e7583db328e394b1ddd685d076193a5bf9237c062d1c95bc"
	},
	"target": {
		"path": "profile.json",
		"sha256": "d2c76c324a66b6fabf788ac059d556a62204edf68d0472f2c982e2368962da70"
	},
	"selectedTestIds": ["T1", "T2"],
	"partialExecution": "wait_for_resolution",
	"timeoutSeconds": 180,
	"onNewBlocker": "return_to_caller",
	"applicationBuild": "fixture-build-1",
	"outputDirectory": "runs/run-1"
}
```

</details>

<details>
<summary>Output: execution result</summary>

The run completed. One test failed. Deferred refund coverage remains visible. Completion, test outcomes, and coverage are separate fields.

```json
{
	"contractVersion": "toolkit-1",
	"requestId": "execute-1",
	"runId": "run-1",
	"completion": "completed",
	"plan": {
		"path": "plans/checkout/v2.json",
		"sha256": "2f9c2ef09130a0f4e7583db328e394b1ddd685d076193a5bf9237c062d1c95bc"
	},
	"target": {
		"path": "profile.json",
		"sha256": "d2c76c324a66b6fabf788ac059d556a62204edf68d0472f2c982e2368962da70"
	},
	"applicationBuild": "fixture-build-1",
	"selectedTestIds": ["T1", "T2"],
	"startedAt": "2026-11-07T14:24:25.788Z",
	"tests": [
		{
			"testId": "T1",
			"outcome": "passed",
			"expected": "The order total is 400 PLN.",
			"observed": "Order confirmed: 400 PLN",
			"assertionKind": "agent_observation",
			"evidenceIds": ["E-T1"],
			"reason": null
		},
		{
			"testId": "T2",
			"outcome": "failed",
			"expected": "HTTP 200 and totalPLN equals 240, with the loyalty discount replaced.",
			"observed": "HTTP 200; totalPLN = 220",
			"assertionKind": "deterministic",
			"evidenceIds": ["E-T2"],
			"reason": "Observed total differs from expected total."
		},
		{
			"testId": "T3",
			"outcome": "not_run",
			"expected": null,
			"observed": null,
			"assertionKind": null,
			"evidenceIds": [],
			"reason": "Test was not selected or was deferred."
		}
	],
	"findings": [
		{
			"id": "F1",
			"type": "defect",
			"severity": "medium",
			"testIds": ["T2"],
			"requirementIds": ["R2"],
			"title": "Promotion stacks with loyalty",
			"expected": "240 PLN",
			"observed": "220 PLN",
			"reproduction": [
				"Create a 400 PLN cart with 20 PLN loyalty.",
				"Apply a 40 percent promotion.",
				"Read the quote total."
			],
			"evidenceIds": ["E-T2"]
		}
	],
	"newGaps": [],
	"evidence": [
		{
			"id": "E-T1",
			"kind": "observation",
			"path": "evidence/T1.txt",
			"sha256": "defae3129c5e2095b2a6580118f56b824b9002714c9577730592317d1b8b8179"
		},
		{
			"id": "E-T2",
			"kind": "observation",
			"path": "evidence/T2.txt",
			"sha256": "86f68eb060aca6d97061d59ce146a5dc2cd1f7a90c0ceaff465ff74ade9bd067"
		}
	],
	"cleanup": {
		"status": "not_applicable",
		"reason": "Illustrative document. No application was used to create this example."
	},
	"finishedAt": "2026-11-07T14:24:25.850Z",
	"coverage": {
		"status": "partial",
		"requirements": [
			{
				"requirementId": "R1",
				"status": "tested",
				"testIds": ["T1"],
				"reason": null
			},
			{
				"requirementId": "R2",
				"status": "tested",
				"testIds": ["T2"],
				"reason": null
			},
			{
				"requirementId": "R3",
				"status": "uncovered",
				"testIds": ["T3"],
				"reason": "At least one required check or decision is missing."
			}
		]
	}
}
```

</details>

Read the [first plan](docs/examples/plans/checkout/v1.md), [revised plan](docs/examples/plans/checkout/v2.md), and [Markdown report](docs/examples/runs/run-1/report.md).

</details>

## How it works

![Checkmate overview: five stages, a checkout example with a defect found and a passed retest, and who owns what.](docs/img/checkmate-infographic.png)

Each stage is a skill with an explicit request file:

- `/checkmate:setup` checks tools and access, and saves a target profile.
- `/checkmate:plan` maps requirements to tests and records open gaps.
- `/checkmate:revise` applies the caller's decisions in a new plan revision.
- `/checkmate:execute` runs selected tests and saves evidence.
- `/checkmate:report` generates Markdown and HTML from the JSON result.

Saved files are never overwritten. A retest is a new run. Completion, test outcomes, and coverage are separate fields, and a process exit code is not a release decision.

Checkmate checks structure and relationships. It cannot prove that an observation is true. Claude Code owns the model, tools, and permissions.

## Commands

```text
checkmate validate <file.json>
checkmate setup <request.json> <profile.json>
checkmate save-plan <request.json> <plan.json>
checkmate gate <request.json>
checkmate begin <request.json>
checkmate finalize <request.json> <observation.json>
checkmate report <request.json>
checkmate delegate <request.json> [--allow <rule>] [--timeout <seconds>]
```

Run a command as `node plugin/bin/checkmate.ts <command>`. `delegate` runs one stage in a fresh Claude Code session.

## Docs

[Contracts and configuration](docs/CONFIGURATION.md)  
[CLI](docs/CLI.md)  
[Evidence](docs/EVIDENCE.md)  
[Dev](docs/DEVELOPMENT.md)

## License

[MIT](LICENSE)
