# Development procedures

Read the implementation before changing its contract or documentation.

1. Update the relevant JSON Schema.
2. Update the implementation and tests.
3. Run `npm run generate` after a schema change.
4. Update the relevant workflow skill and documentation.
5. Run `npm run phase:verify`.
6. Run `npm run test:live` for changes to host integration or workflow behavior when authentication is available. Set `CHECKMATE_LIVE_HOST` to `codex` or `pi` to run the live test on another host. Run it on each host that the change affects.

Use ASD-STE100 style for documentation, instructions, and skills. Use short sentences and consistent terms. Give one action per instruction.

Report passed, failed, and unrun checks separately. Do not claim that mocked output proves live host behavior.

Keep publication separate from implementation. Do not create a release or tag unless the caller requests it.
