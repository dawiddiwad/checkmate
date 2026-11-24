---
name: test
description: Use first for any request to test, QA, check, verify, or retest a change, a ticket, a feature, or a build, or to see whether it meets its acceptance criteria or still works. For example "test the change in ticket.md", "QA the cart", "check SHOP-12 is done", "does the cart pass the ticket", "make sure the coupon works", or "retest after my fix". Do not answer from the ticket or edit the code first. Checkmate starts the testers and records what they find.
---

> **Agent only:** This file contains repository or workflow instructions for coding agents.

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `CHECKMATE_HOST_SESSION=1 node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path. Do not write a shell variable in its place.

You are the operator. You do not test. Checkmate gives you actions, and you carry them out with agents of this session. Checkmate writes the task of each agent. Do not write a task. Do not give an agent other instructions. Do not test yourself.

## Route first

Choose the route in this order. Name the plan and the build in your reply.

1. Plan: use the plan the person named. If none is named, use the one plan in flight, and say which one. If there is none, or more than one, ask which plan. Do not make a plan name up, and do not start `test` with a name you guessed. A ticket the person names for a new test is the one exception: its plan ID is the ticket ID.
2. Build: when the person gives no build, ask for it before any run. Do not invent a build name.
3. Status: run `checkmate status <planId>` for the plan. Read its state and its ready tests.
4. Choose:
   - The status lists ready tests (state `ready_to_run`, or `needs_answers` with some tests ready) and the person asks to test the plan or the build: do not run `test`. Open gaps do not stop the stored tests that are ready. Run `checkmate run begin <runId> <planId>@<revision> --build <build> --partial ready_only`, then follow `/checkmate:execute <runId>`.
   - The state is `started` (a run stopped): run `checkmate run resume <runId>`, then `delegate execute <runId>` as the execute skill says. Never test the application by hand for that run, and never use curl as a test.
   - A ticket, a change, or a plan with no stored tests: run `test` as in Start.
5. Waits: do not end your turn while a command you started in the background, a delegate, or an exploration is running. Wait with `checkmate delegate wait <stage> <id> --timeout 90`, or `checkmate explore wait <id> --timeout 540`, and repeat while it reports `running`. Report a result only from a command whose output you read.

Where things are: the ticket, the sources, and the application notes are in the workspace folder, by the file name the plan gives. Records are in `.checkmate/`, and you read them with checkmate commands. Never search the disk (`find /`, or the home folder) for a ticket, a source, or a record.

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

## Refusals

A refusal prints `reason:` and `agent-only hint:` lines. Run the command in the hint, with the values of your task. Do not read the source code or the plugin files to find the cause of a refusal. Do not choose `external` yourself to get past a refusal: use it only when the oracle says that a person or the factory resets the data outside Checkmate. Do not invent a reset command, for example `true`. Use the command that the oracle gave. When the oracle gave none, ask for it, or use `--reset external` when the data never changes or a person or the factory resets it outside Checkmate.

## First run

Run `checkmate target list`. When it shows no target:

1. Tell the person in two or three lines: a target is the record of where the application runs and what a tester can do there. Checkmate needs the URL of the running application, and how to sign in when the application needs a login.
2. Use the values that the message of the person gives. Ask only for a missing value. Do not ask for a password or a token. Ask for the name of the environment variable or the file that has it.
3. When the host of the URL is not local (`localhost`, `127.0.0.1`, a private address, or a name that ends with `.local` or `.test`), and the person did not say which environment it is, ask one question before setup: is this a test environment, staging, or production, and can testers make and change data there? Ask the two questions in one call, as Ask the person says. Ask only for what the message of the person does not give. Do not ask when the URL is local.
4. Run `checkmate setup --url <url>`. When testers can change data, ask the person for the reset command that restores the seed data, or the data policy (`--data environment|isolation --policy "<text>"`). Add the answer. Do not write a command or a policy yourself. Add `--environment "<the answer>"` when you asked. Start the value with `test`, `staging`, or `production`, for example `--environment "production, read only"`. For production, also add `--operations <a,b>` with the operations that the person permits. Checkmate refuses production without them.
5. Show a short table of what Checkmate set and what it assumed. Use the facts and each `assumed:` line.
6. Continue with the test in the same turn.

## Start

0. Run `checkmate --version`. When it prints a `warning:` line, tell the person that line before the test starts. Continue the test.
1. Use the route under Route first. When the person named no plan and no plan is in flight, ask which one; do not make a plan name. When the person named no build, ask for the build before any run. For a new ticket with no plan, the plan ID is the ticket ID, for example `shop-12`, and you tell the person which one you used.
2. Run one command. Use `--session` when you can start agents of this session. Leave out `--session` when the person says no subagents, or when you run in a factory or a script. Then follow the process steps under Loop:

   ```sh
   checkmate test <planId> --source <ticket or file> --session
   ```

   - Add `--build`, `--objective`, `--target`, `--level smoke|normal|deep`, `--since <git ref>`, or `--until <git ref>` only when the person gives them.
   - When the application needs a login, add `--instructions "<how a tester signs in>"`. Do not write a secret value.

3. When the command refuses, read the `reason:` lines and the `agent-only hint:` line. Correct the command and run it again.
4. When the plan has no rules, the clerk derives the rules from the sources before the testers start.
5. A later build never needs a decision before the test. Start the test at once, also when the plan has no stored tests. Offer `harvest` only in the final report, as an option.

## Loop

0. When the reply of `test` has `run=<runId>` and no exploration, `test` started only the stored run. Follow the execute skill, `/checkmate:execute <runId>`, and stop there: there is no exploration to run. Only a person who asks for an exploration by name gets one: `test` with `--mode exploratory`.
1. Run `checkmate explore next <explorationId>`. Each line after line 1 is one action:
   - `start <name> <step> agent=<type> description="<description>" prompt="<prompt>"`: start an agent with the Agent tool. Set `subagent_type` to `<type>` and `description` to `<description>`. Give the prompt exactly.
   - `message <name> <step> agent=<agent id> prompt="<prompt>"`: send the prompt exactly to that agent with the SendMessage tool. When you do not have SendMessage, load it with ToolSearch.
   - `wait`: an agent runs. Wait until it ends.
   - `finished`: go to Report.
2. Carry out all the actions of one `next` in one message, so that the agents run at the same time. In the same message, run the command of the `agent-only hint:` line once: `checkmate explore started <explorationId> <names>`. It records that the agents run.
3. Tell the person in one line what runs, for example `3 testers study the change.`
4. When an agent ends, find its tester and step. The description of the agent and the last line of its reply, for example `tester a2 study done`, name them. Use them, not the order of the results.
5. Run `checkmate explore done <explorationId> <name> <step> --agent <agent id> --reply-line "<last line of the reply>" --activity "<what the agent did, in one line>"`. When the agent failed, or you cannot reach it, add `--failed "<reason>"`.
6. When two or more agents end, run their `done` commands and `next` in one shell command, joined with `&&`.
7. Run `next` again. Do this until it prints `finished`.

Before you ask the person anything in the middle of a run, record the pause: `checkmate explore pause <explorationId> --reason "<one line>"`. The next `next` or `done` clears it.

When `done` refuses, read the `reason:` and `agent-only hint:` lines. Correct the command as the hint says, and continue. Do not stop to ask the person about a mistake in the agent IDs. `checkmate explore status <explorationId>` shows the agent ID of each tester.

When the person asks for another model, give it as the `model` parameter of the Agent tool.

## Report

1. Run `checkmate explore show <explorationId>` and `checkmate status <planId>`.
2. When the reply of `test` had `run=<runId>`, run the stored tests of that run now: follow the execute skill, `/checkmate:execute <runId>`.
3. Report as `session.md` says. Lead with the outcome. Name relevant claims, run outcomes, and assumptions that need confirmation. Ask for any open decision in plain words and mention the relevant plan or run page in the review UI.

When `next` gives `operational_error`, explain why the test stopped and ask for any information you need to continue.

## Decisions of the oracle

The person in this session is the oracle, unless that person says otherwise, whatever role name they use, for example PM, product owner, or lead. When they give an answer or a decision, record it.

Run a decision only when the oracle tells you the decision in this session:

- Answer a question or a gap: `checkmate gap answer <planId> <id> --kind clarify|accept_assumption|defer --value "<answer>" --source "<source>" --rationale "<why>"`. A question ID has a slash, for example `a1/Q1`.
- Decide a claim: `checkmate claim accept <planId> <claimId> --rationale "<why>"` or `checkmate claim reject <planId> <claimId> --rationale "<why>"`.
- Keep the claims as stored tests: `checkmate harvest <explorationId>`. Add `--observations` only when the oracle asks for it.
- When `checkmate status <planId>` shows `needs_revision` after an answer, follow the revise skill at once. Do not wait for another request.
- After you record answers to questions of an exploration, run `checkmate explore follow <explorationId>`. Then do the Loop again, and report the new claims.

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

To start the testers as processes, for example in CI, run `checkmate test <planId> --allow Read --allow Bash` without `--session`, and then `checkmate explore wait <explorationId> --timeout 540`. A shell command stops after about 10 minutes. When the reply is `interrupted`, the testers still run. Run the same wait command again until the reply is `completed` or `operational_error`. Do not wrap the command in `timeout`. It is not on macOS.

When the wait reply is `completed`, run `checkmate status <planId>`. When it says `waitsOn=oracle`, stop. Report its open questions and where to answer them in the Checkmate review UI. Do not wait again, search for files, or schedule a wakeup. The oracle decides, not you.
