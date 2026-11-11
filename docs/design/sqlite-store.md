# Design: SQLite store and npm CLI

Status: draft for review. Contract version: `toolkit-2`. All open questions of the first draft are resolved in section 3.

## 1. Goals

- Replace the JSON files with one SQLite database.
- Keep plans, decisions, approvals, runs, outcomes, evidence, and the operation log in the database.
- Make runs resumable. Record each assertion result when the agent checks it.
- Give each test an explicit list of assertions. One failed assertion fails the test.
- Reduce tokens. Agents read only the fields they need and write only the changes.
- Support hundreds of plans. Plans can depend on other plans and can block other plans.
- Let a caller approve plans and accept results in a local UI that is simple, elegant, and easy to use.
- Ship a self-contained Claude Code plugin and a separate npm CLI that starts Claude Code with that plugin.

## 2. Non-goals

- No branches or merges of plans.
- No shared database for many hosts. One host writes to one database.
- No `toolkit-1` compatibility and no importer.
- No authentication or access control. The `actor` field is a record. It is not a proof of identity.
- No proof that an observation is true. Checkmate validates structure and relationships only.

## 3. Decisions

| Topic                 | Decision                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location              | `.checkmate/checkmate.db` in the caller's workspace. One host writes to it.                                                                                      |
| Caller gate           | A caller approves a plan revision before execution and accepts a result after execution.                                                                         |
| Agent access          | Agents write only through CLI commands. Agents can read through `checkmate query` (read-only).                                                                   |
| Cross-plan dependency | A dependency names a plan and a test. It does not pin a revision.                                                                                                |
| Dependency rule       | The latest finalized result for the same application build must show `passed`.                                                                                   |
| Evidence              | Evidence bytes are BLOBs in the database. Each blob is content-addressed by SHA-256.                                                                             |
| Audit                 | Each command records one operation row with the actor, the arguments, and the response.                                                                          |
| Views                 | Markdown and HTML are on-demand exports. The UI reads the database directly.                                                                                     |
| Interface             | CLI flags for small writes. JSON on stdin for structured payloads. Compact output.                                                                               |
| Assertions            | Each test has a list of assertions. A test passes only when all assertions pass. One failed assertion fails the test.                                            |
| Inconclusive          | An assertion is `inconclusive` when the evidence cannot show whether it is met. A test with an inconclusive assertion and no failed assertion is `inconclusive`. |
| Approval default      | The profile requires plan approval and result acceptance by default.                                                                                             |
| Evidence size         | The limit is 32 MiB for one evidence file.                                                                                                                       |
| Resume                | `run resume` can record stalled tests as `error` in one step.                                                                                                    |
| Package name          | The npm package is `@xoxoai/checkmate`.                                                                                                                          |
| Merge                 | Not built now. The schema keeps a later merge possible (section 14).                                                                                             |

## 4. Package layout

```text
plugin/                Claude Code plugin. Self-contained. No npm dependencies.
  skills/              setup, plan, revise, execute, report, ui
  contracts/           JSON Schemas for toolkit-2 payloads
  src/                 core: store, rules, commands
  dist/checkmate.js    one bundled file, generated at release
cli/                   npm package @xoxoai/checkmate
  src/                 launcher (delegate), ui, entry point
  plugin/              exact copy of plugin/ at the same version, copied at pack time
```

The plugin contains the complete core. A plugin user can do every stage inside Claude Code without the npm package. The skills run `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`.

The npm CLI adds `delegate`. The plugin also includes `ui`, local assets, and fonts. It also exposes every core command. `delegate` starts `claude -p --plugin-dir <cli>/plugin`, so the CLI and plugin versions are always the same.

Node.js does not strip TypeScript types for files in `node_modules`. A `.ts` entry point fails in an npm install. For this reason, the release builds one JavaScript bundle with esbuild. The bundle has no runtime dependencies. Source stays in TypeScript. Plugin users do not build anything.

Both paths need Node.js 24.12.0 or later for `node:sqlite`. The host still owns the model, authentication, tools, and permissions. `delegate` passes `--allow` rules through as it does today.

## 5. Identifiers and references

- `planId`, `targetId`, `runId`, test IDs, gap IDs, and requirement IDs are caller-readable names, as today.
- Internal rows that the caller does not name (operations, decisions, approvals, evidence) use ULIDs. They do not use autoincrement integers. This keeps a later merge possible.
- A reference is `<id>@<revision>`, for example `checkout@2` or `checkout-local@1`.
- A cross-plan test reference is `<planId>:<testId>`, for example `login:T3`. A test ID without a prefix refers to the same plan.
- Each stored snapshot has a SHA-256 digest of its canonical JSON (sorted keys, no whitespace). A command can take `--expect-sha <digest>`. The command stops if the digest differs.

## 6. Schema

