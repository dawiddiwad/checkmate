# Browser tab and popup management

## What changed

The Playwright browser runtime now tracks a `BrowserContext` plus a current active `Page` instead of permanently using only the page passed to `new BrowserToolRuntime(page)`. Browser actions still use the same runtime object, but they fetch the active page at execution time. When a browser action opens a new tab or popup, the runtime registers that page, makes it active, waits briefly for `domcontentloaded`, and returns a response that says which tab became active.

This matters for flows where a click or key action leaves the original page, such as OAuth popups, payment redirects, or links that open in a new tab. Later browser tools operate on the active tab unless the agent switches tabs explicitly.

## Files carrying the change

- `src/tools/browser/tool.ts`: owns the active-page runtime behavior. It adds stable runtime-local page ids (`p1`, `p2`, ...), context page registration, fallback active-page selection, and the tab tools `browser_list_tabs`, `browser_select_tab`, and `browser_close_tab`. Existing browser actions, navigation, wait, snapshot, keyboard, upload, drag, and type/select paths now use the active page.
- `src/playwright.ts`: creates one `BrowserToolRuntime` per `web({ page })` extension, uses it for tools, initial snapshots, and post-tool screenshots, and publishes new capabilities for browser context and active page access.
- `src/test/browser-tool.test.ts`: expands browser tool coverage from 9 to 12 tools and covers tab listing, tab selection, close/fallback behavior, popup activation, and later actions using the selected or newly opened page.
- `src/test/playwright-extension.test.ts`: verifies post-tool screenshots use the runtime active page after another page becomes active.
- `src/test/test-types.ts`, `src/test/openai-test-manager.test.ts`, and `src/test/step-execution.integration.test.ts`: update mocks for the runtime/context/page methods used by active tab management.
- `README.md`, `docs/GUIDE.md`, and `docs/EXTENSIONS.md`: document active tab/popup tracking, new tab tools, and the difference between the original fixture page and the current active page capability.
- `specs/1a9c9144_tab-popup-management.md`: records the implementation plan and quality-check commands for this change.

## How to use it

In the Playwright web extension, browser tools now target the active tab/page. If an action opens a tab or popup, that new page becomes active automatically.

Agents can manage tabs with:

- `browser_list_tabs` — lists open tabs with their page id, URL, title, and active marker.
- `browser_select_tab` — makes a listed page id active and returns a snapshot.
- `browser_close_tab` — closes a listed page id, or the active tab when `pageId` is `null`; it refuses to close the last open tab.

For custom extensions, `PlaywrightCapability.PAGE` remains the original Playwright fixture page. Use `PlaywrightCapability.ACTIVE_PAGE` for a getter to the current active page, or `PlaywrightCapability.BROWSER_RUNTIME` / `PlaywrightCapability.BROWSER_CONTEXT` when the extension needs runtime or context access.

## How to verify

The changed tests cover the new behavior. The spec for this change names these quality checks:

```sh
npm run compile:check
npm run test:unit:run
npm run test:web:example
```

`npm run test:web:example` is included because the requested change called for an actual end-to-end web example check in addition to unit tests.
