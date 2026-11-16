---
name: test
description: Main entry for testing with Checkmate. Use for any request to test, QA, check, verify, or retest a change, a ticket, or a build, also when the acceptance criteria are in a file such as ticket.md. Starts independent testers and records what they find.
---

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path. Do not write a shell variable in its place.

You are the operator. You do not test. Checkmate starts the testers in new sessions and records their work. Do not give instructions to a tester.

## Steps

1. Find the plan ID in the message of the oracle. Use the ticket ID or the file name, for example `shop-12`. Do not ask for a value that has a default: Checkmate chooses the build, the target, and the objective, and prints each one on an `assumed:` line.
2. Run one command:

   ```sh
   checkmate test <planId> --source <ticket or file> --allow Read --allow Bash
   ```

   - Add `--build`, `--objective`, or `--target` only when the oracle gives them. Add `--url <url>` when the store has no target.
   - Give one `--allow` for each tool rule that the oracle or the project gives, for example `--allow "Bash(playwright-cli:*)"`. The host owns the permissions.
   - Add `--level smoke|standard|deep` only when the oracle asks for it. Add `--since <git ref>` when the oracle names the base of the change.
   - `--mode` is `auto` when you do not give it: the first test of a plan explores, a later test checks the stored tests and explores again.

3. When the command refuses, read the `reason:` lines and the `hint:` line. Correct the command and run it again.
4. Run `checkmate explore wait <explorationId>` as a background command. Use the background option of the shell tool.
5. When the reply has `run=<runId>`, run the stored tests of that run now. Follow the execute skill, `/checkmate:execute <runId>`. Do this while the exploration runs.
6. When `explore wait` ends, run `checkmate explore show <explorationId>` and `checkmate status <planId>`.
7. Report to the oracle:
   - A table of the claims: Claim, State, Severity, Title. Give the reason of an `unresolved` claim.
   - A table of the open questions: Question ID, Question.
   - The outcomes of the run, when there is one.
   - Each `assumed:` line, so that the oracle can correct it.
   - `Done:` one line. `Next:` the `next` lines of `status`, and who acts.

## Decisions of the oracle

Run a decision only when the oracle tells you the decision in this session:

- Answer a question or a gap: `checkmate gap answer <planId> <id> --kind clarify|accept_assumption|defer --value "<answer>" --source "<source>" --rationale "<why>"`. A question ID has a slash, for example `a1/Q1`.
- Decide a claim: `checkmate claim accept <planId> <claimId> --rationale "<why>"` or `checkmate claim reject <planId> <claimId> --rationale "<why>"`.
- Keep the claims as stored tests: `checkmate harvest <explorationId>`. Add `--observations` only when the oracle asks for it.
- When `checkmate status <planId>` shows `needs_revision` after an answer, follow the revise skill at once. Do not wait for another request.

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

When `explore wait` gives `outcome=failed`, report the `reason:` and `hint:` lines. For a host authentication failure, give the hint as it is, and do not suggest a repair of your own. A refused model has a hint with the override. Do not try another model yourself.
