---
name: 'update-documentation'
description: 'Update documentation related to a code change'
argument-hint: 'Describe the code change and which docs to update'
---

## Purpose

Use this skill when behavior, public API, configuration, examples, architecture, or workflow changes.

Documentation must describe the code as it exists now.
Do not leave stale examples, stale names, or stale behavior notes behind.

## Check

- `README.md`
- `docs/GUIDE.md`
- `docs/ROADMAP.md`
- public API exports in `src/index.ts`
- public runtime types in `src/runtime/types.ts`
- changed modules related to the feature

## What To Update

1. Public API docs

- names
- examples
- arguments
- behavior
- return values if user-facing

2. Configuration docs

- env vars
- defaults
- valid ranges
- feature flags
- behavior changes caused by config

3. Behavioral docs

- step semantics
- filtering behavior
- tool behavior
- runtime flow
- cost and performance notes if affected

4. Architecture docs

- folder and module ownership
- moved or renamed modules
- new extension points
- removed concepts

5. Examples

- README snippets
- GUIDE examples
- fixture usage
- programmatic API usage

## Rules

- Prefer concrete statements over vague summaries.
- Keep examples minimal and correct.
- If a name changed in code, change it everywhere in docs.
- If behavior changed, update both prose and examples.
- If a feature was removed, remove or rewrite the docs. Do not leave historical leftovers.
- If a public step option or config key changed, document the value format and give one example.

## High-Risk Areas

Always double-check these:

- copied examples
- config tables
- architecture sections
- cost guidance
- model recommendations
- feature behavior that recently changed

## Done Criteria

- docs match the current code
- examples use current names and APIs
- config docs match runtime defaults and accepted values
- no stale terminology remains for the changed feature
- README and GUIDE tell the same story
