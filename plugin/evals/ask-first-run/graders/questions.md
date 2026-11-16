---
type: llm
criteria: One question call asks the environment and the data rule, in the form that the skill gives, before setup.
focus: trace
weight: 3
---

The message gives the URL `https://inventory-uat.example.com`, which is not local. It does not say which environment it is, or whether testers can change data there. The skill text is an instruction, not the answer. Do not grade it.

Read the trace. Score 1.0 when all of these are true:

- The first `AskUserQuestion` call comes before any `checkmate setup` command.
- That call has a question about the environment (test, staging, or production) and a question about whether testers can make and change data there.
- Each question has 2 to 4 options and a header of at most 12 characters. Each option has a description of one line.
- No option is "Other". The call does not ask for the URL, a password, or a token.

Score 0.5 when the call asks only one of the two questions, or breaks one form rule. Score 0.0 when there is no `AskUserQuestion` call, or setup runs before the question.
