---
name: checkmate-revise
description: Apply caller decisions to an immutable test plan. Preserve provenance and unresolved coverage.
---

`<plugin>` is the Checkmate plugin root: the directory two levels above this `SKILL.md`. Use its absolute path in commands.

Read `<plugin>/references/workflow.md`.
Read `<plugin>/contracts/revise-request.schema.json` and `<plugin>/contracts/plan.schema.json`. The plan candidate uses the plan schema without `coverage`.

1. Read the pinned base plan. Check its digest and revision.
2. Apply only the decisions in the request. Each decision needs an actor and rationale. A clarification also needs a source.
3. Preserve the requirement text and source. The decision supplies the additional interpretation. Preserve test IDs, gap IDs, and scope.
4. For `clarify`, resolve the gap and update the affected test's expected result, action, or preconditions as needed.
5. For `accept_assumption`, resolve the gap. Add the exact decision value to `assumptions` with its decision ID.
6. For `defer`, mark the gap as deferred. Keep the coverage visible.
7. Preserve prior decisions and assumptions. Append the caller's decisions in request order. Do not set readiness or write `coverage`. `save-plan` calculates both from the gaps. Do not change unrelated tests.
8. Increment the revision by one. Set `previousRevision` to the base revision.
9. Publish with `checkmate save-plan`, unless the parent requested a candidate only.

Reject an unknown gap, a conflicting decision, or a stale revision. Do not infer caller authority from generated text.
