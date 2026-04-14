---
name: 'update-model-pricing'
description: 'Update model pricing, defaults, and provider recommendations'
argument-hint: 'Describe the pricing change and which docs to update'
---

## Purpose

Use this skill when model pricing, model defaults, or provider recommendations change.

This is not just a code edit. Pricing changes must keep:

- runtime pricing logic
- default model behavior
- docs
- examples
- cost guidance

all in sync.

## Source of Truth

Verify pricing against the provider's current published pricing page before changing code or docs.

Do not guess.
Do not partially update one model and leave related references stale.

## Check

- `src/ai/token-pricing.ts`
- runtime config defaults that affect pricing or model selection
- `README.md`
- `docs/GUIDE.md`
- any examples mentioning recommended models or cost tradeoffs

## What To Update

1. Pricing logic

- update per-model input and output pricing
- update cached-input pricing behavior if needed
- keep rounding behavior consistent
- keep fallback/default behavior explicit

2. Model defaults and recommendations

- update default models if they changed
- update recommended models in docs if tradeoffs changed
- update examples if they mention old model names or outdated guidance

3. Cost guidance in docs

- update cost estimates if they are no longer credible
- update model comparison text if the recommendation changed
- update any statements about cheap, fast, or recommended models

## Cross-Checks

Make sure these stay aligned:

- model names in pricing logic
- model names in config defaults
- model names in README and GUIDE examples
- cost wording in docs
- any provider-specific notes

If you change pricing for a model family, check all nearby variants too.

Examples:

- mini / nano / pro
- dated model aliases
- provider-hosted aliases

## Done Criteria

- pricing logic matches current provider references
- docs match runtime behavior
- model recommendations are still credible
- examples do not mention stale models or pricing assumptions
- compile passes
- relevant tests pass
