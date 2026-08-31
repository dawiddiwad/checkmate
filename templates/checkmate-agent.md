## Checkmate

Checkmate (`@xoxoai/checkmate`) runs one natural-language step through a model-driven tool
loop inside a Playwright test, via `ai.step({ action, expect })`. It is not a replacement for
ordinary Playwright locators and assertions — it exists for the flows those cannot express.

### When NOT to use `ai.step`

The main risk with this package is over-application: reaching for `ai.step` where
`page.getByRole(...)` and `expect(...)` would have worked. Every extra `ai.step` costs real
turns, real tokens, and real seconds, and trades a deterministic check for a model's judgment.

Do not use `ai.step` when:

- The outcome is checkable with an ordinary locator and assertion. If you can name the
  element and the state you're asserting, write it deterministically instead.
- The step is "click this button" or "fill this field" and the target is unambiguous. Use
  `page.getByRole(...)`, `page.getByTestId(...)`, or similar, and a plain `expect(...)`.
- You are asserting exact text, a count, a URL, or a value already available through the DOM.
  A locator-based assertion is cheaper, faster, and does not depend on a model's interpretation.
- The step would just re-describe in English what a short, stable Playwright snippet already
  says more precisely.

Use `ai.step` when the check genuinely cannot be expressed deterministically: visual or
layout judgment, "does this look/read reasonable", a flow whose selectors are unstable or
unknown ahead of time, or a multi-page path where writing out every intermediate locator
would be brittle and disproportionate to what's being verified.

Prefer mixing both in one test over choosing one exclusively — deterministic steps for the
parts you can name, `ai.step` for the parts you can't.

### How to write a step

```ts
import { test } from './checkmate.fixtures'

test('apply promo code', async ({ ai }) => {
	await ai.step({
		name: 'apply promo code',
		action: 'apply the seasonal promo code SPRING25 at checkout',
		expect: 'the order total drops and the discount is itemised',
	})
})
```

- `action` — what to do, in plain language. Keep it to one page or one flow segment; long
  chains eat turns and cost.
- `expect` — what "passed" looks like, stated as an observable fact the model can check
  against the page, not as an instruction.
- `name` (optional) — a short label; it becomes the `test.step` title and the attachment
  name, so give it one when `action` is long or another step in the same test is similar.
- Every step attaches `checkmate-step.json`, on passes as well as failures. Read `category`
  and `reason` before assuming a failure is a bug: `app` means the assertion genuinely failed
  against the page, `model` means the model gave up (loop detected or turn cap hit), `infra`
  means a budget or provider problem, not the flow under test.
- Configure the model, turn cap, step timeout, and evidence level with `checkmate*` options in
  `playwright.config.ts` (`use: { ... }`), or per test with `test.use({ ... })`.
