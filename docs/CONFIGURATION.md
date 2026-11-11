# Configuration and payloads

The JSON Schemas in `plugin/contracts/` are authoritative. `npm run generate` creates the TypeScript types and validators from them. The contract version is `toolkit-2`. There is no `toolkit-1` compatibility.

Commands take small values as flags. They take structured payloads as JSON on standard input. Each example below passes its schema and the rules of its command.

## Database

Checkmate keeps all state in one SQLite database: `<workspace>/.checkmate/checkmate.db`.

- The workspace is the current directory, or the value of `--workspace <path>`.
- Any command creates `.checkmate/` and the schema when they are missing. `checkmate init` only creates them.
- The database uses WAL mode. The CLI, a delegated worker, and the review UI can use it at the same time. One host writes to one database.
- Rows do not change after a write. Database triggers refuse `UPDATE` and `DELETE`. The one exception: a decision records the revision that applied it, once.
- Checkmate refuses a database with a different schema version. There is no migration from JSON files.
- Agents write only through commands. `checkmate query "<sql>"` opens the database read-only.

Checkmate also uses `.checkmate/tmp/` for payload files and for evidence before it is stored. Add `.checkmate/` to `.gitignore`. The database contains evidence bytes. To keep a plan or a report in Git, export it with `checkmate export`.

## Identifiers and references

- A target ID, plan ID, run ID, test ID, gap ID, and requirement ID has 1 to 96 letters, digits, `_`, or `-`. It starts with a letter or a digit.
- A revision reference is `<id>@<revision>`, for example `checkout@2` or `checkout-local@1`.
- An assertion reference is `<testId>.<assertionId>`, for example `T2.A1`.
- A cross-plan test reference is `<planId>:<testId>`, for example `login:T3`. A test ID without a prefix is in the same plan.
- Each stored plan revision, profile, and result has a SHA-256 digest of its canonical JSON. A decision command can take `--expect-sha <digest>`. The command stops when the digest is different. A digest detects change. It does not authenticate the caller.

## Actor

Every write records an actor. Give `--actor <name>`, or set `CHECKMATE_ACTOR`. Checkmate refuses a write without an actor.

`checkmate delegate` sets `CHECKMATE_ACTOR=claude:<stage>` for its worker. The review UI asks for a name once and keeps it in a cookie.

The actor is a record. It is not a proof of identity. Checkmate has no authentication or access control.

## Target profile

The setup request comes from flags:

```sh
checkmate target open checkout-local --base-url http://127.0.0.1:4173 \
  --capabilities browser,http --operations read_catalog,create_fixture_order,apply_fixture_discount
```

The setup skill checks the tools and the target. Then it runs `checkmate target save checkout-local < profile.json`:

