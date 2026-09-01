# Plan: Browser JavaScript dialog handling

## Goal

Give the agent controlled handling for JavaScript `alert()`, `confirm()`, and `prompt()` dialogs instead of always auto-dismissing them. Keep the safe fallback: if no dialog response was armed, dismiss the dialog automatically so the browser never hangs.

The dialog response must be armed before the browser action that opens the dialog because Playwright dialogs block the triggering action and the model cannot be asked after the dialog appears.

## Design

Add one new browser tool: `browser_set_dialog_response`.

- Purpose: arm how the next JavaScript dialog should be answered.
- The setting is one-shot and scoped to the next tracked browser action.
- Arguments:
  - `action`: enum `'accept' | 'dismiss'`
  - `promptText`: optional string, used only when accepting a `prompt()`
  - `goal`: string, consistent with other browser tools
- Behavior:
  - Agent calls `browser_set_dialog_response` immediately before the click/navigation/key/type/wait that is expected to open a dialog.
  - The next dialog during the next tracked browser action consumes the pending response.
  - If no dialog appears during that action, clear the pending response when the action finishes to avoid applying a stale accept/dismiss to an unrelated later dialog.
  - If no response is armed and a dialog appears, keep existing safe behavior: dismiss it automatically and record that in the timeline.

Expected JavaScript effects:

- `alert()`:
  - accept or dismiss both close the alert, but the timeline should report what was requested.
- `confirm()`:
  - accept returns `true` to page JavaScript.
  - dismiss returns `false`.
- `prompt()`:
  - accept with `promptText` returns that text.
  - accept without `promptText` returns the browser/default prompt value per Playwright behavior.
  - dismiss returns `null`.

## Files to change

### `src/tools/browser/transient-state-tracker.ts`

1. Add an exported type near the existing local types:

   ```ts
   export type DialogHandlingIntent = {
   	action: 'accept' | 'dismiss'
   	promptText?: string
   }
   ```

2. Replace the current constructor's bare optional `clock` parameter with a small options object, while preserving existing call sites:

   ```ts
   type TransientStateTrackerOptions = {
   	clock?: Clock
   	consumeDialogHandlingIntent?: () => DialogHandlingIntent | null
   }
   ```

   Use `clock ?? (() => Date.now())` for `TimelineRecorder`. Default `consumeDialogHandlingIntent` to `() => null`.

3. Pass `consumeDialogHandlingIntent` into `PageEventManager`.

4. Update `PageEventManager` to store that callback.

5. Replace `handleDialog` logic:

   - Return immediately if not tracking, as today.
   - Call `consumeDialogHandlingIntent()` once per dialog.
   - If it returns `{ action: 'accept', promptText }`:
     - record a timeline entry saying the dialog appeared and was accepted by the armed dialog response.
     - call `dialog.accept(promptText)` when `promptText` is defined, otherwise `dialog.accept()`.
   - If it returns `{ action: 'dismiss' }`:
     - record a timeline entry saying the dialog appeared and was dismissed by the armed dialog response.
     - call `dialog.dismiss()`.
   - If it returns `null`:
     - preserve the current fallback record text as closely as possible: `Dialog appeared: "..." (Type: ...) and automatically dismissed.`
     - call `dialog.dismiss()`.
   - Keep `.catch(() => {})` on Playwright dialog promises so cleanup remains best-effort.

6. Keep existing mutation, console-error, navigation, start/stop, and timeline formatting behavior unchanged.

### `src/tools/browser/tool.ts`

1. Import `DialogHandlingIntent` from `./transient-state-tracker.js`.

2. Extend `BrowserTool`:

   ```ts
   TOOL_SET_DIALOG_RESPONSE: 'browser_set_dialog_response'
   ```

3. Add private runtime state to `BrowserToolRuntime`:

   ```ts
   private pendingDialogHandlingIntent: DialogHandlingIntent | null = null
   ```

4. Add a runtime method:

   ```ts
   setDialogResponse(action: 'accept' | 'dismiss', promptText?: string): string
   ```

   It should set `pendingDialogHandlingIntent` and return a clear success message, for example:

   - `Will accept the next JavaScript dialog.`
   - `Will accept the next JavaScript dialog with prompt text.`
   - `Will dismiss the next JavaScript dialog.`

5. Add a private `consumePendingDialogHandlingIntent()` method that returns the current intent and immediately sets the field to `null`.

6. In `wrapWithTracker()`, construct the tracker with the intent consumer:

   ```ts
   const tracker = new TransientStateTracker(this.page, {
   	consumeDialogHandlingIntent: () => this.consumePendingDialogHandlingIntent(),
   })
   ```

7. Ensure every tracked browser action clears any unused pending intent when it finishes or errors. The simplest readable approach is a `finally` block in `wrapWithTracker()` that sets `pendingDialogHandlingIntent = null` after `tracker.stop()` has run. Do not clear before `captureCurrentSnapshot()` because a dialog can appear after the action but before snapshot capture completes.

8. Add a Zod schema for the new tool:

   ```ts
   const dialogResponseSchema = z
   	.object({
   		action: z.enum(['accept', 'dismiss']).describe('How to answer the next JavaScript alert, confirm, or prompt'),
   		promptText: z.string().optional().describe('Text to submit when accepting a prompt() dialog'),
   		goal: z.string().describe('The goal or purpose of handling the next dialog'),
   	})
   	.strict()
   ```

   Keep it permissive: allow `promptText` with `accept`; ignore it for `dismiss` in runtime rather than making the agent fight schema edge cases.

