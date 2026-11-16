# The record

> **Reference** · The database behind Checkmate: where it is, what it keeps, who wrote each row, and what it does not protect.

All state is in one SQLite file in the project directory. Rows do not change after a write, and each write leaves one row in the operation log.

**On this page:** [Location](#location) · [Rules](#rules) · [Actor](#actor) · [Operation log](#operation-log) · [Tables](#tables) · [Review UI](#review-ui) · [Limits](#limits)

## Location

The database is `<workspace>/.checkmate/checkmate.db`. The workspace is the value of `--workspace <path>`, else the value of `CHECKMATE_WORKSPACE`, else the nearest directory with a store, from the current directory up. Read [Workspace](commands.md#workspace).

- Only `init` and `target open` create `.checkmate/` and the schema. Every other command, the read-only commands and `ui` too, refuses when the workspace has no store. It names the directory that it searched.
- Add `.checkmate/` to `.gitignore`. To keep the record of a change in Git, export it with `checkmate export <changeId> --out <file>`.

## Rules

- Agents and people write only through commands. `checkmate query "<sql>"` opens the database read-only.
- Each write runs in one `BEGIN IMMEDIATE` transaction with its operation row. A refused write changes nothing.
- Rows do not change after a write. Triggers refuse `UPDATE` and `DELETE` on every table.
- A journal entry with `supersedes` adds a row. The earlier row stays, and `export` has it in `history`.
- Retiring an instance adds a row to `instance_retirements`. The instance row does not change.
- A profile is a canonical JSON snapshot. The digest is the SHA-256 of that text. A digest detects change. It does not authenticate the actor.
- The database uses WAL mode, a busy timeout of 30 seconds, and foreign keys. `CHECKMATE_BUSY_TIMEOUT_MS` changes the busy timeout. The CLI and the review UI can use it at the same time. One command writes at a time. Every command waits for the lock, also a read. A command that cannot get the lock in 30 seconds gives `operational_error` and changes nothing. One host writes to one database.
- The schema version is 5. Checkmate refuses a database with another version, with the message `Database <path> has schema version <n>. Expected 5.` There is no migration from earlier databases. Version 4 and earlier had the tables of the plan and run model.

## Actor

Every write records an actor. Checkmate uses the first value that it finds:

1. `--actor <name>`
2. `CHECKMATE_ACTOR`
3. `git config user.name` in the workspace
4. The login name of the operating system user

Checkmate refuses a write without an actor. The review UI fills in the same default. A human can change the name in the header.

The actor is a record. It is not a proof of identity. Checkmate has no authentication and no access control. [Several testers](commands.md#several-testers) tells how the actor name makes an actor a tester.

## Operation log

Each write records one row: the time, the actor, the command, the flags and the payload, the status, the response, and the changed subjects. A refused write also records a row with the status `rejected`. A write that cannot get the database lock records nothing. A read records nothing.

Each row has a row ID. The row ID increases in the order of the writes. The last field of each line is the row ID. A decision line has its rationale before the row ID.

```sh
checkmate operations --subject change:shop-12 --limit 2
```

```text
completed operations
01M7CVS3TPCHJBVEYTHVCAAHB7	2026-11-14T11:06:15.767Z	po	accept	completed	change:shop-12	The totals match the receipt.	42
01M7CVS3M0B4SXWSEEBHYDMTH4	2026-11-14T11:06:15.552Z	qa:a1	log	completed	change:shop-12	41
```

To read only the new operations, give the last row ID that you read: `checkmate operations --after 42`. With `--after`, the log lists the operations oldest first.

## Tables

| Table                  | Holds                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| `meta`                 | The contract version and the schema version.                                |
| `operations`           | The operation log.                                                          |
| `blobs`                | Evidence bytes, keyed by SHA-256. Equal bytes are stored once.              |
| `target_requests`      | Targets from `target open`.                                                 |
| `profiles`             | Target profile revisions.                                                   |
| `instances`            | Instances of a target with their entry values. One row for each add.        |
| `instance_retirements` | One row for each retired instance.                                          |
| `changes`              | Changes from `open`: the target and the instance.                           |
| `journal_entries`      | Journal entries as JSON. One row for each entry and each superseding entry. |

Use them with `checkmate query`:

```sh
checkmate query "select kind, count(*) as n from journal_entries where change_id = 'shop-12' group by kind"
```

## Review UI

The UI is a `node:http` server in the plugin. It has no npm dependencies and loads nothing from the internet.

- It listens on `127.0.0.1` only. It refuses a request with another `Host` header, and a form from another origin.
- Each form carries a token from the current start of the UI.
- The `back` value of a form is a path on the UI only. The UI uses `/` for other values.
- Each action calls the same core function as the CLI command. The UI has no write path of its own.
- Pages send a Content Security Policy that allows only resources from the UI itself.
- The server reads `PRAGMA data_version` every 250 ms. When another process commits, it reads the new operation rows and sends their subjects to the open pages as Server-Sent Events. A page reloads only its changed regions.

## Limits

| The checks show                                           | The checks do not show                       |
| --------------------------------------------------------- | -------------------------------------------- |
| An entry has the right shape and valid references.        | That an observation is true.                 |
| An evidence file is inside the workspace, at most 32 MiB. | That the evidence came from the target.      |
| A digest detects a change to the stored bytes.            | That the tester read the evidence correctly. |
| Each write has an actor.                                  | Who the actor really is.                     |

- The checks are not a sandbox. Use a trusted local workspace.
- Checkmate does not sanitize evidence and cannot delete rows. The workspace owner owns retention.
- Linux is the measured platform. macOS was not tested.
- One host writes to one database. There is no shared database for many hosts.

## Next

- [Commands](commands.md): every command and the journal.
- [Development](../development.md): the tests behind these rules.
