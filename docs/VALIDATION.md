# Validation record

Date: 7 November 2026. Package and plugin version: `0.7.0`.

The checks ran on Debian Linux with Node.js `24.22.1`, Claude Code `2.1.319`, Playwright CLI `0.1.23`, and Chromium `156.0.8078.79`.

## Automated checks

- `npm run phase:verify`: passed. All 18 tests passed. No test was skipped.
- Type generation, TypeScript declaration checks, lint, and formatting: passed.
- Installed npm package, public exports, CLI, schemas, and plugin assets: passed.
- Claude plugin and marketplace validation: passed. The validator reported optional listing metadata warnings.
- Local documentation links and agent Markdown formatting: passed.

The tests cover stale inputs, conflicting writes, blocked prerequisites, missing evidence, path escape, report escaping, duplicate run IDs, worker output errors, missing authentication, and worker interruption.

## Live Claude checks

`npm run test:live` passed with subscription authentication.

Claude completed setup in a workspace without application source. It recorded three blocking questions: discount stacking, refund eligibility, and refund permission. The caller clarified the discount rule and deferred both refund gaps. No interactive response was needed.

The default gate blocked execution. Explicit ready-only execution ran the standard checkout test. A fresh session applied the decisions and published a new plan revision.

The execution found the seeded defect: the quote returned 85 PLN instead of 90 PLN. After the caller changed the fixture behavior, a new retest observed 90 PLN and passed. The first failure remained available. Refunds and omitted checks remained uncovered.

A separate Claude session invoked the plan skill directly. Another session executed a saved plan and published its result through the CLI. A live permission-denial check returned `needs_decision` without a test action.

## Measured stage durations

| Stage                | Seconds |
| -------------------- | ------: |
| Setup                |    25.3 |
| Plan                 |    22.7 |
| Ready-only execution |    54.3 |
| Revise               |    17.2 |
| Execute              |    31.6 |
| Retest               |    26.1 |

These values describe one local run. They are not performance targets. Model behavior, load, and tool latency can change them.

The live test retains its requests, plans, evidence, reports, and timing record in the temporary path printed by the runner. This record contains no credentials or raw model transcript.

## Support limits

Linux is the measured platform. macOS and Windows were not tested. The launcher rejects Windows.

Local checks do not establish that hosted CI passed. The PR check reports that result separately. Live CI requires a repository secret and a manual workflow dispatch.
