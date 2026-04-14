# Development Procedures

## When Changing Runtime Flow

Check:

- `src/runtime/`
- `src/ai/client.ts`
- `src/ai/response-processor.ts`
- `src/tools/registry.ts`
- `src/tools/dispatcher.ts`

Then update:

- unit tests
- integration tests
- architecture docs if boundaries changed

## When Changing Tools

Check:

- `src/tools/define-agent-tool.ts`
- `src/tools/types.ts`
- affected tool files

Then update:

- tool tests
- docs if user-facing behavior or parameter meaning changed
- examples if public usage changed

## When Changing Snapshot Filtering

Check:

- `src/tools/browser/snapshot-filter/`
- `src/runtime/types.ts`

Then update:

- `src/test/fuzzy-search.test.ts`
- `docs/GUIDE.md`
- `README.md` if user-facing semantics changed

## When Changing Models or Pricing

Check:

- `src/ai/token-pricing.ts`
- model defaults in config
- pricing guidance in docs

Then update:

- pricing quotes using website references
- docs if user-facing behavior or cost implications changed
- README
- GUIDE

## Done Criteria

- `npm run validation:check` passes
- docs match behavior
- examples still make sense
- the code is easy for a human to read and maintain