9. Register the new tool in `createBrowserTools(runtime)` with description similar to:

   `Set how to answer the next JavaScript alert, confirm, or prompt. Call this immediately before the browser action expected to open the dialog. Unarmed dialogs are dismissed automatically.`

   Handler: `({ action, promptText }) => runtime.setDialogResponse(action, promptText)`.

10. Update any browser-tool count/order assertions to include the new tool. Put it near the other interaction tools, preferably before click/hover or immediately after click/hover. Use the same order in tests as in `createBrowserTools()`.

### `src/playwright.ts`

Add a web extension instruction so the model knows the pre-arming pattern:

```ts
`For JavaScript alert, confirm, or prompt dialogs, call '${BrowserTool.TOOL_SET_DIALOG_RESPONSE}' immediately before the browser action that opens the dialog when the step needs OK, Cancel, or prompt text. Unarmed dialogs are dismissed automatically.`,
```

Keep the existing snapshot instruction.

### `src/test/transient-tracker.unit.test.ts`

Update the fake dialog helper so `accept` and `dismiss` are separate mocks and `accept` can receive an optional prompt string.

Add/update tests:

1. Existing unarmed dialog test still passes:
   - timeline contains `Dialog appeared: "Heads up"`
   - `dismiss` called once
   - `accept` not called
2. Armed accept:
   - create tracker with `{ consumeDialogHandlingIntent: () => ({ action: 'accept' }) }`
   - emit an `alert` or `confirm`
   - `accept` called once
   - `dismiss` not called
   - timeline says accepted by armed response
3. Armed dismiss:
   - consumer returns `{ action: 'dismiss' }`
   - `dismiss` called once
   - `accept` not called
4. Armed prompt text:
   - consumer returns `{ action: 'accept', promptText: 'Alice' }`
   - `accept` called with `'Alice'`
5. Intent is one-shot at tracker level:
   - consumer returns accept once and then null
   - emit two dialogs
   - first accepted, second auto-dismissed

### `src/test/transient-tracker-integration.test.ts`

Add real Playwright tests for JavaScript results:

1. Unarmed confirm is dismissed:

   ```ts
   const result = await page.evaluate(() => confirm('Delete item?'))
   expect(result).toBe(false)
   ```

2. Armed confirm accept returns `true`.

3. Armed prompt accept with text returns that text:

   ```ts
   const result = await page.evaluate(() => prompt('Name?', 'default'))
   expect(result).toBe('Alice')
   ```

4. Armed prompt dismiss returns `null`.

Use a local mutable `intent` variable and a consumer that returns it once, then clears it, to match runtime behavior.

### `src/test/browser-tool.test.ts`

Update the transient tracker mock so its constructor captures the options object. This lets tests verify the runtime passes the pending intent to the tracker.

Changes/tests:

1. Tool definition count becomes 9 and includes `BrowserTool.TOOL_SET_DIALOG_RESPONSE` in the registered order.
2. New tool accepts valid args and returns the arming response.
3. New tool validates invalid args through Zod.
4. Pending intent is available to the next tracked browser action:
   - call `browser_set_dialog_response` with `{ action: 'accept', promptText: 'Alice', goal: 'fill prompt' }`
   - make the mocked `page.click` call the captured `consumeDialogHandlingIntent()` while the action is executing
   - assert it receives `{ action: 'accept', promptText: 'Alice' }`
5. Pending intent is cleared when a tracked action finishes without a dialog:
   - arm accept
   - run a click whose mock does not consume the intent
   - run another click whose mock tries to consume it
   - assert the second click sees `null`

Keep existing behavior tests for navigate/click/drag/upload/type/press/wait/snapshot.

### Documentation

Use the documentation-update skill requirements: behavior changes and public browser tool behavior need docs.

#### `docs/GUIDE.md`

1. In **Writing Effective Tests > Best Practices**, update the popup guidance to mention JavaScript dialogs explicitly. Example wording:

   `For JavaScript alert/confirm/prompt dialogs, say whether to accept, dismiss, or provide prompt text before the triggering action.`

2. In **Web Extension**, add a bullet under “What it adds”:

   `- one-shot JavaScript dialog handling for alert, confirm, and prompt dialogs`

3. Add a short paragraph near the Web Extension example:

   `Unarmed JavaScript dialogs are dismissed automatically. If a flow needs OK/Cancel or prompt input, describe it in the step, for example: "accept the Delete confirmation" or "enter 'Alice' in the prompt". The agent will arm the dialog response before clicking the control that opens it.`

4. In troubleshooting or best practices, mention that users with `OPENAI_ALLOWED_TOOLS` must include `browser_set_dialog_response` if they restrict browser tools and expect dialog control.

#### `README.md`

Add a concise note in **Common Issues** or near the guide link:

- JavaScript `alert`/`confirm`/`prompt` dialogs are dismissed by default.
- Tell the step to accept/dismiss/fill the dialog when the flow requires it.

No README API examples need to change.

## Edge cases to preserve

- Dialogs never hang the run: unarmed dialogs still auto-dismiss.
- Armed responses never persist beyond one tracked browser action.
- A dialog that appears during snapshot capture after the triggering action should still use the armed response because the tracker remains active until after snapshot capture.
- Existing mutation observer, console error, navigation stop behavior, and timeline formatting stay unchanged.
- Do not add a tool that tries to answer an already-open dialog after the model sees it; the timing cannot work reliably because the page action is blocked by the dialog.

## Verification

Run focused tests first:

```bash
npm run test:unit:run -- src/test/transient-tracker.unit.test.ts src/test/transient-tracker-integration.test.ts src/test/browser-tool.test.ts
```

Then run the standard checks:

```bash
npm run compile:check
npm run lint:check
npm run format:check
```

If formatting fails, run:

```bash
npm run format:fix
```

Final confidence check before handoff:

```bash
npm run validation:check
```
