# Benchmark

Checkmate's positioning makes one specific, computable claim: `ai.step` costs roughly 2-3x less
than an MCP-driven agent on the same flow, because the loop prunes context between turns instead
of accumulating it. This document describes how that number is measured, why it is measured that
way, and — once a real run has been published — the result itself.

## Framing

**This measures a context strategy, not a product.** A benchmark against a third-party agent
product driving `@playwright/mcp` would be more externally impressive, and it would also
confound exactly the variable the claim is about: a win would not distinguish context pruning
from a better-prompted opponent, a different model, or a different tool count, and the run would
not be reproducible by anyone who doesn't have that product's setup.

So both arms in this benchmark share everything except the one variable under test:

|                | `checkmate`                                                                                                          | `mcp-baseline`                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Model          | same                                                                                                                 | same                                                                                                           |
| Flows          | same                                                                                                                 | same                                                                                                           |
| Loop           | same (`CheckmateRunner` / `StepExecution`)                                                                           | same                                                                                                           |
| Tools          | the 12 browser tools (`src/tools/browser/tool.ts`)                                                                   | a vendored MCP-shaped tool surface (`scripts/baseline/mcp-baseline.ts`), 18 tools                              |
| Context policy | pruned snapshot — stale snapshots and screenshots are replaced (`ephemeral: true`) each turn instead of accumulating | full accumulated context — every snapshot and screenshot stays in the message history for the rest of the step |

Only the tool surface and the context policy differ. Everything else — the model, the flow
descriptions, the runner, the loop, the report — is identical between arms, because those are
exactly the things that must **not** vary for a cost difference to be attributable to context
pruning.

## Why the baseline is vendored, not a dependency

`scripts/baseline/mcp-baseline.ts` is a plain, readable Checkmate extension whose tool
definitions mirror `@playwright/mcp`'s documented `browser_*` surface
(https://github.com/microsoft/playwright-mcp) at a pinned, commented version, driving the exact
same underlying browser runtime (`BrowserToolRuntime`, from `src/tools/browser/tool.ts`) that the
`checkmate` arm uses.

Taking `@playwright/mcp` as a dev dependency to run a script that only ever executes on release
would put a moving target in the middle of a number this repository publishes — the tool surface
would drift under the benchmark between runs — and it would grow the dependency tree for every
consumer who clones the repo just to build it. Vendoring the surface means the code that produced
a published number sits in the repo for anyone to read and disagree with.

**Pinned version:** `scripts/baseline/mcp-baseline.ts`'s tool surface was transcribed from the
tool documentation at https://playwright.dev/mcp/introduction as of this benchmark's authoring
(2026-08). Confirm the current `@playwright/mcp` tag against that page before publishing a new
run, and update the comment at the top of that file to match.

A handful of MCP tools that don't bear on the benchmarked flows —
`browser_console_messages`, `browser_network_requests`, `browser_evaluate`, `browser_pdf_save`,
`browser_install` — are left out rather than stubbed; none of them replace an action the
benchmarked flows require, so their absence does not change the comparison in a way that favours
either arm.

## Method

```text
scripts/benchmark.ts
  for flow of FLOWS
    for model of MODEL_TIERS
      for arm of ['checkmate', 'mcp-baseline']
        runner = createRunner({ config, extensions: [arm.extension(page)] })
        report = await runner.run(flow.step)
        record(flow, model, arm, report.usage.costUsd, report.durationMs, report.turns, report.outcome)
  write scripts/benchmark-results.json + scripts/benchmark-results.md
```

Run it with:

```bash
npx tsx scripts/benchmark.ts --dry-run   # composes both arms, prints the flow matrix, exits.
                                          # Issues zero provider requests — safe to run any time.
npx tsx scripts/benchmark.ts             # runs every flow through both arms and every configured
                                          # model tier. Spends real money against a live provider.
```

This is a plain script, not a Playwright project: `@xoxoai/checkmate/core` never imports
`@playwright/test`, so `createRunner()` and `StepReport` are exactly what a user's own script or
CI job would use to drive Checkmate outside a test. The benchmark measures nothing of its own —
every number in the published table comes straight out of `StepReport.usage`, `.durationMs`, and
`.turns`.

**Running outside a Playwright Test worker.** The `checkmate` arm's browser tools dispatch every
call through `BrowserToolRuntime`, which wraps each dispatched tool in its own `test.step()`
(added in Phase 4 so the HTML report reads as one `ai:` row per step per turn) — but only when a
Playwright Test worker is actually running. `test.step()` throws `"test.step() can only be called
from a test"` outside one, which a plain `npx tsx` process always is, so `withTurnStep()` in
`src/tools/browser/tool.ts` detects that case (`test.info()` throwing) and calls the tool
directly instead. Inside a real Playwright test the wrapping behaves exactly as Phase 4 shipped
it; this script simply never triggers it.

## Flows

The flow set lives in `scripts/benchmark.ts` (`FLOWS`). It currently reuses the same kind of
public, stable, cost-free-to-navigate pages the shipped examples use
(`test/examples/web/website-testing.spec.ts`), so the benchmark can be re-run without depending
on a private fixture app.

## Model tiers

The PRD asks for more than one model tier, so the benchmark runs every flow against each entry in
`MODEL_TIERS` (`scripts/benchmark.ts`) — currently `gpt-5-mini` and `gpt-oss-20b` hosted on Groq,
the same two tiers referenced elsewhere in this repository's docs and examples.

## Result

Not yet published in full. A release run costs real money across every flow and model tier in
`FLOWS` / `MODEL_TIERS` and is a release-time decision, made and recorded here — whichever way
the number comes out — the next time this benchmark is run for a release.

Three of the four single-step "quick example" flows from
`test/examples/web/website-testing.spec.ts` have been run for real, against `gpt-oss-20b (groq)`
(the model `npm run test:web:example` uses), as a sanity check that the benchmark measures what
it claims to — not as the published release number, which still requires every flow in `FLOWS`
and every entry in `MODEL_TIERS`, including `gpt-5-mini`. The Mojeek search flow and the
Salesforce example were excluded from this check by request; the multi-step Polymer Shop flows
don't fit the benchmark's one-`ai.step`-per-flow shape and would need harness changes to include:

| Flow | Model | checkmate cost | mcp-baseline cost | Ratio |
| --- | --- | --- | --- | --- |
| ollama-model-search | gpt-oss-20b (groq) | $0.0010 | $0.0040 | 4.00x |
| huggingface-model-search | gpt-oss-20b (groq) | $0.0020 | $0.0120 | 6.00x |
| nypl-catcher-in-the-rye | gpt-oss-20b (groq) | $0.0020 | $0.0100 | 5.00x |

All six runs passed (`outcome: 'passed'`, `category: 'app'`, `reason: 'met-expectation'`).
`checkmate` took 4-5 turns across all three flows; `mcp-baseline` took 6-11 turns, and its
`huggingface-model-search` run in particular took 113.9s against `checkmate`'s 9.8s. Every ratio
here (4-6x) comes in above the PRD's claimed ~2-3x range — worth flagging rather than smoothing
over, since a wider gap than claimed is still a claim worth re-checking against the full flow and
model-tier matrix before publication, not just a pleasant surprise.
