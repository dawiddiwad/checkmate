# The record

> **Reference** · The database behind Checkmate: where it is, what it keeps, who wrote each row, and what it does not protect.

All state is in one SQLite file in the application workspace. Rows do not change after a write, and each write leaves one row in the operation log.

**On this page:** [Location](#location) · [Rules](#rules) · [Actor](#actor) · [Operation log](#operation-log) · [Tables](#tables) · [Review UI](#review-ui) · [Limits](#limits)

## Location

The database is `<workspace>/.checkmate/checkmate.db`. The workspace is the current directory, or the value of `--workspace <path>`.

- Any command creates `.checkmate/` and the schema when they are missing. `checkmate init` only creates them.
- `.checkmate/tmp/` holds binary evidence and browser output for a short time. `run finish` removes `.checkmate/tmp/<runId>/`, and `target save` removes `.checkmate/tmp/setup-<targetId>/`.
- Add `.checkmate/` to `.gitignore`. To keep a plan or a report in Git, export it with `checkmate export`.

## Rules

- Agents and people write only through commands. `checkmate query "<sql>"` opens the database read-only.
- Each write runs in one `BEGIN IMMEDIATE` transaction with its operation row. A refused write changes nothing.
- Rows do not change after a write. Triggers refuse `UPDATE` and `DELETE` on every table, with two exceptions: a decision records the revision that applied it, once, and `plan edit` changes a plan revision that has no approval and no run.
- A plan revision, a profile, and a result are canonical JSON snapshots. The digest is the SHA-256 of that text. A digest detects change. It does not authenticate the actor.
- The database uses WAL mode, a busy timeout of 5 seconds, and foreign keys. The CLI, a delegated worker, and the review UI can use it at the same time. One host writes to one database.
- The schema version is 2. Checkmate refuses a database with another version. There is no migration from earlier databases.

## Actor

Every write records an actor. Checkmate uses the first value that it finds:

1. `--actor <name>`
2. `CHECKMATE_ACTOR`
3. `git config user.name` in the workspace
4. The login name of the operating system user

Checkmate refuses a write without an actor.

- `delegate` sets `CHECKMATE_ACTOR=claude:<stage>` for its worker.
- A skill in the same session records agent work as `claude:<stage>` when `CHECKMATE_ACTOR` is not set.
- The review UI fills in the same default. A human can change the name in the header.

The actor is a record. It is not a proof of identity. Checkmate has no authentication and no access control.

## Operation log

Each write records one row: the time, the actor, the command, the flags and the payload, the status, the response, and the changed subjects. A refused write also records a row with the status `rejected`. A read, for example `status` or `inbox`, records nothing.

```sh
checkmate log --subject plan:checkout --limit 5
```

```text
completed log
01M7CVS3TPCHJBVEYTHVCAAHB7	2026-11-14T11:06:15.767Z	po	result accept	completed	run:run-2,plan:checkout,inbox
01M7CVS3M0B4SXWSEEBHYDMTH4	2026-11-14T11:06:15.552Z	po	run finish	completed	run:run-2,plan:checkout,inbox
```

The plan history, `plan diff`, and the log together show who changed what, when, and why. When `plan edit` changes a revision in place, the log keeps the edit.

## Tables

| Table               | Holds                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| `meta`              | The contract version and the schema version.                            |
| `operations`        | The operation log.                                                      |
| `target_requests`   | Setup requests from `target open`.                                      |
| `profiles`          | Target profile revisions.                                               |
| `plan_requests`     | Plan requests from `plan open`.                                         |
| `plan_revisions`    | Plan revisions as JSON snapshots.                                       |
| `decisions`         | Gap answers, and the revision that applied each one.                    |
| `approvals`         | Verdicts on plan revisions and results, with the digest of the subject. |
| `runs`              | Runs: plan revision, target revision, build, selection, and policy.     |
| `run_attempts`      | One row for each start and resume of a run.                             |
| `assertion_results` | One row for each assertion result.                                      |
| `outcomes`          | One row for each closed test.                                           |
| `evidence`          | Evidence rows: test, assertion, kind, name, media type, and digest.     |
| `blobs`             | Evidence bytes, keyed by SHA-256. Equal bytes are stored once.          |
| `findings`          | Defects and potential issues.                                           |
| `run_gaps`          | Gaps that a run found.                                                  |
| `results`           | Finished runs as JSON snapshots.                                        |

The views `latest_plans`, `plan_tests`, and `plan_gaps` read inside the plan snapshots. `plan_tests` and `plan_gaps` have one row for each revision. Use them with `checkmate query`:

```sh
checkmate query "select plan_id, revision, gap_id, status from plan_gaps where status = 'open'"
```

## Review UI

The UI is a `node:http` server in the plugin. It has no npm dependencies and loads nothing from the internet.

- It listens on `127.0.0.1` only. It refuses a request with another `Host` header, and a form from another origin.
- Each form carries a token from the current start of the UI.
- Each form sends the digest of the snapshot on the page. A changed snapshot refuses the action.
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
