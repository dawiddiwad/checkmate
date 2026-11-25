# CLI and record reference

If Checkmate reports that the workspace database came from an older version, move the `.checkmate` folder aside. Run setup to start a fresh workspace.

Use `checkmate --help` for the complete command list from the installed version. Add `--json` for structured output. Add `--workspace <path>` to use another project directory.

## Common sequence

| Purpose                                            | Command                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Set up a URL and local instance                    | `checkmate setup --url <url>`                                                                                                                     |
| Set up an app that is not a web app                | `checkmate setup --entry <name>=<value> [--entry <name>=<value>]` (for example `--entry app=<app ID> --entry device=<device ID>`)                 |
| Record the data policy of a target                 | `checkmate setup --target <targetId> --reset "<command>"` or `--data environment\|isolation --policy "<text>"`                                    |
| Correct the operations or endpoint of a web target | `checkmate setup --correct --target <targetId> --instance <instanceId> --url <url> [--operations <a,b>] [--environment <name>] [--build <build>]` |
| Replace an instance                                | `checkmate target instance replace <targetId> <instanceId> --entry <name=value> [--environment <name>] [--build <build>]`                         |
| Open a plan                                        | `checkmate plan open [planId] --target <targetId@revision> --objective <text> --source <file>`                                                    |
| Delegate a stage                                   | `checkmate delegate <setup\|plan\|revise\|execute> <subject>`                                                                                     |
| Review source requirements                         | `checkmate delegate spec <planId@revision>`                                                                                                       |
| See the next owner and action                      | `checkmate status <planId>`                                                                                                                       |
| Find work for the oracle                           | `checkmate inbox`                                                                                                                                 |
| Read new record operations                         | `checkmate log --after <rowid> --json`                                                                                                            |
| Start a run on a named build                       | `checkmate run begin <runId> <planId@revision> --build <build>`                                                                                   |
| Run a permanent snapshot                           | `checkmate run permanent <runId> <planId> --build <build>`                                                                                        |
| Accept or reject a result                          | `checkmate result accept\|reject <runId> --rationale <text>`                                                                                      |
| Promote passing tests                              | `checkmate plan promote <planId@revision> --run <runId> --build <build> --rationale <text>`                                                       |
| Export a report                                    | `checkmate export run <runId> --format <md\|html\|json\|junit>`                                                                                   |
| Start or stop the review UI                        | `checkmate ui` or `checkmate ui --stop`                                                                                                           |

The examples omit optional `--actor` and `--workspace` flags. Claude Code delegation needs `--allow <rule>` for each required tool. Pi delegation uses `CHECKMATE_HARNESS=pi` and omits `--allow` and `--claude-arg`. The host enforces its own permissions.

Delegated workers use the models that you save on the Settings page of the review UI. The `delegate` command and the `delegate_work` tool use the same rules:

- Execute workers and probes use the tester model and the tester effort.
- Setup, plan, and revise workers use the chat model and the chat effort.
- An empty model setting uses the default model of the harness.
- An explicit model of the caller takes precedence over the setting and its effort: `--claude-arg --model <id>` for Claude Code, or `CHECKMATE_PI_MODEL` for Pi.
- Checkmate sends a saved effort only when the host catalog advertises that effort for the model.

If the host refuses the saved model before the worker writes, the worker runs again on the harness default. The other workers of the same delegate call also use the harness default. The reply then has a reason and `modelFallback`, with the saved model and the refusal of the host. The recorded attempt has the same `modelFallback`. `observedModels` gives the models that ran.

## Targets that are not web applications

A target has the entry points that the recipes of its tools declare. The web tools (`node`, `playwright-cli`) declare `web`, a URL that must start with `http://` or `https://`. The Maestro tool declares `app` and `device`. Quick setup takes the entries by name. `--url <url>` is the short form of `--entry web=<url>`. `checkmate test` takes the same flags for a first setup.

```sh
checkmate setup --entry app=com.example.shop --entry device=<device ID> --target shop-app
checkmate setup --target shop-app --data environment --policy "The simulator is reset by hand."
```

Setup records the installed tools whose recipes fit the entries. A tool that needs an entry that you did not give is not recorded. Setup refuses an entry that no recipe declares, a value that does not match the pattern of its entry, and entries that no installed tool fits. The refusal names the entries that are missing. Setup runs the reachability checks that the recipes give. A recipe without a check leaves the instance not checked, and setup says so. A setup with only `--target` and a data flag records the data policy of a target that is set up and leaves its instances as they are.

