# Validation record

Date: 7 November 2026. Repository and plugin version: `0.7.0`.

The checks ran on Debian Linux with Node.js `24.22.1`, Claude Code `2.1.319`, Playwright CLI `0.1.23`, and Chromium `156.0.8078.79`.

After this record, the plugin moved to `plugin/`, the runtime npm dependencies were removed, and the commands started to calculate plan coverage and evidence digests. The live Claude checks below were not repeated after these changes.

## Automated checks

- `npm run phase:verify`: passed. All 21 tests passed. No test was skipped.
- Type generation, strict TypeScript checks, lint, and formatting: passed.
- Clean plugin install with production dependencies: passed. Node ran the TypeScript CLI and API without a build.
- Claude plugin and marketplace validation: passed. The validator reported optional listing metadata warnings.
- Documentation contracts, file digests, local links, and agent Markdown formatting: passed.
- All eight animation scenes fit the viewport. The GIF and static infographic were inspected.

The tests cover stale inputs, conflicting writes, blocked prerequisites, missing evidence, path escape, report escaping, duplicate run IDs, worker output errors, missing authentication, and worker interruption.

## Release checks

Version tests passed for the first `0.7.0` release, patch increases, repeated preparation, and rejection of stale versions. All version files stayed in sync. The package remained private.

Local simulations passed for Dependabot merge detection, direct pushes, manual releases, PR resume, invalid input, repeated release creation, and tag mismatch rejection. These simulations used a mock GitHub API. They did not create a release.

Actionlint `1.7.12` passed after excluding its unsupported `queue` field check. GitHub documents [`queue: max`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency) as a supported setting. The workflow preserves that setting from the prior release job.

## Live Claude checks

`npm run test:live` passed with subscription authentication.

Claude completed setup in a workspace without application source. It recorded three blocking questions: discount stacking, refund eligibility, and refund permission. The caller clarified the discount rule and deferred both refund gaps. No interactive response was needed.

The default gate blocked execution. Explicit ready-only execution ran the standard checkout test. A fresh session applied the decisions and published a new plan revision.

The execution found the seeded defect: the quote returned 85 PLN instead of 90 PLN. After the caller changed the fixture behavior, a new retest observed 90 PLN and passed. The first failure remained available. Refunds and omitted checks remained uncovered.

A separate Claude session invoked the plan skill directly. Another session executed a saved plan and published its result through the CLI. A live permission-denial check returned `needs_decision` without a test action.

## Measured stage durations

| Stage                | Seconds |
| -------------------- | ------: |
| Setup                |    36.7 |
| Plan                 |    27.0 |
| Ready-only execution |    71.3 |
| Revise               |    34.3 |
| Execute              |    50.1 |
| Retest               |    31.5 |

These values describe one local run. They are not performance targets. Model behavior, load, and tool latency can change them.

The live test retains its requests, plans, evidence, reports, and timing record in the temporary path printed by the runner. This record contains no credentials or raw model transcript.

## Support limits

Linux is the measured platform. macOS and Windows were not tested. The launcher rejects Windows.

Local checks do not establish that hosted CI passed. The PR check reports that result separately. Live CI requires a repository secret and a manual workflow dispatch.
