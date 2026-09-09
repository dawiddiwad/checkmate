# Plan: Add browser file upload tool

## Goal

Add a built-in browser file upload tool in `src/tools/browser/tool.ts` that exposes a model-callable `browser_upload` tool and implements the upload with Playwright `locator.setInputFiles()`.

## Current shape

- Browser tools live in `src/tools/browser/tool.ts`.
- Tools are named in `BrowserTool`, implemented as methods on `BrowserToolRuntime`, then registered in `createBrowserTools()` with a strict Zod schema.
- Existing action tools use `wrapWithTracker()` so successful actions return a fresh snapshot and transient timeline/fallback response.
- Unit coverage is in `src/test/browser-tool.test.ts`; mock Playwright types are in `src/test/test-types.ts`.
- `.env.example` lists the browser tools available for `OPENAI_ALLOWED_TOOLS`; it must include any new built-in browser tool name.

## Files to touch

1. `src/tools/browser/tool.ts`
2. `src/test/browser-tool.test.ts`
3. `src/test/test-types.ts`
4. `.env.example`

No README/GUIDE/ROADMAP changes are needed unless the builder decides to add broader user-facing tool documentation; those files do not currently enumerate built-in browser tool names.

## Implementation steps

### 1. Add the tool name

In `src/tools/browser/tool.ts`, add a constant to `BrowserTool`:

```ts
TOOL_UPLOAD: 'browser_upload',
```

Place it with the other browser action tools, preferably after `TOOL_DRAG` and before `TOOL_TYPE_OR_SELECT`.

### 2. Add runtime upload method

Add a method to `BrowserToolRuntime`, near `dragElement()` / `typeOrSelectInElement()`:

```ts
async uploadFiles(ref: string, filePaths: string[], step: Step): Promise<AgentToolResponse | string> {
	return this.wrapWithTracker(
		async () => {
			try {
				if (!ref || filePaths.length === 0 || filePaths.some((filePath) => !filePath)) {
					throw new Error(
						`'ref' and at least one file path are required for ${BrowserTool.TOOL_UPLOAD} but received ref='${ref}' and filePaths='${filePaths.join(', ')}'`
					)
				}

				await this.page.locator(`aria-ref=${ref}`).setInputFiles(filePaths)
			} catch (error) {
				logger.error(`error uploading files to element with ref '${ref}' due to:\n${error}`)
				return `failed to upload files to element with ref '${ref}':\n${error}\n try with different element type, ref, or file path`
			}
		},
		`Uploaded ${filePaths.length} file${filePaths.length === 1 ? '' : 's'} to element with ref '${ref}'.`,
		step
	)
}
```

The exact wording can be adjusted for readability, but keep these behaviors:

- Validate that `ref` is present and at least one non-empty file path was supplied before calling Playwright.
- Use `this.page.locator('aria-ref=...')` to locate the upload input.
- Call Playwright as `locator.setInputFiles(filePaths)`.
- Accept local file paths only; do not add base64/file-content payload handling in this change.
- Follow the existing action-tool error pattern: log, return a plain failure string, and let `wrapWithTracker()` stop the tracker.
- Let successful calls flow through `wrapWithTracker()` so the model receives a snapshot and any transient timeline.

### 3. Register the tool

In `createBrowserTools()`, add a `defineAgentTool()` entry, preferably after `browser_drag`:

- `name`: `BrowserTool.TOOL_UPLOAD`
- `description`: make clear it uploads one or more local files to a file input element in the browser.
- `schema`: strict Zod object with:
  - `ref: z.string().describe('ref value of the file input element from the snapshot, example: e123')`
  - `name: z.string().describe('name of the file input element, example: Resume Upload')`
  - `filePaths: z.array(z.string()).min(1).describe('local file paths to upload, example: ["fixtures/resume.pdf"]')`
  - `goal: z.string().describe('The goal or purpose of uploading these files')`
- `handler`: `({ ref, filePaths }, context) => runtime.uploadFiles(ref, filePaths, context.step)`

Do not fold upload into `browser_type_or_select`; file upload has a different Playwright operation and should be its own clear tool.

### 4. Update allowed-tools documentation

In `.env.example`, update the comment under `# Available browser tools:` to include `browser_upload` in the comma-separated list. Keep the formatting readable over two lines if needed.

Example target list:

```text
#   browser_navigate, browser_click_or_hover, browser_drag, browser_upload,
#   browser_type_or_select, browser_press_key, browser_snapshot, browser_wait
```

The example `OPENAI_ALLOWED_TOOLS=...` line can remain as-is unless the builder wants that example to demonstrate uploads; the important part is that the canonical available-tools list includes `browser_upload`.

## Tests

### 1. Update mocks

In `src/test/test-types.ts`, add `setInputFiles: Mock` to `MockLocator`.

In `src/test/browser-tool.test.ts`, add `setInputFiles: vi.fn().mockResolvedValue(undefined)` to every mocked locator object used in the file, including the default locator in `beforeEach()` and any custom locators in tests.

### 2. Update tool count/order test

The existing test says `creates seven browser tool definitions`; update it to eight and include `BrowserTool.TOOL_UPLOAD` in the expected order at the same position used in `createBrowserTools()`.

Expected order if registered after drag:

```ts
[
	BrowserTool.TOOL_NAVIGATE,
	BrowserTool.TOOL_CLICK_OR_HOVER,
	BrowserTool.TOOL_DRAG,
	BrowserTool.TOOL_UPLOAD,
	BrowserTool.TOOL_TYPE_OR_SELECT,
	BrowserTool.TOOL_PRESS_KEY,
	BrowserTool.TOOL_SNAPSHOT,
	BrowserTool.TOOL_WAIT,
]
```

### 3. Add success coverage

Add a test that executes `browser_upload` with a ref and one or more file paths, for example:

```ts
const result = await getTool(BrowserTool.TOOL_UPLOAD).execute(
	{
		ref: 'e123',
		name: 'Resume Upload',
		filePaths: ['fixtures/resume.pdf'],
		goal: 'attach resume',
	},
	context
)
```

Assert:

- `mockPage.locator` was called with `aria-ref=e123`.
- The upload locator's `setInputFiles()` was called with `['fixtures/resume.pdf']`.
- The returned result is `{ response: "Uploaded 1 file to element with ref 'e123'.", snapshot: 'mocked snapshot content' }` when no transient timeline exists.

If using a custom locator in this test, return a default html locator for other selectors because snapshot capture calls `page.locator('html').innerHTML()`.

### 4. Add validation/error coverage

Add at least one schema validation test through the registered tool, for example missing `filePaths` or `filePaths: []`, and assert the result contains `Invalid args for 'browser_upload'`.

Also add one runtime error test for an empty ref or empty string file path, and assert the result contains `failed to upload files to element with ref`.

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
- Do not introduce a locator helper abstraction for this; one local locator call is enough.
- Keep tool/schema/handler names aligned so allowed-tool filtering can use `browser_upload`.
- Preserve existing snapshot and transient-state behavior by using `wrapWithTracker()`.
- Do not resolve file paths manually unless a test proves Playwright needs it; `setInputFiles()` accepts the paths supplied by the caller relative to the current working directory.
