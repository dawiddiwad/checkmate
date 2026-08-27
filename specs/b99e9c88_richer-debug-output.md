# Plan: richer debugging output for model/tool reasoning failures

## Goal

Make failures in the model/tool loop easier to debug without changing successful runtime behavior. Failure output should explain what the model returned, which tool was requested, what arguments were used, what tools were available, and what recent conversation state led to the failure. Do not replay or persist provider-only `reasoning` / `reasoning_details` payloads.

## Current state

- `src/ai/client.ts` wraps final API failures as `OpenAI API error [status]: message`, with little request/message context.
- `src/ai/response-processor.ts` directly `JSON.parse`s tool arguments, so malformed model JSON throws a bare parse error.
- `src/tools/dispatcher.ts` logs tool execution and throws a short invalid-tool error, but does not list available tools or wrap tool implementation exceptions with call context.
- `src/ai/message-handler.ts` warns when the model responds with text instead of a tool, but unexpected choices/finish reasons are sparse.
- `src/ai/tool-response-handler.ts` sends compact model-facing summaries, but does not expose full tool error diagnostics in logs.
- `AiClient.sanitizeAssistantMessage()` intentionally strips `reasoning` and `reasoning_details`; keep that behavior.

## Target behavior

When a model/tool loop failure happens, the thrown error and/or debug logs should include:

- step `action` and `expect`
- model name, `tool_choice`, `reasoning_effort`, and current temperature where available
- response id/model, choice index, `finish_reason`, assistant content/refusal previews, and tool call ids/names/raw arguments
- parsed tool name and arguments for dispatch failures
- registered tool names and configured allowed tool names when relevant
- recent message summary by role, with text truncated and image/base64 content omitted as `[image omitted]`
- original error name/message/stack/status/code/body if available, with secrets and huge payloads truncated

Keep normal successful logs about the same. Rich output should appear on failure even when `CHECKMATE_LOG_LEVEL=off`; debug logs can add more detail when logging is enabled.

## Files to change

### Runtime / AI loop

1. `src/ai/client.ts`
   - Add private formatting helpers near the existing retry/error helpers:
     - safe error serialization that handles `Error`, OpenAI-style `{ status, code, body, error }`, and circular/unknown values.
     - recent message summary formatter based on `this.messages`.
     - content preview formatter that truncates strings/arrays and never prints image data or API keys.
   - Update `enhanceError()` to include:
     - status
     - original message
     - model, tool choice, reasoning effort, temperature
     - recent message summary
     - serialized provider error details
   - Update retry debug logging to reuse the same safe error serialization instead of raw `JSON.stringify(error, null, 2)`.
   - Update `isToolError()` warning for 400 tool errors to include the serialized provider error and recent message summary. Keep the existing recovery prompt to the model.
   - Preserve `sanitizeAssistantMessage()` behavior that strips `reasoning` and `reasoning_details`; add/keep tests for that.

2. `src/ai/response-processor.ts`
   - Import the shared logger only if needed for debug/error diagnostics.
   - Replace direct `JSON.parse(toolCall.function.arguments || '{}')` with a small private method that catches parse failures.
   - On malformed JSON arguments, throw an error with:
     - step action/expect
     - choice index and finish reason
     - tool call id/name
     - raw arguments preview
     - assistant content/refusal preview
     - model response id/model if present
   - Wrap `toolDispatcher.dispatch()` failures with model context:
     - tool call id/name
     - parsed arguments
     - choice index/finish reason
     - step action/expect
     - original error as `cause`
   - Keep existing flow for non-function tool calls and tools that return `null`.

3. `src/ai/message-handler.ts`
   - Enrich warnings/errors for model responses without tool calls:
     - include `finish_reason`, content preview, refusal preview, and step action/expect.
   - For unexpected finish reasons resolved as step failure, include the same response details in `actual` so Playwright assertions are useful.
   - Keep the existing follow-up behavior for text responses: prompt the model to call `pass_test_step` or `fail_test_step`.

4. `src/ai/tool-response-handler.ts`
   - Keep model-facing tool execution summaries concise to avoid context bloat.
   - Add debug/warn logging for tool responses with `status: 'error'` that includes full call id, tool name, arguments preview, and response preview.
   - If helper functions are needed, keep them local and small.

### Tool dispatch

5. `src/tools/registry.ts`
   - Add an internal method such as `getRegisteredToolNames(): string[]` returning the registered tool names in registration order or sorted order.
   - Do not export new public API from `src/core.ts` unless necessary; this is for diagnostics inside the runtime.

