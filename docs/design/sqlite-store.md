# Design: SQLite store and npm CLI

Status: draft for review. Contract version: `toolkit-2`.

## 1. Goals

- Replace the JSON files with one SQLite database.
- Keep plans, decisions, approvals, runs, outcomes, evidence, and the operation log in the database.
- Make runs resumable. Record each test outcome when the agent finishes the test.
- Reduce tokens. Agents read only the fields they need and write only the changes.
- Support hundreds of plans. Plans can depend on other plans and can block other plans.
- Let a human approve plans and accept results in a local UI.
- Ship a self-contained Claude Code plugin and a separate npm CLI that starts Claude Code with that plugin.

## 2. Non-goals

- No branches or merges of plans.
- No shared database for many hosts. One host writes to one database.
- No `toolkit-1` compatibility and no importer.
- No authentication or access control. The `actor` field is a record. It is not a proof of identity.
- No proof that an observation is true. Checkmate checks structure and relationships only.

## 3. Decisions

| Topic                 | Decision                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Location              | `.checkmate/checkmate.db` in the caller's workspace. One host writes to it.                    |
| Human gate            | A human approves a plan revision before execution and accepts a result after execution.        |
| Agent access          | Agents write only through CLI commands. Agents can read through `checkmate query` (read-only). |
| Cross-plan dependency | A dependency names a plan and a test. It does not pin a revision.                              |
| Dependency rule       | The latest finalized result for the same application build must show `passed`.                 |
| Evidence              | Evidence bytes are BLOBs in the database. Each blob is content-addressed by SHA-256.           |
| Audit                 | Each command records one operation row with the actor, the arguments, and the response.        |
| Views                 | Markdown and HTML are on-demand exports. The UI reads the database directly.                   |
| Interface             | CLI flags for small writes. JSON on stdin for structured payloads. Compact output.             |
| Merge                 | Not built now. The schema keeps a later merge possible (section 13).                           |

## 4. Package layout

```text
plugin/                Claude Code plugin. Self-contained. No npm dependencies.
  skills/              setup, plan, revise, execute, report
  contracts/           JSON Schemas for toolkit-2 payloads
  src/                 core: store, rules, commands
  dist/checkmate.js    one bundled file, generated at release
cli/                   npm package @xoxoai/checkmate
  src/                 launcher (delegate), ui, entry point
  plugin/              exact copy of plugin/ at the same version, copied at pack time
```

The plugin contains the complete core. A plugin user can do every stage inside Claude Code without the npm package. The skills run `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`.

The npm CLI adds `delegate` and `ui`. It also exposes every core command. `delegate` starts `claude -p --plugin-dir <cli>/plugin`, so the CLI and plugin versions are always the same.

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
  response TEXT NOT NULL          -- JSON
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

CREATE TABLE outcomes (
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  test_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  outcome TEXT NOT NULL,          -- passed | failed | blocked | not_run | error
  observed TEXT,
  reason TEXT,
  recorded_at TEXT NOT NULL,
  operation_id TEXT NOT NULL REFERENCES operations(id),
  PRIMARY KEY (run_id, test_id)
) STRICT;

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,            -- ULID
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  test_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,             -- original file name, for export
  media_type TEXT NOT NULL,
  sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  operation_id TEXT NOT NULL REFERENCES operations(id)
) STRICT;

