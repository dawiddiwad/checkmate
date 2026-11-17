# The record

> **Reference** · The database behind Checkmate: where it is, what it keeps, who wrote each row, and what it does not protect.

All state is in one SQLite file in the application workspace. Rows do not change after a write, and each write leaves one row in the operation log.

**On this page:** [Location](#location) · [Rules](#rules) · [Actor](#actor) · [Operation log](#operation-log) · [Tables](#tables) · [Review UI](#review-ui) · [Limits](#limits)

## Location

The database is `<workspace>/.checkmate/checkmate.db`. The workspace is the current directory, or the value of `--workspace <path>`.

- Any command creates `.checkmate/` and the schema when they are missing. `checkmate init` only creates them.
- `.checkmate/tmp/` holds binary evidence and browser output for a short time. `run finish` removes `.checkmate/tmp/<runId>/`, and `target save` removes `.checkmate/tmp/setup-<targetId>/`.
- `.checkmate/work/<explorationId>/` holds the files of the explorers while an exploration runs. Checkmate removes it when the exploration or a follow-up completes.
- Add `.checkmate/` to `.gitignore`. To keep a plan or a report in Git, export it with `checkmate export`.

## Rules

- Agents and people write only through commands. `checkmate query "<sql>"` opens the database read-only.
- Each write runs in one `BEGIN IMMEDIATE` transaction with its operation row. A refused write changes nothing.
- Rows do not change after a write. Triggers refuse `UPDATE` and `DELETE` on every table, with two exceptions: a decision records the revision that applied it, once, and `plan edit` changes a plan revision that has no approval and no run.
- Retiring an instance adds a row to `instance_retirements`. The instance row does not change.
- A plan revision, a profile, and a result are canonical JSON snapshots. The digest is the SHA-256 of that text. A digest detects change. It does not authenticate the actor.
- The database uses WAL mode, a busy timeout of 30 seconds, and foreign keys. `CHECKMATE_BUSY_TIMEOUT_MS` changes the busy timeout. The CLI, a delegated worker, and the review UI can use it at the same time. One command writes at a time. Every command waits for the lock, also a read such as `log`, `status`, or `inbox`. A command that cannot get the lock in 30 seconds gives `operational_error` and changes nothing. One host writes to one database.
- The schema version is 4. Checkmate adds the exploration tables to a database of version 3 when it opens it. Checkmate refuses a database with another version.

## Actor

Every write records an actor. Checkmate uses the first value that it finds:

1. `--actor <name>`
2. `CHECKMATE_ACTOR`
3. `git config user.name` in the workspace
4. The login name of the operating system user

Checkmate refuses a write without an actor.

- `delegate` sets `CHECKMATE_ACTOR=claude:<stage>` for its worker.
- A skill passes `--actor claude:<stage>` on each stage write, so the record shows `claude:<stage>` in the same session too.
- The review UI fills in the same default. A human can change the name in the top bar.

The actor is a record. It is not a proof of identity. Checkmate has no authentication and no access control.

## Operation log

Each write records one row: the time, the actor, the command, the flags and the payload, the status, the response, and the changed subjects. A refused write also records a row with the status `rejected`. A write that cannot get the database lock records nothing. A read, for example `status` or `inbox`, records nothing.

Each row has a row ID. The row ID increases in the order of the writes. The last field of each line is the row ID. A decision line has its rationale before the row ID.

```sh
checkmate log --subject plan:checkout --limit 5
```

```text
completed log
01M7CVS3TPCHJBVEYTHVCAAHB7	2026-11-14T11:06:15.767Z	po	result accept	completed	run:run-2,plan:checkout,inbox	The totals match the receipt.	42
01M7CVS3M0B4SXWSEEBHYDMTH4	2026-11-14T11:06:15.552Z	po	run finish	completed	run:run-2,plan:checkout,inbox	41
```

To read only the new operations, give the last row ID that you read: `checkmate log --after 42`. With `--after`, the log lists the operations oldest first. [Get a signal when the oracle must act](../guides/factory.md#get-a-signal-when-the-oracle-must-act) uses this cursor.

The plan history, `plan diff`, and the log together show who changed what, when, and why. When `plan edit` changes a revision in place, the log keeps the edit.

## Tables

| Table                  | Holds                                                                         |
| ---------------------- | ----------------------------------------------------------------------------- |
| `meta`                 | The contract version and the schema version.                                  |
| `operations`           | The operation log.                                                            |
| `target_requests`      | Setup requests from `target open`.                                            |
| `profiles`             | Target profile revisions.                                                     |
| `instances`            | Instances of a target with their entry values. One row for each add.          |
| `instance_retirements` | One row for each retired instance.                                            |
| `plan_requests`        | Plan requests from `plan open`.                                               |
| `plan_revisions`       | Plan revisions as JSON snapshots.                                             |
| `decisions`            | Gap answers, and the revision that applied each one.                          |
| `approvals`            | Verdicts on plan revisions and results, with the digest of the subject.       |
| `runs`                 | Runs: plan revision, target revision, instance, build, selection, and policy. |
| `run_attempts`         | One row for each start and resume of a run.                                   |
| `assertion_results`    | One row for each assertion result.                                            |
| `outcomes`             | One row for each closed test.                                                 |
| `evidence`             | Evidence rows: test, assertion, kind, name, media type, and digest.           |
| `blobs`                | Evidence bytes, keyed by SHA-256. Equal bytes are stored once.                |
| `findings`             | Defects and potential issues.                                                 |
| `run_gaps`             | Gaps that a run found.                                                        |
| `results`              | Finished runs as JSON snapshots.                                              |
| `explorations`         | Explorations: plan, target revision, instance, build, mode, and charter.      |
| `exploration_events`   | The steps of an exploration: launch, end, record, merge, and verify.          |
| `journal_entries`      | The entries that the recorders, the merger, and the verifier log.             |
| `plan_rules`           | The derived rules of a plan, and each correction. The latest row applies.     |
| `plan_builds`          | The time when an exploration or a run of a plan first tested each build.      |
| `handoffs`             | Each hand-over of a claim and each undo, with the actor, time, and target.    |

The views `latest_plans`, `plan_tests`, and `plan_gaps` read inside the plan snapshots. `plan_tests` and `plan_gaps` have one row for each revision. Use them with `checkmate query`:

```sh
checkmate query "select plan_id, revision, gap_id, status from plan_gaps where status = 'open'"
```

## Entries of an exploration

The JSON Schemas `plugin/contracts/journal-*.schema.json` define the entries. Each field below is optional. An older entry does not have it. A missing field means unknown, never passed.

| Entry       | Field     | Holds                                                                                           |
| ----------- | --------- | ----------------------------------------------------------------------------------------------- |
| `criterion` | `rule`    | The ID of the plan rule that the session checked, or `outside`.                                 |
| `criterion` | `verdict` | `ok` when the behaviour was right, `wrong` when it was not.                                     |
| `defect`    | `rule`    | The ID of the plan rule that the defect concerns, or `outside` for behaviour outside the rules. |
| `question`  | `rule`    | The ID of the plan rule that the question concerns, or `outside`.                               |
| `question`  | `actual`  | What the build does now, in one sentence.                                                       |
| `topic`     | `label`   | The topic of the merged questions in one to three words.                                        |

Checkmate checks each `rule` against the rules of the charter. It changes an unknown ID to `outside` and counts it. The rule of a claim is the most frequent `rule` of its reports. With a tie, it is the rule of the first report. The rule of a merged question comes from its members in the same way.

The rules of a plan come from the latest revision, else from the request, else from the [derived rules](commands.md#derived-rules). The builds of a plan are in the order of `plan_builds`.

The read models in `plugin/src/rulemap.ts` give the review UI the rule map of a plan: one row for each rule and one for `outside`, and one cell for each build. A cell is `failed` when an open claim of the rule is new, still present, or returned on that build, or when a criterion of that build says `wrong`. Else it is `question` when an open question of the rule was asked on that build. Else it is `passed` when a criterion of that build says `ok`. Else it is `not_checked`. The state of a claim on a build is `new` on its first build, then `still_present`, `fixed`, `returned` (present again after a fix), or `not_retested`. `not_retested` never counts as fixed or as still present.

The rule map also has `areas`. An area groups the rules that have the same `area`, without regard to case, and it uses the first spelling. A rule without `area` is in the area `Rules`. The areas are in the order of the first rule of each. An area has its `label`, its `ruleIds`, and one cell for each build. The cell of an area has the worst `status` of its rules (`failed`, then `question`, then `passed`, then `not_checked`). It also has the sums of `severities`, `criteria`, `claims`, `questions`, and `changes` of its rules. The row of `outside` is in no area.

## Review UI

The UI is a `node:http` server in the plugin. It has no npm dependencies and loads nothing from the internet.

- It listens on `127.0.0.1` only. It refuses a request with another `Host` header, and a form from another origin.
- Each form carries a token from the current start of the UI.
- Each form sends the digest of the snapshot on the page. A changed snapshot refuses the action.
- Each decision form also sends a token of the latest approval row of its subject. A new decision on the subject after the page loaded refuses the action, also a replay of the same form. The UI finds a stale page before it calls the core function, so this refusal adds no row to the operation log. A refusal inside the core function adds a `rejected` row, as for the CLI.
- The `back` and `return` values of a form are paths on the UI only. The UI uses `/` for other values.
- A hand-over in the UI calls the same core function as `checkmate claim handoff`.
- The evidence of a claim has the address `/explorations/<explorationId>/claims/<claimId>/evidence/<n>`. The UI reads the bytes from the record, not from the disk.
- Each action calls the same core function as the CLI command. The UI has no write path of its own.
- Pages send a Content Security Policy that allows only resources from the UI itself.
- The server reads `PRAGMA data_version` every 250 ms. When another process commits, it reads the new operation rows and sends their subjects to the open pages as Server-Sent Events. A page reloads only its changed regions.

## Limits

| The checks show                                     | The checks do not show                  |
| --------------------------------------------------- | --------------------------------------- |
| A payload has the right shape and valid references. | That an observation is true.            |
| A plan follows the plan rules before it is stored.  | That the evidence came from the target. |
| A run starts only through the gate.                 | That QA read the evidence correctly.    |
| A digest detects a change to the stored bytes.      | Who the actor really is.                |

- The rule checks and the path checks are not a sandbox. Use a trusted local workspace.
- Checkmate does not sanitize evidence and cannot delete rows. The workspace owner owns retention.
- Linux is the measured platform. macOS was not tested. The `delegate` launcher refuses Windows.
- One host writes to one database. There is no shared database for many hosts.

## Next

- [Runs and evidence](runs.md): what a run writes.
- [Development](../development.md): the tests behind these rules.
