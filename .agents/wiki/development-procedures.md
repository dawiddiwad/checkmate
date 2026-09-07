# Development Procedures

## When Changing Runtime Flow

Check:

- `src/runtime/`
- `src/ai/client.ts`
- `src/ai/turn-processor.ts`
- `src/tools/registry.ts`
- `src/tools/dispatcher.ts`

Then update:

- unit tests
- integration tests
- architecture docs if boundaries changed

## When Changing Tools

Check:

- `src/driver.ts`
- `src/drivers/loader.ts`
- affected tool files

Then update:

- tool tests
- docs if user-facing behavior or parameter meaning changed
- examples if public usage changed

## When Changing Snapshot Filtering

Check:

- `src/drivers/web/tools/snapshot-filter/`
- `src/drivers/web/checkmate-driver.json`

Then update:

- `src/test/drivers/web/fuzzy-search.test.ts`
- `docs/DRIVERS.md`
- `README.md` if user-facing semantics changed

## When Changing Model Policy

Check:

- `src/config/model-egress.ts`
- `src/contracts/schemas/checkmate-config.v1.json`
- `src/runtime/usage-tracker.ts`

Then update:

- schema and egress tests
- `docs/CONFIGURATION.md` and README examples

The manifest selects the model explicitly. Runtime usage reports raw tokens, not USD estimates. Do not add model-pricing tables or implicit provider defaults.

## Done Criteria

- `npm run phase:verify` passes, including the installed final-surface probes
- docs match behavior
- examples still make sense
- the code is easy for a human to read and maintain

## Package And Release Verification

- Schemas are authored in `src/contracts/schemas/`; edit those sources, not generated root `schemas/` or `dist/` files. `scripts/copy-package-assets.mjs` owns static asset copying.
- `npm run phase:verify` performs source checks, a clean package build, exact tarball allowlist checks, installed export probes, and deterministic CLI acceptance. `prepack` builds only and must not recurse into tests or packing.
- `npm run phase:verify -- --live` adds live Ollama acceptance against the same tarball. CI selects it on `ubuntu-latest` and `macos-latest`; local macOS verification alone is not proof of the hosted matrix.
- The live harness explicitly loads the repository-root `.env` and requires `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`. Missing selected live configuration fails, never skips. Do not print or retain secret values in test output.
- Package asset changes require updating both `package.json` and `test/package/lifecycle.mjs`. Keep removed subpaths blocked and root/driver-contract imports browser-free.
- ESLint and Prettier exclude agent/workspace folders and local tool output. Check edited agent Markdown explicitly with `npx prettier --ignore-path /dev/null <paths> --check`; preserve unrelated user edits and report blockers without weakening gates.
