# Benchmark

`ai.step` prunes context between turns instead of piling it up — old snapshots and screenshots
get replaced each turn rather than staying in the conversation. To see what that's worth, three
of the example flows in this repo (`ollama-model-search`, `huggingface-model-search`,
`nypl-catcher-in-the-rye`) were run twice: once through **checkmate**, once through a tool
surface shaped like `@playwright/mcp`'s, same model, same loop, same everything else.

| Flow                     | checkmate / cli | mcp-shaped | Ratio |
| ------------------------ | --------------- | ---------- | ----- |
| ollama-model-search      | $0.0010         | $0.0040    | 4.00x |
| huggingface-model-search | $0.0020         | $0.0120    | 6.00x |
| nypl-catcher-in-the-rye  | $0.0020         | $0.0100    | 5.00x |

`checkmate` also finished in fewer turns across the board. This was checked against a real `@playwright/mcp` server, which landed 2-4x more expensive, and noticeably slower; and against a general-purpose coding agent: Claude Code driving Playwright through its own CLI and built-in skills - which came out close to
`checkmate` on both cost and time.

So: the context-pruning advantage over a raw MCP-style tool surface is real. Against a coding
agent that already knows how to drive a browser well, the gap mostly closes — a dedicated harness
still earns its place through the things covered in the README (a `StepReport` you can assert on
in CI, a turn cap and step timer that guarantee a result, evidence attached to the test), not
because it's always the cheaper option.
