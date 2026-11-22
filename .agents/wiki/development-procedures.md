# Development procedures

Read the implementation before changing its contract or documentation.

1. Update the relevant JSON Schema.
2. Update the implementation and tests.
3. Run `npm run generate` after a schema change.
4. Update the relevant workflow skill and documentation.
5. Run `npm run phase:verify` and `npm run test:merge`.
6. Run `npm run test:live` only when the change needs it and the run is authorized. Authentication alone does not authorize a potentially paid run.

Follow the rules in [Writing tests](../../docs/development.md#writing-tests) when you add or change a test.

## Test design

- Start with the public command or UI flow that a person or factory uses. Use the built or packed artifact when packaging can change behavior. Use a real temporary database or loopback app when the workflow crosses those boundaries.
- Control external hosts and services. Capture what Checkmate sends and assert the command result and persisted record. A fake can verify the host protocol. It cannot prove live model judgment or host compliance.
- Add focused lower-level tests for distinct parser, state, schema, concurrency, transaction, and refusal invariants. Keep them when they catch a failure that the workflow test does not catch clearly or cheaply.
- Do not repeat the same surface assertion across layers without a distinct failure mode. Prefer state, evidence, and user-visible outcome assertions over full prompt or markup snapshots. Keep prompt checks for instructions that change safety or scope, and check only the required meaning.
- Before retiring a test, name the failure it catches and its callers. Keep that behavior in a replacement test, or record a concrete reason why the test adds no distinct coverage.
- Use controlled local hosts for routine checks. Run authenticated or paid live tests only when the change needs them and the run is authorized. Report live tests that you did not run.

Use ASD-STE100 style for documentation, instructions, and skills. Use short sentences and consistent terms. Give one action per instruction.

Report passed, failed, and unrun checks separately. Do not claim that mocked output proves live Claude behavior.

Keep publication separate from implementation. Do not create a release or tag unless the user requests it.
