---
name: status
description: Answer where a Checkmate plan is in the loop, who it waits on, and what comes next. Use when the human asks about the state of a plan, a ticket, a run, or the inbox. Reads only.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path. Do not write a shell variable in its place.

Checkmate stores no loop state. `checkmate status` derives it from the records. Do not read the database file with another tool. Do not look for scheduled jobs.

1. Find the plan ID in the question. If the question names no plan, run `checkmate plan list`. It prints `state=` and `waitsOn=` for each plan. If one plan matches the question, use it. Else report the plan list and stop.
2. Run `checkmate status <planId>`. Line 1 has `state=`, `waitsOn=`, the revision, the approval, and the latest run. The other lines are `why`, `next`, the open gaps, the pending decisions, and the defects of the latest finished run.
3. If the question is about a run, also run `checkmate run show <runId>`. If the question is about all open work, also run `checkmate inbox`.
4. Report in the format of `workflow.md`:
   - A table with one row for the plan: plan and revision, state, waits on, approval, and latest run. Add one row for each open gap, pending decision, or defect that the status prints.
   - `Done:` the commands that you ran. Say that you changed nothing.
   - `Next:` who acts, from `waitsOn`, and the `next` command from the status. Give the `why` lines as the reason. When `waitsOn` is `none`, say that the loop is complete.

Do not change the records. Do not answer gaps, approve, or begin a run. Tell the human the command, or `/checkmate:ui`.