All tables use `STRICT`. Foreign keys are on. The database uses WAL mode and `busy_timeout = 5000`, so the CLI and a delegated worker can use it at the same time. Each write command uses one `BEGIN IMMEDIATE` transaction.

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
-- contractVersion = toolkit-2, schemaVersion = 1

CREATE TABLE operations (
  id TEXT PRIMARY KEY,            -- ULID
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  command TEXT NOT NULL,
  arguments TEXT NOT NULL,        -- JSON: flags and stdin payload
  status TEXT NOT NULL,           -- completed | needs_decision | rejected | error
  response TEXT NOT NULL,         -- JSON
  subjects TEXT NOT NULL          -- JSON array of changed subjects, for example ["plan:checkout", "run:run-7", "inbox"]
) STRICT;

CREATE TABLE blobs (
  sha256 TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  bytes BLOB NOT NULL
) STRICT;

CREATE TABLE profiles (
  target_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  body TEXT NOT NULL,             -- canonical JSON of the profile
  operation_id TEXT NOT NULL REFERENCES operations(id),
  PRIMARY KEY (target_id, revision)
) STRICT;

CREATE TABLE plan_requests (
  plan_id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  target_revision INTEGER NOT NULL,
  body TEXT NOT NULL,             -- objective, requirements, source context
  operation_id TEXT NOT NULL REFERENCES operations(id),
  FOREIGN KEY (target_id, target_revision) REFERENCES profiles(target_id, revision)
) STRICT;

CREATE TABLE plan_revisions (
  plan_id TEXT NOT NULL REFERENCES plan_requests(plan_id),
  revision INTEGER NOT NULL,
  previous_revision INTEGER,
  sha256 TEXT NOT NULL,
  body TEXT NOT NULL,             -- canonical JSON of the complete plan
  operation_id TEXT NOT NULL REFERENCES operations(id),
  PRIMARY KEY (plan_id, revision),
  CHECK ((revision = 1 AND previous_revision IS NULL) OR previous_revision = revision - 1)
) STRICT;

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,            -- ULID
  plan_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  gap_id TEXT NOT NULL,
  kind TEXT NOT NULL,             -- clarify | accept_assumption | defer
  value TEXT NOT NULL,
  source TEXT,
  rationale TEXT NOT NULL,
  actor TEXT NOT NULL,
  applied_revision INTEGER,       -- set once, when a revision applies it
  operation_id TEXT NOT NULL REFERENCES operations(id),
  FOREIGN KEY (plan_id, base_revision) REFERENCES plan_revisions(plan_id, revision),
  UNIQUE (plan_id, base_revision, gap_id)
) STRICT;

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,            -- ULID
  subject_kind TEXT NOT NULL,     -- plan | result
  subject_id TEXT NOT NULL,       -- checkout@2 or run-7
  subject_sha256 TEXT NOT NULL,
  verdict TEXT NOT NULL,          -- approved | rejected
  rationale TEXT NOT NULL,
  actor TEXT NOT NULL,
  operation_id TEXT NOT NULL REFERENCES operations(id)
) STRICT;

CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL,
  plan_sha256 TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_revision INTEGER NOT NULL,
  application_build TEXT NOT NULL,
  request TEXT NOT NULL,          -- JSON: selection and execution policy
  started_at TEXT NOT NULL,
  browser_session TEXT NOT NULL,
  deadline_seconds INTEGER NOT NULL,
  operation_id TEXT NOT NULL REFERENCES operations(id),
  FOREIGN KEY (plan_id, plan_revision) REFERENCES plan_revisions(plan_id, revision)
) STRICT;

CREATE TABLE run_attempts (
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  attempt INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  PRIMARY KEY (run_id, attempt)
) STRICT;

CREATE TABLE assertion_results (
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  test_id TEXT NOT NULL,
  assertion_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  result TEXT NOT NULL,           -- passed | failed | inconclusive | not_checked
  observed TEXT,                  -- required for passed, failed, and inconclusive
  reason TEXT,                    -- required for inconclusive and not_checked
  recorded_at TEXT NOT NULL,
  operation_id TEXT NOT NULL REFERENCES operations(id),
  PRIMARY KEY (run_id, test_id, assertion_id)
) STRICT;

CREATE TABLE outcomes (
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  test_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  outcome TEXT NOT NULL,          -- passed | failed | inconclusive | blocked | not_run | error
  reason TEXT,                    -- required for blocked, not_run, and error
  recorded_at TEXT NOT NULL,
  operation_id TEXT NOT NULL REFERENCES operations(id),
  PRIMARY KEY (run_id, test_id)
) STRICT;

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,            -- ULID
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  test_id TEXT NOT NULL,
  assertion_id TEXT,              -- NULL for evidence of the whole test, for example an error screenshot
  kind TEXT NOT NULL,
  name TEXT NOT NULL,             -- original file name, for export
  media_type TEXT NOT NULL,
  sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  operation_id TEXT NOT NULL REFERENCES operations(id)
) STRICT;

