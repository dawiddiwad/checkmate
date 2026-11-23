---
name: checkmate
description: Set up a QA target, plan or run tests, and inspect evidence with Checkmate in Pi.
---

> **Agent only:** This file contains repository or workflow instructions for coding agents.

Use the CLI in this package. Resolve `../../src/main.ts` from the directory of this skill. If that file is absent, use `../../dist/checkmate.js`. Run each command in the project workspace as `CHECKMATE_HARNESS=pi node "<absolute CLI path>" <command>`. Keep the provider, model, credentials, and tool policy in Pi.

1. Run `target list` and `plan list`. Use an existing target or plan when it matches the request.
2. For a new target, ask for the running URL. For a remote URL, confirm the environment and permitted operations. Run `setup --url <url>`. Give the confirmed `--environment` and `--operations` for production. Record only a reference for credentials.
   - When the person asks only for setup or a reachability check, stop after setup. Report the target, instance, reachability, and each `assumed:` line. Do not start a plan or a test.
   - Otherwise, setup is not the end. Report the target in one line, then go on to step 3 or 4 with the person's ticket or change.
3. For a ticket, an acceptance-criteria file, or a request to test a change, run this step now. Do not run `--help` first; the command below is the one to use. Run `plan open <planId> --target <targetId>@<revision> --objective "<objective>" --source <file>`. Then run `delegate plan <planId>`. Show the open gaps. Ask the oracle for decisions.
4. For an exploratory test, run `test <planId> --source <file> --allow Read --allow Bash`. Add `--level smoke|normal|deep` when the person selects a level. Run `explore wait <explorationId> --timeout 90`. If it still shows `recording`, run the same command again. When it shows `completed`, run `explore show <explorationId>`. Do not wait longer than 90 seconds in one command.
5. For the stored tests of a plan on a build, do not use `test`. Run `status <planId>`. Use its `next` line, `run begin <runId> <planId>@<revision> --build <build> --partial ready_only`. Pick a new run ID. Then follow "Continue a run".

## Answer questions and revise the plan

Use this when the person answers open gaps, or asks you to change the plan.

1. Run `plan show <planId> --gaps open`. It lists each open gap with its ID, for example `G1`. Use these IDs in the next step.
2. For each gap that the person answered, run `gap answer <planId> <gapId> --kind <clarify|accept_assumption|defer> --value "<answer>" --source <file> --rationale "<why>"`. Use the person's words for `--value`. Use `--source` for the file that states the answer.
3. Run `delegate revise <planId>`. The planner writes the next revision. Do not write a plan JSON yourself.
4. Run `status <planId>` and `plan show <planId>`. Report the new revision and any gap that is still open.
5. When the status says `needs_approval`, run `plan approve <planId@revision> --rationale "<why>"` only after the person approves that revision.

Do not use `plan edit --patch` to answer a gap. Do not guess the JSON shape of a plan change. If `delegate revise` refuses, report each `reason:` and ask the person for the missing value.

## Continue a run

When the person asks you to run or retest stored tests, continue until you execute the run that Checkmate began.

- When `test` returns a `run=<runId>` field, run `delegate execute <runId>` with that exact ID. Do this even when `test` also started an exploration. A missing `run` field means there is no stored-test run to execute.
- When `run begin` succeeds, use its run ID in `delegate execute <runId>`. Do not call `run begin` again to continue that run.
- When the person or `status` names an existing pending run, run `run show <runId>`. If it is still started, run `delegate execute <runId>`. If it is finished, report its recorded result; do not execute it again or create a replacement run.
- Keep the exact plan revision, build, instance, selected tests, and retest link shown by `run show`. Do not substitute a newer revision, another build, or another instance. A retest needs a new run begun on the requested fixed build with `--retest-of <earlierRunId>`.
- Run `delegate execute` without `--allow` or `--claude-arg`. Pi controls its own tools and permissions. Do not widen them to work around a refusal.

If a command refuses or returns `needs_decision`, report its actual status, each `reason:`, and its `hint:` when present. Give the next command or ask for the missing decision or value. Do not invent an ID or say that execution started. After `delegate execute` completes, run `run show <runId>` and report the recorded test outcomes, evidence, gaps, and next decision. A completed command does not mean that every test passed.

Read `status <planId>` when no run needs execution or after you report the run. Report the next action and its owner. A completed test command can record failed or blocked tests.
