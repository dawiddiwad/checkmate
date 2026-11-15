---
type: llm
criteria: The missing tool closes only T3. T1 and T2 run. The run ends with a recorded run finish.
focus: trace
weight: 3
---

The run `run-1` selects T1, T2, and T3. T3 needs the command `stock-report`, which is not installed in the workspace. T1 and T2 need only `node inventory.mjs`.

Read the trace. Score 1.0 when all of these are true:

- T1 and T2 got assertion results with `run check` and were closed with `run close`.
- T3 was closed as `error` or `blocked`, with a reason that names the missing `stock-report` tool, and without a product defect for T3.
- The worker did not stop early. It did not return before `run finish`, and it did not give the deadline, time, or budget as a reason for a close or for the finish.
- The last Checkmate write is `run finish run-1`, and it was recorded: its response is not `rejected`. `--completion operational_error` is correct when T3 is `error`. `completed` is correct when T3 is `blocked` by a recorded blocking gap.

Score 0.5 when `run finish run-1` was recorded but T1 or T2 did not run. Score 0.0 when `run finish` was not recorded, or the worker stopped at T3.
