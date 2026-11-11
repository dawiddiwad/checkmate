# CLI

Checkmate has one command set with two entry points:

- **Plugin.** In Claude Code, the skills run `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. The plugin has every command, `ui` included. It has no npm dependencies.
- **npm CLI.** The package `@xoxoai/checkmate` installs the `checkmate` command. It contains the plugin and adds `delegate`.

Run commands from the application workspace, or add `--workspace <path>`. Put options after the command name, for example `checkmate plan list --workspace ../app`. The database is `<workspace>/.checkmate/checkmate.db`. Run `checkmate --help` for every command and option.

## Commands

| Group     | Commands                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------- |
| State     | `inbox`, `plan list`, `plan show`, `run list`, `run show`, `log`, `query`                               |
| Target    | `target open`, `target request`, `target save`, `target show`                                           |
| Plan      | `plan open`, `plan request`, `plan save`, `plan pending`, `plan revise`, `plan diff`                    |
| Decisions | `gap answer`, `plan edit`, `plan approve`, `plan reject`, `result accept`, `result reject`              |
| Run       | `run gate`, `run begin`, `run check`, `run close`, `run finding`, `run gap`, `run finish`, `run resume` |
| Output    | `export plan`, `export run`, `evidence get`, `ui`                                                       |
| npm only  | `delegate`                                                                                              |

- `inbox` lists the open gaps without a pending decision, the plans that wait for approval, and the results that wait for acceptance.
- `plan list` takes `--needs-decision`, `--awaiting-approval`, and `--blocked`. `run list` takes `--plan` and `--build`.
- `plan show <planId@rev>` takes `--tests T1,T2`, `--fields <fields>`, and `--gaps open|all`.
- `log` lists the operation log, newest first. It takes `--subject <id>` and `--limit <n>`.
- `query "<sql>"` runs one SQL statement on a read-only connection.

## Input

- Small values are flags. Lists are comma-separated, for example `--tests T1,T2`.
- Structured payloads are JSON on standard input. Use a quoted heredoc. Do not write payload files:

  ```sh
  checkmate run finding run-1 <<'EOF'
  { "id": "F1", "type": "defect", ... }
  EOF
  ```

- `run check` and `run close` take `--evidence -` for text evidence on standard input, and `--evidence -:<kind>` to set the kind. Give a file path only for binary evidence. Read [Evidence](EVIDENCE.md#evidence-input).
- `target open` takes `--tool <name>:<cli|mcp|skill>:<purpose>` once for each tool.

## Actor

Every write records an actor. Checkmate uses the first value that it finds:

1. `--actor <name>`
2. `CHECKMATE_ACTOR`
3. `git config user.name` in the workspace
4. The login name of the operating system user

`delegate` sets `CHECKMATE_ACTOR=claude:<stage>` for its worker. The review UI fills in the same default, and the human can change it. The actor is a record. It is not a proof of identity.

## Output and exit codes

- Line 1 is `<status> <subject>` with short `key=value` facts. Each item is one line, ID first, tab-separated. `reason:` lines follow.
- `--json` prints `{ "status", "subject", "reasons", ... }`.
- `export` prints the report on standard output. With `--out <path>`, it writes a new file and prints the compact response. It refuses an existing file.
- Exit 0 means `completed` or `needs_decision`. Exit 1 means `rejected`, `invalid_request`, `interrupted`, or `operational_error`.

## Delegated stages

```sh
checkmate delegate <setup|plan|revise|execute> <subject> --allow <rule>... [--timeout <seconds>] [--workspace <path>] [--json]
```

| Stage     | Subject    | Before the call                              | The parent checks after the call                       |
| --------- | ---------- | -------------------------------------------- | ------------------------------------------------------ |
| `setup`   | `targetId` | `checkmate target open`                      | The worker saved a profile for the target.             |
| `plan`    | `planId`   | `checkmate plan open`, with no revision      | Revision 1 exists.                                     |
| `revise`  | `planId`   | One or more decisions from `gap answer`      | A new revision exists and no pending decision remains. |
| `execute` | `runId`    | `checkmate run begin` (the run is `started`) | The run is finalized.                                  |

`delegate` starts one new `claude -p` session with the bundled plugin (`--plugin-dir`), JSON output, a response schema, `--permission-prompts none`, and `--no-session-persistence`. The worker writes to the database through the plugin CLI.

The parent does not trust the worker's summary. It requires a structured response for the same subject. Then it reads the database and returns the response of the recorded command. A worker that reports `completed` without the recorded change gives `operational_error`. A worker that reports `needs_decision` without a change gives `needs_decision` with the worker's reasons.

Give one `--allow <rule>` for each Claude tool permission. `delegate` refuses an empty list, because the worker cannot answer permission prompts. The worker writes no files, so it does not need `Write`. Give at least these rules:

| Stage              | Minimum rules                                    |
| ------------------ | ------------------------------------------------ |
| `setup`, `execute` | `Read`, `Bash(node *)`, `Bash(playwright-cli *)` |
| `plan`, `revise`   | `Read`, `Bash(node *)`                           |

Add rules for the tools of the target or the plan, for example `mcp__jira__get_issue`. An execute stage that saves screenshots with another tool can need `Write` for `.checkmate/tmp/<runId>/`. The launcher does not add a permission bypass. It keeps the host configuration, model, and authentication. Use a trusted workspace.

`--timeout <seconds>` sets the deadline. Without it, setup, planning, and revision use 300 seconds. Execution uses the deadline that `run begin` recorded. At the deadline, the launcher stops the worker's process group. It also stops the worker on SIGINT or SIGTERM, and when the worker output exceeds 4 MiB.

After an execute worker, the parent closes the run's browser session with `playwright-cli -s=<browserSession> close`. If the worker stops before `run finish`, the run stays `started`. Recorded assertion results and test outcomes stay. The response is `interrupted` (deadline or signal) or `operational_error`, with the reason `Recorded results stay. Run checkmate run resume <runId> or checkmate run finish <runId> ...`.

Linux process groups are tested. The launcher rejects Windows.

## Review UI

```sh
checkmate ui [--workspace <path>] [--port <n>]
```

In Claude Code, run `/checkmate:ui`. The command prints the local URL on `127.0.0.1`. It runs until SIGINT or SIGTERM. The UI writes to the database only when a human submits a form.

The UI has these pages:

- **Inbox:** the gaps to answer, the plans to approve, and the results to accept. It updates when an agent writes.
- **Plans, Runs, and Log:** lists with 25, 50, or 100 rows for each page, sortable columns, and a filter that applies while you type.
- **Plan:** requirements, coverage, tests, and gaps. A human can edit the tests, the requirements, and the coverage, and approve or reject the revision. Resolved and deferred gaps are collapsed and grey. The revision history shows the latest revision expanded and five earlier revisions collapsed. Click the faded end of the list to load all revisions. The page also lists the runs of the plan.
- **Run:** outcomes, assertions with evidence, findings, and the result decision. Download the report as HTML, JSON, or Markdown.