CREATE TABLE findings (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  body TEXT NOT NULL,             -- JSON: type, severity, tests, assertions, requirements, reproduction, evidence IDs
  operation_id TEXT NOT NULL REFERENCES operations(id),
  PRIMARY KEY (run_id, id)
) STRICT;

CREATE TABLE run_gaps (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  body TEXT NOT NULL,             -- JSON gap
  operation_id TEXT NOT NULL REFERENCES operations(id),
  PRIMARY KEY (run_id, id)
) STRICT;

CREATE TABLE results (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id),
  completion TEXT NOT NULL,       -- completed | interrupted | operational_error
  coverage TEXT NOT NULL,         -- complete | partial | not_executed
  finished_at TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  body TEXT NOT NULL,             -- canonical JSON of the complete result
  operation_id TEXT NOT NULL REFERENCES operations(id)
) STRICT;
```

### Snapshots and views

A plan revision and a result are complete canonical JSON snapshots. The snapshot is the authority. Checkmate does not keep a second copy of tests or gaps in other tables. Read views use SQLite JSON functions:

```sql
CREATE VIEW latest_plans AS
  SELECT p.* FROM plan_revisions p
  WHERE p.revision = (SELECT max(revision) FROM plan_revisions WHERE plan_id = p.plan_id);

CREATE VIEW plan_tests AS
  SELECT p.plan_id, p.revision, t.value ->> '$.id' AS test_id, t.value AS test
  FROM plan_revisions p, json_each(p.body, '$.tests') t;

CREATE VIEW plan_gaps AS
  SELECT p.plan_id, p.revision, g.value ->> '$.id' AS gap_id,
         g.value ->> '$.status' AS status, g.value ->> '$.severity' AS severity, g.value AS gap
  FROM plan_revisions p, json_each(p.body, '$.gaps') g;
