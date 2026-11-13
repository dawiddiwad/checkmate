# Configuration and payloads

The JSON Schemas in `plugin/contracts/` are authoritative. `npm run generate` creates the TypeScript types and validators from them. The contract version is `toolkit-2`. There is no `toolkit-1` compatibility.

Commands take small values as flags. They take structured payloads as JSON on standard input, normally in a quoted heredoc (`<<'EOF'`). Each example below passes its schema and the rules of its command.

## Database

Checkmate keeps all state in one SQLite database: `<workspace>/.checkmate/checkmate.db`.

- The workspace is the current directory, or the value of `--workspace <path>`.
- Any command creates `.checkmate/` and the schema when they are missing. `checkmate init` only creates them.
- The database uses WAL mode. The CLI, a delegated worker, and the review UI can use it at the same time. One host writes to one database.
- Rows do not change after a write. Database triggers refuse `UPDATE` and `DELETE`. There are two exceptions: a decision records the revision that applied it, once, and `plan edit` changes a plan revision that has no approval and no run. The operation log records each edit.
- The schema version is 2. Checkmate refuses a database with another version. There is no migration from earlier databases or JSON files.
- Agents write only through commands. `checkmate query "<sql>"` opens the database read-only.

The database is the only record. Payloads and text evidence go in on standard input. Binary evidence, for example a screenshot, goes in `.checkmate/tmp/<runId>/` for a short time. Checkmate deletes each file after it stores the bytes. `run finish` removes `.checkmate/tmp/<runId>/` with its contents, and `target save` removes `.checkmate/tmp/setup-<targetId>/`. The skills point the output of Playwright CLI into these directories, so no `.playwright-cli/` directory stays in the workspace. Add `.checkmate/` to `.gitignore`. To keep a plan or a report in Git, export it with `checkmate export`.

## Identifiers and references

- A target ID, plan ID, run ID, test ID, gap ID, and requirement ID has 1 to 96 letters, digits, `_`, or `-`. It starts with a letter or a digit.
- A revision reference is `<id>@<revision>`, for example `checkout@2` or `checkout-local@1`.
- An assertion reference is `<testId>.<assertionId>`, for example `T2.A1`.
- A cross-plan test reference is `<planId>:<testId>`, for example `login:T3`. A test ID without a prefix is in the same plan.
- Each stored plan revision, profile, and result has a SHA-256 digest of its canonical JSON. A decision command can take `--expect-sha <digest>`. The command stops when the digest is different. A digest detects change. It does not authenticate the caller.

## Actor

Every write records an actor. Checkmate uses the first value that it finds:

1. `--actor <name>`
2. `CHECKMATE_ACTOR`
3. `git config user.name` in the workspace
4. The login name of the operating system user

Checkmate refuses a write when it finds no actor. `checkmate delegate` sets `CHECKMATE_ACTOR=claude:<stage>` for its worker. A skill in the same session records agent work as `claude:<stage>` when `CHECKMATE_ACTOR` is not set. The review UI fills in the same default. When the human changes the name, the UI keeps it in a cookie.

The actor is a record. It is not a proof of identity. Checkmate has no authentication or access control.

## Target profile

The setup request comes from flags:

```sh
checkmate target open checkout-local --base-url http://127.0.0.1:4173 \
  --capabilities browser,http --operations read_catalog,create_fixture_order,apply_fixture_discount \
  --tool "playwright-cli:cli:Drive the browser." --tool "jira:mcp:Read the acceptance criteria."
```

`--tool <name>:<kind>:<purpose>` requests a tool. Give it once for each tool. The kind is `cli` (a command on the `PATH`), `mcp` (an MCP server of the host), or `skill` (a Claude Code skill of the host).

The setup skill checks each tool and the target. Then it sends the profile to `checkmate target save checkout-local`:

