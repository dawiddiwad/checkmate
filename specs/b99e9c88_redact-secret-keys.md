# Plan: close reviewer blocking finding for b99e9c88

## Goal

Fix the reviewer-blocking redaction gap in `ToolResponseHandler` diagnostics. Error logs must not expose JSON/env-style secret keys or their values when logging tool arguments or tool responses.

Reviewer finding to close:

> Extend ToolResponseHandler diagnostic redaction to cover JSON/env-style secret keys such as `OPENAI_API_KEY`, `api_key`/`apiKey`, authorization, and cookie fields before logging arguments or responses.

## Scope

Primary files:

- `src/ai/tool-response-handler.ts`
- `src/test/tool-response-handler.test.ts`

Do not broaden the change unless the tests require it. The original feature is otherwise approved.

## Current problem

`src/ai/tool-response-handler.ts` logs error tool diagnostics here:

```ts
logger.warn(
  `tool response error:\ntool_call_id: ${toolCallId}\ntool: ${toolCall.name}\narguments: ${safePreview(JSON.stringify(toolCall.arguments ?? {}), 1_000)}\nresponse: ${safePreview(toolResponse.response, 2_000)}`
)
```

`safePreview()` calls `redact()`, but `redact()` currently only covers:

- image data URLs
- long base64 blobs
- `sk-*` strings
- bearer tokens
- literal `Authorization:` / `Cookie:` prefixes

It misses secrets represented as JSON or env-style fields, for example:

- `{ "OPENAI_API_KEY": "secret" }`
- `{ "api_key": "secret" }`
- `{ "apiKey": "secret" }`
- `{ "authorization": "Bearer secret" }`
- `{ "cookie": "session=secret" }`
- `OPENAI_API_KEY=secret`
- `api_key: secret`

## Required code changes

### 1. Strengthen ToolResponseHandler redaction

In `src/ai/tool-response-handler.ts`, update `redact(value: string): string` so the value returned by `safePreview()` removes both secret field values and high-risk secret field names from diagnostic logs.

Cover at least these key names, case-insensitively where appropriate:

- `OPENAI_API_KEY`
- `api_key`
- `apiKey`
- `apikey`
- `authorization`
- `cookie`

Recommended behavior:

- Replace full JSON-style secret fields with a neutral placeholder, e.g. `[secret omitted]`, instead of leaving the original key visible.
- Replace env/key-value style secret assignments with `[secret omitted]`.
- Keep the existing redaction for image URLs, long base64 blobs, `sk-*`, bearer tokens, `Authorization:` and `Cookie:` text.
- Apply key-field redaction before generic `Bearer`/`sk-*` redaction so whole fields are removed cleanly.
- Keep truncation after redaction, as `safePreview()` does now.

Suggested patterns to handle:

- double-quoted JSON fields: `"key": "value"`, including escaped characters inside the value
- single-quoted JSON-like fields: `'key': 'value'` if easy without making the code hard to read
- unquoted key-value text: `key=value`, `key: value`

Keep the implementation small and readable. A local helper such as `redactSecretFields(value: string): string` is fine if it makes `redact()` clearer.

### 2. Keep model-facing behavior unchanged

Do not change `buildToolExecutionSummary()` or the content sent through `addToolResponse()` unless a failing test proves it is necessary. The blocker is about diagnostic logging.

### 3. Update tests for the blocker

In `src/test/tool-response-handler.test.ts`, extend the existing `redacts secrets and image data from error diagnostics` test or add a new focused test.

The test should create a `status: 'error'` tool response and tool call arguments containing all of these forms:

```ts
arguments: {
  OPENAI_API_KEY: 'openai-secret-value',
  api_key: 'snake-secret-value',
  apiKey: 'camel-secret-value',
  authorization: 'Bearer auth-secret-value',
  cookie: 'session=cookie-secret-value',
}
```

Also include response text with env-style/key-value secrets, for example:

```ts
response: 'failed OPENAI_API_KEY=response-secret api_key=response-snake authorization=Bearer response-auth cookie=session=response-cookie'
```

Assert the captured `logger.warn` output:

- contains `tool response error` and the `tool_call_id` so diagnostics remain useful
- contains `[secret omitted]`
- does not contain any secret values such as `openai-secret-value`, `snake-secret-value`, `camel-secret-value`, `auth-secret-value`, `cookie-secret-value`, or response secret values
- does not contain high-risk key names such as `OPENAI_API_KEY`, `api_key`, `apiKey`, `authorization`, or `cookie`
- still does not contain base64/image values from the existing image case

If avoiding key names makes the current assertions awkward, split the existing test into two tests: one for image/token redaction and one for JSON/env secret field redaction.

## Verification

Run targeted checks first:

```bash
npx vitest run --config src/test/vitest.config.ts src/test/tool-response-handler.test.ts
npx tsc --noEmit
```

Then run the same targeted regression set used for the original feature if time allows:

```bash
npx vitest run --config src/test/vitest.config.ts src/test/openai-client-retry.test.ts src/test/response-processor.test.ts src/test/tool-response-handler.test.ts src/test/tool-dispatcher.test.ts src/test/message-handler.test.ts
```

Finally try:

```bash
npm run validation:check
```

The previous builder reported `npm run validation:check` may still fail on pre-existing lint errors in generated/adw harness files:

- `.claude/skills/sssf/templates/harness_engineering/subagents.ts`
- `adws/adw_data/harness_engineering/subagents.ts`

Judge every command by exit status. If full validation fails only for those pre-existing files, report that clearly and include the successful targeted test/compile results.
