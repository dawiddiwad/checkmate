# toolkit-2 implementation notes

This file is the shared contract for the implementation of `docs/design/sqlite-store.md`.
Read the design first. This file fixes the details that the design leaves open.
When this file and the design differ, this file wins.

## Layout

```text
plugin/src/store.ts      open, schema DDL, triggers, transactions, operation log, canonical JSON, digest, ulid
plugin/src/contracts.ts  validate() over generated validators, plan rules, readiness, coverage, gapsAffecting
plugin/src/targets.ts    target open/save/show
plugin/src/plans.ts      plan open/request/save/show/list/diff/pending/revise, gap answer, plan approve/reject, gate
plugin/src/runs.ts       run begin/check/close/finding/gap/finish/resume/show/list, result accept/reject, evidence
plugin/src/views.ts      read models shared by CLI output and the UI: inbox, plan list, run list, log
plugin/src/render.ts     export of plan and run as Markdown, HTML, JSON
plugin/src/cli.ts        argument parsing, command table, compact and JSON output, exit codes
plugin/src/index.ts      public exports for cli/
plugin/bin/checkmate.ts  development entry: imports cli.ts main
plugin/dist/checkmate.js generated bundle (esbuild) of plugin/bin/checkmate.ts. Committed. Skills run it.
cli/                     npm package @xoxoai/checkmate: delegate and every core command
```

Remove `plugin/src/files.ts`, `plugin/src/stages.ts`, `plugin/src/launcher.ts` (moves to `cli/src/launcher.ts`), and the
toolkit-1 schemas that no longer apply. Remove JSON-file code paths completely. No compatibility code.

## Coding rules

Follow `AGENTS.md` and `.agents/wiki/coding-standards.md`: no comments unless a rule is not obvious, no semicolons,
tabs, single quotes, small explicit functions, no abstractions without need. Prettier config is in `.prettierrc.json`.
TypeScript runs with Node.js type stripping: use `import type`, no enums, no parameter properties, no namespaces.
Use `node:sqlite` `DatabaseSync` only. No new runtime dependencies in `plugin/`.

## Database

- Path: `<workspace>/.checkmate/checkmate.db`. Any command creates the directory and the schema when missing.
- On open: `PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000`, `PRAGMA foreign_keys = ON`.
- `meta`: `contractVersion = toolkit-2`, `schemaVersion = 1`. Refuse a database with another schemaVersion.
- Tables as in the design, plus:
  - `target_requests (target_id TEXT PRIMARY KEY, body TEXT NOT NULL, operation_id ...)`: the setup request.
  - `operations` has `subjects TEXT NOT NULL` (JSON array).
  - Every `operation_id` column is `REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED`, because the operation row
    is inserted last in the transaction, when the response is known.
- Immutability triggers: `BEFORE UPDATE` and `BEFORE DELETE` raise on every table. The one exception is
  `decisions.applied_revision`: an update is allowed only when the old value is NULL and only that column changes.
- `blobs` insert is `INSERT OR IGNORE`.
- Write transaction: `BEGIN IMMEDIATE`, run the command, insert the operation row with status and response, `COMMIT`.
  On error: `ROLLBACK`, then insert a `rejected` operation row (with the error reason as response) in its own
  transaction, then throw.
- Live-update cursor: the UI uses the implicit `rowid` of `operations`, not the ULID. ULIDs from two processes in the
  same millisecond can sort out of commit order. `rowid` is commit order for one writer at a time.
- Read-only connection for `query`: `new DatabaseSync(path, { readOnly: true })`.

### Canonical JSON and digests

`canonical(value)`: JSON with object keys sorted recursively, no whitespace. `digest(text)`: SHA-256 hex.
Every `body` column holds canonical JSON. Every `sha256` column of a snapshot is `digest(body)`.

### ULID

Crockford base32, 48-bit millisecond time and 80 random bits, monotonic in one process (increase the random part when
the time does not change).

## Subjects

Strings in `operations.subjects`:
`target:<targetId>`, `plan:<planId>`, `run:<runId>`, `inbox`. A command lists every subject it changed. Any write that
can change what waits for a human (gaps, plan revisions, approvals, finished runs, acceptances) also lists `inbox`.

## Actor

Every write needs an actor: `--actor <name>`, else `CHECKMATE_ACTOR`. A write without an actor is refused.