```json
{
	"contractVersion": "toolkit-2",
	"targetId": "checkout-local",
	"revision": 1,
	"baseUrl": "http://127.0.0.1:4173",
	"environment": "local_fixture",
	"capabilities": ["browser", "http"],
	"tools": [
		{
			"name": "playwright-cli",
			"kind": "cli",
			"purpose": "Drive the browser.",
			"version": "0.1.23",
			"reachable": true
		},
		{ "name": "jira", "kind": "mcp", "purpose": "Read the acceptance criteria.", "reachable": true },
		{ "name": "node", "kind": "cli", "purpose": "Send HTTP requests.", "version": "v24.22.2", "reachable": true }
	],
	"authentication": { "kind": "none", "references": [] },
	"allowedOperations": ["read_catalog", "create_fixture_order", "apply_fixture_discount"],
	"startup": { "owner": "caller", "command": null },
	"cleanup": "Close the run browser session. The fixture stores no records.",
	"readyForLiveExecution": true,
	"approvals": { "plan": "required", "result": "required" }
}
```

Rules:

- `targetId`, `baseUrl`, `capabilities`, and `allowedOperations` must be equal to the setup request.
- `tools` has one entry for each requested tool, with the same name and kind. The setup skill can add default tools: `playwright-cli` for `browser` and `node` for `http`. `version` is optional. Record the actual version when you know it.
- `reachable` is the result of the setup check. `readyForLiveExecution` cannot be `true` when a requested tool is not reachable.
- A capability is a label for plan tests. It does not name a fixed tool.
- Checkmate records the tools. The host gives the permission to use them. Checkmate does not enforce permissions.
- `baseUrl` uses HTTP or HTTPS. It must not contain a user name or a password.
- `authentication.references` contains environment variable names or browser-state references. It never contains credential values. The host resolves them at runtime.
- The caller normally owns application startup. A startup command is guidance for an authorized host. Checkmate does not start it.
- `revision` is the latest revision plus 1. A save of the same revision with the same content changes nothing.
- When `readyForLiveExecution` is `false`, `target save` returns `needs_decision`, and the gate refuses every run.

### Approvals policy

`approvals` is optional. The default is `{ "plan": "required", "result": "required" }`.

| Field    | `required`                                                                                              | `none`                                                      |
| -------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `plan`   | `run gate` and `run begin` need an approval of the exact plan revision. A new revision needs a new one. | Execution needs no plan approval. The inbox omits the plan. |
| `result` | A cross-plan dependency needs an accepted result. The inbox lists the result until the caller decides.  | A passed result satisfies a dependency without acceptance.  |

Change the policy only with a new profile revision. A plan uses the profile revision that it names.

## Plan request

`checkmate plan open checkout --target checkout-local@1` records the request from standard input. The target revision must exist.

A request with requirements:

```json
{
	"objective": "Verify checkout totals and identify missing acceptance decisions.",
	"requirements": [
		{ "id": "R1", "text": "A standard order for one 400 PLN item has a total of 400 PLN.", "source": "brief#standard" },
		{
			"id": "R2",
			"text": "A 40 percent promotion applies to the order. The brief does not say if it stacks with the 20 PLN loyalty discount.",
			"source": "brief#promotion"
		}
	],
	"sourceContext": [
		{ "uri": "brief", "content": "The shop sells one item at 400 PLN. A loyal customer has a 20 PLN loyalty discount." }
	]
}
```

A request with sources only. The plan stage reads the sources with the plan tools and writes the requirements:

```json
{
	"objective": "Verify checkout totals.",
	"context": {
		"sources": ["jira:SHOP-12", "docs/checkout.md"],
		"instructions": "Use the acceptance criteria of SHOP-12. Use section 2 of the document."
	},
	"tools": ["playwright-cli", "jira", { "name": "confluence", "kind": "mcp", "purpose": "Read the pricing page." }]
}
```

| Field           | Required | Meaning                                                                                                    |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `objective`     | Yes      | The scope of the plan.                                                                                     |
| `requirements`  | No       | The requirements to cover. The plan stage does not add requirements.                                       |
| `sourceContext` | No       | Short source text that the caller copies into the request, as `{ "uri", "content" }`.                      |
| `context`       | No       | `sources`: where the requirements come from. `instructions`: how to read them.                             |
| `tools`         | No       | A string selects a tool of the target profile. An object `{ "name", "kind", "purpose" }` adds a plan tool. |

