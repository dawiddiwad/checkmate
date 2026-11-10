---
name: checkmate-plan
description: Create a test plan from requirements or an exploratory objective. Record explicit oracles, coverage, and gaps before execution.
---

`<plugin>` is the Checkmate plugin root: the directory two levels above this `SKILL.md`. Use its absolute path in commands.

Read `<plugin>/references/workflow.md`.
Read `<plugin>/contracts/plan-request.schema.json` and `<plugin>/contracts/plan.schema.json`. The plan candidate uses the plan schema without `coverage`.

1. Read the request and the pinned target profile. Check the profile digest.
2. Preserve every declared requirement and its source. Do not broaden the declared scope.
3. Create tests with requirement IDs, capability, permitted operations, prerequisites, action, expected result, and oracle kind.
4. Record unknown expected behavior, missing access, and unsupported tools as gaps. An unknown oracle is blocking. Scope each gap with care. A gap applies to the tests it names and to every test of the requirements it names. To block only one test, name that test and leave the requirement list empty. A global access gap has empty requirement and test lists.
5. Do not set test readiness. `save-plan` sets it from the gaps: an open blocking gap blocks a test, and a deferred gap defers it. A test that no such gap applies to is ready, and needs an explicit expected result. Do not invent caller decisions or accepted assumptions.
6. Do not write `coverage`. `save-plan` calculates coverage from the tests and gaps. Never mark a planned test as passed.
7. Write revision 1 with `previousRevision: null`, empty `decisions`, and empty `assumptions`. Copy the target reference from the request.
8. Publish with `checkmate save-plan`, unless the parent requested a candidate only. Return blocking questions to the caller.

Do not run test actions during planning. Do not silently omit a requirement. Use a scoped exploratory objective when a full requirement inventory is unavailable.
