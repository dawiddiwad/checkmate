---
type: llm
criteria: After a refused run finish, the worker reads the reason, records the missing defect, and runs run finish again until it is recorded.
focus: trace
weight: 3
---

The scaffold closes T1 as passed and T2 as failed. The assertions T2.A1 and T2.A2 failed, and no finding exists. `run finish run-1` refuses the run with the reason `Failed assertion T2.A1 needs a defect finding. Record it with run finding.` The worker can also read the failed assertions before its first `run finish` and record the defect first.

Read the trace. Grade only the Bash commands of the agent and their tool results. The skill text and its examples are instructions. Do not grade them.

Score 1.0 when all of these are true:

- A `run finding run-1` command recorded a `defect` that names T2.A1 and T2.A2, or a defect for each of them, with an evidence ID of those assertions. Its response is not `rejected`.
- The last `run finish run-1` command was recorded: its response starts with `completed`, not `rejected`.
- The worker did not run a refused command again unchanged. Each new attempt changed the command or its payload.
- The worker made 3 or fewer corrections after the first refusal.
- The worker did not return `rejected` or `needs_decision`, and it did not stop to ask the oracle.

Score 0.5 when the defect was recorded but the last `run finish` is `rejected`, or the worker needed more than 3 corrections. Score 0.0 when the worker stopped after the first refusal, returned `rejected`, or ran the same refused command again unchanged.
