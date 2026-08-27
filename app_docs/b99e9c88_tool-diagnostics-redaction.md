# b99e9c88 tool diagnostics redaction

## What changed

This change closes the blocking diagnostics redaction gap for tool response errors and adds broader model/tool failure context. Tool error diagnostics now keep enough context to debug malformed calls, invalid tools, dispatch failures, and provider/tool-loop failures while omitting high-risk secrets and bulky image/base64 payloads.

The reviewer blocker is addressed in `src/ai/tool-response-handler.ts`: when a tool response has `status: 'error'`, it logs the tool call id, tool name, arguments preview, and response preview. The preview redacts JSON-style and env/key-value secret fields before truncation, including `OPENAI_API_KEY`, `api_key`, `apiKey`, `apikey`, `authorization`, and `cookie`, and keeps the existing redaction for image data URLs, long base64 blobs, `sk-*` tokens, bearer tokens, `Authorization`, and `Cookie` text.

## Where it lives

- `src/ai/tool-response-handler.ts` logs sanitized error diagnostics for failed tool responses and redacts secret field names/values from argument and response previews.
- `src/ai/client.ts` enriches retry/final OpenAI API errors with model settings, step context, recent message previews, and sanitized provider errors.
- `src/ai/message-handler.ts` replaces raw model-choice dumps with bounded diagnostics that include step context, choice index, finish reason, content preview, and refusal preview.
- `src/ai/response-processor.ts` wraps malformed tool-argument JSON and dispatch failures with tool call id, tool name, arguments preview, response/choice context, and original error text.
- `src/tools/dispatcher.ts` reports invalid tools with requested arguments, registered tool names, and allowed tool names; it also wraps thrown tool executions and warns when a tool returns an error response.
- `src/tools/registry.ts` exposes registered tool names for dispatcher diagnostics.
- `.env.example`, `README.md`, `docs/GUIDE.md`, and `docs/ROADMAP.md` document `CHECKMATE_LOG_LEVEL=debug` as the way to inspect model/tool loop diagnostics.
- `specs/b99e9c88_redact-secret-keys.md` records the blocker, required redaction coverage, and suggested verification commands.

## Verification coverage

The change adds or extends tests for the diagnostic paths:

- `src/test/tool-response-handler.test.ts` verifies tool response error logging keeps `tool response error` and `tool_call_id`, emits `[secret omitted]` / `[image omitted]`, and does not include secret values or high-risk key names such as `OPENAI_API_KEY`, `api_key`, `apiKey`, `authorization`, or `cookie`.
- `src/test/openai-client-retry.test.ts` verifies final API errors include request/recent-message context and recoverable 400 tool errors log sanitized provider details.
- `src/test/message-handler.test.ts` verifies enriched diagnostics for text responses, unexpected finish reasons, and no-content/no-tool responses.
- `src/test/response-processor.test.ts` verifies malformed tool arguments and dispatch failures include model/tool context and preserve the original cause.
- `src/test/tool-dispatcher.test.ts` verifies invalid tool diagnostics, thrown tool wrapping, error response normalization, and warning logs.

Targeted verification commands from the included spec:

```bash
npx vitest run --config src/test/vitest.config.ts src/test/tool-response-handler.test.ts
npx tsc --noEmit
npx vitest run --config src/test/vitest.config.ts src/test/openai-client-retry.test.ts src/test/response-processor.test.ts src/test/tool-response-handler.test.ts src/test/tool-dispatcher.test.ts src/test/message-handler.test.ts
npm run validation:check
```

Use `CHECKMATE_LOG_LEVEL=debug` when reproducing model/tool-loop failures to inspect the new diagnostic summaries.