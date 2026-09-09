---
name: 'update-model-policy'
description: 'Update Checkmate model selection, provider request behavior, egress controls, and token accounting while preserving manifest ownership.'
---

## Ownership

The selected manifest policy owns provider, model, endpoint, API-key binding, generation settings, and egress controls. There is no implicit model default or runtime pricing table. Requests can select an approved policy and tighten scenario timeout or token budget; they cannot override model settings.

Read `.agents/wiki/architecture.md` for runtime ownership. Inspect only the relevant boundaries:

- `src/contracts/schemas/checkmate-config.v1.json`, `src/contracts/schemas/run-request.v1.json`, and `src/contracts/types.ts` for wire contracts.
- `src/config/model-egress.ts`, `src/config/policy.ts`, and `src/api/prepare-run.ts` for static validation and effective policy.
- `src/ai/client.ts`, `src/ai/rate-limit-policy.ts`, and `src/ai/turn-processor.ts` for provider adaptation and bounded request retries.
- `src/runtime/usage-tracker.ts` for token accounting; `src/runtime/config.ts` is internal, not another operator configuration source.
- `docs/CONFIGURATION.md` and `.env.example` for setup guidance; `test/acceptance/ollama-cli.mjs` owns test-only environment loading.

## Preserve These Boundaries

- Validate settings without importing executable drivers or retaining secret values. Runtime secrets use invocation-local readers.
- Apply model-egress text redaction, opaque-content permission, and byte limits before provider adaptation. Evidence redaction is a separate policy; diagnostic sanitization is mandatory under either setting.
- Count the response that crosses the token ceiling. Wholly missing usage is fatal only with an active ceiling; malformed or partial usage is always fatal. Do not introduce costs or USD budgets.
- Provider-request retries remain bounded; they do not authorize whole-scenario retries or target rollback.
- Normal CLI/API calls do not implicitly load `.env` or provider settings from environment variables. The selected live test harness explicitly loads its environment and writes a temporary manifest.

Verify changed provider capabilities against current official documentation when necessary. Do not change operator model choices, example models, or credentials merely because a newer model exists.

## Verification

Update the relevant policy/egress and usage suites under `src/test/config/`, `src/test/runtime/`, and `src/test/openai-client-retry.test.ts`. Fake-provider tests should inspect the actual outgoing request, not only resolved configuration.

Keep affected configuration docs and examples aligned with schemas. Preserve unrelated user edits. Run `npm run phase:verify`; use `npm run phase:verify -- --live` when live acceptance is required and configured. Missing live inputs fail rather than skip, and secret values must not appear in output.