```json
{
	"contractVersion": "toolkit-2",
	"targetId": "checkout-local",
	"revision": 1,
	"baseUrl": "http://127.0.0.1:4173",
	"environment": "local_fixture",
	"capabilities": ["browser", "http"],
	"tooling": [
		{ "capability": "browser", "executable": "playwright-cli", "version": "0.1.23" },
		{ "capability": "http", "executable": "node", "version": "v24.22.2" }
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
- `tooling` has one entry for each capability. Record the actual version. The `browser` capability uses Playwright CLI. The `http` capability can use Node.js fetch.
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
| `result` | A cross-plan dependency needs an accepted result. The inbox lists the result until a human decides.     | A passed result satisfies a dependency without acceptance.  |

Change the policy only with a new profile revision. A plan uses the profile revision that it names.

## Plan request

`checkmate plan open checkout --target checkout-local@1 < plan-request.json` records the request. The target revision must exist.

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

Requirements and sources do not change in later revisions. Use a new plan for a different scope.

## Plan candidate

The plan skill writes a candidate and runs `checkmate plan save checkout < candidate.json`. Checkmate builds revision 1 from the request and the candidate.

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
			"assertions": [{ "id": "A1", "check": "The order total is 400 PLN.", "oracleKind": "deterministic" }]
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
- An assertion has a unique ID in its test, a non-empty `check`, and an `oracleKind`. Use `deterministic` for an exact value. Use `agent_observation` when the agent interprets the evidence.
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

The revise skill reads `checkmate plan pending checkout` and runs `checkmate plan revise checkout < delta.json`. The delta contains only changes.

```json
{
	"tests": {
		"T2": {
			"preconditions": ["Cart with one 400 PLN item and 20 PLN loyalty."],
			"assertions": {
				"A1": { "check": "totalPLN equals 240.", "oracleKind": "deterministic" },
				"A2": { "check": "The response status is HTTP 200.", "oracleKind": "deterministic" }
			}
		}
	}
}
```

Checkmate builds the next revision from the latest revision, the pending decisions, and the delta:

1. It appends the pending decisions in recorded order. It sets the gap status and `decisionId`. It adds an assumption for each `accept_assumption`.
2. It applies the delta. A delta can change only `action`, `preconditions`, and `assertions` of tests that a pending decision affects.
3. In `assertions`, a known ID changes that assertion. A new ID adds an assertion and needs `check` and `oracleKind`. `null` removes an assertion. An ID from an earlier revision cannot come back.
4. It calculates `gapIds`, readiness, and coverage again, and checks all plan rules.
5. It marks the decisions as applied.

`plan revise` needs one or more pending decisions. When every decision is `defer`, send `{ "tests": {} }`. A concurrent revise of the same plan fails. `checkmate plan diff checkout 1 2` shows the field changes and a JSON Patch.

## Finding

During a run, the execute skill records each finding with `checkmate run finding <runId> < finding.json`:

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

When the agent finds new ambiguity during a run, it records a gap with `checkmate run gap <runId> < gap.json`:

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

`run gate` and `run begin` take these flags:

| Flag               | Values                                      | Default               |
| ------------------ | ------------------------------------------- | --------------------- |
| `--tests`          | A non-empty list of test IDs.               | Required.             |
| `--build`          | The application build identity.             | Required.             |
| `--partial`        | `wait_for_resolution`, `ready_only`         | `wait_for_resolution` |
| `--on-new-blocker` | `return_to_caller`, `continue_independent`  | `return_to_caller`    |
| `--timeout`        | 1 to 3600 seconds (`run begin` only).       | 600                   |
| `--retest-of`      | A finished run of the same plan and target. | None.                 |

- `wait_for_resolution` refuses a run when the plan has an open blocking gap.
- `ready_only` permits a selection of ready tests. It does not make a blocked test ready.
- Include local prerequisite tests in the same selection. A cross-plan dependency needs the latest finalized result for the same build to show `passed`. When result acceptance is required, the result must also be accepted.
- A retest needs a new run ID and a new build. The prior run does not change.

## Environment variables

| Variable          | Owner     | Effect                                                                                             |
| ----------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `CHECKMATE_ACTOR` | Checkmate | The default actor for writes. `--actor` overrides it.                                              |
| `ANTHROPIC_MODEL` | Host      | Claude Code selects the model with it. Checkmate does not read it. `delegate` passes it unchanged. |

The live tests read more variables. Read [Development](DEVELOPMENT.md).

## Checkmate and the host

| Checkmate owns                                                  | The host (Claude Code) owns                |
| --------------------------------------------------------------- | ------------------------------------------ |
| The contracts and the rule checks                               | The agent loop, model, and context         |
| The database, digests, and the operation log                    | Authentication                             |
| The gates: approval, readiness, prerequisites, and dependencies | Tools and tool permissions                 |
| Outcome derivation, coverage, and exports                       | The `--allow` rules that the caller gives  |
| The review UI on `127.0.0.1`                                    | The browser sessions and the target access |

The caller owns the scope, the decisions, application startup and fixes, evidence retention, and release decisions. Target content cannot authorize a change to the request or the plan. Checkmate checks are not a sandbox.
