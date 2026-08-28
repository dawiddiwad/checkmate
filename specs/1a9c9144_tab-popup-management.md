# Plan: Browser tab and popup management

## Goal

Make the built-in browser runtime operate on an active page inside the Playwright `BrowserContext` instead of permanently operating on only the `Page` passed to `new BrowserToolRuntime(page)`. When browser actions open a tab or popup, the runtime should make that new page active, capture snapshots/screenshots from it, and route later browser tools to it. Add model-callable tab management tools so the agent can list, switch, and close tabs/popups when a flow needs to return to another page.

## Files to touch

- `src/tools/browser/tool.ts`
- `src/playwright.ts`
- `src/salesforce.ts` only if TypeScript imports/types need adjustment after the runtime API changes
- `src/tools/salesforce/login-tool.ts` only if TypeScript imports/types need adjustment after the runtime API changes
- `src/test/browser-tool.test.ts`
- `src/test/test-types.ts`
- `src/test/step-execution.integration.test.ts` and `src/test/openai-test-manager.test.ts` only if the browser runtime/tool mocks need new constants or constructor behavior
- `README.md`
- `docs/GUIDE.md`
- `docs/EXTENSIONS.md`

## Runtime design

1. Keep the public constructor shape `new BrowserToolRuntime(page: Page)`.
2. Inside `BrowserToolRuntime`, store:
   - `browserContext = page.context()`
   - `activePage = page`
   - stable in-memory page ids, for example `p1`, `p2`, assigned by the runtime and never reused during the runtime lifetime
3. Add clear methods to `BrowserToolRuntime`:
   - `getActivePage(): Page`
   - `getBrowserContext(): BrowserContext`
   - `listPages(): Promise<string>` or a structured helper used by the tool handler
   - `selectPage(pageId: string, step: Step): Promise<AgentToolResponse | string>`
   - `closePage(pageId: string | undefined, step: Step): Promise<AgentToolResponse | string>`
4. Track all pages in the context:
   - Register the constructor page immediately.
   - Subscribe to the context `page` event in the runtime constructor.
   - Register any existing pages returned by `browserContext.pages()` when listing/switching.
   - Remove closed pages from the list or filter them out every time the list is read.
5. Active page rules:
   - Initial active page is the constructor page.
   - `browser_navigate` navigates the current active page.
   - Every action tool reads `const page = this.getActivePage()` at execution time and uses that page for locators, keyboard, dialogs, tracker, waits, snapshots, and error messages.
   - When a click/key/type/upload/drag/navigate/wait action opens a new tab or popup, register the new page, set it active, bring it to front when possible, wait for a light readiness state (`domcontentloaded` or a short no-op fallback), and capture the response snapshot from the new active page.
   - If the active page closes, choose the most recent non-closed page in the same context. Prefer the closed page's opener when available and still open; otherwise use the last open page from `browserContext.pages()`.
   - If no pages remain, throw a clear runtime error.
6. Keep page state in one place. Do not pass a `Page` into every tool handler. Tool handlers should still call methods on the shared runtime.

## New browser tools

Add three model-callable tools in `src/tools/browser/tool.ts` and include them in `createBrowserTools(runtime)`:

1. `browser_list_tabs`
   - Schema: `{ goal: string }`
   - Returns a readable list of open pages with id, active marker, URL, and title.
   - Does not need a snapshot.
2. `browser_select_tab`
   - Schema: `{ pageId: string, goal: string }`
   - Sets that page active, brings it to front, and returns a fresh snapshot of the selected page.
   - Error string should say the requested page id was not found or is closed.
3. `browser_close_tab`
   - Schema: `{ pageId: string | null, goal: string }`
   - If `pageId` is null, close the active page.
   - Do not close the last open page; return a clear error string instead.
   - After closing, select the opener or the newest remaining page as active and return a fresh snapshot from it.

Add constants to `BrowserTool` for these names. Update the expected browser tool count in tests from 9 to 12.

## Updating existing browser methods

In `src/tools/browser/tool.ts`:

1. Import `BrowserContext` in addition to `Page`.
2. Replace all direct `this.page` uses with a local active page fetched at action time:
   - `navigateToUrl`
   - `clickElement`
   - `dragElement`
   - `uploadFiles`
   - `typeOrSelectInElement`
   - `pressKey`
   - `captureCurrentSnapshot`
   - `wait`
   - `wrapWithTracker`
3. `wrapWithTracker` should receive or capture the page used for the action, start `TransientStateTracker` on that page, run the action, detect any page opened during the action, update active page if needed, then capture the snapshot from `getActivePage()`.
4. Include tab changes in the tool response. If a new page became active, make the response say so, for example: `Opened new tab p2: https://example.com. Active tab is now p2.` followed by the normal timeline or fallback response.
5. Keep dialog intent behavior unchanged:
   - `browser_set_dialog_response` still arms exactly the next tracked browser action.
   - The pending dialog intent is cleared in `finally` after every tracked action.
   - The tracker should listen on the page where the action started.
6. Avoid hidden compatibility wrappers. Keep the runtime readable and keep tab selection logic in explicit small private methods such as `registerPage`, `openPages`, `setActivePage`, and `selectFallbackActivePage`.

## Playwright extension changes

