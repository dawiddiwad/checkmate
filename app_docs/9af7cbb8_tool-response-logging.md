# Tool response debug logging

## What changed

Debug-mode logging now records the tool response text that is about to be returned to the model from the central model-bound path. In `src/ai/tool-response-handler.ts`, `ToolResponseHandler.handleMultiple()` logs one `logger.debug` entry per model-bound tool response when `getRuntimeConfig().getLogLevel()` is `debug`, immediately before `aiClient.addToolResponse(...)`.

The debug entry includes the tool call id, tool name, status, redacted/truncated arguments, redacted/truncated response text, and snapshot metadata. Full snapshot content is deliberately not included there; snapshot output is represented only as `none` or `present (<length> chars, content logged by SnapshotService)` to avoid duplicating page snapshot logs.

Error diagnostics were also de-duplicated. `src/tools/dispatcher.ts` no longer warns when a normalized tool response has `status: 'error'`; warning responsibility sits in `ToolResponseHandler`. In debug mode, the warning says `response: logged at debug level` instead of repeating the response body. Outside debug mode, the warning still includes the redacted/truncated response body.

Tools that complete without a model-bound response, such as step result tools returning `undefined`, are handled in `src/tools/dispatcher.ts`: when log level is `debug`, the dispatcher logs `tool completed without model response` with the tool name and redacted/truncated arguments, then returns `null` as before.

## Files carrying the change

- `src/ai/tool-response-handler.ts` adds central model-bound response debug logging, snapshot metadata formatting, debug-mode checks, and debug-aware error warning text.
- `src/tools/dispatcher.ts` removes duplicate error warning logs and adds debug-only logging for tools that return no model response, with expanded redaction for dispatcher previews.
- `src/test/tool-response-handler.test.ts` covers debug response logs, non-debug silence, error warning/body de-duplication, and snapshot-content omission.
- `src/test/tool-dispatcher.test.ts` covers error normalization without dispatcher warnings and debug/non-debug logging for no-response tools.
- `specs/9af7cbb8_tool-response-logging.md` records the implementation plan and verification commands for this change.

## How to use or verify

Set the runtime log level to debug, for example with `CHECKMATE_LOG_LEVEL=debug`. Model-bound tool responses should appear through `CheckmateLogger` with the `tool response returned to model:` header. Step tools that do not return a model response should instead log `tool completed without model response:`.

Verify with:

```bash
npm run test:unit:run
npm run test:web:example
```
