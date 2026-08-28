# Browser upload tool

## What changed

A new model-callable browser tool, `browser_upload`, was added. It uploads one or more local files to a browser file input by locating the element with the snapshot `ref` (`aria-ref=<ref>`) and calling Playwright `locator.setInputFiles(filePaths)`.

This matters because file uploads now have a dedicated browser tool instead of being forced through typing/selecting behavior.

## Files carrying the change

- `src/tools/browser/tool.ts`
  - Adds `BrowserTool.TOOL_UPLOAD` with the tool name `browser_upload`.
  - Adds `BrowserToolRuntime.uploadFiles(ref, filePaths, step)`.
  - Validates that `ref` is present and that at least one non-empty file path is provided before calling Playwright.
  - Returns the usual wrapped browser action response on success, including a fresh snapshot.
  - Logs and returns a failure string if validation or Playwright upload fails.
  - Registers the tool in `createBrowserTools()` with a strict schema: `ref`, `name`, `filePaths`, and `goal`.
- `.env.example`
  - Adds `browser_upload` to the commented list of available browser tools for `OPENAI_ALLOWED_TOOLS`.
- `src/test/browser-tool.test.ts`
  - Updates the browser tool count/order expectation from seven tools to eight and includes `BrowserTool.TOOL_UPLOAD`.
  - Adds upload success coverage, zod validation coverage for empty `filePaths`, and runtime error coverage for an empty file path.
  - Extends mocked locators with `setInputFiles`.
- `src/test/test-types.ts`
  - Adds `setInputFiles` to the `MockLocator` test interface.
- `specs/abeb5572_browser-upload-tool.md`
  - Captures the implementation plan and verification commands for the upload tool.

## How to use it

Call `browser_upload` with a file input `ref` from the browser snapshot and one or more local file paths:

```json
{
  "ref": "e123",
  "name": "Resume Upload",
  "filePaths": ["fixtures/resume.pdf"],
  "goal": "attach resume"
}
```

On success, the tool response includes text like:

```text
Uploaded 1 file to element with ref 'e123'.
```

and the wrapped browser snapshot response.

## How to verify

The changed test coverage is in `src/test/browser-tool.test.ts`. Run:

```sh
npx vitest run --config src/test/vitest.config.ts src/test/browser-tool.test.ts
npm run compile:check
```
