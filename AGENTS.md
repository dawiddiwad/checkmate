# AGENTS.md

## Coding Standards

Write code like Linus Torvalds.

## Purpose

This codebase is for humans first, and must be:

- obvious
- readable
- maintainable
- easy to follow
- modular without pointless abstraction
- no clever code that makes maintenance harder

## Priorities

1. Keep behavior correct.
2. Prefer the smallest clear change.
3. Optimize for human readers over "smart" structure.
4. Keep runtime flow, tool contracts, tests, and docs aligned.

## Read First

- `.agents/wiki/coding-standards.md`
- `.agents/wiki/architecture.md`
- `.agents/wiki/development-procedures.md`

## Task-Specific Skills

- `.agents/skills/update-documentation/SKILL.md` for public API, configuration, behavior, and workflow documentation.
- `.agents/skills/update-model-policy/SKILL.md` for policy-owned model selection, provider requests, egress controls, and token accounting.

## Non-Negotiables

- Keep naming concrete and honest.
- Do not spread one concept across many files without a good reason.
- Do not add abstractions unless they remove real complexity.
- If behavior changes, update tests.
- If public API, config, or workflow changes, update documentation.
- Keep model selection and egress policy-owned. Checkmate reports raw token usage, not model pricing or USD budgets.
