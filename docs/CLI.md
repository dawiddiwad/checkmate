# CLI

Checkmate has one command set in two entry points:

- In a Claude Code plugin session, the skills run `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`.
- The npm package `@xoxoai/checkmate` installs the `checkmate` command. It adds `delegate` and `ui`. It passes every other command to the plugin CLI.

Run commands from the caller's workspace, or add `--workspace <path>`. Put options after the command name, for example `checkmate plan list --workspace ../app`. The database is `<workspace>/.checkmate/checkmate.db`. Run `checkmate --help` for the complete list of commands and options.

## Output and exit codes

- Line 1 is `<status> <subject>` with short `key=value` facts. Each item is one line, ID first, tab-separated. `reason:` lines follow.
- `--json` prints `{ "status", "subject", "reasons", ... }`.
- Exit 0 means `completed` or `needs_decision`. Exit 1 means `rejected`, `invalid_request`, `interrupted`, or `operational_error`.
- Every write needs an actor: `--actor <name>`, or `CHECKMATE_ACTOR`.

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

`delegate` starts one fresh `claude -p` session with the bundled plugin (`--plugin-dir`), JSON output, a response schema, `--permission-prompts none`, and `--no-session-persistence`. It sets `CHECKMATE_ACTOR=claude:<stage>` for the worker. The worker writes to the database through the plugin CLI.

The parent does not trust the worker's words. It requires a structured response for the same subject. Then it reads the database and returns the response of the recorded command. A worker that reports `completed` without the recorded change gives `operational_error`. A worker that reports `needs_decision` without a change gives `needs_decision` with the worker's reasons.

Give one `--allow <rule>` for each Claude tool permission. `delegate` refuses an empty list, because the worker cannot answer permission prompts. Give at least these rules:

| Stage              | Minimum rules                                             |
| ------------------ | --------------------------------------------------------- |
| `setup`, `execute` | `Read`, `Write`, `Bash(node *)`, `Bash(playwright-cli *)` |
| `plan`, `revise`   | `Read`, `Write`, `Bash(node *)`                           |

Add rules for the target's own tools when a stage needs them. The launcher does not add a permission bypass. It keeps the host configuration, model, and authentication. Use a trusted workspace.

`--timeout <seconds>` sets the deadline. Without it, setup, planning, and revision use 300 seconds. Execution uses the deadline that `run begin` recorded. At the deadline, the launcher stops the worker's process group. It also stops the worker on SIGINT or SIGTERM, and when the worker output exceeds 4 MiB.

After an execute worker, the parent closes the run's browser session with `playwright-cli -s=<browserSession> close`. If the worker stops before `run finish`, the run stays `started`. Recorded assertion results and test outcomes stay. The response is `interrupted` (deadline or signal) or `operational_error`, with the reason `Recorded results stay. Run checkmate run resume <runId> or checkmate run finish <runId> ...`.

Linux process groups are tested. The launcher rejects Windows.

## Review UI

```sh
checkmate ui [--workspace <path>] [--port <n>]
```

The command prints the local URL. It runs until SIGINT or SIGTERM.