```

At hundreds of plans, these views are fast enough. If a query becomes slow, add a generated index table in the same transaction as the snapshot. Do not add it before a measurement shows the need.

### Immutability

Triggers refuse `UPDATE` and `DELETE` on every table except one column: `decisions.applied_revision`, which changes once from `NULL` to a revision. The core never updates a row. The triggers are a second check against a direct SQL write.

```sql
CREATE TRIGGER plan_revisions_immutable BEFORE UPDATE ON plan_revisions
BEGIN SELECT RAISE(ABORT, 'Plan revisions are immutable'); END;
```

## 7. Tests and assertions

A test has one action and a list of assertions. An assertion is one thing that the agent must check. It replaces the single `expected` field and the single `oracleKind` field of `toolkit-1`.

```json
{
	"id": "T2",
	"requirementIds": ["R2"],
	"capability": "http",
	"operations": ["create_fixture_order", "apply_fixture_discount"],
	"dependsOn": ["login:T3"],
	"preconditions": ["Cart has one 400 PLN item and 20 PLN loyalty."],
	"action": "Apply the 40 percent promotion and read the quote.",
	"assertions": [
		{ "id": "A1", "check": "The response status is HTTP 200.", "oracleKind": "deterministic" },
		{ "id": "A2", "check": "totalPLN equals 240.", "oracleKind": "deterministic" },
		{ "id": "A3", "check": "The quote does not list the loyalty discount.", "oracleKind": "agent_observation" }
	]
}
```

### Plan rules

- A ready test has one or more assertions.
- An assertion ID is unique in its test. An assertion is referenced as `<testId>.<assertionId>`, for example `T2.A2`.
- Each assertion has a non-empty `check` and an `oracleKind`: `deterministic` or `agent_observation`.
- An unknown expected result is a blocking gap. A test with such a gap is blocked. Do not write an assertion with an unknown expected result.
- A decision revision can add, change, or remove assertions only in a test that a decision affects. A plan edit can change the objective, requirements, and test content. Both create a new immutable revision and recalculate readiness and coverage. A revision cannot reuse the ID of a removed assertion.

### Run rules

- The agent records one result for each assertion: `passed`, `failed`, `inconclusive`, or `not_checked`.
- `passed` and `failed` need an observation and one or more evidence files.
- `inconclusive` means that the agent checked the assertion, but the evidence cannot show whether the assertion is met. It needs an observation, one or more evidence files, and a reason that says what is missing, for example `The quote shows a total, but not which discounts it includes.`
- `inconclusive` is not a defect and needs no finding. The agent can add a `potential_issue` finding when it suspects a defect.
- `not_checked` means that the agent did not check the assertion. It needs a reason, for example `Stopped after A1 failed: the quote was not created.`
- After a failed assertion, the agent continues with the assertions that it can still check. The agent records the others as `not_checked`.
- Checkmate calculates the test outcome from the assertion results. The agent does not set it:

Checkmate uses the first row that applies:

| Assertion results          | Test outcome   |
| -------------------------- | -------------- |
| One or more `failed`       | `failed`       |
| One or more `not_checked`  | `error`        |
| One or more `inconclusive` | `inconclusive` |
| All `passed`               | `passed`       |

- `failed` comes first: one failed assertion fails the test, whatever the other results are.
- `error` comes before `inconclusive`: an assertion that was not checked means the run is incomplete for that test. The caller must know this first.
- An `inconclusive` test does not cover its requirements. The requirement stays `uncovered` with the reason `An assertion is inconclusive.`
- An `inconclusive` test does not prevent `completion: completed`. The check ran. Only the evidence was not sufficient.
- An `inconclusive` test does not satisfy a dependency. A dependency needs `passed`.
- The caller decides what to do next: a decision that gives a stronger oracle, a change to the assertion, or a retest with better evidence.

- A test that the agent did not start has no assertion results. The agent records it as `blocked`, `not_run`, or `error` with a reason.
- Each failed assertion is in a `defect` finding. A finding names its assertions, for example `"assertionIds": ["T2.A2"]`. A defect names one or more failed assertions.

## 8. Plans

### Create

1. The caller runs `checkmate plan open <planId> --target <targetId@rev> < request.json`. The payload has the objective, requirements, and source context. Checkmate records the plan request.
2. The plan skill reads the request with `checkmate plan request <planId>`.
3. The skill writes a candidate and runs `checkmate plan save <planId> < candidate.json`.
4. Checkmate sets readiness and coverage, checks the candidate, and stores revision 1.

The rules from `toolkit-1` stay: requirements and sources do not change, the first revision has no decisions or assumptions, and a ready test needs one or more assertions, a capability of the target, and permitted operations.

### Decide and revise

The decision and its implementation are separate steps. The caller has the authority. The agent implements.

1. A human (UI) or a caller agent runs `checkmate gap answer <planId> <gapId> --kind <kind> --value <text> --source <uri> --rationale <text> --actor <name>`. Checkmate records a decision against the latest revision. The gap must be open in that revision.
2. The revise skill runs `checkmate plan pending <planId>`. The output shows the pending decisions and only the gaps and tests that they affect.
3. The skill sends only the changes: `checkmate plan revise <planId> < delta.json`.

```json
{
	"tests": {
		"T2": {
			"preconditions": ["Cart has 20 PLN loyalty."],
			"assertions": {
				"A2": { "check": "totalPLN equals 240." },
				"A4": { "check": "The quote lists the promotion once.", "oracleKind": "deterministic" }
			}
		}
	},
	"gaps": { "G1": { "status": "resolved" }, "G2": { "status": "deferred" } },
	"assumptions": []
}
```

4. Checkmate builds the next revision from the latest revision, the delta, and the pending decisions. It appends the decisions, sets `decisionId` on each gap, recalculates readiness and coverage, and checks the result. A delta can change only the `action`, `preconditions`, and `assertions` of affected tests, and the status of decided gaps. In `assertions`, a known ID changes that assertion, a new ID adds an assertion, and `null` removes an assertion. Checkmate refuses other changes.
5. Checkmate marks the decisions as applied.

A revision needs a base. Checkmate uses the latest revision in the same transaction. A concurrent revision fails with the primary key. This replaces the `readdir` check.

### Approval

- `checkmate plan approve <planId@rev> --actor <name> --rationale <text>` records an approval with the revision digest.
- `checkmate plan reject <planId@rev> ...` records a rejection.
- The latest approval row for a revision applies.
- The profile sets the policy: `"approvals": { "plan": "required" | "none", "result": "required" | "none" }`. The default is `required` for both.
- A new revision needs a new approval. An approval does not carry over.

### Cross-plan dependencies

A test can name a test in another plan in `dependsOn`: `["T1", "login:T3"]`. A gap can name a test in another plan in `testIds`.

- `plan save` and `plan revise` check that each named plan and test exists in the latest revision of that plan.
- `plan save` and `plan revise` refuse a cycle. The check uses the test graph of the latest revision of every plan.
- Stored readiness is local. It uses only the gaps of the same plan.
- `run gate` calculates effective readiness. A cross-plan dependency blocks a test when:
  - the dependency plan has no finalized result for the same application build, or
  - that result does not show `passed` for the dependency test, or
  - result approval is required and that result is not accepted, or
  - an open blocking gap in the latest revision of any plan applies to the dependency test.
- The gate reports each block with its cause, for example `Blocked by login:T3: no passed result for build fixture-build-1`.
- `checkmate plan list --blocked` shows plans with blocked tests and the cause.

## 9. Runs

### State machine

```text
            run begin                       run finish
  (none) ─────────────► started ──────────────────────► finalized
                          │  ▲                           (completed | interrupted | operational_error)
             crash or     │  │ run resume
             deadline     ▼  │ (new attempt)
                        stalled
