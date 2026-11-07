---
name: execute
description: Execute a pinned Checkmate plan with direct tools. Record observations and evidence. Preserve blocked and omitted coverage.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.
Read `contracts/execute-request.schema.json` and `contracts/observation.schema.json` in the plugin.
Read `${CLAUDE_PLUGIN_ROOT}/references/browser.md` and `${CLAUDE_PLUGIN_ROOT}/references/http.md` as needed.

1. Read the request, plan, and profile. Run `checkmate gate`. Stop if the gate does not return `completed`.
2. In the current session, run `checkmate begin` once. In a delegated stage, the parent has already done this. Read `invocation.json` in the output directory. Use its exact `startedAt` and `browserSession`.
3. Run only selected ready tests. Run prerequisite tests first. A failed prerequisite prevents dependent test actions.
4. Use the target's tools directly. Do not generate maintained automation. Do not modify the application.
5. Compare each observation with the plan's exact expected result. Copy that expected result and oracle kind into the observation document.
6. Save evidence beneath `outputDirectory/evidence/`. Record each file's ID, kind, and path. The finalizer records the SHA-256 digest of each file. A pass or failure needs actual evidence.
7. Record an observed mismatch as `failed` with a `defect` finding. Use `error` for a tool or access failure. Use `potential_issue` for an inference. Do not call a tool error a product defect.
8. Record new ambiguity as an open gap. Stop further actions if `onNewBlocker` is `return_to_caller`. Otherwise continue only independent tests. Record blocked dependent tests.
9. Include every planned test exactly once. Use `not_run` for omitted or deferred tests. Give each blocked, omitted, or erroneous test a reason.
10. Close only this run's browser session. Record cleanup status. A tool or cleanup error requires `completion: operational_error`. A deadline requires `completion: interrupted`.
11. Write the observation document. Do not include `coverage` or `finishedAt`. The finalizer calculates coverage and records the finish time. Copy request identity, pinned references, selected IDs, build identity, and any `retestOf` reference exactly.
12. Publish with `checkmate finalize`, unless the parent requested a candidate only. Return its response.

A retest is a new run with a new build identity. Keep the prior run unchanged. A narrow retest does not establish full coverage.