6. `src/tools/dispatcher.ts`
   - Use `toolRegistry.getRegisteredToolNames()` and `toolRegistry.getRuntimeConfig().getAllowedFunctionNames()` in invalid-tool diagnostics.
   - Replace the invalid tool error with a richer message containing requested name, arguments preview, registered names, and allowed names if configured.
   - Wrap exceptions thrown by `tool.execute()` in an error such as `Tool execution failed: <toolName>` with arguments preview and original error as `cause`.
   - When `normalizeToolResponse()` returns `status: 'error'`, log a warning/debug line with the tool name and response preview.
   - Keep `inferToolResponseStatus()` behavior unless a test exposes a bug.

### Tests

7. `src/test/openai-client-retry.test.ts`
   - Ensure mock configs include `getToolChoice()` and `getReasoningEffort()` wherever `enhanceError()` now reads them.
   - Add a test that a final API error message includes model/tool-choice/reasoning/temperature and a recent message summary.
   - Add a test for a 400 tool-related provider error verifying:
     - it is retried according to current recovery behavior
     - the warning/debug log contains provider status and recent message context
     - no API key or image/base64 payload appears in the formatted diagnostics.
   - Keep the existing test proving `reasoning` and `reasoning_details` are not stored in replayed assistant messages.

8. `src/test/response-processor.test.ts`
   - Add a malformed tool arguments test where `function.arguments` is invalid JSON and assert the thrown error mentions the tool call id/name, raw arguments, choice index/finish reason, and step.
   - Add a dispatch failure test where the mocked dispatcher rejects and assert the wrapper error contains tool/model context and preserves the original cause.
   - Update existing mock expectations only if the richer wrapping changes call order or thrown messages.

9. Add `src/test/tool-dispatcher.test.ts`
   - Test invalid tool names include requested name, arguments, registered tools, and allowed tools.
   - Test a throwing tool is wrapped with tool name/arguments and original cause.
   - Test a string/object tool error response still normalizes to `status: 'error'` and emits a warning/debug log.

10. Add `src/test/message-handler.test.ts` only if `message-handler.ts` changes are not covered through `response-processor.test.ts`.
    - Cover unexpected finish reasons and no-content/no-tool errors with enriched messages.

### Documentation

Use the `update-documentation` skill guidance for consistency.

11. `docs/GUIDE.md`
    - Update the `CHECKMATE_LOG_LEVEL` row or add a short troubleshooting paragraph explaining that `debug` helps with model/tool failures by showing response summaries, tool calls, available tools, and recent message summaries.
    - In troubleshooting, add a small “Model does not call tools / invalid tool arguments” section pointing users to `CHECKMATE_LOG_LEVEL=debug` and the new failure output.

12. `.env.example`
    - Update the logging comments to mention model/tool loop diagnostics.
    - Remove or fix the current “structured JSON output” wording if it no longer matches the logger’s plain text format.

13. `docs/ROADMAP.md`
    - Mark “Richer debugging output for model/tool reasoning failures” as complete if the feature is implemented.

14. `README.md`
    - Add one short note near debugging/troubleshooting guidance, if there is an existing suitable section, that `CHECKMATE_LOG_LEVEL=debug` provides model/tool loop diagnostics.

## Implementation notes

- Keep helper functions small and concrete. Prefer local private methods over a broad diagnostics abstraction unless code duplication becomes obvious.
- Truncate long fields consistently. Suggested limits:
  - content/raw arguments: 1,000 characters in thrown errors
  - tool response previews: 2,000 characters in logs
  - recent messages: last 6 messages, each 500 characters
- Never print `OPENAI_API_KEY`, authorization headers, cookies, or full base64 image URLs.
- Do not add comments unless the surrounding file already needs public API documentation.
- Do not change public tool contracts or successful control flow.
- Do not send richer debug-only diagnostics back to the model unless it is already part of the compact tool execution summary; avoid increasing token use.

## Verification

Run targeted tests first:

```bash
npx vitest run --config src/test/vitest.config.ts src/test/openai-client-retry.test.ts src/test/response-processor.test.ts src/test/tool-response-handler.test.ts src/test/tool-dispatcher.test.ts
```

If `src/test/message-handler.test.ts` is added, include it in the targeted command.

Then run the full project validation:

```bash
npm run validation:check
```

Judge command success by exit status.