```

- `started`: a `runs` row exists and has no `results` row.
- `stalled`: not stored. A started run with no live worker. The caller decides to resume or finish it.
- `finalized`: a `results` row exists. The run does not change after this.

### Commands

1. `checkmate run gate <planId@rev> --tests T1,T2 --build <build>` checks the gate without side effects.
2. `checkmate run begin <runId> <planId@rev> --tests T1,T2 --build <build> [--retest-of <runId>] [--timeout <s>] [--partial wait_for_resolution|run_ready] [--on-new-blocker return_to_caller|continue_independent]` runs the gate, records the run and attempt 1, and prints `startedAt` and `browserSession`. A plan revision that needs approval and has none fails the gate.
3. For each assertion, the agent runs `checkmate run check <runId> <testId> <assertionId> --result <result> [--observed <text>] [--reason <text>] [--evidence <file>[:kind]]...`.
   - The agent does not send the check text or the oracle kind. Checkmate copies them from the plan.
   - Checkmate reads each evidence file, stores the bytes as a blob, and records the evidence row. When a tool needs a capture file, the agent uses the absolute temporary `evidenceDirectory` returned by `run begin` or `run resume`. Checkmate removes each capture after import and clears remaining captures when the run finishes. Durable evidence stays in SQLite; no per-run JSON file is saved.
   - Checkmate enforces the rules for one assertion now: the test is selected and ready, its prerequisites passed, and a `passed` or `failed` result has an observation and evidence.
   - An assertion result is final. A second `check` for the same assertion fails.
4. When the agent has a result for each assertion of a test, it runs `checkmate run close <runId> <testId>`. Checkmate calculates the test outcome (section 7) and prints it.
   - For a test that the agent did not start, the agent runs `checkmate run close <runId> <testId> --outcome blocked|not_run|error --reason <text>`.
   - A tool failure during a test is `--outcome error`. The assertion results that the agent recorded before the failure stay.
   - A test outcome is final. A second `close` for the same test fails.
5. `checkmate run finding <runId> < finding.json` and `checkmate run gap <runId> < gap.json` record findings and new gaps.
6. `checkmate run finish <runId> --completion <completion> --cleanup <status> --cleanup-reason <text>` checks the rules for the whole run (section 10), adds `not_run` for unselected tests, calculates coverage, and stores the result.

### Resume

- `checkmate run resume <runId>` records a new attempt. It lists each selected test that is not closed, with the assertions that have no result.
- Recorded assertion results stay. The agent checks only the assertions that have no result.
- Checkmate does not repeat a test automatically. An agent can have done actions of a test that was not closed when the session stopped. The resume output shows each such test with the warning `Actions may have occurred`. The caller decides to continue it or to record it as `error`.
- `checkmate run resume <runId> --error T3,T4 --reason <text>` closes the named tests as `error` and records the new attempt in one step.
- A deadline or a worker failure in `delegate` does not finalize the run with `error` for every test, as `toolkit-1` does. The run stays `started`. Recorded outcomes stay. The response tells the caller to resume or finish.

### Result acceptance

- `checkmate result accept <runId> --actor <name> --rationale <text>` and `checkmate result reject ...` record an approval with the result digest.
- Acceptance is a caller record. It is not a release decision by Checkmate.

## 10. Rules kept from toolkit-1

The rules in `stages.ts` move to the new commands. They do not change in meaning:

- Revisions are immutable and linear. A gap-decision revision changes only affected tests and applies the pending decisions. An explicit plan edit can update requirements and test content while preserving decision history. Existing runs remain pinned to their original revision.
- A `passed`, `failed`, or `inconclusive` assertion result needs an observation and evidence. An `inconclusive` result also needs a reason. The check text and oracle kind come from the plan.
- A failed assertion needs a defect finding. A defect needs a failed assertion.
- A finding's requirements and evidence match its tests and assertions.
- A runtime gap is new and open.
- `completed` is not possible with an `error` outcome, a failed cleanup, or a selected test that was not run without a cause.
- Completion, test outcomes, and coverage stay separate fields.
- A retest is a new run linked to the prior run. It needs a different build unless the prior result's latest decision is `rejected`. A repeat to correct rejected evidence can use the same application build. The prior run does not change.

## 11. Command interface

### Output

- The default output is compact text. The first line is the status. Each item is one line with the ID first and tab-separated fields.
- `--json` prints the same data as JSON for programs.
- A command prints only what the caller asked for. It does not repeat complete documents.
- `--fields` selects fields. `--tests`, `--gaps`, and `--requirements` select items.

```text
$ checkmate plan show checkout@2 --tests T2 --fields readiness,assertions
completed checkout@2 sha256=2f9c2ef0
T2	ready
T2.A1	deterministic	The response status is HTTP 200.
T2.A2	deterministic	totalPLN equals 240.
T2.A3	agent_observation	The quote does not list the loyalty discount.
```

### Common options

- `--workspace <path>`: the directory that contains `.checkmate/`. The default is the current directory.
- `--actor <name>`: overrides `CHECKMATE_ACTOR`, the workspace Git user name, and the operating-system user, in that order.
- `--expect-sha <digest>`: stop if the referenced snapshot differs.
- `--json`: JSON output.

### Commands

| Command                                                                                                 | Package | Purpose                                      |
| ------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------- |
| `init`                                                                                                  | plugin  | Create the database.                         |
| `target save < profile.json`, `target show <id@rev>`                                                    | plugin  | Store and read a target profile.             |
| `plan open`, `plan request`, `plan save`                                                                | plugin  | Create a plan.                               |
| `plan show`, `plan list`, `plan diff <id> <a> <b>`                                                      | plugin  | Read plans. `diff` prints a JSON Patch.      |
| `gap answer`, `plan pending`, `plan revise`                                                             | plugin  | Decide and revise.                           |
| `plan approve`, `plan reject`                                                                           | plugin  | Plan gate.                                   |
| `run gate`, `run begin`, `run check`, `run close`, `run finding`, `run gap`, `run finish`, `run resume` | plugin  | Execute.                                     |
| `run show`, `run list`                                                                                  | plugin  | Read runs.                                   |
| `result accept`, `result reject`                                                                        | plugin  | Result gate.                                 |
| `evidence get <id> --out <file>`                                                                        | plugin  | Write evidence bytes to a file for viewing.  |
| `export plan\|run <id> --format md\|html\|json --out <file>`                                            | plugin  | Generate views.                              |
| `log [--subject <id>]`                                                                                  | plugin  | Read the operation log.                      |
| `query "<sql>"`                                                                                         | plugin  | Read-only SQL. The database opens read-only. |
| `delegate <stage> ... --allow <rule>...`                                                                | npm     | Run a stage in a new Claude Code session.    |
| `ui [--port <n>]`                                                                                       | plugin  | Start the local review UI.                   |

### Operation log and replay

Each command records one `operations` row in the same transaction as its change. A refused write records its row in a separate transaction, so the log also shows refusals. The row has the flags and the stdin payload. `checkmate log` shows the history of a plan or run. The plan history and the operation log together give the "who changed what, when, and why" view. `plan diff` gives the change itself.

## 12. Evidence

- Evidence belongs to one assertion, or to the whole test when it shows an error.
- Evidence bytes are BLOBs in `blobs`. The key is the SHA-256 of the bytes. Equal files are stored once.
- The maximum size of one evidence file is 32 MiB. `node:sqlite` reads and writes a BLOB as one buffer, so a larger limit uses too much memory.
- The media type comes from the file extension. Unknown extensions use `application/octet-stream`.
- `evidence get` and the UI give the bytes back. The UI serves them with the stored media type and `Content-Disposition: attachment` for types other than images and plain text.
- Checkmate does not sanitize evidence. The caller owns what an agent captures and how long the database keeps it. Do not capture credentials, cookies, authorization headers, or full transcripts.

## 13. Review UI

`checkmate ui` starts a server with `node:http`. It listens only on `127.0.0.1`. It has no external resources and no npm dependencies.

The UI has one job: show the human what waits for a decision, and let them decide with full context. It is calm, minimal, and fast. It looks like the design document: the four-square mark, the same fonts, and the same colors.

### Visual language

- **Mark.** Four squares in a row. The third square is filled. It appears in the page header.
- **Type.** Space Grotesk for headings, Inter for text, and JetBrains Mono for IDs, digests, builds, and code. The npm package includes the WOFF2 files. All three fonts use the SIL Open Font License 1.1. The UI does not load fonts from the internet, so it works offline and sends no request to another host.
- **Color.** Neutral greys with a green tint, one deep-green accent, and white or near-black surfaces. Status colors (passed, failed, blocked, warning) are separate from the accent. The UI follows the system light or dark setting. A toggle in the header overrides it.
- **Status in form and text.** Each status has an icon, a word, and a color, for example `✓ passed`, `✗ failed`, and `? inconclusive`. Color is never the only signal.
- **Restraint.** Borders mark separate objects only. No shadows on lists. No animation except a short fade for toasts. The UI respects `prefers-reduced-motion`.
- **Accessibility.** Contrast meets WCAG 2.2 AA in both themes. Each control has a label and a visible focus ring. Pages use landmarks and headings in order.

### Pages

| Page  | URL                 | Content                                                                                                                                  |
| ----- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Inbox | `/`                 | Items that wait for a human, oldest first, in three groups: gaps to answer, plans to approve, results to accept. This is the start page. |
| Plans | `/plans`            | All plans with status, open gaps, approval, and blocks. Paginated filters and search across displayed columns.                           |
| Plan  | `/plans/checkout@2` | Tests with their assertions, gaps, requirements and coverage, decisions, and history with a diff for each revision.                      |
| Runs  | `/runs`             | All runs with plan, build, completion, coverage, and acceptance. Filters by plan, build, and status.                                     |
| Run   | `/runs/run-7`       | Summary, each test with its assertion results and evidence, findings, new gaps, coverage, and cleanup.                                   |
| Log   | `/log`              | The operation log. Filters by subject and actor.                                                                                         |

The navigation shows the number of inbox items. An empty inbox says `Nothing waits for you.` and links to the latest runs.

### Interaction rules

- **Server-rendered HTML and plain forms.** Each page works without JavaScript. A small script adds keyboard shortcuts, the evidence viewer, and the inbox count refresh.
- **Post, redirect, get.** A form posts, the server redirects, and the browser loads the result. A reload does not send the form again.
- **One primary action for each page.** The decision panel is on the right on a wide screen and at the bottom on a narrow screen. It shows the subject (`checkout@2`), the digest, and the action buttons.
- **A rationale is required.** The action button stays disabled until the rationale field has text.
- **Confirm in place.** The first click on `Approve checkout@2` changes the panel to a short summary and a `Confirm` button. The UI does not use modal dialogs.
- **Inconclusive results.** The result acceptance panel lists each inconclusive assertion with its reason, above the action buttons.
- **Queue flow.** After an action, the UI shows a toast (`Approved checkout@2`) and opens the next inbox item. `Back to inbox` is always one click away.
- **Gap answer form.** A segmented control selects `Clarify`, `Accept assumption`, or `Defer`. Help text below the control says what each kind does. The source field is shown and required for `Clarify` only.
- **Stale data.** Each form sends the digest of the snapshot on the page. If the snapshot changed, Checkmate refuses the action. The UI keeps the typed text and shows a banner: `checkout has a newer revision (3). Your decision was not recorded. Review revision 3.`
- **Evidence.** Images show as thumbnails and open in a viewer. Text shows inline in monospace. Other types download.
- **Assertion results.** A run page shows each assertion as one row: the icon, the check text, and the observation. Failed and inconclusive rows open by default. Passed rows stay closed.
- **Diff.** History expands the latest change and shows five earlier changes collapsed. A faded control loads the remaining history on request. Refresh resets this view. Field changes use readable values instead of raw JSON Patch.
- **Editing.** A plan edit creates a new revision. Coverage follows requirement mappings. A stale digest or pending gap decision refuses the save. The plan page links its runs.
- **Lists.** Plans, Runs, and Log use 25 rows by default, with 50 and 100 available. Their Updated, Started, and Time columns sort newest first and can reverse. Search covers displayed columns in the database. Search, dropdowns, and clearing filters update results automatically.
- **Closed gaps.** Resolved and deferred gaps are collapsed and muted.
- **Reports.** Finished runs offer HTML and JSON downloads and browser printing to PDF.
- **Stable links.** Each URL identifies one object and can be shared on the same host, for example `/plans/checkout@2#T2`.
- **Keyboard.** `/` focuses search. `j` and `k` move in a list. `Enter` opens the item. `Esc` closes the evidence viewer. `?` shows the shortcuts.
- **Live updates.** Each page shows changes to its items when another process writes them. Section "Live updates" below gives the rules.
- **Errors.** An error message says what went wrong and what to do next. It does not show a stack trace.
- **Narrow screens.** The layout becomes one column. Tables scroll inside their container.

