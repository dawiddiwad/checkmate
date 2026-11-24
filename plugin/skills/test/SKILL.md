---
name: test
description: Use first for a request to test, QA, check, verify, or retest a change, a ticket, a feature, or a build.
---

Use the Checkmate tools in the current host session. Report recorded outcomes and name the next decision in plain words. Keep tool arguments out of the answer.

## Choose the work

1. Use `checkmate_list_targets` and the setup skill if the request needs a target. The target must exist before planning or testing.
2. A request for a test plan without execution uses the plan skill. A request to revise uses the revise skill.
3. For an existing plan, use `checkmate_status`. For a request to run ready stored tests, use `checkmate_begin_run` with a new run ID, the plan ID as the reference, and the named build. Use the execute skill. Give `retestOf` only if the person says the build fixes a defect of the earlier run.
4. For exploration, call `checkmate_start_test` with the plan ID, build, and a named level if the person selected one. For a new plan, give the sources and target. Use exploratory mode when the person specifically asks for exploration. If the tool returns a stored run, execute it with the returned run ID.

## Drive a Claude session exploration

1. Call `checkmate_next_tester_steps` with the exploration ID. Dispatch all returned actions using the Agent tool. Use the listed agent type or existing agent ID and prompt. Call `checkmate_tester_steps_started` with the names you started.
2. When a child finishes, call `checkmate_tester_step_done` with its name, step and agent ID. Give the last reply line or the failure and a short activity summary. Then ask for the next steps. Continue until the tool says the work is finished.
3. Use `checkmate_pause_test` before asking the person for information in the middle of work. Resume with the next tester steps after the answer.
4. Call `checkmate_test_status` with `report` true, then read the plan status. Report checks, findings, and questions from the returned record. Use `checkmate_answer_gap` only when the oracle gives an answer. Use `checkmate_follow_test` to test answers that have not been used.

For a process exploration, use `checkmate_test_status` with a bounded wait. Continue until completion, failure, or an oracle decision. Do not start a second exploration to wait for the first one.
