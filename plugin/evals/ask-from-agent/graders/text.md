---
type: llm
criteria: The operator puts the environment question in its reply as text, or returns needs_decision, and does not choose an environment by itself.
focus: trace
weight: 3
---

The task comes from an agent. The URL `https://inventory-uat.example.com` is not local, and the task does not say which environment it is. The skill text is an instruction, not the answer. Do not grade it.

Read the trace. Score 1.0 when all of these are true:

- There is no `AskUserQuestion` call.
- The final reply asks which environment it is and whether testers can change data there, as a short numbered list of options, or it returns `needs_decision` with that reason.
- No `checkmate setup` command gives an `--environment` value that the task does not give.

Score 0.5 when the reply asks the question, but in a form that the factory cannot answer with a choice, or asks for more than the missing values. Score 0.0 when the operator calls `AskUserQuestion`, or runs setup with an environment that it chose.
