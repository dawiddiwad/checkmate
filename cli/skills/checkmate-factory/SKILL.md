---
name: checkmate-factory
description: Start, inspect, or resume a Checkmate development campaign in the Checkmate source repository. Use for a development task from a GitHub issue, a prompt, or a file.
---

Use `scripts/factory.mjs` from the root of the Checkmate source repository. This workflow needs the source checkout, its installed dependencies, and an authenticated Pi host. The repository's `factory.yml` sets the role models, effort, phase jobs, and campaign limits. Set `qa.exploreBeforeFactory` to `true` to explore the starting build before the factory agent begins. Use `--config <yaml>` to choose a different config.

Start a campaign with exactly one input. Pass the user's text or path as one argument.

- GitHub issue number or URL: `node scripts/factory.mjs start --issue <number-or-url>`
- Development request: `node scripts/factory.mjs start --prompt "<request>"`
- Ticket file or link: `node scripts/factory.mjs start --file <path-or-link>`

To inspect an existing campaign, use `node scripts/factory.mjs status <campaign-dir>`. Read `status.json` in the campaign directory for its result and record location.

If the runner exits with 2, read `decisions.json`. Give the person the open decisions, the trade-offs for each option, and the oracle's recommendation. After the person answers, write a JSON object that maps each decision ID to its chosen option ID. Run `node scripts/factory.mjs resume <campaign-dir> --answers <json-file>`.

If the runner exits with 0, report the tested commit, the Checkmate record, and the candidate bundle. If it exits with 1, report the reason saved by the runner and where to inspect the campaign.
