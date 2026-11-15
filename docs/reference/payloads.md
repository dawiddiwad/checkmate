# Payloads

> **Reference** · The JSON that the commands take on standard input, with the rules that Checkmate applies.

The JSON Schemas in `plugin/contracts/` are the authority, and this page explains them with examples. Each example passes its schema and the rules of its command. The contract version is `toolkit-2`.

**On this page:** [Identifiers](#identifiers) · [Target profile](#target-profile) · [Instance](#instance) · [Plan request](#plan-request) · [Plan candidate](#plan-candidate) · [Plan delta](#plan-delta) · [Plan edit](#plan-edit) · [Finding](#finding) · [Runtime gap](#runtime-gap) · [Lite checklist](#lite-checklist) · [Lite record](#lite-record) · [Metadata](#metadata) · [Limits](#limits) · [Schemas](#schemas)

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
- `reset` is optional. It tells QA how to restore a fresh state of the application, for example the seed data: `"reset": { "owner": "checkmate", "command": ["npm run db:reset"] }`. `owner` is `checkmate` when QA can run the command, or `factory` when only the factory can reset. `command` is a list of command lines, or `null`. It is guidance. Checkmate does not run it. `target show` prints it on a `reset` line, and `delegate execute` names it in the prompt.
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

- Checkmate trims spaces and line breaks at the start and end of each entry value, `environment`, and each reference. This is the same for flags and for JSON. It refuses a value that is empty after the trim.
- `entries` has exactly one value for each entry point of the target. Checkmate refuses a missing name and an unknown name. It checks against the entry points of the setup request, which are equal to the entry points of every revision.
- A `url` value is a valid URI of any scheme, for example `https:`, `sftp:`, or `salesforce:`. It has no user name and no password.
- A `command` value is a command line. QA runs it at test time, for example to get a one-time login URL. Checkmate stores the command, never its output.
- A `value` value is an opaque string, for example an org alias.
- `environment` is optional free text.
- `references` is optional. It names authentication aliases or environment variables, never credential values.
- An instance does not change. A second add with the same values changes nothing. A second add with other values is refused.
- `target instance retire <targetId> <instanceId>` writes a retirement row. No new run can start on a retired instance. Its runs stay as they are. When started runs use the instance, the reply has a `warning` line that names them. The status stays `completed`.
- `delegate execute` tells the worker when the instance of the run is retired. The worker stops with a blocking gap when the instance does not respond.
- An instance ID is not used again in the same target, also after it is retired. For a refreshed sandbox, retire the old instance and add a new one, for example `uat-2`. The plan and the retest chain stay the same. A retest on the new instance can keep the build.

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
		{ "id": "R1", "text": "A standard order for one 400 PLN item has a total of 400 PLN.", "source": "brief#standard" },
		{ "id": "R2", "text": "A 40 percent promotion applies with the loyalty discount.", "source": "brief#promotion" }
	],
	"sourceContext": [{ "uri": "brief", "content": "The shop sells one item at 400 PLN. A promotion is 40 percent." }],
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

