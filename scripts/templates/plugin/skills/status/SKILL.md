---
name: status
description: Answer where a Checkmate plan or run is in the loop and who acts next. Read only.
---

Call `{{tool status}}` with the plan ID. For a named run, also call `{{tool read_run}}` with its ID. Use `{{tool inbox}}` when the person asks about open work or gives no ID.

Report the current state, the build and instance where relevant, and the person who acts next. Distinguish the last result from an open run. Report readiness, coverage, and outcomes from the record. A completed action can record failed or blocked tests.

Show the relevant review page when the oracle needs to answer a gap, approve a plan, or accept a result. Do not start work from this skill. Keep tool names and internal paths out of replies.
