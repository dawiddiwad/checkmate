# Payloads

> **Reference** · The JSON that the commands take on standard input, with the rules that Checkmate applies.

The JSON Schemas in `plugin/contracts/` are the authority, and this page explains them with examples. Each example passes its schema and the rules of its command. The contract version is `toolkit-2`.

**On this page:** [Identifiers](#identifiers) · [Target profile](#target-profile) · [Instance](#instance) · [Plan request](#plan-request) · [Plan candidate](#plan-candidate) · [Plan delta](#plan-delta) · [Plan edit](#plan-edit) · [Finding](#finding) · [Runtime gap](#runtime-gap) · [Schemas](#schemas)

## Identifiers

- A target, instance, entry point, plan, run, test, gap, or requirement ID has 1 to 96 letters, digits, `_`, or `-`. It starts with a letter or a digit.
- A revision reference is `<id>@<revision>`, for example `checkout@2`.
- An assertion reference is `<testId>.<assertionId>`, for example `T2.A1`.
- An instance reference is `<targetId>/<instanceId>`, for example `shop/uat`.
- A cross-plan test reference is `<planId>:<testId>`, for example `login:T3`. A test ID without a prefix is in the same plan.
- Each plan revision, profile, and result has a SHA-256 digest of its canonical JSON. `--expect-sha <digest>` uses it.

## Target profile

`target open` records the setup request from flags. The setup stage checks each tool and the target through an instance, then sends the profile to `target save <targetId>`.

```json
{
	"contractVersion": "toolkit-2",
	"targetId": "shop",
	"revision": 1,
	"entryPoints": [{ "name": "web", "kind": "url", "purpose": "Storefront and HTTP API." }],
	"capabilities": ["browser", "http"],
	"tools": [
		{
			"name": "playwright-cli",
			"kind": "cli",
			"purpose": "Drive the browser.",
			"version": "0.1.23",
			"reachable": true
		},
		{ "name": "jira", "kind": "mcp", "purpose": "Read the ticket.", "reachable": true }
	],
	"authentication": { "kind": "none", "references": [] },
	"allowedOperations": ["read_catalog", "create_order"],
	"startup": { "owner": "factory", "command": null },
	"cleanup": "Close the run browser session.",
	"readyForLiveExecution": true,
	"approvals": { "plan": "required", "result": "required" }
}
```

- `targetId`, `entryPoints`, `capabilities`, and `allowedOperations` are equal to the setup request. So every revision of a target has the same entry points.
- `entryPoints` has one or more entries with a unique `name`. `kind` is `url`, `command`, or `value`. The profile has no entry values. An instance gives them.
- `tools` has one entry for each requested tool, with the same name and kind. The setup stage can add `playwright-cli` for `browser` and `node` for `http`. `version` is optional.
- `reachable` is the result of the setup check. `readyForLiveExecution` cannot be `true` when a requested tool is not reachable. When it is `false`, `target save` gives `needs_decision`, and the gate refuses every run.
- `authentication.references` holds environment variable names or browser-state references, never credential values. The host resolves them.
- `startup.command` is guidance for an authorized host. Checkmate does not start the application.
- `revision` is the latest revision plus 1. A save of the same revision with the same content changes nothing.

### Approvals policy

`approvals` is optional. The default requires both.

| Field    | `required`                                                                               | `none`                                                     |
| -------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `plan`   | A run needs an approval of the exact plan revision. A new revision needs a new approval. | A run needs no plan approval. The inbox omits the plan.    |
| `result` | A cross-plan dependency needs an accepted result. The inbox lists the result.            | A passed result satisfies a dependency without acceptance. |

Change the policy only with a new profile revision. A plan uses the profile revision that it names.

## Instance

`target instance add <targetId> <instanceId>` records an instance. Give the values with `--entry <entryPoint>=<value>` flags, or send this JSON on standard input:

```json
{
	"entries": {
		"web": "sf org open --target-org shop-uat --url-only --json",
		"org": "shop-uat"
	},
	"environment": "UAT sandbox",
	"references": ["sf alias shop-uat"]
}
```

- `entries` has exactly one value for each entry point of the target. Checkmate refuses a missing name and an unknown name. It checks against the entry points of the setup request, which are equal to the entry points of every revision.
- A `url` value is a valid URI of any scheme, for example `https:`, `sftp:`, or `salesforce:`. It has no user name and no password.
- A `command` value is a command line. QA runs it at test time, for example to get a one-time login URL. Checkmate stores the command, never its output.
- A `value` value is an opaque string, for example an org alias.
- `environment` is optional free text.
- `references` is optional. It names authentication aliases or environment variables, never credential values.
- An instance does not change. A second add with the same values changes nothing. A second add with other values is refused.
- `target instance retire <targetId> <instanceId>` writes a retirement row. No new run can start on a retired instance. Its runs stay as they are.
- An instance ID is not used again in the same target, also after it is retired. For a refreshed sandbox, retire the old instance and add a new one, for example `uat-2`. The plan and the retest chain stay the same.

## Plan request

`plan open <planId> --target <targetId@rev>` records the request. For a request with sources only, use flags:

```sh
checkmate plan open checkout --target shop@1 --objective "Verify checkout totals." \
  --source jira:SHOP-12 --source docs/checkout.md --instructions "Use the acceptance criteria only."
```

For requirements or plan tools, send JSON on standard input:

```json
{
	"objective": "Verify checkout totals.",
	"requirements": [
		{ "id": "R1", "text": "A standard order for one 400 PLN item has a total of 400 PLN.", "source": "brief#standard" }
	],
	"sourceContext": [{ "uri": "brief", "content": "The shop sells one item at 400 PLN." }],
	"tools": ["playwright-cli", { "name": "confluence", "kind": "mcp", "purpose": "Read the pricing page." }]
}
```

| Field           | Required | Meaning                                                                                      |
| --------------- | -------- | -------------------------------------------------------------------------------------------- |
| `objective`     | Yes      | The scope of the plan.                                                                       |
| `requirements`  | No       | The requirements to cover. The plan stage does not add requirements.                         |
| `sourceContext` | No       | Short source text copied into the request, as `{ "uri", "content" }`.                        |
| `context`       | No       | `sources`: where the requirements come from. `instructions`: how to read them.               |
| `tools`         | No       | A string selects a profile tool. An object `{ "name", "kind", "purpose" }` adds a plan tool. |

- A request needs `requirements` or one or more `context.sources`.
- Without requirements, the plan stage writes them. The `source` of each starts with a context source, for example `jira:SHOP-12#ac-2`.
- When `tools` names profile tools, the plan keeps only those. Without names, the plan keeps all profile tools. An object must not use the name of a profile tool.
- `plan request <planId>` prints the request with the resolved tools.

`plan revise` does not change the requirements. `plan edit` can. Use a new plan for a new scope.

## Plan candidate

The plan stage sends a candidate to `plan save <planId>`. Checkmate builds revision 1 from the request and the candidate.

```json
{
	"tests": [
		{
			"id": "T1",
			"title": "Standard order total",
			"requirementIds": ["R1"],
			"capability": "browser",
			"operations": ["create_order"],
			"dependsOn": [],
			"preconditions": ["Fresh cart with one 400 PLN item."],
			"action": "Complete checkout and read the order total.",
			"assertions": [{ "id": "A1", "check": "The order total is 400 PLN.", "checkKind": "deterministic" }]
		},
		{
			"id": "T2",
			"title": "Promotion with loyalty discount",
			"requirementIds": ["R2"],
			"capability": "http",
			"operations": ["create_order"],
			"dependsOn": ["T1"],
			"preconditions": ["Cart with one 400 PLN item and 20 PLN loyalty."],
			"action": "Request GET /quote?promotion=true&loyalty=true and read the total.",
			"assertions": []
		}
	],
	"gaps": [
		{
			"id": "G1",
			"severity": "blocking",
			"status": "open",
			"requirementIds": [],
			"testIds": ["T2"],
			"question": "Does the 40 percent promotion stack with the 20 PLN loyalty discount?",
			"consequence": "The expected total is unknown, so T2 cannot assert a value.",
			"decisionId": null
		}
	]
}
```

Checkmate sets these fields. The candidate does not contain them:

- `gapIds`: the gaps that affect the test. A gap affects the tests in `testIds` and every test of the requirements in `requirementIds`. A gap with two empty lists affects every test.
- `readiness`: `deferred` when an affecting blocking gap is deferred, else `blocked` when an affecting blocking gap is open, else `ready`.
- `coverage`: one row for each requirement: `planned`, `blocked`, or `deferred`.

Rules:

- Each requirement has one or more tests or gaps.
- A ready test has one or more assertions, a capability of the target, and allowed operations only.
- An assertion has an ID that is unique in its test, a `check`, and a `checkKind`: `deterministic` for an exact value, `agent_observation` when the agent interprets the evidence.
- Do not write an assertion with an unknown expected value. Write an open blocking gap. In the example, T2 is `blocked`.
- `dependsOn` names local tests or cross-plan tests. The named plan and test exist. Checkmate refuses a dependency cycle across all plans.
- Revision 1 has no decisions and no assumptions.

`plan save` gives `needs_decision` with one reason for each open blocking gap.

## Plan delta

The revise stage reads `plan pending <planId>` and sends a delta to `plan revise <planId>`. The delta contains only changes.

```json
{
	"tests": {
		"T2": {
			"assertions": {
				"A1": { "check": "totalPLN equals 240.", "checkKind": "deterministic" },
				"A2": { "check": "The response status is HTTP 200.", "checkKind": "deterministic" }
			}
		}
	}
}
```

Checkmate builds the next revision:

1. It appends the pending decisions in recorded order, sets the gap status and `decisionId`, and adds an assumption for each `accept_assumption`.
2. It applies the delta. A delta changes only `action`, `preconditions`, and `assertions` of the tests that a pending decision affects.
3. In `assertions`, a known ID changes that assertion. A new ID adds one and needs `check` and `checkKind`. `null` removes one. An ID from an earlier revision cannot come back.
4. It calculates `gapIds`, readiness, and coverage again, and checks all plan rules.
5. It marks the decisions as applied.

`plan revise` needs one or more pending decisions. When every decision is `defer`, send `{ "tests": {} }`. A concurrent revise of the same plan fails.

## Plan edit

`plan edit <planId@rev>` takes a full candidate: `tests`, `gaps`, and optional `requirements`. Without `requirements`, the revision keeps its requirements. To start from the current revision, run `plan show <planId@rev> --json`, copy `plan.requirements`, `plan.tests`, and `plan.gaps`, and remove `readiness` and `gapIds` from each test.

- `plan edit` names the latest revision.
- A revision with no approval and no run changes in place. Else Checkmate saves the next revision.
- A gap with a pending decision stays open.
- An assertion ID that an earlier revision used cannot come back with a new meaning.
- The reply prints `edit=in_place` or `edit=new_revision`.

### Small edits

`plan edit <planId@rev> --patch` takes only the changes. Each list is an object keyed by ID.

```json
{
	"requirements": { "R1": { "text": "A standard order for one 400 PLN item totals 400 PLN." } },
	"tests": { "T2": { "action": "Request GET /quote?promotion=true." } },
	"gaps": {
		"G5": {
			"severity": "blocking",
			"requirementIds": [],
			"testIds": ["T2"],
			"question": "Is the quote rounded?",
			"consequence": "The total can differ by 1 PLN."
		}
	}
}
```

- A known ID changes only the given fields. A list field, for example `preconditions`, is replaced as a whole.
- A new ID adds the item. A new requirement needs `text` and `source`. A new test needs `title`, `requirementIds`, `capability`, `operations`, and `action`. A new gap needs `severity`, `requirementIds`, `testIds`, `question`, and `consequence`, and it is `open`.
- `null` removes the item. `assertions` works as in the [plan delta](#plan-delta).
- A patch cannot set gap `status` or `decisionId`. Use `gap answer`.

`plan adopt-gaps` builds a candidate from the gaps of a run, and the same rules apply.

## Finding

QA sends each finding to `run finding <runId>`.

```json
{
	"id": "F1",
	"type": "defect",
	"severity": "medium",
	"assertionIds": ["T2.A1"],
	"requirementIds": ["R2"],
	"title": "Promotion stacks with the loyalty discount",
	"expected": "totalPLN equals 240.",
	"observed": "GET /quote?promotion=true&loyalty=true returned HTTP 200 with totalPLN 220.",
	"reproduction": ["Request GET /quote?promotion=true&loyalty=true.", "Read totalPLN."],
	"evidenceIds": ["01M75A0ZVZC156GNSTPZ9G4MYX"]
}
```

`evidenceIds` are the IDs that `run check` printed. [Findings](runs.md#findings) has the rules.

## Runtime gap

QA sends new ambiguity to `run gap <runId>`.

```json
{
	"id": "G3",
	"severity": "blocking",
	"status": "open",
	"requirementIds": ["R2"],
	"testIds": [],
	"question": "The quote shows a second discount line named 'welcome'. Is it part of the expected total?",
	"consequence": "The expected total for R2 can be different from 240 PLN.",
	"decisionId": null
}
```

- A runtime gap is open, has no decision, and has an ID that is new in the plan and the run.
- Its requirements and tests exist.
- A blocking runtime gap keeps the requirements that it names uncovered in the result. A gap with two empty lists keeps every requirement uncovered.
- It does not change the plan. The oracle answers or adopts it. Read [Answer a gap from a run](../guides/oracle.md#answer-a-gap-from-a-run).

## Schemas

| Schema                       | Checked by                        |
| ---------------------------- | --------------------------------- |
| `profile.schema.json`        | `target save`                     |
| `instance.schema.json`       | `target instance add`             |
| `plan-request.schema.json`   | `plan open`                       |
| `plan-candidate.schema.json` | `plan save`, `plan edit`          |
| `plan-delta.schema.json`     | `plan revise`                     |
| `plan-patch.schema.json`     | `plan edit --patch`               |
| `plan.schema.json`           | each stored plan revision         |
| `finding.schema.json`        | `run finding`                     |
| `gap.schema.json`            | `run gap`, and each gap in a plan |
| `result.schema.json`         | each stored result                |
| `response.schema.json`       | the output of a delegated worker  |

A payload with an unknown field, a missing field, or a wrong type is refused before any rule check.

## Next

- [Runs and evidence](runs.md): results, outcomes, and coverage.
- [Decide as the oracle](../guides/oracle.md): when to send an edit or a patch.
