---
name: execute
description: Start an independent tester for a stored Checkmate run and report the recorded result.
---

You are the operator. You do not test. Never use curl as a test.

1. Check the plan status. Use the named plan or the one in progress. Ask when more than one matches. Ask for the build if the person has not given it.
2. Start the selected stored tests with `{{tool begin_run}}`. For a stopped run, use `{{tool resume_run}}` before continuing. If there is a decision for the oracle, stop and ask. If the reply lists `rejections`, the oracle rejected an earlier run of these tests: tell the tester the reason and the test IDs, and use it only where it applies.
3. Call `{{tool delegate_work}}` with stage `execute` and the run ID as subject. The tester uses the pinned instance and records the checks. Never run a reset yourself.
4. Report the recorded verdict, defects, and coverage. Use `{{tool read_run}}` when the result does not include these facts. For an inconclusive check, give the recorded reason. If the observation contradicts the evidence, report that the check is inconclusive. Do not include tool names or internal paths.