The prompts of delegated workers name the entries from the profile, for example "the app and device entries", and the plan prompt lists the `observeFrom` values of the target tools. `checkmate plan request <planId>` prints them.

## Add a project tool recipe

Checkmate loads built-in recipes and project recipes from `.checkmate/recipes/`. A recipe has a JSON file and the Markdown usage file it names. Run `checkmate recipe list --json` to read existing recipes and their usage text. The review UI shows the same recipes on the Settings > Recipes page. The page is read-only.

To add a recipe, write both files in a draft folder. The JSON file name must match the recipe name. Run `checkmate recipe add --file <recipe.json>` from the project. The command checks both files before it installs them. If it refuses a recipe, correct the field or file in the message and run the command again. Recipe names are unique without regard to case. Choose a different name if a built-in or project recipe already uses it.

Commit both installed files to share the recipe with your team. Checkmate loads them from the checkout. Review recipes as project code because setup and testers can run commands that recipes specify.

### Salesforce CLI example

Save this as `draft/sf.json`. Setup looks for `sf` on `PATH` and checks the org with a read-only SOQL query. [Salesforce CLI command reference](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_data_query.html)

```json
{
	"name": "sf",
	"capability": "salesforce",
	"kind": "cli",
	"purpose": "Read records from a Salesforce org.",
	"detect": "path",
	"entryPoints": [{ "name": "org", "kind": "value", "purpose": "Salesforce org alias." }],
	"reachable": [
		{
			"check": "command",
			"run": [
				"sf",
				"data",
				"query",
				"--query",
				"SELECT Id FROM Organization LIMIT 1",
				"--target-org",
				"{org}",
				"--json"
			]
		}
	],
	"environment": {},
	"workspaceFolders": [],
	"observeFrom": { "soql": "state" },
	"evidence": ["soql_result"],
	"usage": "sf.md"
}
```

In `draft/sf.md`, tell the tester to run `sf data query --target-org <org entry> --query '<SOQL>' --json` and record the relevant result as `soql_result` evidence. Use an org alias that your Salesforce CLI already knows:

```sh
checkmate recipe add --file draft/sf.json
checkmate setup --target salesforce --entry org=my-sandbox --operations read_records
```

## Agent tools

The Claude Code plugin serves Checkmate actions through its local MCP server. The Pi package registers the same actions as native tools. The host gives each tool its workspace and role. An action takes named arguments. Its result gives the recorded state or a refusal with reasons and a next action.

Pi explorers use host tools and MCP servers for context when started by the extension or review UI, or when the CLI caller omits `--allow`. Their Checkmate actions are disabled. The tool policy limits built-in edits and writes to each tester's work folder. The review UI still asks about a call that its tool rules do not approve. Factory exploration with `--allow` and delegated stages use explicit tool sets.

| Work                        | Tools with the `checkmate_` prefix                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Inspect or correct a target | `list_targets`, `show_target`, `setup`, `replace_instance`                                                                |
| Plan and answer             | `open_plan`, `read_plan_request`, `save_plan`, `read_pending`, `revise_plan`, `edit_plan`, `answer_gap`                   |
| Explore                     | `start_test`, `test_status`, `pause_test`, `follow_test`, `next_tester_steps`, `tester_steps_started`, `tester_step_done` |
| Execute stored tests        | `begin_run`, `read_run`, `resume_run`, `record_check`, `close_test`, `record_finding`, `record_gap`                       |
| Start an independent worker | `delegate_work`                                                                                                           |
| Review state                | `status`, `inbox`                                                                                                         |

The operator opens requests and starts independent planners, revisers and testers. Only the assigned worker can save a plan or its revision, record a check, or close a test through a host tool. The launcher closes a test whose worker recorded all observed checks and records the final run outcome. A plan gap answer starts a reviser immediately. A question from exploration is recorded for follow-up testing. Give the person's exact answer.

Use the returned target, plan, and instance IDs for subsequent actions. To correct a web target, use setup with the `correct` field. To replace an instance, supply its complete entry values. A target correction applies to a plan before its first stored run. The first run pins the corrected profile. An exploration or run uses the replacement instance's URL in place of a superseded URL from that instance's history. Previously recorded runs retain their pinned profile and instance.

For a structured check, give only the observed item, for example `"400"` for HTTP status. Give `absent: true` after a successful read when the item is missing. Put the response and request details in `evidence: [{text, kind}]`. To attach a file, use `[{file, kind}]` with a fresh file from the run evidence directory. A successful call consumes the file. An incomplete test closed as an operational error keeps its observations without requiring a defect finding. A completed tester step can report a product defect. Give a step failure only for an agent or host failure.