In `src/playwright.ts`:

1. Continue accepting `web({ page })` and `createPlaywrightRunner(page)`.
2. Create one `BrowserToolRuntime` in `setup(api)` and use it everywhere in the extension:
   - browser tools use the runtime
   - initial snapshots use `browserRuntime.getActivePage()`
   - post-tool screenshots use `browserRuntime.getActivePage()`
3. Do not capture screenshots from the original constructor page after the active page has changed.
4. Add capabilities:
   - keep `PlaywrightCapability.PAGE` for compatibility, but document it as the original Playwright fixture page
   - keep `PlaywrightCapability.BROWSER_RUNTIME`
   - add `PlaywrightCapability.BROWSER_CONTEXT`
   - optionally add `PlaywrightCapability.ACTIVE_PAGE` as a getter function `() => browserRuntime.getActivePage()` if custom extensions need a simple dynamic active page capability
5. Update the web extension instructions for the model:
   - browser tools operate on the active tab/page
   - tabs/popups opened by actions become active automatically
   - use `browser_list_tabs`, `browser_select_tab`, and `browser_close_tab` to inspect, switch, or close tabs/popups
   - keep the existing snapshot and dialog instructions
6. If `buildInitialMessages` is defined outside `setup` and cannot see the runtime variable, move runtime creation to the outer `web()` closure so both setup and hooks use the same runtime. Be careful not to create two runtimes for one extension instance.

## Tests

Update/add unit tests in `src/test/browser-tool.test.ts`:

1. Extend the mock page/context types in `src/test/test-types.ts` with the methods/events used by the runtime:
   - `context()` on `MockPage`
   - `pages()`, `on()`, `off()` or a simple fake event emitter on `MockBrowserContext`
   - `url()`, `title()`, `bringToFront()`, `waitForLoadState()`, `isClosed()`, `close()`, `opener()` as needed
2. Keep existing behavior tests passing for navigation, click/hover, drag, upload, type/select, key press, snapshot, wait, and dialog arming.
3. Add tests for active-page behavior:
   - navigating uses the initial active page
   - after selecting another page, `browser_navigate` and action tools use the selected page
   - after a click opens a popup/new tab, the runtime marks the new page active and the returned snapshot comes from it
   - after a popup becomes active, a later `browser_press_key` or `browser_type_or_select` uses the popup page, not the original page
4. Add tests for tab tools:
   - `browser_list_tabs` returns stable ids, URL/title, and active marker
   - `browser_select_tab` switches to the requested page and returns a snapshot
   - selecting an unknown/closed page returns a clear error string
   - `browser_close_tab` closes the active popup and falls back to the opener or newest remaining page
   - closing the last remaining page returns a clear error string
5. Add a regression test for dialog intent clearing after a tracked action with active-page logic, reusing the existing dialog tests.
6. If `src/playwright.ts` has or needs direct tests, add/adjust a test that post-tool screenshots are taken from `browserRuntime.getActivePage()` after a tab switch. If no direct Playwright extension test exists, cover this through the smallest existing extension/runner test that can observe it.
7. Update test mocks in `src/test/step-execution.integration.test.ts` and `src/test/openai-test-manager.test.ts` if they import `BrowserTool` constants or instantiate the mocked runtime.

## Documentation

Update user-facing docs because browser behavior and tool set change:

1. `README.md`
   - Mention that web tools track the active tab/page and automatically switch to newly opened tabs/popups.
   - Mention tab management at a high level in the API/entry-point section if concise.
2. `docs/GUIDE.md`
   - In the Web Extension section, add tab/popup behavior:
     - new tabs/popups become active automatically
     - all browser tools operate on the active tab
     - use list/select/close tab tools when a flow returns to a previous page or needs to close an OAuth/payment popup
   - In troubleshooting, add a note for restricted `OPENAI_ALLOWED_TOOLS`: include the tab tools when tests need tab/popup control.
   - Update the architecture diagram/key components if it describes `BrowserToolRuntime` as page-only.
3. `docs/EXTENSIONS.md`
   - Update the Playwright capability example/guidance to avoid telling custom extensions to keep using `PlaywrightCapability.PAGE` as the active page after tool calls.
   - Prefer `PlaywrightCapability.BROWSER_RUNTIME` or the active-page getter capability for current active page access.

## Quality checks

Run these from the repo root and judge each by exit status:

1. `npm run compile:check`
2. `npm run test:unit:run`
3. `npm run test:web:example`
4. If time allows, run `npm run validation:check` as the full local gate. This includes formatting, linting, and unit tests.

The prompt explicitly requires `test:web:example` because it is an actual end-to-end web example, not just unit coverage.

## Risks and edge cases

- Avoid adding a long wait to every browser action just to detect popups. Use context page events and a short bounded settle only around actions where needed.
- Do not let `BrowserScreenshotService` or `SnapshotService` keep using the constructor page after the active page changes.
- The `PlaywrightCapability.PAGE` public capability cannot magically update if it remains a raw `Page`. Document it honestly or add a dynamic active-page capability/getter.
- Popups can close themselves after OAuth/payment completion. The runtime must recover to an open page before the next action.
- Page ids are runtime-local. They are for model/tool use within the current runner only and should not be persisted.