## Contracts (JSON Schema, draft-07, `plugin/contracts/`)

`contractVersion` is `toolkit-2` everywhere. Identifier pattern `^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$` (ID).
Test reference pattern `^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$` (local or `plan:test`).

| Schema                    | Used by                       | Shape                                                                                                       |
| ------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `profile.schema.json`     | `target save` stdin, snapshot | toolkit-1 profile plus `approvals: { plan: required|none, result: required|none }` (optional, default both required) |
| `plan-request.schema.json`| `plan open` stdin             | `{ objective, requirements?, sourceContext?, context?: {sources, instructions?}, tools? }`                  |
| `plan-candidate.schema.json` | `plan save` stdin          | `{ tests: [test without readiness and gapIds], gaps: [gap] }`                                               |
| `plan-delta.schema.json`  | `plan revise` stdin           | `{ tests: { <testId>: { action?, preconditions?, assertions?: { <assertionId>: {check?, oracleKind?} | null } } } }` |
| `plan.schema.json`        | snapshot                      | see below                                                                                                    |
| `finding.schema.json`     | `run finding` stdin           | `{ id, type: defect|potential_issue, severity, assertionIds: ["T2.A2"], requirementIds, title, expected, observed, reproduction, evidenceIds }` |
| `gap.schema.json`         | `run gap` stdin, inside plan  | toolkit-1 gap (`testIds` items use the test reference pattern)                                               |
| `result.schema.json`      | snapshot                      | see below                                                                                                    |
| `response.schema.json`    | delegated worker output       | `{ status: completed|needs_decision|interrupted|operational_error|rejected, subject, reasons: [string] }`    |

Plan snapshot:

```json
{
	"contractVersion": "toolkit-2",
	"planId": "checkout",
	"revision": 2,
	"previousRevision": 1,
	"target": { "targetId": "checkout-local", "revision": 1, "sha256": "…" },
	"objective": "…",
	"requirements": [{ "id": "R1", "text": "…", "source": "…" }],
	"tests": [
		{
			"id": "T1",
			"title": "Standard order total",
			"requirementIds": ["R1"],
			"capability": "browser",
			"operations": ["create_fixture_order"],
			"readiness": "ready",
			"gapIds": [],
			"dependsOn": [],
			"preconditions": [],
			"action": "…",
			"assertions": [{ "id": "A1", "check": "…", "oracleKind": "deterministic" }]
		}
	],
	"gaps": [{ "id": "G1", "severity": "blocking", "status": "resolved", "requirementIds": ["R2"], "testIds": [], "question": "…", "consequence": "…", "decisionId": "01J…" }],
	"assumptions": [{ "decisionId": "01J…", "text": "…" }],
	"decisions": [{ "id": "01J…", "gapId": "G1", "kind": "clarify", "actor": "…", "rationale": "…", "value": "…", "source": "…" }],
	"coverage": [{ "requirementId": "R1", "testIds": ["T1"], "status": "planned" }]
}
```

- `title` is a required short test name (UI and reports use it).
- A test lists its affecting local gaps in `gapIds`; Checkmate sets `gapIds` and `readiness` (the candidate omits both).
- `assertions` has `minItems: 0` in the schema; the rule "a ready test needs one or more assertions" is in code.
- `dependsOn` items use the test reference pattern.

Result snapshot:

```json
{
	"contractVersion": "toolkit-2",
	"runId": "run-7",
	"plan": { "planId": "checkout", "revision": 2, "sha256": "…" },
	"target": { "targetId": "checkout-local", "revision": 1, "sha256": "…" },
	"applicationBuild": "fixture-build-2",
	"selectedTestIds": ["T1", "T2"],
	"retestOf": null,
	"startedAt": "…",
	"finishedAt": "…",
	"attempts": 1,
	"completion": "completed",
	"tests": [
		{
			"testId": "T2",
			"outcome": "failed",
			"reason": null,
			"assertions": [
				{ "assertionId": "A1", "check": "…", "oracleKind": "deterministic", "result": "passed", "observed": "…", "reason": null, "evidenceIds": ["01J…"] }
			]
		}
	],
	"findings": [ "finding with derived testIds" ],
	"newGaps": [],
	"evidence": [{ "id": "01J…", "testId": "T2", "assertionId": "A1", "kind": "http_exchange", "name": "quote.json", "mediaType": "application/json", "sha256": "…", "size": 123 }],
	"cleanup": { "status": "completed", "reason": "…" },
	"coverage": { "status": "partial", "requirements": [{ "requirementId": "R1", "status": "tested", "testIds": ["T1"], "reason": null }] }
}
```

