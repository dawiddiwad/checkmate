# CLI

Use `node /absolute/path/to/checkmate/plugin/bin/checkmate.ts <command>`. Run commands from the caller's workspace. Use `--workspace <path>` to select another directory. Paths in JSON remain relative to that workspace.

| Command                                  | Input                            | Effect                                                                   |
| ---------------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `validate <kind> file.json`              | A document of the named kind     | Check the contract. Profile and plan checks include relationships.       |
| `setup request.json candidate.json`      | Setup request and profile        | Save a new profile, or accept an identical existing profile.             |
| `save-plan request.json candidate.json`  | Plan or revise request and plan  | Check scope and decisions. Calculate coverage. Publish a revision.       |
| `gate request.json`                      | Execute request                  | Check digests, gaps, capabilities, operations, and prerequisites.        |
| `begin request.json`                     | Execute request                  | Apply the gate. Reserve the output directory with an invocation record.  |
| `finalize request.json observation.json` | Execute request and observations | Record evidence digests. Calculate coverage. Publish result and reports. |
| `report request.json`                    | Report request                   | Generate views from a pinned result.                                     |
| `delegate request.json`                  | Any stage request                | Run one fresh host session, or render a report directly.                 |

`validate` needs the document kind: `request`, `profile`, `plan`, `plan-candidate`, `observation`, or `result`. It does not guess the kind. Use `plan-candidate` and `observation` to check a document before you publish it.

The plugin calls the same TypeScript entry point. No global npm command is installed.

`delegate` starts one headless session of a host CLI. Select the host with `--host`. The hosts are `claude` (the default), `codex`, and `pi`. The launcher starts the command with the same name. The host keeps its own model, authentication, and configuration.

Use `--allow <rule>` for each permission in a delegated stage. A rule uses the format of the selected host. The launcher gives the rules to the host. It does not translate them. `delegate` refuses to start without at least one rule, because the worker cannot answer permission prompts. Give at least these rules:

| Stage            | `claude`                                                  | `codex`                      | `pi`                    |
| ---------------- | --------------------------------------------------------- | ---------------------------- | ----------------------- |
| `setup`          | `Read`, `Write`, `Bash(node *)`, `Bash(playwright-cli *)` | `workspace-write`, `network` | `read`, `write`, `bash` |
| `plan`, `revise` | `Read`, `Write`                                           | `workspace-write`            | `read`, `write`         |
| `execute`        | `Read`, `Write`, `Bash(node *)`, `Bash(playwright-cli *)` | `workspace-write`, `network` | `read`, `write`, `bash` |
| `report`         | None. `delegate` renders the report without a host.       | None                         | None                    |

- `claude`: each rule is a Claude Code tool rule. Add rules for the target's own tools, if a stage needs them.
- `codex`: give exactly one sandbox mode, `read-only` or `workspace-write`. Add `network` to permit network access in the sandbox. Codex has no rule for each command.
- `pi`: each rule is a pi tool name. pi has no permission system. Its `bash` tool can run any command. Add `--unrestricted-host` to accept this. `delegate` refuses a `pi` worker without it.

The launcher does not add a permission bypass. It preserves host configuration and authentication. Repository hooks and instructions can run under normal host configuration. Use a trusted workspace.

`--timeout <seconds>` sets the deadline of a delegated stage. The maximum is 3600 seconds. Without it, setup, planning, and revision use 300 seconds, and execution uses `timeoutSeconds` from its request. For execution, `--timeout` overrides the request, and `invocation.json` records the applied deadline as `deadlineSeconds`. `--host`, `--allow`, `--unrestricted-host`, and `--timeout` apply only to `delegate`.

## Responses

Stage responses contain `contractVersion`, `requestId`, `operation`, `status`, `artifact`, and `reasons`. A delegated stage response also contains `usage`: the tokens, context, and cost that the host reported for the stage. See [Stage usage](CONFIGURATION.md#stage-usage).

- `completed`: the stage produced a checked artifact, or the gate accepted the request.
- `needs_decision`: access, readiness, or a caller decision is missing.
- `invalid_request`: the input violates a contract or relationship.
- `interrupted`: the worker exceeded its deadline or received a stop signal.
- `operational_error`: the worker or finalizer could not complete the stage.

Exit 0 means that a valid stage response was produced. This includes `needs_decision` and completed results with defects. Exit 1 means invalid input, interruption, or an operational error. Inspect the payload.

Malformed input can have no valid request identity. Its error response contains only `status` and `reasons`.

## Delegated stages

The launcher uses an argument array. The prompt names the stage skill file and tells the worker to follow it. A host that can load a skill directly also gets the skill: Claude Code with `--plugin-dir`, and pi with `--skill`. Claude Code and Codex read the prompt from standard input. pi gets the prompt as an argument.

The launcher selects two paths: the candidate file and the response file. The worker writes the candidate and a stage response with `artifact: null`. The response must match `response.schema.json`. The launcher reads both files, checks them, and publishes the candidate. It does not accept prose as a result. The host output is used only to detect a failed session and to read the model name and usage.

Each invocation starts a fresh session. All required context must be in the request and saved inputs. Model selection remains a host setting.

For execution, the parent applies the gate before it starts the worker. It records `startedAt`, a unique `browserSession`, the applied `deadlineSeconds`, and the worker `host` in `invocation.json`. The host record contains the host name, the version that the host CLI reports, and the permission mode: `allow_rules` or `unrestricted`. The worker uses `startedAt` and `browserSession`. The parent checks the candidate before finalization. The result records the same host and the model from the host output, with `source: "launcher"`. The model is `null` when the host output does not name it. Codex output does not name the model.

A stopped or failed worker does not produce a completed result. If no checked observation is available, the finalizer records selected tests as errors with unknown observations. It keeps omitted tests visible. Do not infer that no target action occurred. An invalid candidate cannot be published as a result. `launcher-error.json` records the failure when applicable.

If the finalizer rejects a received observation, the run gets no result. `launcher-error.json` records the reason and the `candidate` path. The candidate stays in place. To recover the run:

1. Read the reason in `launcher-error.json`.
2. Copy the candidate and correct the copy. Change only what the reason names. Do not invent observations.
3. Run `checkmate finalize request.json corrected-observation.json` for the same request. The parent attempts to close only the reserved browser session. Use a browser idle timeout as an additional cleanup measure.

Linux process groups are tested. The launcher rejects Windows. macOS process groups use the same code but are not in the measured support baseline.

## Setup request example

Save this file in the caller's workspace. Replace the URL and allowed operations for your target.

```json
{
	"contractVersion": "toolkit-2",
	"requestId": "setup-local",
	"operation": "setup",
	"caller": "developer",
	"profilePath": ".checkmate/profile.json",
	"targetId": "local-app",
	"baseUrl": "http://127.0.0.1:3000",
	"capabilities": ["browser", "http"],
	"allowedOperations": ["read_catalog"]
}
```

In Claude Code, invoke `/checkmate:checkmate-setup` with this request file. In Codex, use `$checkmate-setup`. In pi, use `/skill:checkmate-setup`. Then create a plan request with the returned profile reference. Use `plugin/contracts/plan-request.schema.json` for its fields.