- A request needs `requirements` or one or more `context.sources`.
- Without requirements, the plan candidate must contain `requirements`. The `source` of each requirement starts with a context source, for example `jira:SHOP-12#ac-2`.
- With requirements, the candidate must not contain `requirements`.
- When `tools` names one or more profile tools, the plan keeps only those. Without names, the plan keeps all profile tools. A string must name a profile tool. An object must not use the name of a profile tool.
- `checkmate plan request <planId>` prints the request with the resolved tools.

`plan revise` does not change the requirements. `plan edit` can change them. Use a new plan for a different scope.

## Plan candidate

The plan skill writes a candidate and sends it to `checkmate plan save checkout`. Checkmate builds revision 1 from the request and the candidate.

```json
{
	"tests": [
		{
			"id": "T1",
			"title": "Standard order total",
			"requirementIds": ["R1"],
			"capability": "browser",
			"operations": ["create_fixture_order"],
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
			"operations": ["apply_fixture_discount"],
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
- `readiness`: `deferred` when an affecting gap is deferred, else `blocked` when an affecting gap is open and blocking, else `ready`.
- `coverage`: one row for each requirement, with the status `planned`, `blocked`, or `deferred`.

Rules:

- Each requirement has one or more tests or gaps.
- A ready test needs one or more assertions, a capability of the target, and allowed operations only.
- An assertion has a unique ID in its test, a non-empty `check`, and a `checkKind`. Use `deterministic` for an exact value. Use `agent_observation` when the agent interprets the evidence.
- Do not write an assertion with an unknown expected value. Write an open blocking gap. In the example, T2 has no assertions and is `blocked`.
- `dependsOn` names local tests or cross-plan tests (`login:T3`). The named plan and test must exist. Checkmate refuses a dependency cycle across all plans.
- Revision 1 has no decisions and no assumptions.

`plan save` returns `needs_decision` with one reason for each open blocking gap, for example `G1: Does the 40 percent promotion stack with the 20 PLN loyalty discount?`.

## Decisions

A decision and its implementation are separate steps. The caller decides. The agent implements.

```sh
checkmate gap answer checkout G1 --kind clarify --source decisions#promotion \
  --value "The promotion replaces the loyalty discount. The quote total is 240 PLN." \
  --rationale "Product owner decision."
