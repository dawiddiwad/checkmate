1. Run `target list` and `plan list`. Use an existing plan only when the person names it or names its ticket. Use an existing target only when the person names it or it is the only target.
2. For a new target, ask for the running URL. For a remote URL, confirm the environment and permitted operations. Run `setup --url <url>`. For an application that is not a web application, ask for its entries, for example the app ID and the device ID, and run `setup --entry <name>=<value>` for each. To record only the data policy of a target that is set up, run `setup --target <id> --reset "<command>"` or `--data environment|isolation --policy "<text>"`. Give the confirmed `--environment` and `--operations` for production. Record only a reference for credentials. If setup says a data policy is needed, ask the person how the data is reset or isolated. Do not write a policy, a reset command, or a hook yourself. When setup refuses with `Request conflict` or `Instance conflict`, nothing was saved. A request and an instance do not change. Follow the hint: drop the changed flag, or use a new `--target` or a new `--instance`.
   - When the person asks only for setup or a reachability check, stop after setup. Report the target, instance, reachability, and each `assumed:` line. Do not start a plan or a test.
   - If the application did not answer, say why and ask the person to make it reachable or confirm the URL. If the profile needs a prerequisite or a data policy, ask only for the missing information. Continue with step 3 or 4 when the target is ready.
3. For a ticket, an acceptance-criteria file, or a request to test a change, run this step now. Run `plan open --target <targetId>@<revision> --objective "<objective>" --source <file>`. Leave out `<planId>`: Checkmate takes it from the ticket key, for example `BS-42`, or from the file name, and prints it as `planIdFrom`. Use that `planId` in the next commands. To name the plan, put its ID first. Never write `stdin` or `-` as the plan ID. A request on standard input needs no word on the command line. Pass every file that the person names as `--source`. Do not name a file in `--objective` unless it is a `--source`: `plan open` refuses it. Then run `delegate plan <planId> --detach`. It starts the planner and returns at once. Then run `delegate wait plan <planId> --timeout 90`. While the reply status is `running`, run the `delegate wait` command from its hint again. A status other than `running` is the result. Do not start the planner a second time. Show the open gaps. Ask the oracle for decisions.
4. For an exploratory test, run `test <planId> --source <file> --allow Read --allow Bash`. Add `--level smoke|normal|deep` when the person selects a level. Run `explore wait <explorationId> --timeout 90`. If it still shows `recording`, run the same command again. When it shows `completed`, run `explore show <explorationId>`. Do not wait longer than 90 seconds in one command.
5. For the stored tests of a plan on a build, do not use `test`. The build that the person names decides the run. If the person names no build, ask for it. Do not invent a build name. Run `status <planId>` only to read the revision and the last run ID. Run `run begin <newRunId> <planId>@<revision> --build <build> --partial ready_only`, with a new run ID. Add `--retest-of <earlierRunId>` only when the person says the build contains a fix for a defect of that run. A run on a build with no fix, or a repeat of a run, is a new run without `--retest-of`. The `agent-only next` line of status may name `--retest-of`; use it only under this rule. Do not follow the `agent-only next` line of status instead of the person's build. Then follow "Continue a run".

## Answer questions and revise the plan

Use this when the person answers open gaps, or asks you to change the plan.

Before any `gap answer`, read the gap question in `plan show`. Record the answer only when it responds to that question. If it does not, record nothing. Say which gap the person means, or that no gap matches, and ask. Never record a person's words as the answer to a gap they do not address.

1. Run `plan show <planId> --gaps open`. It lists each open gap with its ID, for example `G1`. Use these IDs in the next step.
2. For each gap that the person answered, run `gap answer <planId> <gapId> --kind <clarify|accept_assumption|defer> --value "<answer>" --source <source> --rationale "<why>"`. Use the person's words for `--value`. For an answer that the person gave in this conversation, use `--source conversation`. Use `--source <file>` only for a file in the workspace that states the answer. Do not write a file to hold an answer.
3. Run `delegate revise <planId> --detach`, then `delegate wait revise <planId> --timeout 90`. The planner writes the next revision. While the reply status is `running`, run the `delegate wait` command from its hint again. A status other than `running` is the result. Do not write a plan JSON yourself.
4. Run `status <planId>` and `plan show <planId>`. Report the new revision and any gap that is still open.
5. When the status says `needs_approval`, run `plan approve <planId@revision> --rationale "<why>"` only after the person approves that revision.

To drop a requirement that the person names and that no open gap covers, run `scope drop <planId> <requirementId> --source <file> --rationale "<why>"`, then `delegate revise <planId>` as above. Use the source file the person named, or the message if it is the only source. Do not use `plan edit --patch` to answer a gap or to drop a requirement. Do not guess the JSON shape of a plan change. If `delegate revise` refuses, explain the reason in plain words. Ask for the missing value when you need it.

## Add or remove a test directly