### Live updates

The CLI, a delegated worker, and the UI are different processes. SQLite does not tell one process about a write by another process. The UI server detects changes and sends them to the browser.

**Change detection**

- The server keeps one read connection. Every 250 ms, it reads `PRAGMA data_version`. The value changes only when another connection commits. The read is cheap and does not scan tables.
- When the value changes, the server reads the operations after its last cursor: `SELECT id, subjects FROM operations WHERE id > ? ORDER BY id`. ULIDs sort by time, so the operation ID is the cursor.
- Each write command records the subjects it changed in `operations.subjects`. Examples: `plan:checkout`, `run:run-7`, `inbox`. The command sets them in the same transaction as the change.

**Delivery**

- The browser opens one Server-Sent Events stream: `GET /events?subjects=run:run-7,inbox`. Each page subscribes to its own subjects and to `inbox`, for the navigation count.
- Each event has the operation ID as its `id` and the changed subjects as data. The server sends only events for the subscribed subjects.
- The browser reconnects automatically. It sends `Last-Event-ID`, and the server sends the events after that ID. No change is lost while the connection is down.
- The server sends a comment line every 15 seconds, so proxies and the browser keep the stream open.
- Server-Sent Events use `node:http` only. They need no dependency and no WebSocket.

**Page update**

- On an event, the page loads its own URL again in the background and replaces the changed regions. It does not reload the full page. Scroll position and focus stay.
- A changed row shows a short highlight. With `prefers-reduced-motion`, the row shows a static marker instead.
- An `aria-live="polite"` region announces changes, for example `T2 closed: failed`.
- A form with typed text is never replaced. If its subject changed, a banner says so above the form, for example `run-7 has a new result. Review it before you decide.` The stale digest check (above) still refuses an action on old data.
- A plan revision does not change, so its page does not change. When a newer revision exists, a banner says `Revision 3 is available` with a link. The page does not move to the new revision automatically.
- In the inbox, new items appear in their group. When an item disappears, focus moves to the next item.
- The header shows the connection state: `● Live`, or `○ Reconnecting…` while the stream is down.
- Without JavaScript, pages work but do not update. A reload shows the current state.