A requirement can have [`metadata`](#metadata).

- A request needs `requirements` or one or more `context.sources`.
- Give the existing product documentation as a source too, for example `docs/checkout.md`. The planner plans [regression tests](#metadata) from the existing rules in it.
- Without requirements, the plan stage writes them. The `source` of each starts with a context source, for example `jira:SHOP-12#ac-2`.
- When `tools` names profile tools, the plan keeps only those. Without names, the plan keeps all profile tools. An object must not use the name of a profile tool.
- `plan request <planId>` prints the request with the resolved tools.

`plan revise` does not change the requirements. `plan edit` can. Use a new plan for a new scope.

## Plan candidate

The plan stage sends a candidate to `plan save <planId>`. Checkmate builds revision 1 from the request and the candidate. The example passes with the [plan request](#plan-request) example.

A candidate has `requirements` only when the request has no requirements:

- When the request has `requirements`, the candidate does not contain `requirements`. Checkmate copies them from the request.
- When the request has only `context.sources`, the candidate must contain `requirements`. The `source` of each starts with a context source, for example `{ "id": "R1", "text": "…", "source": "jira:SHOP-12#ac-1" }`.

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
			"dependsOn": [],
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
- Tests are independent by default. Use `dependsOn` only when a test uses a record that another test creates. One failure blocks each test that depends on it. `plan save`, `plan revise`, `plan edit`, and `plan show` give a warning when a local chain has more than 3 tests, or when more than half of the tests have a local `dependsOn`. The warning names the tests. The command is not refused.
- Revision 1 has no decisions and no assumptions.
- A test and a requirement of the candidate can have [`metadata`](#metadata).

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
- Only an open gap without a decision can change. An answered or deferred gap stays the same. An edit that removes a test can remove that test from such a gap.
- A new gap cannot use the ID of an open gap of a run of the plan.
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
- `metadata` of a requirement or a test is replaced as a whole. Send `{}` to remove it. A plan delta cannot change metadata.

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

`evidenceIds` are the IDs that `run check` printed. A finding can have [`metadata`](#metadata). [Findings](runs.md#findings) has the rules.

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

- A runtime gap is open and has no decision. Its ID is new in each revision of the plan and in each gap of each run of the plan. Else `run gap` gives `Gap ID <id> is in use. Use a new ID.`
- An open blocking runtime gap stops the gate for the tests that it affects. `--partial ready_only` leaves them out.
- Its requirements and tests exist.
- A blocking runtime gap keeps the requirements that it names uncovered in the result. A gap with two empty lists keeps every requirement uncovered.
- It does not change the plan. The oracle answers or adopts it. Read [Answer a gap from a run](../guides/oracle.md#answer-a-gap-from-a-run).

<!-- lite payloads: generated by npm run generate from plugin/contracts/lite-*.schema.json -->

## Lite checklist

QA sends it to `lite checklist <planId> --target <targetId@revision>`. The checklist of a change. Record it before the build, in one lite checklist call. The base app runs and does not have the change. Study the ticket, the docs, and the base app first. Do not test the change before the build.

| Field                         | Type     | Required | Description                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `objective`                   | string   | yes      | What to verify, in one sentence.                                                                                                                                                                                                                                                                                                                                    |
| `criteria`                    | integer  | yes      | The count of numbered acceptance criteria in the ticket. Use 0 when the ticket has none.                                                                                                                                                                                                                                                                            |
| `items`                       | object[] | yes      | The rules to verify. Write one item for each numbered acceptance criterion. Then add the existing rules near the change that the change can break: the same totals and calculations, the same validation and error messages, the lists, exports, and counters that show the changed data, the permissions, and the rules in the docs for the same page or endpoint. |
| `items[].id`                  | string   | yes      | A unique item ID, for example R1.                                                                                                                                                                                                                                                                                                                                   |
| `items[].text`                | string   | yes      | The rule, in one sentence.                                                                                                                                                                                                                                                                                                                                          |
| `items[].source`              | string   | yes      | The file that states the rule: the ticket file for a criterion, or docs/\<file>#\<section> for an existing rule.                                                                                                                                                                                                                                                    |
| `items[].criterion`           | integer  | no       | The number of the acceptance criterion of this item. Give it only on a criterion item. Do not merge two criteria in one item.                                                                                                                                                                                                                                       |
| `items[].baseline`            | object   | no       | Give a baseline to each existing rule that the change can break. Measure it on the base app with one request or a few steps, not a full test. The baseline value is the reference value. Each build does the steps again and gives the value that it sees.                                                                                                          |
| `items[].baseline.steps`      | string   | yes      | The exact request or UI steps. Each build does the same steps again.                                                                                                                                                                                                                                                                                                |
| `items[].baseline.value`      | string   | yes      | The value that you saw on the base app. Use a short exact value, for example 409 "Book is on loan" or fee 1.50.                                                                                                                                                                                                                                                     |
| `items[].baseline.documented` | string   | yes      | The value that the docs state. When it is not the base value, add a question.                                                                                                                                                                                                                                                                                       |
| `changes`                     | object[] | no       | The parts of the product that the change touches. When you have the repository or the merge request, read the diff first. Write one entry for each changed area. An area without an item is a prompt to add an item or a baseline. This field is never necessary, and no rule of Checkmate needs it.                                                                |
| `changes[].area`              | string   | yes      | The part of the product that the diff or the ticket changes, in a few words, for example the loan limit check.                                                                                                                                                                                                                                                      |
| `changes[].source`            | string   | yes      | Where you saw the change: a file path, a diff hunk reference, or a ticket line.                                                                                                                                                                                                                                                                                     |
| `changes[].items`             | string[] | no       | The IDs of the items that cover this area. Leave out this field when no item covers it.                                                                                                                                                                                                                                                                             |
| `questions`                   | object[] | no       | One question for each point that the ticket and the docs do not settle: a threshold and whether it is inclusive, rounding, how two rules combine, the order of operations, and the result after a state change. Also ask when the base value and the documented value differ. The PM answers before the build. Leave out this field when you have no question.      |
| `questions[].id`              | string   | yes      | A new question ID, for example Q1.                                                                                                                                                                                                                                                                                                                                  |
| `questions[].question`        | string   | yes      | One clear question for the PM.                                                                                                                                                                                                                                                                                                                                      |
| `questions[].items`           | string[] | no       | The IDs of the items that the answer changes.                                                                                                                                                                                                                                                                                                                       |

```json
{
	"objective": "Verify the new loan limit and the existing late fees.",
	"criteria": 1,
	"items": [
		{
			"id": "R1",
			"text": "A member can have at most 5 books on loan.",
			"source": "ticket.md",
			"criterion": 1
		},
		{
			"id": "R2",
			"text": "A late return adds a fee of 0.50 for each day.",
			"source": "docs/loans.md#fees",
			"baseline": {
				"steps": "Return loan L1 3 days late. Then GET /api/loans/L1.",
				"value": "fee 1.50",
				"documented": "fee 1.50"
			}
		}
	],
	"changes": [
		{
			"area": "Loan limit check",
			"source": "src/loans.ts @@ -40,7 +40,9 @@",
			"items": ["R1"]
		},
		{
			"area": "Late fee calculation",
			"source": "src/fees.ts @@ -12,4 +12,6 @@",
			"items": ["R2"]
		}
	],
	"questions": [
		{
			"id": "Q1",
			"question": "Is a sixth loan refused, or put on a waiting list?",
			"items": ["R1"]
		}
	]
}
```

## Lite record

QA sends it to `lite record <planId> --build <build>`. One tested build, in one lite record call. Leave out each optional field that you do not need. When Checkmate refuses, read reason and hint, correct the payload, and send it again. Only the PM answers questions and accepts records.

| Field                      | Type                             | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `items`                    | object[]                         | no       | New rules that you found and that no item covers, with the source exploration or docs/\<file>#\<section>.                                                                                                                                                                                                                                                                                                                                                                                   |
| `items[].id`               | string                           | yes      | A new unique item ID, for example R9.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `items[].text`             | string                           | yes      | The rule, in one sentence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `items[].source`           | string                           | yes      | Where the rule comes from: exploration, or docs/\<file>#\<section>.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `checks`                   | object[]                         | yes      | One or more checks for each item. For each rule, also try the boundary value, the other entry point (API or UI), the state after an undo or a removal, and a second view of the same value (a list, an export, a header).                                                                                                                                                                                                                                                                   |
| `checks[].item`            | string                           | yes      | The item ID.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `checks[].check`           | string                           | yes      | What you did, in one sentence.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `checks[].result`          | passed, failed, blocked, not_run | no       | passed, failed, blocked (the check cannot run), or not_run (you did not run it). A criterion item needs passed, failed, or blocked. Leave it out with value on an item with a repeat line.                                                                                                                                                                                                                                                                                                  |
| `checks[].observed`        | string                           | no       | What you saw. Necessary for passed and failed without value.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `checks[].value`           | string                           | no       | Necessary for each repeat line: do its steps again and give the value that you see. Checkmate compares it with the reference value after it removes the spaces at the two ends, changes each sequence of spaces to one space, and writes each number in one form (1.50 is 1.5, 007 is 7). All other text must be equal. Equal: passed. Different: failed, and the check needs defect or intended. On an item without a reference value, a passed check with value sets the reference value. |
| `checks[].reason`          | string                           | no       | Necessary for blocked and not_run: why the check did not run.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `checks[].intended`        | object                           | no       | Only for a different value that is correct because the ticket or a PM answer changes the rule. Then the check is passed and the value becomes the reference value.                                                                                                                                                                                                                                                                                                                          |
| `checks[].intended.note`   | string                           | yes      | Why the new value is correct.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `checks[].intended.source` | string                           | yes      | The ticket line, PM answer, or doc that changes the rule, for example Q1.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `checks[].evidence`        | entry[]                          | no       | File paths in the workspace (screenshots, responses, logs), for example evidence/r1.png, or {"text": "\<what you saw>"}.                                                                                                                                                                                                                                                                                                                                                                    |
| `checks[].defect`          | string                           | no       | Necessary on a failed check, and only there: a new defect ID from defects, or an open defect with the verdict not_fixed.                                                                                                                                                                                                                                                                                                                                                                    |
| `defects`                  | object[]                         | no       | The new defects of this build, each with exact steps, the expected result and its source (the ticket, a doc, or a PM answer), and evidence. A failed check names each defect. When no item covers it, add an item. Give an earlier defect a verdict in retests.                                                                                                                                                                                                                             |
| `defects[].id`             | string                           | yes      | A new defect ID, for example D1.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `defects[].title`          | string                           | yes      | Names the incorrect behaviour.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `defects[].severity`       | low, medium, high, critical      | yes      | low, medium, high, or critical: the effect on the user.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `defects[].steps`          | string[]                         | yes      | One step in each entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `defects[].expected`       | string                           | yes      | The correct result and its source.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `defects[].actual`         | string                           | yes      | What you saw.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `defects[].evidence`       | entry[]                          | yes      | One or more entries in the form of checks[].evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `retests`                  | object[]                         | no       | A verdict for each open earlier defect: do its steps again before you explore, then give fixed or not_fixed, what you saw, and evidence from this build. For not_fixed, also add a failed check that names the defect ID.                                                                                                                                                                                                                                                                   |
| `retests[].defect`         | string                           | yes      | The ID of the open earlier defect.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `retests[].verdict`        | fixed, not_fixed                 | yes      | fixed or not_fixed. For not_fixed, also add a failed check that names this ID in defect.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `retests[].observed`       | string                           | yes      | What you saw when you did the steps of the defect again.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `retests[].evidence`       | entry[]                          | yes      | One or more entries that show the result on this build.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `questions`                | object[]                         | no       | New open points for the PM. Do not ask a question again.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `questions[].id`           | string                           | yes      | A new question ID, for example Q1.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `questions[].question`     | string                           | yes      | One clear question for the PM.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `questions[].items`        | string[]                         | no       | The IDs of the items that the answer changes.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `changes`                  | object[]                         | no       | Changed areas that you found after the checklist, in the form of the checklist field changes.                                                                                                                                                                                                                                                                                                                                                                                               |
| `changes[].area`           | string                           | yes      | The part of the product that the diff or the ticket changes, in a few words, for example the loan limit check.                                                                                                                                                                                                                                                                                                                                                                              |
| `changes[].source`         | string                           | yes      | Where you saw the change: a file path, a diff hunk reference, or a ticket line.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `changes[].items`          | string[]                         | no       | The IDs of the items that cover this area. Leave out this field when no item covers it.                                                                                                                                                                                                                                                                                                                                                                                                     |

```json
{
	"checks": [
		{
			"item": "R1",
			"check": "Borrow a sixth book.",
			"result": "failed",
			"observed": "The loan is created.",
			"defect": "D1"
		},
		{
			"item": "R2",
			"check": "Return L1 3 days late. GET /api/loans/L1.",
			"value": "fee 1.50"
		}
	],
	"defects": [
		{
			"id": "D1",
			"title": "A sixth loan is accepted",
			"severity": "high",
			"steps": ["Borrow 5 books.", "Borrow one more."],
			"expected": "Refused (ticket.md, criterion 1).",
			"actual": "201 Created.",
			"evidence": [
				"evidence/d1.png",
				{
					"text": "POST /api/loans: 201"
				}
			]
		}
	]
}
```

<!-- end of lite payloads -->

## Metadata

`metadata` holds team fields, for example a priority, a component, labels, or a Jira or Xray key. It is optional on a requirement, a test, and a finding. Put team fields in `metadata`. Do not put them in a title or a check.

```json
{
	"id": "F1",
	"type": "defect",
	"severity": "high",
	"assertionIds": ["T2.A1"],
	"requirementIds": ["R2"],
	"title": "Promotion stacks with the loyalty discount",
	"expected": "totalPLN equals 240.",
	"observed": "GET /quote?promotion=true&loyalty=true returned totalPLN 220.",
	"reproduction": ["Request GET /quote?promotion=true&loyalty=true.", "Read totalPLN."],
	"evidenceIds": ["01M75A0ZVZC156GNSTPZ9G4MYX"],
	"metadata": {
		"jiraKey": "SHOP-142",
		"component": "pricing",
		"labels": "checkout,regression",
		"storyPoints": 3,
		"blocker": true
	}
}
```

A test in a candidate can carry its Xray key the same way: `"metadata": { "priority": "high", "component": "pricing", "xrayKey": "SHOP-T7" }`.

The planner marks a regression test with `"metadata": { "type": "regression" }`. A regression test checks that an existing rule near the change still holds, for example a validation limit, a permission, a counter, or an existing price. The rule and its expected values come from a source: a context source, the product documentation, or the project instructions. Each retest runs it again.

- `metadata` is an object with 0 to 20 keys.
- A key has 1 to 64 letters, digits, `_`, `.`, or `-`. It starts with a letter.
- A value is a string of 0 to 500 characters, a number, or a boolean. A list or an object is refused. Give a list as one string, for example `"checkout,regression"`.
- Checkmate copies `metadata` into the plan revision or the result. The stored JSON sorts the keys. Checkmate does not store an empty `metadata` object, so `{}` gives the same digest as no `metadata`. Only one rule reads `metadata`: a retest must select each ready test with `"type": "regression"`. Read [Run gate and policy](commands.md#run-gate-and-policy). `metadata` does not change readiness, outcomes, or coverage.
- The Markdown and HTML exports, `plan show --json`, `run show --json`, `finding list`, and the review UI show it. The JUnit export gives test metadata as `metadata.<key>` properties.

## Limits

The schemas refuse a payload that breaks one of these limits:

| Item                                                                        | Limit                                                                 |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| An ID                                                                       | 1 to 96 characters. Read [Identifiers](#identifiers).                 |
| A text field, for example a `title`, `check`, or `question`                 | 1 or more characters. An empty string is refused.                     |
| A test `title`                                                              | 200 characters or fewer                                               |
| An instance entry value                                                     | 2000 characters or fewer                                              |
| An instance `environment`                                                   | 500 characters or fewer                                               |
| An instance reference                                                       | 200 characters or fewer                                               |
| [`metadata`](#metadata)                                                     | 20 keys or fewer. A string value has 500 characters or fewer.         |
| Finding `assertionIds`, `requirementIds`, `reproduction`, and `evidenceIds` | 1 or more items. Record evidence with `run check` before the finding. |
| Test `requirementIds` and `operations`                                      | 1 or more items                                                       |
| Request `requirements`, when present                                        | 1 or more items                                                       |
| Profile `entryPoints`, `capabilities`, and `allowedOperations`              | 1 or more items                                                       |
| Profile `startup.command` and `reset.command`, when not `null`              | 1 or more items                                                       |

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
| `lite-checklist.schema.json` | `lite checklist`                  |
| `lite-record.schema.json`    | `lite record`                     |
| `gap.schema.json`            | `run gap`, and each gap in a plan |
| `result.schema.json`         | each stored result                |
| `response.schema.json`       | the output of a delegated worker  |

A payload with an unknown field, a missing field, or a wrong type is refused as `malformed` before any rule check. The reason names each field, and the hint names the schema, for example as follows. For a lite payload, the hint tells you to run `lite guide <planId>`.

```text
rejected run-1 refusal=malformed
reason: Refused: malformed request.
reason: Invalid finding: finding needs field "title", finding has unknown field "priority", finding/severity must be one of: low, medium, high, critical
hint: Fix each named field and send the finding again. The schema is contracts/finding.schema.json in the plugin.
```

## Next

- [Runs and evidence](runs.md): results, outcomes, and coverage.
- [Decide as the oracle](../guides/oracle.md): when to send an edit or a patch.