`npm run generate` creates `plugin/src/types.ts` and `plugin/src/validators.js` from the schemas. Update both generator
scripts for the new schema list.

## Commands

All commands accept `--workspace <path>`, `--json`. Writes accept `--actor <name>`. Stdin payloads are JSON.
Exit code 0 for `completed` and `needs_decision`, 1 for everything else.

Compact output: line 1 is `<status> <subject>` plus short `key=value` facts. Then one line per item, ID first,
tab-separated. Then `reason: <text>` lines. `--json` prints `{ "status", "subject", "reasons": [], ...data }`.
Errors print `rejected <subject>` and `reason: <message>` (or JSON) and exit 1. Unknown command or bad flags:
`invalid_request` and exit 1.

| Command | Behavior |
| --- | --- |
| `init` | Create the database. Print `completed .checkmate/checkmate.db`. |
| `target open <targetId> --base-url <url> --capabilities a,b --operations x,y` | Record the setup request. Refuse a second open with different values. Identical open is a no-op `completed`. |
| `target request <targetId>` | Print the setup request. |
| `target save <targetId> < profile.json` | Check the profile (toolkit-1 profile rules, plus: targetId, baseUrl, capabilities, allowedOperations equal the request). Revision must be latest+1, or equal to the latest with identical content (idempotent). Status `completed` when `readyForLiveExecution`, else `needs_decision` with reasons. |
| `target show <targetId[@rev]>` | Print the profile summary. `--json` prints the profile. |
| `plan open <planId> --target <targetId@rev> < request.json` | Record the plan request. The target revision must exist. |
| `plan request <planId>` | Print objective, requirements, source context, and the target capabilities and allowed operations. |
| `plan save <planId> < candidate.json` | Build revision 1 from request + candidate. Set gapIds, readiness, coverage. Check rules. Refuse when revision 1 exists. Status `needs_decision` with one reason per open blocking gap (`G1: <question>`), else `completed`. |
| `plan show <planId[@rev]> [--tests T1,T2] [--fields f1,f2] [--gaps open|all]` | Default latest revision. Lines: requirements, tests (`T1  ready  browser  <title>`), with `--fields assertions` one line per assertion (`T1.A1  deterministic  <check>`), gaps, decisions, approval state. |
| `plan list [--needs-decision] [--awaiting-approval] [--blocked]` | One line per plan: id@rev, open blocking gaps, approval, blocked cross-plan tests. |
| `plan diff <planId> <a> <b>` | JSON Patch (RFC 6902) from rev a to rev b, plus field lines (`T2.A2 check: "x" → "y"`). |
| `gap answer <planId> <gapId> --kind clarify|accept_assumption|defer --value <text> [--source <uri>] --rationale <text>` | Decision against the latest revision. Gap must be open there. Clarify needs a source. One pending decision per gap. |
| `plan pending <planId>` | Pending decisions, and only the affected tests (with assertions) and gaps. |
| `plan revise <planId> < delta.json` | Build latest+1: append pending decisions in recorded order, set gap status (`clarify`/`accept_assumption` → resolved, `defer` → deferred) and decisionId, add assumptions for `accept_assumption`, apply the delta to affected tests only, recalculate gapIds/readiness/coverage, check rules, mark decisions applied. Needs at least one pending decision. |
| `plan approve <planId@rev> --rationale <text>` / `plan reject …` | Approval row with the revision digest. Accept `--expect-sha`. |
| `run gate <planId@rev> --tests T1,T2 --build <b> [--partial wait_for_resolution|ready_only] [--retest-of <runId>]` | Gate without side effects. `completed` or `needs_decision` with reasons. |
| `run begin <runId> <planId@rev> --tests T1,T2 --build <b> [--partial …] [--on-new-blocker return_to_caller|continue_independent] [--timeout <s>] [--retest-of <runId>]` | Gate, then insert run and attempt 1. Print `startedAt`, `browserSession`, `deadlineSeconds`. Defaults: partial `wait_for_resolution`, on-new-blocker `return_to_caller`, timeout 600. |
| `run check <runId> <testId> <assertionId> --result passed|failed|inconclusive|not_checked [--observed <text>] [--reason <text>] [--evidence -[:kind]] [--evidence <path>[:kind]]…` | Rules in design section 7 and 9. `-` reads one text from stdin. Evidence paths are relative to the workspace and must be inside `.checkmate/tmp/<runId>/`. Kind defaults from extension: `.png/.jpg/.jpeg/.webp` screenshot, `.json` http_exchange, `.zip/.trace` trace, else observation. Max 32 MiB each. Delete the file after the commit. |
| `run close <runId> <testId> [--outcome blocked|not_run|error --reason <text>]` | Derive outcome, or record the given one. Print the outcome. |
| `run finding <runId> < finding.json` | Check and store. A defect names only failed assertions. Evidence IDs belong to the named assertions or their tests. |
| `run gap <runId> < gap.json` | New, open, unknown ID, references exist in the plan. |
| `run finish <runId> --completion completed|interrupted|operational_error --cleanup completed|failed|not_applicable --cleanup-reason <text>` | Rules in design section 10. For interrupted/operational_error, unclosed selected tests are stored as `error` with reason `Run stopped before the test closed. Actions may have occurred.` |
| `run resume <runId> [--error T3,T4 --reason <text>]` | New attempt. List unclosed tests and their assertions without results. |
| `run show <runId> [--tests …]` / `run list [--plan <id>] [--build <b>]` | Read. |
| `result accept <runId> --rationale <text>` / `result reject …` | Approval row with the result digest. |
| `evidence get <evidenceId> --out <path>` | Write the bytes. |
| `export plan <planId@rev>|run <runId> --format md|html|json [--out <path>]` | Render to stdout, or to a new file. |
| `log [--subject <s>] [--limit <n>]` | Operation log, newest first. Default limit 50. |
| `query "<sql>"` | Read-only connection. Rows as TSV with a header, or JSON. |

