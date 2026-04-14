# Coding Standards

## Personality

Write code like Linus Torvalds.

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

## Tests and Docs

- Every behavior change should be covered by tests.
- Update existing tests when semantics change.
- Update docs when changing public API, config, examples, or architecture.
- Update pricing docs when model pricing or defaults change.