```

| Kind                | Effect in the next revision                                                        | Needs                                |
| ------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| `clarify`           | The gap is `resolved`. The agent writes the assertions that the value makes known. | `--value`, `--rationale`, `--source` |
| `accept_assumption` | The gap is `resolved`. The value stays visible in `assumptions`.                   | `--value`, `--rationale`             |
| `defer`             | The gap is `deferred`. Affected tests are `deferred`. Coverage stays incomplete.   | `--value`, `--rationale`             |

The gap must be open in the latest revision. A gap can have one pending decision.

## Plan delta

The revise skill reads `checkmate plan pending checkout` and sends the delta to `checkmate plan revise checkout`. The delta contains only changes.

```json
{
	"tests": {
		"T2": {
			"preconditions": ["Cart with one 400 PLN item and 20 PLN loyalty."],
			"assertions": {
				"A1": { "check": "totalPLN equals 240.", "checkKind": "deterministic" },
				"A2": { "check": "The response status is HTTP 200.", "checkKind": "deterministic" }
			}
		}
	}
}
```

Checkmate builds the next revision from the latest revision, the pending decisions, and the delta:

1. It appends the pending decisions in recorded order. It sets the gap status and `decisionId`. It adds an assumption for each `accept_assumption`.
2. It applies the delta. A delta can change only `action`, `preconditions`, and `assertions` of tests that a pending decision affects.
3. In `assertions`, a known ID changes that assertion. A new ID adds an assertion and needs `check` and `checkKind`. `null` removes an assertion. An ID from an earlier revision cannot come back.
4. It calculates `gapIds`, readiness, and coverage again, and checks all plan rules.
5. It marks the decisions as applied.

`plan revise` needs one or more pending decisions. When every decision is `defer`, send `{ "tests": {} }`. A concurrent revise of the same plan fails. `checkmate plan diff checkout 1 2` shows the field changes and a JSON Patch.

## Plan edit

The caller can change the latest plan revision directly. Send a full candidate (`tests`, `gaps`, and optional `requirements`) to `checkmate plan edit <planId@rev>`. Without `requirements`, the revision keeps its requirements.

To start from the current revision, run `checkmate plan show <planId@rev> --json`. Copy `plan.requirements`, `plan.tests`, and `plan.gaps`. Remove `readiness` and `gapIds` from each test. Checkmate sets them. The `Edit as JSON` field of the review UI shows the same candidate.

| Revision state             | Effect                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| No approval and no run     | The revision changes in place. It gets a new digest. The operation log records the edit. |
| Approved, or used by a run | Checkmate saves the next revision. The approved or used revision does not change.        |

- `plan edit` names the latest revision. Add `--expect-sha <digest>` to stop the edit when the revision changed.
- A gap with a pending decision must stay open.
- An assertion ID that an earlier revision used cannot come back with a new meaning.
- Checkmate calculates `gapIds`, readiness, and coverage again, and checks all plan rules.
- The reply shows `edit=in_place` or `edit=new_revision`.

## Finding

During a run, the execute skill sends each finding to `checkmate run finding <runId>`:

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

`evidenceIds` are the IDs that `run check` printed. Read [Evidence](EVIDENCE.md#findings) for the rules.

## Runtime gap

When the agent finds new ambiguity during a run, it sends a gap to `checkmate run gap <runId>`:

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

A runtime gap is open, has no decision, and has an ID that is new in the plan and the run. Its requirements and tests must exist. A blocking runtime gap that names a requirement keeps that requirement uncovered in the result. A gap with two empty lists keeps every requirement uncovered. A runtime gap does not change the plan. The caller decides what to do next.

## Execution policy

`run begin` takes these flags. `run gate` takes the same flags except `--on-new-blocker` and `--timeout`. It checks the gate and records nothing.

| Flag               | Values                                      | Default               |
| ------------------ | ------------------------------------------- | --------------------- |
| `--tests`          | A non-empty list of test IDs.               | Required.             |
| `--build`          | The application build identity.             | Required.             |
| `--partial`        | `wait_for_resolution`, `ready_only`         | `wait_for_resolution` |
| `--on-new-blocker` | `return_to_caller`, `continue_independent`  | `return_to_caller`    |
| `--timeout`        | 1 to 3600 seconds.                          | 600                   |
| `--retest-of`      | A finished run of the same plan and target. | None.                 |

- `wait_for_resolution` refuses a run when the plan has an open blocking gap.
- `ready_only` permits a selection of ready tests. It does not make a blocked test ready.
- `--on-new-blocker` tells the execute stage what to do after it records a new blocking gap. `return_to_caller`: stop and close the remaining tests as `blocked`. `continue_independent`: continue the tests that the gap does not affect. Checkmate records the policy. The agent applies it.
- Include local prerequisite tests in the same selection. A cross-plan dependency needs the latest finalized result for the same build to show `passed`. When result acceptance is required, the result must also be accepted.
- A retest needs a new run ID and a new build. The prior run does not change.

## Environment variables

| Variable          | Owner     | Effect                                                                                              |
| ----------------- | --------- | --------------------------------------------------------------------------------------------------- |
| `CHECKMATE_ACTOR` | Checkmate | The default actor for writes. `--actor` overrides it. Without it, Checkmate uses the git user name. |
| `ANTHROPIC_MODEL` | Host      | Claude Code selects the model with it. Checkmate does not read it. `delegate` passes it unchanged.  |

The live tests read more variables. Read [Development](DEVELOPMENT.md).

## Checkmate and the host

| Checkmate owns                                                  | The host (Claude Code) owns                |
| --------------------------------------------------------------- | ------------------------------------------ |
| The contracts and the rule checks                               | The agent loop, model, and context         |
| The record of target and plan tools                             | Tool installation and tool access          |
| The database, digests, and the operation log                    | Authentication                             |
| The gates: approval, readiness, prerequisites, and dependencies | Tools and tool permissions                 |
| Outcome derivation, coverage, and exports                       | The `--allow` rules that the caller gives  |
| The review UI on `127.0.0.1`                                    | The browser sessions and the target access |

The caller owns the scope, the decisions, application startup and fixes, evidence retention, and release decisions. Target content cannot authorize a change to the request or the plan. The rule checks are not a sandbox.
