# Development procedures

> **Agent only:** This file contains repository or workflow instructions for coding agents.

Read the implementation before changing its contract or documentation.

1. Update the relevant JSON Schema.
2. Update the implementation and tests.
3. Run `npm run generate` after a schema change.
4. Update the relevant workflow skill and documentation. Edit a generated skill in its template. See [tool names and generated skills](#tool-names-and-generated-skills).
5. Install the prerequisites in [docs/development.md](../../docs/development.md#prerequisites).
6. Run `npm run phase:verify`.

Follow the test design rules below when you add or change a test.

## Tool names and generated skills

Read this before you add, rename, or remove an action tool or a tool field, or change a reply text, a prompt, or a shipped skill that names a tool.

Do not type a Checkmate tool name or tool field as a string literal. Take it from its definition:

- `plugin/contracts/actions.schema.json` defines the actions and their input fields. `npm run generate` writes `Actions` in `plugin/src/types.ts` from it.
- `plugin/src/tool-names.ts` gives the tool name of an action: `toolName(action)` for Pi, and `claudeToolName(action)` for Claude Code. Use them in code, prompts, and host arguments.
- `call(action, ...fields)` in `plugin/src/action-tools.ts` writes "`<tool>` with `<fields>`" for a reply text. TypeScript checks each field against the action input.
- The shipped skills that name a tool are generated. A template in `scripts/templates/` has the path of the file that it makes, for example `scripts/templates/plugin/skills/test/SKILL.md`. Edit the template. Do not edit the generated file. To name a tool in a skill that has no template, move the skill to `scripts/templates/` first.
- In a template, write a tool as `{{tool <action>}}`, a field as `{{field <action>.<field>}}`, and the required recipe fields as `{{recipe-fields}}`. Add each action that a template names to `tools` in `scripts/generate-templates.ts`.
- Run `npm run build` to write the generated files and the bundle. Commit them.

These checks fail on a mistake:

| Mistake                                                     | Check                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| An action is renamed or removed in the schema               | `tsc` in `npm run type:check`, at each use of the action   |
| `call` names a field that the action input does not have    | `tsc`                                                      |
| `{{tool x}}` names an action that is not in `tools`         | `npm run generate`: "names unknown tool"                   |
| `{{field a.f}}` names a field that the schema does not have | `npm run generate`: "names field"                          |
| A placeholder is misspelled                                 | `npm run generate`: "has a placeholder that is not filled" |
| A generated skill is edited by hand, or is stale            | `npm run type:check`: "is stale. Run npm run build"        |

No check finds a tool name or field typed as a literal, in code, a template, or a hand-written skill. A field named in reply text outside `call` is not checked. Look for them in your diff.

These names stay literal:

- `toolPrefix` and `claudeToolPrefix` in `plugin/src/tool-names.ts`. They are the definition. `claudeToolPrefix` follows the plugin name in `plugin/.claude-plugin/plugin.json` and the server name in `plugin/.mcp.json`. No check ties them together.
- `disallowedTools` in the front matter of `plugin/agents/tester.md`. It is not generated. Change it by hand when the prefix changes.
- CLI commands, for example `checkmate run close`, and host tools, for example the Agent tool or `bash`. They are not action tools.

## Test design

- Start with the public command or UI flow that a person or factory uses. Use the built or packed artifact when packaging can change behavior. Use a real temporary database or loopback app when the workflow crosses those boundaries.
- Control external hosts and services. Capture what Checkmate sends and assert the command result and persisted record. A fake can verify the host protocol. It cannot prove live model judgment or host compliance.
- Add focused lower-level tests for distinct parser, state, schema, concurrency, transaction, and refusal invariants. Keep them when they catch a failure that the workflow test does not catch clearly or cheaply.
- Do not repeat the same surface assertion across layers without a distinct failure mode. Prefer state, evidence, and user-visible outcome assertions over full prompt or markup snapshots. Keep prompt checks for instructions that change safety or scope, and check only the required meaning.
- Before retiring a test, name the failure it catches and its callers. Keep that behavior in a replacement test, or record a concrete reason why the test adds no distinct coverage.
- Use controlled local hosts for routine checks. Run authenticated or paid live tests only when the change needs them and the run is authorized. Report live tests that you did not run.

Report passed, failed, and unrun checks separately. Do not claim that mocked output proves live Claude behavior.

Keep publication separate from implementation. Do not create a release or tag unless the user requests it. Follow the [pull request skill](../skills/pull-request/SKILL.md) for each pull request.