CREATE TABLE findings (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  body TEXT NOT NULL,             -- JSON: type, severity, tests, requirements, reproduction, evidence IDs
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

## 7. Plans

### Create

1. The caller runs `checkmate plan open <planId> --target <targetId@rev> < request.json`. The payload has the objective, requirements, and source context. Checkmate records the plan request.
2. The plan skill reads the request with `checkmate plan request <planId>`.
3. The skill writes a candidate and runs `checkmate plan save <planId> < candidate.json`.
4. Checkmate sets readiness and coverage, checks the candidate, and stores revision 1.

The rules from `toolkit-1` stay: requirements and sources do not change, the first revision has no decisions or assumptions, and a ready test needs an expected result, a capability of the target, and permitted operations.

### Decide and revise

The decision and its implementation are separate steps. The caller has the authority. The agent implements.

1. A human (UI) or a caller agent runs `checkmate gap answer <planId> <gapId> --kind <kind> --value <text> --source <uri> --rationale <text> --actor <name>`. Checkmate records a decision against the latest revision. The gap must be open in that revision.
2. The revise skill runs `checkmate plan pending <planId>`. The output shows the pending decisions and only the gaps and tests that they affect.
3. The skill sends only the changes: `checkmate plan revise <planId> < delta.json`.

```json
{
	"tests": { "T2": { "expected": "HTTP 200 and totalPLN equals 240.", "preconditions": ["Cart has 20 PLN loyalty."] } },
	"gaps": { "G1": { "status": "resolved" }, "G2": { "status": "deferred" } },
	"assumptions": []
}
```

4. Checkmate builds the next revision from the latest revision, the delta, and the pending decisions. It appends the decisions, sets `decisionId` on each gap, recalculates readiness and coverage, and checks the result. A delta can change only the fields that `toolkit-1` lets a revision change: `expected`, `action`, `preconditions`, and `oracleKind` of affected tests, and the status of decided gaps. Checkmate refuses other changes.
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

## 8. Runs

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
3. For each test, the agent runs `checkmate run record <runId> <testId> --outcome <outcome> [--observed <text>] [--reason <text>] [--evidence <file>[:kind]]...`.
   - Checkmate copies `expected` and `assertionKind` from the plan. The agent does not send them.
   - Checkmate reads each evidence file, stores the bytes as a blob, and records the evidence row. The agent writes evidence files to `.checkmate/tmp/<runId>/` first. Checkmate deletes each file after it stores it.
   - Checkmate checks the rules for one test now: the test is selected and ready, a verdict has an observation and evidence, and a prerequisite passed before a verdict.
   - An outcome is final. A second `record` for the same test fails.
4. `checkmate run finding <runId> < finding.json` and `checkmate run gap <runId> < gap.json` record findings and new gaps.
5. `checkmate run finish <runId> --completion <completion> --cleanup <status> --cleanup-reason <text>` checks the rules for the whole run (section 9), adds `not_run` for unselected tests, calculates coverage, and stores the result.

### Resume

- `checkmate run resume <runId>` lists the selected tests that have no outcome and records a new attempt.
- Checkmate does not repeat a test automatically. An agent can have done actions of a test that had no outcome when the session stopped. The resume output shows each such test with the warning `Actions may have occurred`. The caller decides to run it or to record it as `error`.
- A deadline or a worker failure in `delegate` does not finalize the run with `error` for every test, as `toolkit-1` does. The run stays `started`. Recorded outcomes stay. The response tells the caller to resume or finish.

### Result acceptance

- `checkmate result accept <runId> --actor <name> --rationale <text>` and `checkmate result reject ...` record an approval with the result digest.
- Acceptance is a caller record. It is not a release decision by Checkmate.

## 9. Rules kept from toolkit-1

The rules in `stages.ts` move to the new commands. They do not change in meaning:

- Revisions are immutable and linear. A revision cannot change requirements, sources, test inventory, gap inventory, unrelated tests, or prior decisions and assumptions.
- A verdict needs an observation and evidence. The expected result and assertion kind match the plan.
- A failed assertion needs a defect finding. A defect needs a failed assertion.
- A finding's requirements and evidence match its tests.
- A runtime gap is new and open.
- `completed` is not possible with an `error` outcome, a failed cleanup, or a selected test that was not run without a cause.
- Completion, test outcomes, and coverage stay separate fields.
- A retest is a new run with a new build. The prior run does not change.

## 10. Command interface

### Output

- The default output is compact text. The first line is the status. Each item is one line with the ID first and tab-separated fields.
- `--json` prints the same data as JSON for programs.
- A command prints only what the caller asked for. It does not repeat complete documents.
- `--fields` selects fields. `--tests`, `--gaps`, and `--requirements` select items.

```text
$ checkmate plan show checkout@2 --tests T2 --fields readiness,expected
completed checkout@2 sha256=2f9c2ef0
T2	ready	HTTP 200 and totalPLN equals 240, with the loyalty discount replaced.
```

### Common options

- `--workspace <path>`: the directory that contains `.checkmate/`. The default is the current directory.
- `--actor <name>`: required for every write. `CHECKMATE_ACTOR` sets a default.
- `--expect-sha <digest>`: stop if the referenced snapshot differs.
- `--json`: JSON output.

### Commands

| Command                                                                                     | Package | Purpose                                      |
| ------------------------------------------------------------------------------------------- | ------- | -------------------------------------------- |
| `init`                                                                                      | plugin  | Create the database.                         |
| `target save < profile.json`, `target show <id@rev>`                                        | plugin  | Store and read a target profile.             |
| `plan open`, `plan request`, `plan save`                                                    | plugin  | Create a plan.                               |
| `plan show`, `plan list`, `plan diff <id> <a> <b>`                                          | plugin  | Read plans. `diff` prints a JSON Patch.      |
| `gap answer`, `plan pending`, `plan revise`                                                 | plugin  | Decide and revise.                           |
| `plan approve`, `plan reject`                                                               | plugin  | Plan gate.                                   |
| `run gate`, `run begin`, `run record`, `run finding`, `run gap`, `run finish`, `run resume` | plugin  | Execute.                                     |
| `run show`, `run list`                                                                      | plugin  | Read runs.                                   |
| `result accept`, `result reject`                                                            | plugin  | Result gate.                                 |
| `evidence get <id> --out <file>`                                                            | plugin  | Write evidence bytes to a file for viewing.  |
| `export plan\|run <id> --format md\|html\|json --out <file>`                                | plugin  | Generate views.                              |
| `log [--subject <id>]`                                                                      | plugin  | Read the operation log.                      |
| `query "<sql>"`                                                                             | plugin  | Read-only SQL. The database opens read-only. |
| `delegate <stage> ... --allow <rule>...`                                                    | npm     | Run a stage in a new Claude Code session.    |
| `ui [--port <n>]`                                                                           | npm     | Start the local review UI.                   |

### Operation log and replay

Each command records one `operations` row in the same transaction as its change. A refused write records its row in a separate transaction, so the log also shows refusals. The row has the flags and the stdin payload. `checkmate log` shows the history of a plan or run. The plan history and the operation log together give the "who changed what, when, and why" view. `plan diff` gives the change itself.

## 11. Evidence

- Evidence bytes are BLOBs in `blobs`. The key is the SHA-256 of the bytes. Equal files are stored once.
- The maximum size of one evidence file is 32 MiB. `node:sqlite` reads and writes a BLOB as one buffer, so a larger limit uses too much memory.
- The media type comes from the file extension. Unknown extensions use `application/octet-stream`.
- `evidence get` and the UI give the bytes back. The UI serves them with the stored media type and `Content-Disposition: attachment` for types other than images and plain text.
- Checkmate does not sanitize evidence. The caller owns what an agent captures and how long the database keeps it. Do not capture credentials, cookies, authorization headers, or full transcripts.

## 12. UI

`checkmate ui` starts a server with `node:http`. It listens only on `127.0.0.1`. It has no external resources and no npm dependencies.

- Pages: plans list (status, open gaps, approval, blocks), plan revision (requirements, tests, gaps, decisions, diff to the previous revision), run (outcomes, evidence, findings, coverage), and operation log.
- Actions: answer a gap, approve or reject a plan revision, and accept or reject a result.
- Each action calls the same core function as the CLI command. The UI has no write path of its own.
- The UI asks for the actor name once and keeps it in a cookie.
- Each form sends the digest of the snapshot the person saw. Checkmate refuses the action if the snapshot changed.
- The server escapes all stored text. Plan and evidence text is untrusted data.
- The server checks the `Host` and `Origin` headers and uses a random per-start token in each form. This blocks a write from another web page in the same browser.

## 13. Later: merge of databases

Not built now. These design choices keep it possible:

- Internal rows use ULIDs.
- Rows are append-only.
- Each snapshot has a digest.

A later `checkmate merge <other.db>` attaches the other database and inserts missing rows. Equal rows have the same key and digest. A conflict is the same key with a different digest, for example two different revisions with the same number of the same plan. The command stops and reports each conflict. The caller decides. Runs do not conflict, because run IDs are unique.

## 14. Skills

The skills keep their stages. The instructions change:

- Skills read through `plan show`, `plan request`, `plan pending`, and `run resume`. They do not read files.
- `revise` writes a delta. It does not write a full plan.
- `execute` runs `run record` after each test. It does not write one observation at the end.
- `report` runs `export`.
- A delegated stage writes to the database through the same commands. The parent does not publish a candidate. The parent reads the operation log and the result.

## 15. Tests

- Store: schema creation, immutability triggers, foreign keys, WAL with two connections.
- Plans: create, delta revise, refused deltas, concurrent revise, approval required by the gate, new revision needs new approval.
- Cross-plan: missing plan or test, cycle refused, block by missing result, block by failed result, block by unaccepted result, block by open gap in another plan.
- Runs: one test recorded at a time, second record refused, resume after a stopped worker, finish rules, retest rules.
- Evidence: blob deduplication, size limit, export bytes equal input bytes.
- CLI: compact and JSON output, `--fields`, `--expect-sha`, read-only `query` refuses writes.
- Operation log: one row per command, refused writes recorded.
- UI: each action uses the core function, stale digest refused, Host and Origin checks, escaping.
- Packaging: the npm package runs from `node_modules`, `delegate` loads the bundled plugin, and the plugin and CLI versions are equal.
- Live: one plan, revise, approve, execute, resume, and accept cycle with Claude Code.

## 16. Implementation order

1. Store: schema, triggers, canonical JSON, digests, operation log.
2. Targets and plans: create, show, delta revise, decisions, diff.
3. Approvals and the gate, with cross-plan dependencies.
4. Runs: begin, record, finding, gap, finish, resume, and evidence blobs.
5. Export and the report views.
6. Skills update.
7. npm CLI: bundle, `delegate`, `ui`.
8. Documentation: README, CONFIGURATION, CLI, EVIDENCE, architecture wiki.

Each step keeps `npm run phase:verify` green. The JSON file code is removed when step 4 is complete.

## 17. Open questions

1. Should the profile's approval policy default to `required` for both plans and results, or `none`?
2. Is 32 MiB a sufficient limit for one evidence file? A screen video can be larger.
3. Should `run resume` let the caller mark a stalled test as `error` in one step, or should the caller use `run record`?
4. Is the npm package name `@xoxoai/checkmate` correct for the public package?
