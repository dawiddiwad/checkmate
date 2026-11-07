# Checkmate

Checkmate is a testing toolkit for Claude Code. It supplies workflows, contracts, execution checks, and evidence reports. Claude Code supplies the agent loop, model, tools, and permissions.

Use Checkmate to test requirements, changes, or a scoped exploratory objective. Source code is optional. Start with a running application and access to its tools.

## Install

Use Node.js 24 or later. The repository is a Claude plugin marketplace:

```text
/plugin marketplace add dawiddiwad/checkmate
/plugin install checkmate@checkmate
```

Install the plugin's Node.js dependencies before the first stage. For local development or PR review, clone this repository and run:

```sh
npm ci
claude --plugin-dir /absolute/path/to/checkmate
```

For a production-only install in the plugin directory, use `npm ci --omit=dev`. Install Claude Code and Playwright CLI on the host separately. The tested versions are Claude Code `2.1.319` and Playwright CLI `0.1.23`.

The plugin has five skills:

- `/checkmate:setup`: check tools and save a target profile.
- `/checkmate:plan`: create tests and identify gaps.
- `/checkmate:revise`: apply caller decisions to a new plan revision.
- `/checkmate:execute`: run selected tests and save evidence.
- `/checkmate:report`: generate Markdown and HTML reports.

Give each skill an explicit request file. Use the schemas in [contracts](contracts) and the [CLI guide](docs/CLI.md).

## Workflow

1. Set up the target profile. Record tools, versions, access references, and permitted operations.
2. Plan tests. Preserve each requirement and its source. Record unknown expected behavior as a blocking gap.
3. Ask the dispatching agent to clarify, accept an assumption, or defer coverage. Use a person when the agent lacks authority.
4. Revise the plan. Keep the prior revision unchanged.
5. Execute selected tests. The default policy blocks execution while an open blocking gap remains.
6. Read the result and its evidence. The caller decides whether to fix the application or release it.
7. Retest in a new run after a fix. Preserve earlier results and omitted coverage.

A completed run can contain defects. Complete coverage can contain failed tests. A process exit code is not a release decision.

## Run a delegated stage

```sh
node /absolute/path/to/checkmate/bin/checkmate.js delegate requests/plan.json --workspace /path/to/project \
  --allow Read --allow Write --allow 'Bash(node *)'
```

The launcher starts one fresh Claude Code session. Select tool rules for the requested stage. A browser stage also needs permission for the applicable Playwright commands. Do not grant blanket permissions in an untrusted workspace.

Use a normal Claude login, `CLAUDE_CODE_OAUTH_TOKEN`, or `ANTHROPIC_API_KEY`. Keep credentials in the host's secret store. Checkmate does not extract tokens or implement authentication.

## Read more

- [Contracts and configuration](docs/CONFIGURATION.md)
- [CLI and stage responses](docs/CLI.md)
- [Evidence and reports](docs/EVIDENCE.md)
- [Development and tests](docs/DEVELOPMENT.md)
- [Browser recipe](references/browser.md)
- [HTTP recipe](references/http.md)

## Scope

The scripts enforce Checkmate contract checks. They cannot restrict an agent that has arbitrary shell access. Tool permissions belong to the host. A valid file does not prove that an observation is accurate.

Checkmate does not fix product code, provision environments, generate maintained test suites, or publish releases. It does not enforce model token budgets or sanitize arbitrary screenshots.

## License

[MIT](LICENSE)
