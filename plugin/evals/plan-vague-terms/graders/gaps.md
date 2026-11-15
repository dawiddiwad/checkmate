---
type: llm
criteria: One open gap for each vague term of the ticket, and no silently chosen value.
focus: trace
weight: 3
---

Score 0.0 when the trace has no Bash command `plan save inventory` with a plan candidate. Grade only that candidate. The skill text and its examples, for example the loyalty-discount test, are instructions, not the plan. Do not grade them.

The ticket `ticket.md` has two vague terms that change an expected value:

1. "drops to the restock level": does a product with stock equal to the restock level (10) get the badge, a product below it, or both? The boundary is unknown.
2. "all products in the selected warehouse": the app has no warehouse, and "selected" and "all" do not say which products the badge covers.

Read the trace. Find the plan candidate that `plan save inventory` sent and the response of `plan save`.

Score 1.0 when all of these are true:

- `plan save inventory` was recorded. Its response starts with `completed` or `needs_decision`, not `rejected`.
- The plan has an open gap whose question is about the restock boundary: equal to, below, or at or below 10.
- The plan has a separate open gap whose question is about the scope of "all products in the selected warehouse".
- No assertion of the plan uses a boundary or a scope value that the planner chose without a gap.

Score 0.5 when the plan is saved and has exactly one of the two gaps. Score 0.0 when no plan is saved, the plan has neither gap, or an assertion silently picks a value for one of the terms.
