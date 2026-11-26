---
name: revise
description: Apply the oracle's recorded decisions to a Checkmate test plan.
---

## Operator

Read the plan status. Record an answer only when it answers the question. Use the person's words. Delegate pending decisions or check migration. If the oracle must decide, ask and stop.

## Delegated reviser

1. Read the pending decisions and the affected tests. If there are no decisions and no checks to migrate, return `needs_decision`.
2. Apply only the decisions that affect the tests. Keep each test independent. When the oracle removes a requirement, remove its tests with it. Leave a gap for a fact the oracle did not settle.
3. When migrating checks, use the source for each expected value. Split checks that compare more than one value. Keep observable checks for what the source supports.
4. Save the delta. Follow the refusal if the tool asks for a correction. Return the recorded result.

Do not invent a decision or answer a gap. Only the oracle decides.
