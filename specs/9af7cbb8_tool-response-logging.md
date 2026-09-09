# Plan: Debug logging for model-bound tool responses

## Goal

When `CHECKMATE_LOG_LEVEL=debug`, log the tool response content that Checkmate returns to the model through the shared `CheckmateLogger` logger. Do this once, from one model-bound path, for browser, Salesforce, custom, and other normal tool responses. Avoid duplicating error response bodies across `warn` and `debug` logs, and avoid duplicating full page snapshot content.

## Key findings

- `src/logging/index.ts` exports `logger`, created by `CheckmateLogger.create('checkmate', new RuntimeConfig().getLogLevel())`.
- Normal tools flow through:
  - `ResponseProcessor.handleResponse()`
  - `ToolDispatcher.dispatch()`
  - `ToolResponseHandler.handleMultiple()`
  - `AiClient.addToolResponse()`
- `ToolResponseHandler.handleMultiple()` is the best central place to log model-bound tool response text, because it is called immediately before `aiClient.addToolResponse(toolCallId, toolResponse.response)`.
- Browser tools and Salesforce login return normal `ToolResponse` values after dispatch, so central logging in `ToolResponseHandler` covers them.
- Step result tools (`pass_test_step`, `fail_test_step`) intentionally return `void` after resolving the step. They do not send a tool response back to the model because the step is complete. Do not change them to return a response, because that would make the runner continue the model loop unnecessarily.
- Existing duplication to fix:
  - `ToolDispatcher.dispatch()` logs error responses with `logger.warn(...)`.
  - `ToolResponseHandler.handleMultiple()` also logs error responses with `logger.warn(...)`.
  - In debug mode, a new full debug response log would duplicate the full error response unless the warning is adjusted.
- Snapshot duplication risk:
  - `SnapshotService.get()` already logs the full created page snapshot with `logger.debug('created aria page snapshot...')`.
  - Browser tool responses carry `snapshot` separately from `response`, and `playwright.ts` appends that snapshot as a user message after tool responses.
  - Do not include full `toolResponse.snapshot` content in the new generic tool-response debug log. Log only whether a snapshot is present and its length. Let `SnapshotService` remain the single full snapshot-content debug log.

## Implementation steps

### 1. Update `src/ai/tool-response-handler.ts`

Add central debug logging in `ToolResponseHandler.handleMultiple()` before each call to `this.aiClient.addToolResponse(...)`.

Concrete behavior:

- Add a small private/helper function such as `isDebugMode()` that checks:
  - `this.aiClient.getRuntimeConfig().getLogLevel() === 'debug'`
- Only call `logger.debug(...)` when that returns true. This keeps unit tests deterministic and avoids building large debug strings outside debug mode.
- Add a helper such as `logModelBoundToolResponse(toolCallId, toolCall, toolResponse)` that logs exactly one debug entry per model-bound tool response.
- The debug entry should include:
  - a stable header like `tool response returned to model:`
  - `tool_call_id`
  - `tool`
  - `status`
  - redacted/truncated serialized `arguments`
  - redacted/truncated `response`
  - snapshot metadata only, for example `snapshot: present (1234 chars, content logged by SnapshotService)` or `snapshot: none`
- Use the existing `safePreview()`, `redact()`, and `truncateText()` helpers for arguments and response content so secrets and image/base64 data remain redacted.
- Do not log full `toolResponse.snapshot` content from this helper.

Adjust existing error warning behavior to avoid duplicate full response bodies:

- Keep a warning for error responses so non-debug users still see important diagnostics.
- In non-debug modes, keep the existing warning detail, including redacted/truncated `response`, to preserve useful diagnostics.
- In debug mode, do not include the full response body in the warning because the new debug log already includes it. Instead include the same metadata and a line like `response: logged at debug level`.
- This prevents the same response body from being emitted once at `warn` and again at `debug` when debug mode is active.

Do not add logging in `AiClient.addToolResponse()` for this change. That method lacks the tool name/arguments/status context and would risk a second generic response log if callers add their own logs later.

### 2. Update `src/tools/dispatcher.ts`

Remove the post-normalization warning that logs error responses:

```ts
if (response?.status === 'error') {
	logger.warn(`tool returned error: ${toolCall.name}\nresponse: ${preview(response, 2_000)}`)
}
```

Reason: `ToolResponseHandler` is the model-bound path and already has `tool_call_id`, tool name, arguments, redaction, and now debug/non-debug duplicate control. Keeping both warnings duplicates error responses.

After normalizing, add only a debug log for tools that return no model-bound response, guarded by the runtime config log level:

- If `response` is `null` and `this.toolRegistry.getRuntimeConfig().getLogLevel() === 'debug'`, log a message like:
  - `tool completed without model response:`
  - `tool: pass_test_step`
  - redacted/truncated `arguments`
