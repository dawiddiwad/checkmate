# CLI

Checkmate has one command set in two entry points:

- In a Claude Code plugin session, the skills run `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`.
- The npm package `@xoxoai/checkmate` installs the `checkmate` command. It adds `delegate`. The plugin already includes `ui` and all database commands.

Run commands from the caller's workspace, or add `--workspace <path>`. Put options after the command name, for example `checkmate plan list --workspace ../app`. The database is `<workspace>/.checkmate/checkmate.db`. Run `checkmate --help` for the complete list of commands and options.

## Output and exit codes

- Line 1 is `<status> <subject>` with short `key=value` facts. Each item is one line, ID first, tab-separated. `reason:` lines follow.
- `--json` prints `{ "status", "subject", "reasons", ... }`.
- Exit 0 means `completed` or `needs_decision`. Exit 1 means `rejected`, `invalid_request`, `interrupted`, or `operational_error`.
- Every write records an actor. Selection order: `--actor <name>`, `CHECKMATE_ACTOR`, workspace Git `user.name`, then the operating-system user.

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

`delegate` starts one fresh `claude -p` session with the bundled plugin (`--plugin-dir`), JSON output, a response schema, `--permission-prompts none`, and `--no-session-persistence`. The worker writes to the database through the plugin CLI.

The parent does not trust the worker's words. It requires a structured response for the same subject. Then it reads the database and returns the response of the recorded command. A worker that reports `completed` without the recorded change gives `operational_error`. A worker that reports `needs_decision` without a change gives `needs_decision` with the worker's reasons.

Give one `--allow <rule>` for each Claude tool permission. `delegate` refuses an empty list because the worker cannot answer permission prompts. Permit the bundled Node.js command for database access and the host tools that the stage needs. For example, a host that uses Playwright CLI can permit `Bash(playwright-cli *)`; another host can use its browser connector instead.

The launcher keeps the host configuration, model, and authentication. A fresh session does not inherit tools or source content that exist only in the parent's conversation. Provide those through the host configuration or the request's `sourceContext`. Setup and plan instructions guide tool use; native host permissions enforce access.

`--timeout <seconds>` sets the deadline. Without it, setup, planning, and revision use 300 seconds. Execution uses the deadline that `run begin` recorded. At the deadline, the launcher stops the worker's process group. It also stops the worker on SIGINT or SIGTERM, and when the worker output exceeds 4 MiB.

When the target uses Playwright CLI, the parent closes the run's named browser session after execution. Other tools follow the target's cleanup instructions. If the worker stops before `run finish`, the run stays `started`. Recorded assertion results and test outcomes stay. The response is `interrupted` (deadline or signal) or `operational_error`, with the reason `Recorded results stay. Run checkmate run resume <runId> or checkmate run finish <runId> ...`.

Linux process groups are tested. The launcher rejects Windows.

## Review UI

```sh
checkmate ui [--workspace <path>] [--port <n>]
```

The command prints the local URL. It runs until SIGINT or SIGTERM.

The plugin can start the same UI without an npm CLI install:

```text
/checkmate:ui
```

```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" ui --workspace /path/to/application
```

The UI binds to `127.0.0.1`. It supports decisions, plan edits, run links, and report downloads. Lists search the database as filters change. Read [Workflow](WORKFLOW.md#review-and-retest).

## Current state and decisions

Before acting, read the relevant `target request`, `target show`, `plan request`, `plan show`, `plan pending`, or `run show` record. Read again after a write. For a decision based on a displayed snapshot, pass `--expect-sha` when the command supports it.

Agents can record caller decisions directly:

- `gap answer <planId> <gapId>` records a clarification, assumption, or deferral.
- `plan approve <planId@revision>` and `plan reject <planId@revision>` record plan decisions.
- `result accept <runId>` and `result reject <runId>` record result decisions.

Each decision needs a rationale. Approval applies to one revision. A new revision needs its own approval.

Pass JSON payloads on standard input, for example with a here-document or a pipe. Do not keep generated request, candidate, delta, or finding JSON files in the workspace. The database stores these records. Existing caller-owned requirement files can still be used as input.

## Editing a plan

`checkmate plan edit <planId> --expect-sha <digest>` reads JSON on standard input with `objective`, `requirements`, and `tests`. Start from the latest plan so IDs and relationships remain valid. The command creates a new revision, recalculates readiness and coverage, and preserves prior decisions and runs. Apply pending gap decisions with `plan revise` first. Read the new revision before approval.
