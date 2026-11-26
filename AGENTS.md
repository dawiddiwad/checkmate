# AGENTS.md

> **Agent only:** This file contains repository or workflow instructions for coding agents.

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
- `.agents/skills/update-model-policy/SKILL.md` for model aliases, authentication, and permissions.
- `.agents/skills/pull-request/SKILL.md` for every pull request.

## Non-Negotiables

- Keep naming concrete and honest.
- Do not spread one concept across many files without a good reason.
- Do not add abstractions unless they remove real complexity.
- If behavior changes, update tests.
- Test public behavior through the command or UI first. Follow [test design](.agents/wiki/development-procedures.md#test-design).
- Run `npm test` for the required packaged scenarios. Read `test/e2e/scenarios.json` for coverage and gaps.
- If public API, config, or workflow changes, update documentation.
- Do not type a Checkmate tool name or tool field as a string literal. Edit a generated skill only in `scripts/templates/`. Follow [tool names and generated skills](.agents/wiki/development-procedures.md#tool-names-and-generated-skills).
- Keep authentication, credentials, and permissions with the host. Follow `.agents/skills/update-model-policy/SKILL.md`.
- Use ASD-STE100 style for documentation, instructions, and skills: short sentences, consistent terms, and one action per instruction.