### Security

- Each action calls the same core function as the CLI command. The UI has no write path of its own.
- The UI defaults to the inferred actor. A human can change the name; the choice stays in a cookie.
- The server escapes all stored text. Plan and evidence text is untrusted data.
- The server checks the `Host` and `Origin` headers and uses a random per-start token in each form. This blocks a write from another web page in the same browser.
- The server sends a strict Content Security Policy: same origin only, no inline script, no remote resources.

## 14. Later: merge of databases

Not built now. These design choices keep it possible:

- Internal rows use ULIDs.
- Rows are append-only.
- Each snapshot has a digest.

A later `checkmate merge <other.db>` attaches the other database and inserts missing rows. Equal rows have the same key and digest. A conflict is the same key with a different digest, for example two different revisions with the same number of the same plan. The command stops and reports each conflict. The caller decides. Runs do not conflict, because run IDs are unique.

## 15. Skills

The skills keep their stages. The instructions change:

- Skills read the relevant database records before each task and after writes. They do not use chat memory or exports as current state.
- Setup records context and tool instructions. Plan context instructions can override setup context; tool instructions combine with setup restrictions. The host supplies tools and permissions. No separate connector registry is required.
- `revise` writes a delta. It does not write a full plan.
- `execute` runs `run check` after each assertion and `run close` after each test. It does not write one observation at the end.
- `report` reads the current run or plan. It runs `export` only when the caller requests a file.
- A delegated stage writes to the database through the same commands. The parent does not publish a candidate. The parent reads the operation log and the result.