The CLI still serves scripts, factory stages, review UI chat, exports, permanent runs, approvals, permissions, and recovery operations. Checkmate's CLI and host tools validate supported actions with the same [action schemas](../plugin/contracts/actions.schema.json). Factory grants and target credentials stay with the host.

## Plans and contracts

A plan revision contains requirements, tests, and gaps. A test names its rules, capability, operations, preconditions, action, and assertions. An assertion has a known expected value. An unknown expected value belongs in an open gap.

Use the JSON Schemas as the contract:

- [Plan candidate](../plugin/contracts/plan-candidate.schema.json): fields a planner can save.
- [Plan](../plugin/contracts/plan.schema.json): stored revisions and computed fields.
- [Target profile](../plugin/contracts/profile.schema.json) and [instance](../plugin/contracts/instance.schema.json).
- [Run result](../plugin/contracts/result.schema.json), [finding](../plugin/contracts/finding.schema.json), and [gap](../plugin/contracts/gap.schema.json).
- [Journal entries](../plugin/contracts/journal-entry.schema.json). Checkmate validates each entry before it adds the build from the exploration.
- [Extracted rules](../plugin/contracts/worker-rule.schema.json) and [verification results](../plugin/contracts/verification.schema.json). Checkmate records valid items and reports refused items by index. It assigns rule IDs.

An instance can declare which build it serves. A run or exploration can start on that instance only for that build.

Setup and testing commands validate input shapes before they change records or contact the application. The CLI, review forms, and host actions use the same contracts for those inputs. Run checks and test closings use the action contract before they record evidence or outcomes.

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

For a pipeline, read the exit code, not only the text. The exit-code table for each command is in [Factory workflows](factory.md#exit-codes-for-a-pipeline). `checkmate status <planId>` exits 0 by default, also when the plan waits on the oracle. Add `--fail-on-blocked` to exit with code 3 when an open blocking gap exists or `waitsOn=oracle`. Code 1 means a rejected or failed command. Code 0 means completed or `needs_decision`. A pipeline that needs the decision state must use `--fail-on-blocked` or read the `waitsOn` line.

A command can return `needs_decision` when a person must decide or provide input. Read each `reason:` line. It is not the same as a command failure. A `rejected` response lists a gate or validation reason. Correct that reason before retrying.

An answer is pending until the planner applies it. Approval applies to one revision. A result decision applies to one recorded run. Acceptance means the record is correct; it does not mean that every test passed or that Checkmate released the application.

## Run recovery

A stopped process does not complete its run. Checkmate keeps the record and any evidence already written. Read the open tests before resuming:

```sh
checkmate run show <runId>
checkmate run resume <runId>
```

Resume checks the current instance, profile, and gate. It records a new attempt and lists the open tests. `run begin` and `run resume` also print a `rejection` line for each open rejection that covers a test of the run, with the reason of the oracle. A permanent run has none. It does not run test actions. If you cannot safely continue a test that may have changed the application, close it as `error` and explain why. Read [Local human-oracle QA](local-qa.md#review-a-result-and-retry) for the full procedure.

## Promotion and permanent runs

`plan promote` records an explicit oracle decision. It requires a completed, accepted, passing run of the latest plan revision on the latest recorded build, with evidence for every assertion. Every rule must have a test, every test must pass in that one run, and no gap, question, or claim can remain open.

The promotion creates an immutable test snapshot. Later plan edits do not change it. `run permanent` requires an explicit `--build` and uses the most recent promotion by source revision if it remains valid. Use `--promotion` to require that exact snapshot. It starts no exploration and accepts no discovery findings. Checkmate refuses a wrong, stale, empty, rejected, or withdrawn promotion; it does not fall back to an older snapshot.

See [Factory workflows](factory.md) for the three complete paths and the ownership rules.

## Record and limits

The record is `.checkmate/checkmate.db` in the workspace. Ignore `.checkmate/checkmate.db*`, `.checkmate/tmp/`, and `.checkmate/ui.json` in Git. Keep `.checkmate/recipes/` trackable. Export data when you need a file to share:

```sh
checkmate export plan <planId@revision> --format md --out plan.md
checkmate export run <runId> --format html --out run.html
```

Checkmate records evidence and decisions. It does not verify that a source is true, judge a model, start the application, or enforce host permissions. For a pre-build review, source matching checks that a quote exists in the named local file; it does not judge the reviewer’s conclusion.

`checkmate log --after <rowid> --json` returns operations after a saved row ID, oldest first. A factory can poll this record and notify its oracle. Checkmate does not send notifications.
