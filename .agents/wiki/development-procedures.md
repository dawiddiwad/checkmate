# Development procedures

Read the implementation before changing its contract or documentation.

1. Update the relevant JSON Schema.
2. Update the implementation and tests.
3. Run `node scripts/generate-types.mjs` after a schema change.
4. Update the relevant workflow skill and documentation.
5. Run `npm run phase:verify`.
6. Run `npm run test:live` for changes to Claude integration or workflow behavior when authentication is available.

Use ASD-STE100 style for documentation, instructions, and skills. Use short sentences and consistent terms. Give one action per instruction.

Report passed, failed, and unrun checks separately. Do not claim that mocked output proves live Claude behavior.

Keep publication separate from implementation. Do not create a release or tag unless the caller requests it.
