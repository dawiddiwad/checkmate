# CLI and record reference

Use `checkmate --help` for the complete command list from the installed version. Add `--json` for structured output. Add `--workspace <path>` to use another project directory.

## Common sequence

| Purpose                         | Command                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| Set up a URL and local instance | `checkmate setup --url <url>`                                                                  |
| Open a plan                     | `checkmate plan open <planId> --target <targetId@revision> --objective <text> --source <file>` |
| Delegate a stage                | `checkmate delegate <setup\|plan\|revise\|execute> <subject>`                                  |
| Review source requirements      | `checkmate delegate spec <planId@revision>`                                                    |
| See the next owner and action   | `checkmate status <planId>`                                                                    |
| Find work for the oracle        | `checkmate inbox`                                                                              |
| Read new record operations      | `checkmate log --after <rowid> --json`                                                         |
| Start a run on a named build    | `checkmate run begin <runId> <planId@revision> --build <build>`                                |
| Run a permanent snapshot        | `checkmate run permanent <runId> <planId> --build <build>`                                     |
| Accept or reject a result       | `checkmate result accept\|reject <runId> --rationale <text>`                                   |
| Promote passing tests           | `checkmate plan promote <planId@revision> --run <runId> --build <build> --rationale <text>`    |
| Export a report                 | `checkmate export run <runId> --format <md\|html\|json\|junit>`                                |
| Start or stop the review UI     | `checkmate ui` or `checkmate ui --stop`                                                        |

The examples omit optional `--actor` and `--workspace` flags. Claude Code delegation needs `--allow <rule>` for each required tool. Pi delegation uses `CHECKMATE_HARNESS=pi` and omits `--allow` and `--claude-arg`. The host enforces its own permissions.

## Plans and contracts

A plan revision contains requirements, tests, and gaps. A test names its rules, capability, operations, preconditions, action, and assertions. An assertion has a known expected value. An unknown expected value belongs in an open gap.

Use the JSON Schemas as the contract:

- [Plan candidate](../plugin/contracts/plan-candidate.schema.json): fields a planner can save.
- [Plan](../plugin/contracts/plan.schema.json): stored revisions and computed fields.
- [Target profile](../plugin/contracts/profile.schema.json) and [instance](../plugin/contracts/instance.schema.json).
- [Run result](../plugin/contracts/result.schema.json), [finding](../plugin/contracts/finding.schema.json), and [gap](../plugin/contracts/gap.schema.json).

The planner saves only the candidate fields. Checkmate calculates readiness, coverage, decisions, and revision digests. Do not write those derived values into a candidate. The schemas are authoritative when an example differs.

## Status and decisions

`checkmate status <planId>` names the state, the owner, the blockers, and suggested `next` commands. Read the reasons and current record before acting. The `next` command is a hint with placeholders; replace each placeholder with the current value.

Common states:

| State               | Owner   | Meaning                                         |
| ------------------- | ------- | ----------------------------------------------- |
| `ready_to_test`     | QA      | A plan can start its first test or exploration. |
| `needs_answers`     | oracle  | A blocking gap or run gap is open.              |
| `needs_revision`    | planner | An oracle answer needs a new plan revision.     |
| `needs_approval`    | oracle  | The latest revision needs approval.             |
| `ready_to_run`      | QA      | A test can start.                               |
| `run_in_progress`   | QA      | A run is started.                               |
| `defects_open`      | factory | QA recorded a defect that needs a fix.          |
| `needs_retest`      | QA      | A ready test needs a current result.            |
| `awaits_acceptance` | oracle  | QA finished; the result needs a decision.       |
| `accepted`          | none    | The oracle accepted the required results.       |

A command can return `needs_decision` when a person must decide or provide input. Read each `reason:` line. It is not the same as a command failure. A `rejected` response lists a gate or validation reason. Correct that reason before retrying.

An answer is pending until the planner applies it. Approval applies to one revision. A result decision applies to one recorded run. Acceptance means the record is correct; it does not mean that every test passed or that Checkmate released the application.

## Run recovery

A stopped process does not complete its run. Checkmate keeps the record and any evidence already written. Read the open tests before resuming:

```sh
checkmate run show <runId>
checkmate run resume <runId>
```

Resume checks the current instance, profile, and gate. It records a new attempt and lists the open tests. It does not run test actions. If you cannot safely continue a test that may have changed the application, close it as `error` and explain why. Read [Local human-oracle QA](local-qa.md#review-a-result-and-retry) for the full procedure.

## Promotion and permanent runs

`plan promote` records an explicit oracle decision. It requires a completed, accepted, passing run of the latest plan revision on the latest recorded build, with evidence for every assertion. Every rule must have a test, every test must pass in that one run, and no gap, question, or claim can remain open.

The promotion creates an immutable test snapshot. Later plan edits do not change it. `run permanent` requires an explicit `--build` and uses the most recent promotion by source revision if it remains valid. Use `--promotion` to require that exact snapshot. It starts no exploration and accepts no discovery findings. Checkmate refuses a wrong, stale, empty, rejected, or withdrawn promotion; it does not fall back to an older snapshot.

See [Factory workflows](factory.md) for the three complete paths and the ownership rules.

## Record and limits

The record is `.checkmate/checkmate.db` in the workspace. Add `.checkmate/` to `.gitignore`. Export data when you need a file to share:

```sh
checkmate export plan <planId@revision> --format md --out plan.md
checkmate export run <runId> --format html --out run.html
```

Checkmate records evidence and decisions. It does not verify that a source is true, judge a model, start the application, or enforce host permissions. For a pre-build review, source matching checks that a quote exists in the named local file; it does not judge the reviewer’s conclusion.

`checkmate log --after <rowid> --json` returns operations after a saved row ID, oldest first. A factory can poll this record and notify its oracle. Checkmate does not send notifications.
