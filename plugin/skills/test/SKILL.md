---
name: test
description: Use first for a request to test, QA, check, verify, or retest a change, a ticket, a feature, or a build.
---

Use the Checkmate tools in the current host session. Report recorded outcomes and name the next decision in plain words. You are the operator. You do not test. Never use curl as a test. Never run a reset yourself. Keep tool names, arguments, and internal paths out of replies.

## Choose the work

1. Use `checkmate_list_targets` and the setup skill if the request needs a target. The target must exist before planning or testing.
2. A request for a test plan without execution uses the plan skill. A request to revise uses the revise skill.
3. Use the named plan, or the only plan in progress. Ask when the plan or build is unclear. For an existing plan, use `checkmate_status`. For a request to run ready stored tests, use `checkmate_begin_run` with a new run ID, the plan ID as the reference, and the named build. Use the execute skill. Give `retestOf` only if the person says the build fixes a defect of the earlier run.
4. Keep the default level, tester count and deadlines unless the person asks to change them. For exploration, call `checkmate_start_test` with the plan ID, build, and a named level if the person selected one. For a new plan, give the sources and target. Use exploratory mode when the person specifically asks for exploration. If the tool returns a stored run, execute it with the returned run ID.

## Drive a Claude session exploration

1. Call `checkmate_next_tester_steps` with the exploration ID. Dispatch all returned actions using the Agent tool. Use the listed agent type or existing agent ID and prompt. Call `checkmate_tester_steps_started` with the names you started.
2. When a child finishes, call `checkmate_tester_step_done` with its name and step. Copy the exact `agentId` from the Agent tool. The agent type is not an ID. Give `failure` only when the Agent tool could not start, reach, or complete that agent. When the agent finished and found a defect, omit `failure`. Do not put its finding in the step result. Then call `checkmate_next_tester_steps` again. A recorded step does not end the exploration. Do not report the exploration as complete until `checkmate_next_tester_steps` returns `finished`.
3. Use `checkmate_pause_test` before asking the person for information in the middle of work. Resume with the next tester steps after the answer.
4. Call `checkmate_test_status` with `report` true, then read the plan status. Report checks, findings, and questions from the returned record. Follow the decision rules below.

A person can start a follow-up or stop the exploration in the review UI. When the person says that a follow-up waits, do step 1 for that exploration. When a tool replies that the exploration was stopped, end its agents. Do not start more agents for it. Report the stop and its reason.

For a process exploration, use `checkmate_test_status` with a bounded wait. Continue until completion, failure, or an oracle decision. Do not start a second exploration to wait for the first one.

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
