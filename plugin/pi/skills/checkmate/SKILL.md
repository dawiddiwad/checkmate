---
name: checkmate
description: Set up a QA target, save a plan, run tests, and inspect evidence with Checkmate in Pi.
---

Use native `checkmate_*` tools. They take named arguments and return the recorded state. You are the operator. You do not test. Never use curl as a test. Never run a reset yourself or invent a reset command. Report the outcome first, without tool names or internal paths. Ask the person only for a decision or missing value. For an oracle decision, give the relevant page in the Checkmate review UI.

## Set up and plan

If the tool needed for the test has no recipe, add one as part of setup. Use the entry names from its recipe.

1. Read an example with `checkmate recipe list --json`. Write `<tool>.json` and the Markdown file named in `usage` side by side in a draft folder. Include `name`, `capability`, `kind`, `purpose`, `detect`, `environment`, `workspaceFolders`, `observeFrom`, `evidence`, `usage`, and include `entryPoints` for a target that needs inputs such as an inventory file or org alias. Give each entry a `name`, `kind`, and `purpose`. For a CLI, use its executable name with `kind: "cli"` and `detect: "path"`. For MCP, include `server` and `tools`.
2. Run `checkmate recipe add --workspace <absolute project path> --file <recipe.json>`. Use the project folder where this host session started, or the workspace named in the setup refusal. The tool and draft can be elsewhere. Add `--replace` to correct an installed custom recipe with the same name.
3. Verify the reported workspace and fix any validation error. Call `checkmate_setup` with the declared entries. Pass the receipt line that starts with “Report to the person:” to the person.

If `checkmate` is unavailable, use `node "<plugin root>/dist/checkmate.js"` in its place.

1. Ask for the application address or the entries its tool needs. Confirm the environment and permitted operations for a remote target. Use `checkmate_setup` and report its reachability result. Use `checkmate_replace_instance` for an instance correction and use the instance ID it returns.
2. Report assumptions and readiness. Ask for the missing reset or isolation policy when data can change. Do not write a policy or a hook yourself. Stop for setup-only requests.
3. For planning, call `checkmate_open_plan` with a target ID and a request object containing the objective and source files in `context.sources`. Give all sources the person named. Omit the plan ID to derive it from the first source. Use the returned plan ID.
4. Call `checkmate_delegate_work` with stage `plan` and the plan ID. The planner reads the sources and saves the tests and gaps. Report the saved plan and questions. Stop for a plan-only request.

## Test and report

Use the named plan or the only plan in progress. Ask when more than one plan matches or when the person has not given the build. Keep the default level, tester count and deadlines unless the person asks to change them. For exploration, call `checkmate_start_test` and wait for that exploration with `checkmate_test_status`. Stop at a decision for the oracle. For stored tests use `checkmate_begin_run` with a new ID and the named build. Give `retestOf` when the build fixes an earlier defect. Resume a stopped run with `checkmate_resume_run`. If the reply lists `rejections`, the oracle rejected an earlier run of these tests: tell the tester the reason and the test IDs, and use it only where it applies.

If an exploration reports that a host integration needs sign-in, say which integration was unavailable. Let the person sign in through Pi if they need it for another test.

Use `checkmate_delegate_work` with stage `execute` and the run ID as subject. The worker reads the pinned instance, runs the selected tests and records the results. Report the recorded verdict, defects, and coverage. Read the run only if the result lacks those facts. Use `checkmate_inbox` for a request about all open work.

## Decisions of the oracle

Record an answer only when the person answered that question. Send their exact words and the source with `checkmate_answer_gap`. Do not infer a formula or a value. For a slash ID, record the exploration answer, then use `checkmate_follow_test` once for that exploration. For a plan gap, recording the answer starts a reviser. If status still shows `needs_revision` with a pending answer, delegate revise at once. When status says `waitsOn=oracle`, report the open questions and stop. Do not poll or answer them yourself.

Only when the person asks, use the review UI to approve the plan, accept or reject a claim, or keep exploration claims as stored tests. Keep observations as tests only when the person asks, using the factory command `checkmate harvest <explorationId> --observations`. To drop a requirement with the person's decision, use the factory command `checkmate scope drop <planId> <requirementId> --source <source> --rationale <reason>`, then delegate revise. Never change a claim state by editing its record.

## Ask the person

When you need a decision from the person, the choices are few, and the `AskUserQuestion` tool is in your tool list, ask with that tool. Use one call with at most 4 questions and 2 to 4 options for each question. Put the recommended option first, and add "(Recommended)" to its label. Give each question a header of at most 12 characters. Give each option one line that says what happens. Do not add an "Other" option. The tool adds it.

When the tool is not in your tool list, or your task came from an agent, a factory, or a script, do not use the tool. Write the question and its options in your reply as a short numbered list, or return `needs_decision` with the reason. An agent that is the oracle can answer in text.

For a value with no fixed choices, for example a URL or how to sign in, ask one short text question. Do not ask for a secret. Ask where it is kept.

Ask with the tool for:

- The environment of a URL that is not local, and whether testers can make and change data there.
- The target or the instance, when more than one exists.
- The level, only when the person asks for a choice.
- A decision in the middle of a run, for example stop, use another URL, or continue. Record the pause first.
- Accept or reject of a `suspected` or `unresolved` claim, when the person asks to triage.

## Claims

| State        | Meaning                                        | Who acts |
| ------------ | ---------------------------------------------- | -------- |
| `observed`   | One tester reported it with steps or evidence. | factory  |
| `confirmed`  | Two testers reported it, or a verifier saw it. | factory  |
| `suspected`  | The tester was not sure.                       | oracle   |
| `unresolved` | The verifier did not see it.                   | oracle   |
| `accepted`   | The oracle accepted it.                        | factory  |
| `rejected`   | The oracle rejected it.                        | none     |

Do not change a state. Do not remove a claim.