## Gate rules

In order, collect every reason (do not stop at the first):

1. Target profile of the plan has `readyForLiveExecution`.
2. Plan approval policy `required`: the latest approval row for `plan:<planId>@<rev>` is `approved` and its digest is
   the revision digest. Reason: `Plan checkout@2 is not approved`.
3. `wait_for_resolution`: each open blocking gap → `Open blocking gap: G1`.
4. Each selected test: exists; readiness `ready`; capability and operations in the profile; one or more assertions;
   local `dependsOn` selected (`Missing prerequisite: T1`).
5. Cross-plan `dependsOn` (`login:T3`): see design section 8. Reason text:
   `Blocked by login:T3: <cause>` where cause is `no finalized result for build <b>`, `latest result run-4 shows failed`,
   `result run-4 is not accepted`, or `open blocking gap G2 in login`.
6. Retest: previous run finalized, same planId and target, different run ID and build.

`run begin` refuses a run ID that exists.

## Views for the UI (`plugin/src/views.ts`)

Export plain functions over a `Store`. The UI and the CLI use the same functions.

- `inbox(store)`: `{ gaps: [{planId, revision, gapId, question, severity, since}], plans: [{planId, revision, sha256, since, summary}], results: [{runId, planId, revision, build, counts, coverage, sha256, since}] }`.
  Gaps: open gaps of latest revisions without a pending decision. Plans: latest revisions with approval policy
  required and no approval row. Results: finalized runs with result policy required and no approval row.
- `planList(store)`, `planDetail(store, planId, revision?)`, `planHistory(store, planId)` (revisions with operation,
  actor, time, field changes against the previous revision), `runList(store, filters)`, `runDetail(store, runId)`
  (works for started runs: shows recorded assertion results and closed tests), `operationLog(store, {subject, limit, after})`,
  `changesAfter(store, rowid)` → `[{rowid, id, subjects}]`, `evidenceBytes(store, id)`.
- Write functions used by the UI: `answerGap`, `approvePlan`, `rejectPlan`, `acceptResult`, `rejectResult`. Each takes
  `(store, actor, input)` and accepts `expectSha256`.

## Tests

`node --test test/*.test.ts` must stay fast (no network, no browser, no Claude). Use temporary workspaces.
Cover the cases listed in design section 16. Remove toolkit-1 tests and fixtures that no longer apply. Keep
`test/fixture.ts` (the checkout fixture server) and adapt `test/live.ts` later.
