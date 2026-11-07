---
name: plan
description: Create a test plan from requirements or an exploratory objective. Record explicit oracles, coverage, and gaps before execution.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.
Read `contracts/plan-request.schema.json` and `contracts/plan.schema.json` in the plugin.

1. Read the request and the pinned target profile. Check the profile digest.
2. Preserve every declared requirement and its source. Do not broaden the declared scope.
3. Create tests with requirement IDs, capability, permitted operations, prerequisites, action, expected result, and oracle kind.
4. Record unknown expected behavior, missing access, and unsupported tools as gaps. An unknown oracle is blocking. A global access gap has empty requirement and test lists.
5. Set test readiness from the gaps: `ready`, `blocked`, or `deferred`. A ready test needs an explicit expected result. Do not invent caller decisions or accepted assumptions.
6. Set coverage to `planned`, `blocked`, or `deferred`. Use `planCoverage` from the plugin API to calculate it if needed. Never mark a planned test as passed.
7. Write revision 1 with `previousRevision: null`, empty `decisions`, and empty `assumptions`. Copy the target reference from the request.
8. Publish with `checkmate save-plan`, unless the parent requested a candidate only. Return blocking questions to the caller.

Do not run test actions during planning. Do not silently omit a requirement. Use a scoped exploratory objective when a full requirement inventory is unavailable.
