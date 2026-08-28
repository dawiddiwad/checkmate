# Plan: Add browser drag-and-drop tool

## Goal

Add a built-in browser drag-and-drop tool in `src/tools/browser/tool.ts` that exposes a model-callable `browser_drag` tool and implements the action with Playwright `locator.dragTo()`.

## Current shape

- Browser tools live in `src/tools/browser/tool.ts`.
- Tools are named in `BrowserTool`, implemented as methods on `BrowserToolRuntime`, then registered in `createBrowserTools()` with a strict Zod schema.
- Existing action tools use `wrapWithTracker()` so successful actions return a fresh snapshot and transient timeline/fallback response.
- Unit coverage is in `src/test/browser-tool.test.ts`; mock Playwright types are in `src/test/test-types.ts`.

## Files to touch

1. `src/tools/browser/tool.ts`
2. `src/test/browser-tool.test.ts`
3. `src/test/test-types.ts`

No documentation file currently documents these built-in browser tool names. `.env.example` already mentions `browser_drag` in its allowed-tools comments, so this change does not require a docs update unless the implementation changes that environment contract.

## Implementation steps

### 1. Add the tool name

In `src/tools/browser/tool.ts`, add a constant to `BrowserTool`:

```ts
TOOL_DRAG: 'browser_drag',
```

Keep the existing concrete naming style. Place it near the other browser action tools, preferably after `TOOL_CLICK_OR_HOVER`.

### 2. Add runtime drag method

Add a method to `BrowserToolRuntime`, near `clickElement()`:

```ts
async dragElement(sourceRef: string, targetRef: string, step: Step): Promise<AgentToolResponse | string> {
	return this.wrapWithTracker(
		async () => {
			try {
				if (!sourceRef || !targetRef) {
					throw new Error(
						`both 'sourceRef' and 'targetRef' are required for ${BrowserTool.TOOL_DRAG} but received sourceRef='${sourceRef}' and targetRef='${targetRef}'`
					)
				}

				const source = this.page.locator(`aria-ref=${sourceRef}`)
				const target = this.page.locator(`aria-ref=${targetRef}`)
				await source.dragTo(target)
			} catch (error) {
				logger.error(`error dragging element with ref '${sourceRef}' to element with ref '${targetRef}' due to:\n${error}`)
				return `failed to drag element with ref '${sourceRef}' to element with ref '${targetRef}':\n${error}\n try with different element type or ref`
			}
		},
		`Dragged element with ref '${sourceRef}' to element with ref '${targetRef}'.`,
		step
	)
}
```

The exact wording can be adjusted for readability, but keep these behaviors:

- Reject empty `sourceRef` or `targetRef` before calling Playwright.
- Use `this.page.locator('aria-ref=...')` for both source and target.
- Call Playwright as `source.dragTo(target)`.
- Follow the existing action-tool error pattern: log, return a plain failure string, and let `wrapWithTracker()` stop the tracker.
- Let successful calls flow through `wrapWithTracker()` so the model receives a snapshot and any transient timeline.

### 3. Register the tool

In `createBrowserTools()`, add another `defineAgentTool()` entry, preferably after click/hover:

- `name`: `BrowserTool.TOOL_DRAG`
- `description`: make clear it drags a source element onto a target/drop element.
- `schema`: strict Zod object with:
  - `sourceRef: z.string().describe('ref value of the element to drag from the snapshot, example: e123')`
  - `sourceName: z.string().describe('name of the element to drag, example: File card')`
  - `targetRef: z.string().describe('ref value of the drop target from the snapshot, example: e456')`
  - `targetName: z.string().describe('name of the element to drop onto, example: Done column')`
  - `goal: z.string().describe('The goal or purpose of dragging this element')`
- `handler`: `({ sourceRef, targetRef }, context) => runtime.dragElement(sourceRef, targetRef, context.step)`

Do not reuse the click/hover tool with another boolean. Drag has two refs and should be its own clear tool.

## Tests

### 1. Update mocks

In `src/test/test-types.ts`, add `dragTo: Mock` to `MockLocator`.

In `src/test/browser-tool.test.ts`, add `dragTo: vi.fn().mockResolvedValue(undefined)` to the default mocked locator object in `beforeEach()`.

### 2. Update tool count/order test

The existing test says `creates six browser tool definitions`; update it to seven and include `BrowserTool.TOOL_DRAG` in the expected order at the same position used in `createBrowserTools()`.

### 3. Add success coverage

Add a test that executes `browser_drag` with `sourceRef` and `targetRef`, then asserts:

- `page.locator` was called with `aria-ref=<sourceRef>` and `aria-ref=<targetRef>`.
- The source locator's `dragTo()` was called with the target locator.
- The returned result is `{ response: "Dragged element with ref '<sourceRef>' to element with ref '<targetRef>'.", snapshot: 'mocked snapshot content' }` when no transient timeline exists.

For a clear assertion, set up source and target locator objects in that test with `mockPage.locator.mockImplementation(...)`. Return a default html locator for other selectors because snapshot capture calls `page.locator('html').innerHTML()`.

### 4. Add validation/error coverage

Add at least one test for invalid/missing args through the registered tool, for example missing `targetRef`, and assert the result contains `Invalid args for 'browser_drag'`.

Optionally add a runtime-level empty-ref test, similar to the press-key/wait runtime error tests, asserting the result contains `failed to drag element with ref ''` or the equivalent final wording.

## Verification

Run these commands and judge by exit status:

```sh
npx vitest run --config src/test/vitest.config.ts src/test/browser-tool.test.ts
npm run compile:check
```

If formatting changes are needed, run:

```sh
npm run format:fix
```

Then re-run the targeted unit test and compile check.

## Notes and constraints

- Keep the change small and localized.
- Do not introduce an abstraction for locator lookup; two local variables are enough.
- Keep tool/schema/handler names aligned so allowed-tool filtering can use `browser_drag`.
- Preserve existing snapshot and transient-state behavior by using `wrapWithTracker()`.
