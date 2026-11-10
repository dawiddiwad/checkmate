---
name: checkmate-execute
description: Execute a pinned Checkmate plan with direct tools. Record observations and evidence. Preserve blocked and omitted coverage.
---

`<plugin>` is the Checkmate plugin root: the directory two levels above this `SKILL.md`. Use its absolute path in commands.

Read `<plugin>/references/workflow.md`.
Read `<plugin>/contracts/execute-request.schema.json` and `<plugin>/contracts/observation.schema.json`.
Read `<plugin>/references/browser.md` and `<plugin>/references/http.md` as needed.

1. Read the request, plan, and profile. Run `checkmate gate`. Stop if the gate does not return `completed`.
2. In the current session, run `checkmate begin` once. In a delegated stage, the parent has already done this. Read `invocation.json` in the output directory. Use its exact `startedAt` and `browserSession`.
3. Run only selected ready tests. Run prerequisite tests first. A failed prerequisite prevents dependent test actions.
4. Use the target's tools directly. Do not generate maintained automation. Do not modify the application.
5. Compare each observation with the plan's exact expected result. Copy that expected result and oracle kind into the observation document.
6. Save evidence files in `<outputDirectory>/evidence/`. Record each file's ID, kind, and path. Write the path relative to the output directory. For `outputDirectory: runs/run-1`, save `runs/run-1/evidence/T1.txt` and record `"path": "evidence/T1.txt"`. The finalizer records the SHA-256 digest of each file. A pass or failure needs actual evidence.
7. Record an observed mismatch as `failed` with a `defect` finding. Use `error` for a tool or access failure. Use `potential_issue` for an inference. Do not call a tool error a product defect.
8. Record new ambiguity as an open gap. Stop further actions if `onNewBlocker` is `return_to_caller`. Otherwise continue only independent tests. Record blocked dependent tests.
9. Include each selected test exactly once. Give each blocked, not-run, or erroneous test a reason. You can omit an unselected test. The finalizer records it as `not_run`.
10. Close only this run's browser session. Record cleanup status. A tool or cleanup error requires `completion: operational_error`. A deadline requires `completion: interrupted`.
11. Write the observation document. In `host`, declare the agent CLI that runs this session, its version, and your model. Use null for a value that you do not know. In a delegated stage, the parent replaces it with the host that it ran. Do not include `coverage` or `finishedAt`. The finalizer calculates coverage and records the finish time. Copy request identity, pinned references, selected IDs, build identity, and any `retestOf` reference exactly.
12. Publish with `checkmate finalize`, unless the parent requested a candidate only. Return its response.

A retest is a new run with a new build identity. Keep the prior run unchanged. A narrow retest does not establish full coverage.