## 16. Tests

- Store: schema creation, immutability triggers, foreign keys, WAL with two connections.
- Plans: create, delta revise, refused deltas, concurrent revise, approval required by the gate, new revision needs new approval.
- Cross-plan: missing plan or test, cycle refused, block by missing result, block by failed result, block by unaccepted result, block by open gap in another plan.
- Assertions: a ready test without assertions refused, outcome calculated from assertion results, one failed assertion fails the test, `not_checked` without a failure gives `error`, `inconclusive` without a failure or `not_checked` gives `inconclusive`, inconclusive without a reason or evidence refused, inconclusive test leaves its requirement uncovered and blocks a dependency, failed assertion without a defect refused, assertion delta add, change, and remove.
- Runs: one assertion recorded at a time, second check refused, second close refused, resume keeps recorded assertions, `resume --error`, finish rules, retest rules.
- Evidence: blob deduplication, size limit, export bytes equal input bytes.
- CLI: compact and JSON output, `--fields`, `--expect-sha`, read-only `query` refuses writes.
- Operation log: one row per command, refused writes recorded.
- UI: each action uses the core function, rationale required, stale digest refused with typed text kept, post-redirect-get, Host and Origin checks, escaping, pages work without JavaScript, keyboard navigation, contrast in both themes. Live updates: a write by another process sends an event within 1 second, only subscribed subjects receive it, `Last-Event-ID` replays missed events, a form with typed text is not replaced, a plan revision page shows a newer-revision banner, the connection state shows a reconnect.
- Packaging: the npm package runs from `node_modules`, `delegate` loads the bundled plugin, and the plugin and CLI versions are equal.
- Live: one plan, revise, approve, execute, resume, and accept cycle with Claude Code.

## 17. Implementation order

1. Store: schema, triggers, canonical JSON, digests, operation log.
2. Targets and plans: create, show, delta revise, decisions, diff.
3. Approvals and the gate, with cross-plan dependencies.
4. Runs: begin, check, close, finding, gap, finish, resume, and evidence blobs.
5. Export and the report views.
6. Skills update.
7. npm CLI: bundle, `delegate`, `ui` with local fonts and live updates.
8. Documentation: README, CONFIGURATION, CLI, EVIDENCE, architecture wiki.

Each step keeps `npm run phase:verify` green. The JSON file code is removed when step 4 is complete.
