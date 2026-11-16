# Development

> **Guide** · For people who change Checkmate itself: the layout, the checks, the contracts, and the release flow.

The plugin is plain TypeScript that Node.js runs directly, with no runtime npm dependencies. Every change goes through `npm run phase:verify`, and a merged pull request releases itself.

**On this page:** [Set up](#set-up) · [Layout](#layout) · [Checks](#checks) · [Writing tests](#writing-tests) · [Contracts](#contracts) · [Releases](#releases)

## Set up

1. Use Node.js 24.12.0 or later.
2. Install the pinned development dependencies with `npm ci`.
3. Make your change on a feature branch.
4. Run `npm run phase:verify`.

## Layout

| Path                | Holds                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------- |
| `plugin/`           | The Claude Code plugin. Claude Code copies only this directory. It runs no npm install. |
| `plugin/skills/`    | The `qa` and `ui` skills.                                                               |
| `plugin/hooks/`     | `hooks.json`: the `SessionEnd` hook that starts `record`.                               |
| `plugin/contracts/` | The JSON Schemas. They are the authority.                                               |
| `plugin/src/`       | The store, the targets, the journal, the guide, the recorder, the commands, and the UI. |
| `plugin/dist/`      | `checkmate.js`, the bundle of `plugin/bin/checkmate.ts`.                                |
| `cli/`              | The npm package `@xoxoai/checkmate`. It runs the same commands as the plugin.           |
| `scripts/`          | Generators, build scripts, and the release script.                                      |
| `test/`             | The tests. They are TypeScript and run directly with `node --test`.                     |

- The plugin imports only Node.js built-in modules and its own files. Do not add runtime npm dependencies.
- The runtime uses erasable TypeScript syntax, so Node.js runs `plugin/bin/checkmate.ts` without a compiler.
- Node.js does not strip types in `node_modules`, so the npm package runs the JavaScript bundle.
- The root package is private. It holds the development dependencies and commands.
- `cli/` runs `scripts/build-cli.ts` before it packs. The script bundles `cli/src/main.ts` and copies `plugin/`, `README.md`, and `LICENSE` into the package. In the package README, relative links and images point to the release tag on GitHub.
- Checkmate starts no tester. Only `record` starts Claude: one fork of a test session, with the `claude` command of the host. Do not add a model loop or an Agent SDK runner. Keep model selection, authentication, and permissions with the host.

## Checks

```sh
npm run phase:verify
```

`phase:verify` runs, in order:

1. `type:check`: the generated types, validators, and plugin bundle match their sources, and TypeScript has no errors.
2. `lint:check`: ESLint on `plugin`, `cli`, `scripts`, and `test`.
3. `format:check`: Prettier.
4. `npm test`: the fast suite. It uses temporary workspaces and needs no network and no Claude credential. The `record` tests put a fake `claude` on `PATH`.
5. `node test/plugin.ts`: copies `plugin/` out of the repository and runs the bundled CLI without npm install.

| Test file                | Covers                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `test/store.test.ts`     | Schema, version check, triggers, foreign keys, WAL readers, lock errors, canonical JSON, ULIDs.   |
| `test/workspace.test.ts` | The workspace order, `CHECKMATE_WORKSPACE`, the refusal without a store, the unknown change.      |
| `test/targets.test.ts`   | Targets, profile checks, revision order, and instances.                                           |
| `test/journal.test.ts`   | Entries, the guide, gaps, several testers, merge, issues, and verify.                             |
| `test/record.test.ts`    | `record` with a fake `claude`: the session lookup, the result, failures, and the guard.           |
| `test/cli.test.ts`       | Output, flags, read-only `query`, actor, standard input, the operation log, and old stores.       |
| `test/ui.test.ts`        | UI pages, escaping, forms, Host and Origin checks, live events, the log list, and Settings.       |
| `test/package.test.ts`   | `npm pack` and install of the CLI, the package README links, and a change from the installed CLI. |
| `test/release.test.ts`   | Version rules and the five version files.                                                         |

Add tests for changed relationships and failure paths. Do not replace live checks with mocked success. A passed suite does not prove that an agent finds more defects with Checkmate.

## Writing tests

Use these rules when you add or change a test.

1. **Assert a rule once.** Assert it at the lowest layer that owns it, for example `journal`, `targets`, or `store`. A CLI or UI test checks only the wiring: one happy path and one refusal for each command or page.
2. **Write one scenario for each feature and for each escaped bug.** Name the test after the behavior that broke.
3. **Use a table for validation.** Write one test for each input surface, with a table of inputs and expected reasons. Do not add a test for each bad input.
4. **Assert behavior, not text.** The agent-facing CLI lines are a contract. Check the format of each command in one test. In other places, match the identifying tokens, for example `/Unknown change: kart/`. Select HTML by `data-key`, role, or label, not by class names or markup.
5. **Keep a runtime budget, not a count budget.** Do not use a fixed wait. Wait for a condition, or inject the timeout. Use a subprocess only when the proof needs a process boundary, for example standard input, an exit code, or a lock between processes. Seed a shared workspace once for each file, and copy it for each test.

## Contracts

1. Edit the schemas in `plugin/contracts/`.
2. Run `npm run generate`. It writes `plugin/src/types.ts` and `plugin/src/validators.js`.
3. Do not edit the generated files. `npm run type:check` fails when they differ from the schemas.
4. The `description` and `examples` of `journal-*.schema.json` are the text of `checkmate guide`. Keep them descriptive: what the record holds and how to write an entry. Do not write how to test.
5. Update the skills and this manual.

## Releases

Each merged pull request to `main` starts the release job in `.github/workflows/ci.yml` after `verify` passes.

1. `scripts/release-version.ts` checks that the five version files agree: `package.json`, `package-lock.json`, `cli/package.json`, `plugin/.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json`.
2. When the current version already has a tag, it increases the patch version in all five files.
3. The job runs `phase:verify` on the release candidate.
4. It pushes the version commit and the tag `v<version>`.
5. It publishes `./cli` to npm with trusted publishing. No npm token is used.
6. After the publish succeeds, it creates the GitHub release.

- **No release.** Add the `skip-release` label to the pull request before you merge it.
- **Minor or major.** Set the new version in all five files in the pull request. It must be newer than every release tag, and npm must not have it yet.
- **Resume.** Release jobs run one at a time. When a job fails after the push, rerun the failed job. Or run CI manually on `main` with `release` on and the merged pull request number in `pull_request`. The job reuses the release commit and tag, and skips the npm publish when npm already has the version.
- **Manual release.** A manual run does not check the labels. Without a pull request number, it makes a separate release. A direct push without a merged pull request does not release.

npm must trust this repository and `.github/workflows/ci.yml`. The workflow token needs write access to the contents, and the repository rules must let the release bot push the commit and the tag.

## Next

- [Concepts](reference/concepts.md): the terms that the code and the manual share.
- [The record](reference/record.md): the rules that the store tests check.
