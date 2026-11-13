# CLI

Checkmate has one command set with two entry points:

- **Plugin.** In Claude Code, the skills run `node "<plugin root>/dist/checkmate.js" <command>` with the absolute plugin path. Claude Code puts the path into a skill when it loads the skill. The plugin has every command, `ui` included. It has no npm dependencies.
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

- `inbox` lists the open gaps without a pending decision, the plans that wait for approval, the results that wait for acceptance, and the plan requests that have no revision yet. The first field of a line is `<planId@rev>/<gapId>`, `<planId@rev>`, `<runId>`, or `<planId>`. The second field is `gap`, `plan`, `result`, or `requested`. A requested plan waits for the plan stage.
- `plan list` shows each plan at its latest revision, and each plan request without a revision as `<planId> status=requested`. It takes `--needs-decision`, `--awaiting-approval`, and `--blocked`. `run list` takes `--plan` and `--build`.
- `plan show <planId@rev>` takes `--tests T1,T2`, `--fields <fields>`, and `--gaps open|all`. A plan ID without a revision shows the latest revision. `run show <runId>` takes `--tests`.
- `log` lists the operation log, newest first. It takes `--subject` and `--limit <n>` (default 50). A subject is `target:<targetId>`, `plan:<planId>`, `run:<runId>`, or `inbox`.
- `query "<sql>"` runs one SQL statement on a read-only connection.

## Input

- Small values are flags. Lists are comma-separated, for example `--tests T1,T2`.
- Structured payloads are JSON on standard input. A caller can redirect a file, for example `plan open checkout --target shop@1 < request.json`. A delegated worker or a skill sends the JSON in a quoted heredoc and does not write payload files:

  ```sh
  checkmate run finding run-1 <<'EOF'
  { "id": "F1", "type": "defect", ... }
  EOF
  ```

- `run check` and `run close` take `--evidence -` for text evidence on standard input, and `--evidence -:<kind>` to set the kind. Give a file path only for binary evidence. Read [Evidence](EVIDENCE.md#evidence-input).
- `target open` takes `--tool <name>:<cli|mcp|skill>:<purpose>` once for each tool.

## Actor

Every write records an actor: `--actor <name>`, else `CHECKMATE_ACTOR`, else `git config user.name`, else the login name. `delegate` sets `CHECKMATE_ACTOR=claude:<stage>` for its worker. Read [Configuration](CONFIGURATION.md#actor).

## Output and exit codes

- Line 1 is `<status> <subject>` with short `key=value` facts. Each item is one line, ID first, tab-separated. `reason:` lines follow.
- `--json` prints `{ "status", "subject", "reasons", ... }`.
- `export` prints the report on standard output. With `--out <path>`, it writes a new file and prints the compact response. It refuses an existing file.

| Status              | Meaning                                                                                                  | Exit |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ---- |
| `completed`         | The command did its work.                                                                                | 0    |
| `needs_decision`    | The caller must decide or give input. Read the `reason:` lines. The command can have recorded its write. | 0    |
| `rejected`          | Checkmate refused the command. Nothing changed. Correct the input and try again.                         | 1    |
| `invalid_request`   | The command name or the options are wrong.                                                               | 1    |
| `interrupted`       | A run or a delegated worker stopped at the deadline or on a signal.                                      | 1    |
| `operational_error` | A tool, access, or worker failure stopped the work.                                                      | 1    |

`needs_decision` exits with 0. Read line 1, not only the exit code. For example, `plan save` with open gaps gives `needs_decision`, and `run gate` or `run begin` gives `needs_decision` when the gate refuses the run. Then `run begin` creates no run.

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

The parent does not trust the worker's summary. It requires a structured response for the same subject. Then it reads the database and returns the response of the recorded command, with `operation=<id>` on line 1. A worker that reports `completed` without the recorded change gives `operational_error`. In setup, plan, and revise, a worker that reports `needs_decision` without a change gives `needs_decision` with the worker's reasons, for example a source that it cannot read. In execute, a run that is not finished gives `operational_error`.

Give one `--allow <rule>` for each Claude tool permission. `delegate` refuses an empty list, because the worker cannot answer permission prompts. Give at least `Read` and `Bash` for each stage:

```sh
checkmate delegate plan checkout --allow Read --allow Bash
```

The worker sends JSON payloads to the plugin CLI on standard input with a heredoc. The permission check of Claude Code blocks a heredoc that contains JSON when the rule is a prefix rule, for example `Bash(node *)`. Thus a prefix rule is not sufficient. `Bash` lets the worker run any shell command in the workspace. The worker writes no payload files, so it does not need `Write`.

Add rules for the tools of the target or the plan. `mcp__jira` allows every tool of the `jira` MCP server, and `mcp__jira__get_issue` allows one tool. The worker loads the MCP servers of the host configuration. An execute stage that saves screenshots with another tool can need `Write` for `.checkmate/tmp/<runId>/`. The launcher does not add a permission bypass. The host owns the permissions, the configuration, the model, and the authentication. Use a trusted workspace.

`--timeout <seconds>` sets the deadline. Without it, setup, planning, and revision use 300 seconds. Execution uses the deadline that `run begin` recorded. At the deadline, the launcher stops the worker's process group. It also stops the worker on SIGINT or SIGTERM, and when the worker output exceeds 4 MiB.

After an execute worker, the parent closes the run's browser session with `playwright-cli -s=<browserSession> close`. If the worker stops before `run finish`, the run stays `started`. Recorded assertion results and test outcomes stay. The response is `interrupted` (deadline or signal) or `operational_error`, with the reason `Recorded results stay. Run checkmate run resume <runId> or checkmate run finish <runId> ...`.

Linux process groups are tested. The launcher rejects Windows.

## Review UI

```sh
checkmate ui [--workspace <path>] [--port <n>]
```

In Claude Code, run `/checkmate:ui`. The command prints the local URL on `127.0.0.1`. It runs until SIGINT or SIGTERM. The UI writes to the database only when a human submits a form. Each page updates when another process writes.

- **Inbox** (`/`): the gaps to answer, the plans to approve, the results to accept, and the plans to draft. After a decision, the UI opens the next item.
- **Plans, Runs, and Log:** 25, 50, or 100 rows for each page. Click a column header to sort. The search field filters while you type. The URL keeps the list state.
- **Plan** (`/plans/<planId>@<rev>`): tests, gaps, requirements and coverage, runs of the plan, decisions, and history. Approve or reject the revision here. `Export` downloads the plan as HTML, Markdown, or JSON. Resolved and deferred gaps are folded below the open gaps. The history shows the latest revision open and five earlier revisions folded. `Show full history` loads the rest.
- **Plan editor** (`/plans/<planId>@<rev>/edit`, `Edit plan` on the plan page): forms for the requirements, the tests, the assertions, and the coverage. `Edit as JSON` adds or removes requirements, tests, assertions, and gaps. The rules of `plan edit` apply. Only the latest revision can change.
- **Run** (`/runs/<runId>`): outcomes, assertions with evidence, findings, new gaps, coverage, and the result decision. When the run is finished, `Download report` gives HTML, Markdown, or JSON (`/runs/<runId>/report.html`, `.md`, or `.json`).

Each form records an actor. The UI fills in the default actor of the commands. The header shows `actor: <name>`. Click it to change the name. The UI keeps the new name in a cookie.

Each form sends the digest of the shown snapshot. When the snapshot changed, the UI refuses the action, keeps the typed text, and shows a message.
