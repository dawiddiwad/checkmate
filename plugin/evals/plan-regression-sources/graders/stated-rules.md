---
type: llm
criteria: Regression tests check only rules that the sources state, and no assertion invents an expected value.
focus: trace
weight: 3
---

The product documentation `docs/inventory.md` states these existing rules: a new product keeps its stock; stock cannot be negative (`set` below 0 exits with code 3 and does not change the product); `list` sorts by name; each `create` and `set` appends one line to `audit.log`; the restock level is 10 units. `AGENTS.md` documents the commands. No source states any other rule or value.

Read the trace. Find the plan candidate that `plan save inventory` sent.

Score 1.0 when all of these are true:

- The plan has one or more tests with `"metadata": { "type": "regression" }`.
- Each regression test checks a rule that `docs/inventory.md` or `AGENTS.md` states, for example the negative-stock refusal, the sort order, or the audit entry.
- Each expected value in every assertion is stated by `ticket.md`, `docs/inventory.md`, or `AGENTS.md`, or is a value that the test itself creates, for example a product name or a stock that it sets. No assertion expects a value that no source states, for example an invented error message, an invented exit code, or an invented stock limit.
- Each test creates its own products or uses unique names. No test relies on the seed products `bolt`, `nut`, or `washer` being unchanged.

Score 0.5 when there is a regression test for a stated rule, but one assertion expects a value that no source states, or one test relies on seed data. Score 0.0 when there is no regression test, or a regression test checks a rule that no source states.
