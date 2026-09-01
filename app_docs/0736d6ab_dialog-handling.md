# JavaScript dialog handling

This change adds controlled handling for browser JavaScript `alert`, `confirm`, and `prompt` dialogs. Dialogs are still safe by default: if no response is armed, the transient tracker dismisses the dialog automatically so the run does not hang. When a step needs a specific result, the agent can now arm the response immediately before the browser action that opens the dialog.

## What changed

- `src/tools/browser/tool.ts` adds `browser_set_dialog_response` to the browser tool set.
  - Arguments are `action: "accept" | "dismiss"`, optional `promptText`, and `goal`.
  - Runtime messages confirm whether the next dialog will be accepted, accepted with prompt text, or dismissed.
  - The pending response is one-shot. It is consumed by the next dialog during a tracked browser action, or cleared when that tracked action finishes without using it.
- `src/tools/browser/transient-state-tracker.ts` adds `DialogHandlingIntent` and tracker options for `consumeDialogHandlingIntent`.
  - Armed `accept` calls `dialog.accept()`, or `dialog.accept(promptText)` when text is provided.
  - Armed `dismiss` calls `dialog.dismiss()`.
  - Unarmed dialogs keep the existing automatic-dismiss behavior and timeline entry.
  - Timeline entries now distinguish armed accept/dismiss from automatic dismissal.
- `src/playwright.ts` adds a web extension instruction telling the agent to call `browser_set_dialog_response` immediately before the action expected to open a JavaScript dialog when OK, Cancel, or prompt text is required.
- `README.md` and `docs/GUIDE.md` document the default dismissal behavior, the pre-arming pattern, and the need to include `browser_set_dialog_response` when browser tools are restricted with `OPENAI_ALLOWED_TOOLS`.
- `specs/0736d6ab_dialog-handling.md` records the implementation plan and edge cases.

## How to use it

Describe the required dialog outcome in the AI step before the triggering action, for example:

- `accept the Delete confirmation`
- `dismiss the confirmation dialog`
- `enter 'Alice' in the prompt`

The agent should then call `browser_set_dialog_response` and immediately follow it with the click, navigation, key press, type, wait, or other tracked browser action that opens the dialog. If the dialog is not armed, `alert`/`confirm`/`prompt` dialogs are dismissed automatically.

## Verification

The diff adds coverage in:

- `src/test/browser-tool.test.ts` for tool registration, argument validation, arming messages, passing the pending intent to a tracked action, and clearing unused intent.
- `src/test/transient-tracker.unit.test.ts` for unarmed dismissal, armed accept, armed dismiss, prompt text, and one-shot consumption.
- `src/test/transient-tracker-integration.test.ts` for real Playwright confirm and prompt return values.

Focused verification command from the spec:

```bash
npm run test:unit:run -- src/test/transient-tracker.unit.test.ts src/test/transient-tracker-integration.test.ts src/test/browser-tool.test.ts
```
