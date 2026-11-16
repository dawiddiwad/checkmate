---
name: test
description: Main entry for testing with Checkmate. Use for any request to test, QA, check, verify, or retest a change, a ticket, or a build, also when the acceptance criteria are in a file such as ticket.md. Starts independent testers and records what they find.
---

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path. Do not write a shell variable in its place.

You are the operator. You do not test. Checkmate gives you actions, and you carry them out with agents of this session. Checkmate writes the task of each agent. Do not write a task. Do not give an agent other instructions. Do not test yourself.

## First run

Run `checkmate target list`. When it shows no target:

1. Tell the person in two or three lines: a target is the record of where the application runs and what a tester can do there. Checkmate needs the URL of the running application, and how to sign in when the application needs a login.
2. Use the values that the message of the person gives. Ask only for a missing value. Do not ask for a password or a token. Ask for the name of the environment variable or the file that has it.
3. When the host of the URL is not local (`localhost`, `127.0.0.1`, a private address, or a name that ends with `.local` or `.test`), and the person did not say which environment it is, ask one question before setup: is this a test environment, staging, or production, and can testers make and change data there? Do not ask when the URL is local.
4. Run `checkmate setup --url <url>`. Add `--environment "<the answer>"` when you asked. Start the value with `test`, `staging`, or `production`, for example `--environment "production, read only"`. For production, also add `--operations <a,b>` with the operations that the person permits. Checkmate refuses production without them.
5. Show a short table of what Checkmate set and what it assumed. Use the facts and each `assumed:` line.
6. Continue with the test in the same turn.

## Start

1. Find the plan ID. Use the ticket ID, for example `shop-12`. When there is no ticket, make a short name from the objective, for example `coupon-limit`. Tell the person which one you used.
2. Run one command:

   ```sh
   checkmate test <planId> --source <ticket or file> --session
   ```

   - Add `--build`, `--objective`, `--target`, `--level smoke|standard`, `--since <git ref>`, or `--until <git ref>` only when the person gives them.
   - When the application needs a login, add `--instructions "<how a tester signs in>"`. Do not write a secret value.

3. When the command refuses, read the `reason:` lines and the `hint:` line. Correct the command and run it again.
4. A later build never needs a decision before the test. Start the test at once, also when the plan has no stored tests. Offer `harvest` only in the final report, as an option.

## Loop

1. Run `checkmate explore next <explorationId>`. Each line after line 1 is one action:
   - `start <name> <step> agent=<type> description="<description>" prompt="<prompt>"`: start an agent with the Agent tool. Set `subagent_type` to `<type>` and `description` to `<description>`. Give the prompt exactly.
   - `message <name> <step> agent=<agent id> prompt="<prompt>"`: send the prompt exactly to that agent with the SendMessage tool. When you do not have SendMessage, load it with ToolSearch.
   - `wait`: an agent runs. Wait until it ends.
   - `finished`: go to Report.
2. Carry out all the actions of one `next` in one message, so that the agents run at the same time. In the same message, run the command of the `hint:` line once: `checkmate explore started <explorationId> <names>`. It records that the agents run.
3. Tell the person in one line what runs, for example `3 testers study the change.`
4. When an agent ends, find its tester and step. The description of the agent and the last line of its reply, for example `tester a2 study done`, name them. Use them, not the order of the results.
5. Run `checkmate explore done <explorationId> <name> <step> --agent <agent id> --reply-line "<last line of the reply>" --activity "<what the agent did, in one line>"`. When the agent failed, or you cannot reach it, add `--failed "<reason>"`.
6. When two or more agents end, run their `done` commands and `next` in one shell command, joined with `&&`.
7. Run `next` again. Do this until it prints `finished`.

Before you ask the person anything in the middle of a run, record the pause: `checkmate explore pause <explorationId> --reason "<one line>"`. The next `next` or `done` clears it.

When `done` refuses, read the `reason:` and `hint:` lines. Correct the command as the hint says, and continue. Do not stop to ask the person about a mistake in the agent IDs. `checkmate explore status <explorationId>` shows the agent ID of each tester.

When the person asks for another model, give it as the `model` parameter of the Agent tool.

## Report

1. Run `checkmate explore show <explorationId>` and `checkmate status <planId>`.
2. When the reply of `test` had `run=<runId>`, run the stored tests of that run now: follow the execute skill, `/checkmate:execute <runId>`.
3. Report to the person:
   - A table of the claims: Claim, State, Severity, Title. Give the reason of an `unresolved` claim.
   - A table of the open questions: Question ID, Question.
   - The outcomes of the run, when there is one.
   - Each `assumed:` line, so that the person can correct it.
   - `Done:` one line. `Next:` the `next` lines of `status`, and who acts.
   - The plan page of the review UI: `/checkmate:ui`.

When `next` gives `operational_error`, report the `reason:` and `hint:` lines.

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

To start the testers as processes, for example in CI, run `checkmate test <planId> --allow Read --allow Bash` without `--session`, and then `checkmate explore wait <explorationId>`.
