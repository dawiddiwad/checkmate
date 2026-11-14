---
name: status
description: Answer where a Checkmate plan is in the loop, who it waits on, and what comes next. Use for a question about the state of a plan, a ticket, a run, or the inbox. Reads only.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path. Do not write a shell variable in its place.

Checkmate stores no loop state. `checkmate status` derives it from the records. Do not read the database file with another tool. Do not look for scheduled jobs.

1. Find the plan ID in the question. If the question names no plan, run `checkmate plan list`. It prints `state=` and `waitsOn=` for each plan. If one plan matches the question, use it. Else report the plan list and stop.
2. Run `checkmate status <planId>`. Line 1 has `state=`, `waitsOn=`, the revision, the approval, and the latest run in begin order. The other lines are `why`, one or more `next`, one `started` line with the build and the instance for each open run, the open gaps, the pending decisions, and the open defects of the ready tests. A defect stays open until a run that began later passes each of its tests on the same instance or on another build, a retest in its chain records the defect again, or the oracle rejects its result. `checkmate finding list --open` also lists the open defects of deferred or removed tests.
   When the oracle rejected a plan revision or a run result, a `why` line gives the decision: `<subject> was rejected by <actor>: <rationale>`. Report the rationale.
3. If the question is about a run, also run `checkmate run show <runId>`. Its `decision` line gives the verdict, the actor, the time, and the rationale of the latest result decision. If the question is about all open work, also run `checkmate inbox`.
4. Report in the format of `workflow.md`:
   - A table with one row for the plan: plan and revision, state, waits on, approval, and latest run. Add one row for each open run with its instance. Add one row for each open gap, pending decision, or defect that the status prints.
   - `Done:` the commands that you ran. Say that you changed nothing.
   - `Next:` who acts, from `waitsOn`, and each `next` command from the status. Give the `why` lines as the reason. When `waitsOn` is `none`, say that the loop is complete.

Do not change the records. Do not answer gaps, approve, or begin a run. Tell the oracle the command, or `/checkmate:ui`.
