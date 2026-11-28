# Coding Standards

> **Agent only:** This file contains repository or workflow instructions for coding agents.

## Style

- Prefer small, explicit functions.
- Prefer plain data flow over deep indirection.
- Avoid hidden state.
- Keep module boundaries honest.
- Do not write comments.
- Do not add ; at the end of lines.

## Naming

- Use names that describe current behavior.
- Avoid vague names like `manager`, `helper`, or `util` unless that is the real job.
- Public API names should be stable and easy to understand.

## Structure

- One module, one job.
- Keep related logic together.
- Split files only when it improves comprehension.
- Do not create abstractions just to look clean.

## Changes

- Make the smallest correct change first.
- Remove dead paths when they are no longer needed.
- Do not add compatibility code without a real reason.
- In the review UI, use the design tokens from `plugin/src/ui/tokens.css` and the rules in `docs/design-system.md`. Do not write raw colours in component rules. Do not write raw lengths in `gap`, `padding`, or `margin`. Use the breakpoints of the design system in `@media`.

## Tests and Docs

- Update existing tests when semantics change.
- Update docs when changing examples or architecture.
- Keep model policy, provider behavior, token accounting, tests, and configuration docs aligned. Do not add USD pricing. Follow `.agents/skills/update-model-policy/SKILL.md`.