- This makes step-result tool completion visible in debug without pretending a response was returned to the model.
- Update the local `preview()` redaction if necessary so this new debug log does not expose secrets.

Keep the existing `logger.info('executing tool...')` call unchanged.

### 3. Do not change snapshot creation logging

Leave `src/tools/browser/snapshot-service.ts` as the only place that logs full page snapshot content:

```ts
logger.debug(`created aria page snapshot:\n${compressedSnapshot}`)
```

Do not add full snapshot logging in:

- `src/ai/tool-response-handler.ts`
- `src/playwright.ts`
- `src/tools/browser/tool.ts`
- `src/tools/dispatcher.ts`

The new generic debug response log should include snapshot presence/length only.

### 4. Do not change Salesforce or browser tool implementations unless tests expose a bug

- `src/tools/salesforce/login-tool.ts` returns the result of `browserRuntime.navigateToUrl(...)`; central logging covers it as `login_to_salesforce_org` once it is normalized and passed to `ToolResponseHandler`.
- `src/tools/browser/tool.ts` already returns `{ response, snapshot }` for browser actions; central logging covers the `response`, and `SnapshotService` covers the full snapshot.

### 5. Update unit tests

#### `src/test/tool-response-handler.test.ts`

Update the mocked `openaiClient` to include:

```ts
getRuntimeConfig: vi.fn().mockReturnValue({
	getLogLevel: vi.fn().mockReturnValue('off'),
})
```

Add tests for the new behavior:

1. **Logs model-bound tool responses in debug mode**
   - Set `getLogLevel` to return `debug`.
   - Use a successful response, for example `browser_click_or_hover`.
   - Assert `logger.debug` is called once.
   - Assert the debug text contains `tool response returned to model`, the tool call id, tool name, status, arguments, and response body.

2. **Does not log model-bound tool responses in non-debug mode**
   - Keep `getLogLevel` as `off` or `info`.
   - Assert `logger.debug` is not called for a successful tool response.

3. **Does not duplicate error response body between warn and debug in debug mode**
   - Set `getLogLevel` to `debug`.
   - Use an error response with a unique body string.
   - Assert `logger.debug` contains the unique response body.
   - Assert `logger.warn` does not contain the unique response body and instead contains the debug-level marker.

4. **Does not include full snapshot content in the generic tool-response debug log**
   - Set `getLogLevel` to `debug`.
   - Use a `ToolResponse` with `snapshot: 'page snapshot:\n{button Submit}'`.
   - Assert the debug log mentions snapshot presence/length.
   - Assert it does not contain `page snapshot:` or `{button Submit}`.

Keep the existing secret-redaction tests. They should still pass in non-debug mode because warnings retain redacted response text outside debug mode.

#### `src/test/tool-dispatcher.test.ts`

Update `createConfig()` to include `getLogLevel`, defaulting to `off`.

Adjust the existing error-response test:

- Rename it from `normalizes string and object error responses and logs them` to `normalizes string and object error responses`.
- Keep the normalization assertions.
- Change the warning assertion to `expect(logger.warn).not.toHaveBeenCalled()` because warning now belongs to `ToolResponseHandler` only.

Add a step/no-response debug test:

- Create a tool like `pass_test_step` whose `execute` returns `undefined`.
- Set config `getLogLevel` to `debug`.
- Dispatch it.
- Assert the result is `null`.
- Assert `logger.debug` was called with `tool completed without model response`, the tool name, and arguments.

Add a non-debug counterpart if useful:

- Same undefined-returning tool with log level `off`.
- Assert `logger.debug` is not called.

#### Optional focused test for Salesforce name coverage

If the builder wants an explicit named coverage check without invoking Salesforce auth, add a `ToolResponseHandler` unit case with `toolCall.name = 'login_to_salesforce_org'` and a normal response. This proves the central logger treats Salesforce tool names like any other model-bound tool response.

No e2e mocking of Salesforce login is needed for this request.

## Verification commands

Run these from the repo root and judge each by exit status:

1. Unit tests:

```bash
npm run test:unit:run
```

2. Actual web example e2e requested by the operator:

```bash
npm run test:web:example
```

If time allows, also run the broader validation gate:

```bash
npm run validation:check
```

## Expected result

- With `CHECKMATE_LOG_LEVEL=debug`, every model-bound tool response is logged once through Checkmate's shared logger.
- Browser and Salesforce tool responses are covered by the central handler.
- Step result tools are logged as completed without a model-bound response, without changing the step completion flow.
- Full page snapshots are not duplicated in the generic tool-response debug log; `SnapshotService` remains the single full snapshot-content debug log.
- Error response bodies are not duplicated across `warn` and `debug` when debug mode is active.
