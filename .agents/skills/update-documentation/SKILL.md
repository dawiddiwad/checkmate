---
name: 'update-documentation'
description: 'Align Checkmate documentation and examples with changes to versioned contracts, drivers, configuration, evidence, or CLI/API workflows.'
---

## Source Of Truth

Checkmate exposes a manifest-driven `describe -> validate -> run -> route-result` workflow. Read the changed implementation and its tests before updating prose.

- `src/contracts/schemas/` contains the authoritative hand-authored JSON Schemas; `src/contracts/types.ts` mirrors the wire contracts.
- `src/index.ts` and `src/api/index.ts` define the root embedding API. `src/driver.ts` defines the public driver API. `src/runtime/types.ts` contains internal reports, not the public result contract.
- `package.json`, `scripts/copy-package-assets.mjs`, and `test/package/` define shipped exports and assets. Do not document blocked deep imports or removed framework entry points.

## Route The Documentation Change

- `README.md`: product overview and introductory examples; preserve user-selected structure and unrelated edits.
- `docs/CLI.md`: commands, stdout envelopes, exit routing, signals, and parent/worker containment.
- `docs/CONFIGURATION.md` and `.env.example`: manifest ownership, policy limits, secret bindings, and explicit test-only environment loading.
- `docs/DRIVERS.md`: static descriptors, driver registration, session lifecycle, tools, and evidence capabilities.
- `docs/EVIDENCE.md`: retention, content redaction, mandatory diagnostic sanitization, durability, and invocation-relative references.
- `docs/DEVELOPMENT.md`: build, package gates, and local/live verification.
- `.agents/wiki/architecture.md` and `.agents/wiki/development-procedures.md`: runtime ownership and maintenance guidance.

Removed fixture guides, extension docs, scaffolding, and pricing tables are not documentation targets. Do not recreate them as compatibility guidance.

## Check Observable Behavior

- Keep execution, invalid invocation, pre-execution operational failure, and CLI-only containment distinct. Do not promise semantic steps or durable evidence in parent-authored outcomes.
- Preserve ordered steps, first-failure stopping, complete step enumeration, and cleanup/durability precedence. No result authorizes automatic whole-scenario retry.
- Describe the CLI worker as lifetime containment, not a sandbox. In-process cancellation is cooperative; Linux and macOS are the supported v1 platforms.
- Keep provider settings policy-owned and distinguish model-egress controls from evidence redaction. Structural metadata is not redacted; diagnostic content is sanitized even with evidence redaction off.
- Validate changed JSON examples against shipped schemas and preparation rules. Use deterministic fixtures under `src/test/fixtures/` where appropriate; do not pass off abbreviated fragments as complete runnable configuration.
- Check local documentation links and explicitly include referenced published assets in the package allowlist and its tests.

Run relevant tests and `npm run phase:verify`. For release verification, `npm run phase:verify -- --live` runs package and live acceptance against the same tarball. Report unavailable checks rather than claiming they passed.