Use this when the person asks you to add, change, or drop a test. An open gap does not block a test that its requirement does not depend on. Do not wait for a gap answer for such a test. A test on a requirement that an open gap blocks waits for the gap answer. Do not run `run begin` or any test for it. A run starts only when the person asks to run tests. Send the JSON in a heredoc. Give `--rationale`.

- A new test needs a requirement. If the plan has no requirement for it, add the requirement in the same JSON with `text` and `source`: `{"requirements": {"R7": {"text": "<the rule, one sentence>", "source": "conversation"}}, "tests": {...}}`. Do not read the schema files. Do not invent other field names.
- Add a test. Use a new test ID. Give every field: `{"tests": {"T10": {"title": "...", "requirementIds": ["R5"], "capability": "browser", "operations": ["any_test_operation"], "dependsOn": [], "preconditions": [], "action": "...", "assertions": {"A1": {"check": "...", "checkKind": "deterministic", "observe": "<what is observed>", "expected": "<the value>"}}}}}`. The `expected` kinds are: plain text, `{{marker}}` (the run marker), `type:number`, `type:non-empty`, `one-of:A|B`, `matches:<regex>`, `at least:N`, `at most:N`, `contains:TEXT`, `absent:TEXT`. A check that no value can be compared for uses `"checkKind": "agent_observation"` and no `expected`. Run `checkmate plan edit <planId>@<revision> --patch --rationale "<why>" <<'EOF'`, then the JSON, then `EOF`.
- Remove a test and its requirement together: `{"requirements": {"R6": null}, "tests": {"T6": null}}`. A requirement without a test or an open gap is refused.
- Each assertion check says what to observe, for example `The page shows the book count.`
- A deterministic assertion also needs `expected`, the value that code compares with what the record observed. Write `expected` as plain text for an exact value, for example `"240"`. Write `{{marker}}` where the run marker belongs, for example `"{{marker}}-T1"`.
- For a shape or a range, use one of: `type:number`, `type:non-empty`, `one-of:A|B`, `matches:<regex>`, `at least:N`, `at most:N`, `contains:TEXT`, `absent:TEXT`. Do not write a type word alone, such as `number`. Do not write a sentence that starts with `not`; write `absent:<text>` instead.
- An agent_observation assertion has no `expected`. Its check states the observation, and the tester judges it.

If `plan edit` refuses, explain the reason in plain words. Ask the person only when you need their input.

## Continue a run

When the person asks you to run or retest stored tests, continue until you execute the run that Checkmate began.

- When `test` returns a `run=<runId>` field, run `delegate execute <runId>` with that exact ID. Do this even when `test` also started an exploration. A missing `run` field means there is no stored-test run to execute.
- When `run begin` succeeds, use its run ID in `delegate execute <runId>`. Do not call `run begin` again to continue that run.
- When the person or `status` names an existing pending run, run `run show <runId>`. If it is still started, run `delegate execute <runId>`. If it is finished, report its recorded result; do not execute it again or create a replacement run.
- Keep the exact plan revision, build, instance, selected tests, and retest link shown by `run show`. Do not substitute a newer revision, another build, or another instance. A retest is a run on a new build that the person says contains a fix, begun with `--retest-of <earlierRunId>`. A rerun of the same code is a new run without `--retest-of`.
- Run `delegate execute` without `--allow` or `--claude-arg`. Pi controls its own tools and permissions. Do not widen them to work around a refusal.
- `delegate execute` can run for several minutes. Give its shell call a timeout of at least 600 seconds. If the call times out, run `run show <runId>`. A run that is still `started` has not ended.
- When a run is `started` but its process stopped, run `run resume <runId>` first. It rechecks the instance, profile, and run gate, and it does not run test actions. Then run `delegate execute <runId>`.

If a command refuses or needs a decision, explain why it stopped. Make any correction you can make yourself. If you need the person to decide or give a value, ask in plain words. Before you say what changed in the record, run `plan show` or `status` and report the state that it shows. A refusal that a later command fixed is not the final state. Do not invent an ID or say that execution started. After `delegate execute` completes, run `run show <runId>` and report the recorded test outcomes and any decision that is waiting on the run page. A completed command does not mean that every test passed.

Read `status <planId>` when no run needs execution or after you report the run. If someone needs to act, say who and what they need to do in plain words. A completed test command can record failed or blocked tests.

## Gate a run for CI

When the person asks you to gate a pipeline on a run, run `run show <runId> --gate` and use its exit code. It does not change the record.

- 0: every selected test passed, and coverage is complete.
- 1: a test failed. The product has defects. Report each failed test ID with its `failed` result.
- 2: a test could not run, the run is not finished, or coverage is partial. Report it as not tested. Do not call it passed.
- 3: the plan waits on an oracle decision: an open blocking gap. Name the gap and say where to answer it in the review UI.

Read the `gate=` line for the state name. A defect outranks the other codes.
