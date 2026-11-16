# Commands

> **Reference** · Every command, its input and output, the statuses, the journal, the gap kinds, `record`, several testers, and `ui`.

Small values go in flags. Journal entries and a target profile go in JSON on standard input. Line 1 of every response is the status.

**On this page:** [Command line](#command-line) · [Workspace](#workspace) · [Command list](#command-list) · [Input](#input) · [Output](#output) · [Refusals](#refusals) · [Statuses and exit codes](#statuses-and-exit-codes) · [The journal](#the-journal) · [record](#record) · [Several testers](#several-testers) · [ui](#ui) · [Environment variables](#environment-variables)

## Command line

| Command line | Command                                  |
| ------------ | ---------------------------------------- |
| Plugin       | `node "<plugin root>/dist/checkmate.js"` |
| npm CLI      | `checkmate` from `@xoxoai/checkmate`     |

The two command lines have the same commands. The skills run the plugin CLI with its absolute path. The plugin has no npm dependencies and no global `checkmate` command.

`checkmate --help` prints every command with its options. `checkmate <command> --help` prints the usage of that command with `completed` on line 1. For a group, for example `checkmate target --help`, it prints each command of the group. `checkmate --version` prints the version.

## Workspace

Every command takes `--workspace <path>` and `--json`. Put options after the command name, for example `checkmate show shop-12 --workspace ../app`. A write takes `--actor <name>`.

Checkmate finds the workspace in this order:

1. `--workspace <path>`.
2. `CHECKMATE_WORKSPACE`.
3. The nearest directory with a `.checkmate/checkmate.db` store, from the current directory up.
4. The current directory.

Only `init` and `target open` create a store. Every other command refuses when the workspace has no store, the read-only commands and `ui` too. The refusal names the directory that Checkmate searched, and nothing changes:

```text
rejected shop-12 refusal=prohibited
reason: Refused: prohibited in the current state.
reason: No Checkmate store in /tmp and its parent directories. Nothing changed.
hint: Run the command in the project directory, or set CHECKMATE_WORKSPACE to the project directory, or pass --workspace <path>.
```

An agent that changes its directory, for example with `cd /tmp`, sets `CHECKMATE_WORKSPACE` to the project directory first.

## Command list

| Group   | Command                                                                | Does                                                                                                                                                                                                             |
| ------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store   | `init`                                                                 | Creates `.checkmate/checkmate.db`.                                                                                                                                                                               |
|         | `operations [--subject <s>] [--limit <n>] [--after <rowid>]`           | Lists the operation log, newest first. The subject is `target:<targetId>` or `change:<changeId>`. The limit is 1 to 1000. The default is 50.                                                                     |
|         | `query "<sql>"`                                                        | Runs one SQL statement on a read-only connection. It refuses a second statement, a write, and a statement without result columns.                                                                                |
| Target  | `target open <targetId>`                                               | Records a target: its entry points, capabilities, operations, and tools.                                                                                                                                         |
|         | `target request <targetId>`                                            | Prints the recorded target request.                                                                                                                                                                              |
|         | `target save <targetId>`                                               | Saves a profile revision from standard input.                                                                                                                                                                    |
|         | `target list`                                                          | Lists each target with its latest revision and instances.                                                                                                                                                        |
|         | `target show <targetId[@rev]> [--instance <id>]`                       | Prints a profile, and the values of one instance.                                                                                                                                                                |
|         | `target instance add <targetId> <instanceId>`                          | Adds an instance from `--entry` flags or standard input.                                                                                                                                                         |
|         | `target instance retire <targetId> <instanceId>`                       | Retires an instance.                                                                                                                                                                                             |
|         | `target instance list <targetId>`                                      | Lists the instances of a target, active and retired.                                                                                                                                                             |
| Journal | `open <changeId> --target <targetId> [--instance <id>]`                | Opens a change. The target must exist.                                                                                                                                                                           |
|         | `guide [<changeId>] [--role <tester\|recorder\|merger\|verifier>]`     | Prints what the record holds and how to log an entry, from the entry schemas. With a change, it also prints the PM answers and the open defects. `--role recorder [--build <build>]` prints the recorder prompt. |
|         | `record <changeId> [--build <build>] [--session <id>] [--timeout <s>]` | Starts a recorder: a fork of a Claude Code test session that writes the record. Read [record](#record).                                                                                                          |
|         | `log <changeId> [--build <build>] [--from <file>]`                     | Saves each valid entry of standard input or of the `--from` file, and refuses each invalid entry alone.                                                                                                          |
|         | `gaps <changeId> [--build <build>] [--all]`                            | Prints the open items of a build. `--all` prints all of them, for all actors.                                                                                                                                    |
|         | `show <changeId> [--all]`                                              | Prints the record of a change. `--all` shows the entries of all actors.                                                                                                                                          |
|         | `export <changeId> [--out <file>] [--all]`                             | Prints the record of a change as JSON, or writes it to a new file.                                                                                                                                               |
|         | `answer <changeId> <questionId> --answer <text>`                       | Records a PM answer.                                                                                                                                                                                             |
|         | `accept\|reject <changeId> --build <build> --rationale <text>`         | Records the decision of the oracle on a build, and prints the gaps of the build.                                                                                                                                 |
| Team    | `merge <changeId> --build <build>`                                     | Prints the defects of all testers on a build, and the suggested groups.                                                                                                                                          |
|         | `issues <changeId> [--build <build>]`                                  | Prints the merged result: one line for each issue.                                                                                                                                                               |
|         | `verify <changeId> --build <build>`                                    | Prints the issues to verify, with their steps.                                                                                                                                                                   |
| UI      | `ui [--port <n>]`                                                      | Starts the review UI.                                                                                                                                                                                            |

## Input

- Lists in flags are comma-separated, for example `--capabilities browser,http`.
- A payload is JSON on standard input. Use a quoted heredoc:

  ```sh
  checkmate log shop-12 --build b1 <<'EOF'
  { "kind": "note", "text": "Explored the coupon form." }
  EOF
  ```

- `log --from <file>` reads the same JSON from a file instead of standard input. The path is relative to the current directory, or absolute. The file must be inside the workspace. Evidence paths in the entries work the same as from standard input. `record` logs the file of its recorder the same way.
- `target open` takes `--entry-point <name>:<url|command|value>:<purpose>` once for each entry point. It needs one or more. The name uses letters, digits, `_`, and `-`. The purpose can contain `:`.
- `target open` takes `--tool <name>:<cli|mcp|skill>:<purpose>` once for each tool. The name uses letters, digits, `_`, and `-`, with an optional `<plugin>:` prefix.
- `target instance add` takes `--entry <entryPoint>=<value>` once for each entry point, `--environment <text>`, and `--reference <text>` (repeatable). Without `--entry`, it reads the instance JSON on standard input. The schema is `plugin/contracts/instance.schema.json`.
- `target save` reads a profile. The schema is `plugin/contracts/profile.schema.json`.

## Output

- Line 1 is `<status> <subject>` with short `key=value` facts.
- Each item is one line, ID first, with tab-separated fields.
- `reason:` lines follow.
- A `hint:` line follows when Checkmate can tell you what to do next. Read [Refusals](#refusals).
- `--json` prints `{ "status", "subject", "reasons", ... }`. A refusal adds `refusal` and can add `hint`.
- `export` prints the record as JSON. With `--out <path>`, it writes a new file and prints the response. It refuses an existing file.
- A schema error names the field. A missing field gives `<payload>/<path> needs field "<name>"`. An unknown field gives `<payload>/<path> has unknown field "<name>"`. A wrong value of a fixed list gives `<payload>/<path> must be one of: <values>`. A value of the wrong type gives `<payload>/<path> must be <type>`. When a field takes more than one type, for example a string or an object, the error names only the type of the value that you sent. When no type agrees, it lists all types, for example `must be string, number, or boolean`.
- An option value that is not in its fixed list or not in its range gives `invalid_request`, for example `operations --limit 0`, `operations --subject bogus`, or `guide --role boss`. The usage line shows a fixed list as `<a|b>`. The command does not start, and the log has no row.

## Refusals

When Checkmate refuses a command, the reply tells you why and how to correct it:

- Line 1 has `refusal=malformed` or `refusal=prohibited`. `--json` gives the same value in `refusal`.
- The first reason is `Refused: malformed request.` or `Refused: prohibited in the current state.`.
- The next reason says what is wrong.
- A `hint:` line, and `hint` in `--json`, tells you what to do. It names the missing field, the correct format, or the next command with the real IDs. Replace each `<placeholder>`.

| Refusal      | Meaning                                                                                                                                          | Do this                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `malformed`  | The command, an option, an argument, or the payload is wrong: an unknown command or option, a missing value, a wrong format, a schema error.     | Correct the command or the payload, as the hint says. Then send it again.      |
| `prohibited` | The command is well formed, but the record or a rule does not permit it now. For example, the change is not open, or the workspace has no store. | Do the step that the hint names first. Then send the command again, unchanged. |

Example:

```text
rejected kart refusal=prohibited
reason: Refused: prohibited in the current state.
reason: Unknown change: kart. The store /work/shop/.checkmate/checkmate.db has the changes shop-12.
hint: Check the change ID and the directory. To use the store of another project, run the command in that project directory, or set CHECKMATE_WORKSPACE to it, or pass --workspace <path>.
```

`invalid_request` is always `malformed`. `rejected` is `malformed` or `prohibited`.

## Statuses and exit codes

| Status              | Meaning                                                                        | Exit |
| ------------------- | ------------------------------------------------------------------------------ | ---- |
| `completed`         | The command did its work.                                                      | 0    |
| `needs_decision`    | `target save` saved a profile that is not ready. Read the `reason:` lines.     | 0    |
| `rejected`          | Checkmate refused the command. Nothing changed. Read the hint, then try again. | 1    |
| `invalid_request`   | The command name or the options are wrong. Read the hint for the usage.        | 1    |
| `operational_error` | The database lock stopped the command, or `record` saved no entry.             | 1    |
| `interrupted`       | The recorder of `record` did not end before `--timeout`. Checkmate stopped it. | 1    |

**Lock.** One command writes at a time. Every command waits up to 30 seconds for the database lock, also a read. Set `CHECKMATE_BUSY_TIMEOUT_MS` to change the wait. When it cannot get the lock, it gives `operational_error` with the reason `Another command holds the database lock. Nothing changed. Run the command again.` Run the same command again. The log has no row for that attempt.

## The journal

The tester tests freely and does not talk to Checkmate. After the test session, the recorder of `record` writes down what the tester did and saw, and Checkmate logs it. A person or another agent can also log entries. Read [record](#record). The journal has no checklist step, no finish step, and no completeness refusal.

1. The opener runs `open <changeId> --target <targetId>`. The target must exist. The opener can log criteria with `log`.
2. The writer of the entries runs `guide <changeId>`. `record` puts the same entry descriptions in the prompt of its recorder. The guide comes from the `description` and `examples` of `plugin/contracts/journal-*.schema.json`. It prints each field description one time. A later field with the same description shows only its name. No output of a later command tells the writer to read the guide again.
3. The writer runs `log` at any time, in any order. Standard input is one entry, a JSON array of entries, an object with an `entries` array, or one entry on each line. Checkmate removes a Markdown code fence around the JSON and a comma before `}` or `]`. When the array is not valid JSON, Checkmate reads each entry alone. The build is in the entry or in `--build`. Checkmate saves each valid entry and refuses each invalid entry alone, with its index, the field, a hint, and `fix`: the entry with each bad field corrected or removed. A call that saves no entry is refused. A call that saves one or more entries completes. When it refuses no entry, it prints one line: `completed <changeId> saved=<IDs>`. Else that line also has `refused=<count>`, and a `refused` line follows for each refused entry. It prints nothing else: the writer runs `gaps` to read what the record does not show yet.
4. The writer runs `gaps` at any time. `gaps` always completes, and no command needs it to be empty.
5. The PM runs `answer`. The oracle runs `accept` and `reject`.

The entry kinds are `criterion`, `observation`, `defect`, `question`, `verdict`, and `note`. The merger also logs `issue`: read [Several testers](#several-testers). Checkmate gives an ID with the prefix `C`, `O`, `D`, `Q`, `V`, or `N` when the entry has no `id`. An entry with `supersedes` replaces the earlier entry of the same kind and keeps its ID. Nothing is deleted: `export` has each version in `history`. Evidence is a file path in the workspace or a text. Checkmate stores the bytes of each file in `blobs`. A string with a space or `://`, or a string that does not look like a path, is text. The `source` of a criterion and the `saw` of a verdict are optional.

A defect with `saw`, `value`, or `via` is also the observation that shows it. Do not log that observation again. The views count such a defect as an observation marked `wrong`, about its `about` and the criteria in its `links`. Its `saw` is its `actual` when it has no `saw`. A defect without these fields is not an observation.

An observation with a `value` on an earlier build is a baseline. When an observation or a defect with a `value` has no `repeats`, Checkmate links it to one earlier observation with a `value` when exactly one chain of repeats matches: the same `about` and the same `steps`, without letter case and extra spaces, or the same ID without the build name at the end (`total-b1` and `total-base` or `total`). Checkmate saves the rule in `linked`. With two or more matches it links nothing. `"repeats": "none"` stops the link.

Open items are things the record does not show yet. Only `gaps` prints them. Each kind gets one line first, and the other lines follow the rank. `gaps` prints at most 8 lines of each kind and at most 40 lines, then a `count` line and a `not_shown` line with the count of each kind that it does not show. For a tester, the `not_shown` line does not point to `--all`, because `--all` shows the entries of the other testers. An item shows on one line only. The kinds, in rank order:

- `difference`: a repeat with another value and no note or defect about it. A defect that repeats a baseline explains its own difference. Checkmate compares the values in a normal form: it removes spaces at the two ends, changes each sequence of spaces to one space, and writes each number in one form.
- `baseline`: an observation with a `value` on an earlier build that no observation on the build repeats, with its steps.
- `baselines`: on the first build of the change, fewer than 3 observations have a `value`. The idea lists the existing rules near the change that are worth a baseline. `baseline_area`: on the first build, a changed area with no baseline about it.
- `wrong`: an observation marked `wrong` with no defect or note about it.
- `unverified`: a suspected defect that no observation shows on the running app, or a defect that only `via: code` observations show. `evidence`: a defect of the build without evidence.
- `open_end`: a note or an observation of the build that says that something is not tested, not verified, not captured, not covered, skipped, or `TODO`, with no entry about it.
- `retest`: a defect of an earlier build with no verdict on the build, unless an earlier verdict is `fixed`.
- `build`: the build has no observation. `value`: on `base`, an observation without a `value`.
- `criteria`: the journal has no criterion. `criterion`: a criterion has no observation on the build. `happy_path`: it has one observation, or only `ok` observations.
- `area`: a changed area (the `area` of a criterion or a note) that no observation on the build is about.
- `answer`: a PM answer that no observation on the build is about. An answer that only sends the agent to the ticket or the docs, for example "No decision; use the ticket and existing docs.", has no decision and gives no item.
- `entry_point`: no observation on the build used the UI (capability `browser`) or the API (capability `http`) of the target, or a criterion was observed only through some of them.

On `base`, the lines `criteria`, `criterion`, `happy_path`, `answer`, and `area` do not show, because the change is not built. An observation is about an ID when its `about` is the ID or has the ID as a word.

`show` prints the criteria, a matrix of the observations for each criterion or `about` on each build, the defects with their verdicts, the questions with their answers, and the decisions. `accept` and `reject` print the gaps of the build at the time of the decision.

## record

```sh
checkmate record <changeId> [--build <build>] [--session <sessionId>] [--timeout <seconds>] [--actor <name>]
```

`record` writes the record of one Claude Code test session. Run it from outside the test session, after the session or after a turn of it, in the directory where the test session ran. When that directory is not the project directory, set `CHECKMATE_WORKSPACE` to the project directory: it names the shared record. A person runs it in a terminal, or the orchestrator of an agent factory runs it.

1. It refuses when `CHECKMATE_RECORDER` is set: a recorder cannot start another recorder. It refuses an unknown change, and a `PATH` without `claude`.
2. It finds the session to copy. `--session` names it. Without `--session`, it uses the latest session of the current directory: the newest `<sessionId>.jsonl` file in `<config>/projects/<name>/`. `<config>` is `CLAUDE_CONFIG_DIR`, else `~/.claude`. `<name>` is the real path of the current directory with each character that is not a letter or a digit changed to `-`. A name of more than 200 characters is cut to 200 and ends with `-<hash>`. It skips the sessions of earlier recorders of the store, and the session in `CLAUDE_CODE_SESSION_ID`: the Claude Code session that runs `record`. When it finds no session, it refuses and tells you to pass `--session`.
3. It makes the folder `<files>`: `<workspace>/.checkmate/tmp/record-<recorderId>`, an absolute real path.
4. It starts one recorder in the current directory, in print mode, and waits for it to end:

   ```sh
   claude -p --resume <sessionId> --fork-session --session-id <recorderId> --output-format json \
     --permission-prompts none --add-dir <files> --allowedTools Read "Edit(/<files>/**)"
   ```

   The recorder is a new session with the history of the test session. The test session does not see what the recorder does. The recorder gets `CHECKMATE_WORKSPACE`, `CHECKMATE_ACTOR`, and `CHECKMATE_RECORDER=1`.

   The prompt on standard input has all that the recorder needs: the task, the entry kinds and their fields, an example file, and what the record already holds for the actor (the criteria, the defects with their verdicts, and the questions with their answers). Its only task is to write one JSON array of new entries to `<files>/entries.json` with the Write tool. It runs no command. `checkmate guide <changeId> --role recorder [--build <build>]` prints the same prompt, with `<files>` and a placeholder for the record text.

5. Checkmate logs `<files>/entries.json` as `log --from` does, with the actor and `--build`. It saves each valid entry and refuses each invalid entry alone.
6. When it refuses one or more entries, it resumes the recorder one time: `claude -p --resume <recorderId>`, with the same permission arguments and no fork. The prompt lists the refusals and asks for the corrected entries only, in `<files>/fix.json`. Checkmate logs that file. There is no second repair.
7. It removes `<files>`, and counts the entries of the change that the actor added, for each kind.

The actor is the actor of the caller: `--actor`, else `CHECKMATE_ACTOR`, else the default. In a team, run `record` with the actor of the tester.

`--add-dir` lets the recorder write in `<files>` when `<files>` is outside the current directory. The permissions let the recorder read files and write files only in `<files>`, without a prompt. `Edit(//abs/path/**)` is the host rule form for an absolute path, and the host checks a file write against `Edit` rules. The recorder has no Bash rule. With `--permission-prompts none`, the host refuses each other tool call that needs a prompt. Evidence is a path of a file that the tester saved in the workspace, relative to the current directory or to the workspace, or the text that the tester saw. The model, the authentication, and the other settings stay with the host. Checkmate passes no `--model`.

`--timeout` is in seconds, from 1 to 86400, for all recorder calls together. The default is 600.

Output: line 1 is `<status> <changeId> session=<id> recorder=<id> saved=<n> refused=<n>`, with `costUsd=` and `durationMs=`: the sums over the recorder calls, when the results of `claude` have them. An `added` line follows for each kind: `added<TAB><kind><TAB><count>`. The `reason:` lines give the failures and the refusals that remain. `--json` prints `{ "status", "subject", "reasons", "changeId", "build", "session", "recorder", "calls", "saved", "refused", "added": { "<kind>": <count> }, "costUsd", "durationMs" }`.

| Status              | When                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `completed`         | Checkmate saved one or more entries.                                                                                                   |
| `operational_error` | The first recorder call exited with an error or the `claude` result has `is_error`, the recorder wrote no file, or no entry was saved. |
| `interrupted`       | A recorder call did not end before `--timeout`. Checkmate stopped it, and still logged the file that the recorder wrote before.        |
| `rejected`          | A refusal before the start. No recorder started.                                                                                       |

A failure has a `hint:` line. The entries that Checkmate logged stay. The operation log has a `log` row for each file and one `record` row for each call of `record`, with the session and the recorder ID.

## Several testers

Two or more agents can test one change. Each tester tests alone. Its own recorder logs into the same journal with the actor of that tester. The merger then merges what they found. Checkmate does not limit how an agent tests.

- Each tester has its own actor, for example `qa:a1`. Run `record` with `--actor qa:a1` or `CHECKMATE_ACTOR=qa:a1`. Each entry stores its actor.
- A tester is an actor whose name starts with `qa:`, except `qa:merge` and `qa:verify`. All other actors are not testers: for example the opener, the PM, `qa:merge`, and `qa:verify`. Open the change and log the shared criteria with an actor that is not a tester.
- The short name of an actor is the part after the last colon: `qa:a1` has the short name `a1`. Use a different short name for each actor.
- Entry IDs are unique for each actor. Two testers can both log `D1`. The full ID is `<short name>/<id>`, for example `a1/D1`. An actor can use the bare ID of its own entry in each field that names an entry. To name the entry of another actor, use the full ID. A bare ID that names the entry of another actor is saved as the full ID.
- A tester sees its own entries, the entries of the actors that are not testers, the PM answers, and the decisions. `guide`, `show`, `gaps`, and `export` do not show the entries of the other testers. `--all` on `show`, `gaps`, and `export` shows all entries. An actor that is not a tester sees all entries. A view shows the bare ID of an entry when no other entry in the view has the same ID, and the full ID when one has.
- A tester can run its commands in a subfolder of the workspace, for example `workspace/a1`. Checkmate finds `.checkmate` in a parent folder. Read [Workspace](#workspace). An evidence path is relative to the current folder or to the workspace.
- Several `log` calls can run at the same time. Each call waits for the database lock.

An `issue` entry says that two or more defect entries describe the same defect: `{"kind": "issue", "title": "...", "severity": "high", "reports": ["a1/D1", "a3/D2"]}`. Checkmate gives an ID with the prefix `I`. To add or remove a report, log the issue again with `supersedes`. A defect that is in no issue is its own issue, with the full ID of the defect.

1. The merger runs `guide <changeId> --role merger`, then `merge <changeId> --build <build>`. `merge` prints each defect of the build from all testers: the full ID, the severity, the title, `expected`, `actual`, and the criteria that it links to directly or through a linked observation. It prints at most 60 defects. Then it prints the `suggest` lines, the `may_belong` lines under the heading `singles that may belong to a larger issue`, an example, and three `check` lines: the defects in no issue, the `suggest` lines that are not logged, and the count of `may_belong` lines. A `suggest` line is a group of defects of two or more actors that link to the same criterion, or whose title and `actual` have many of the same words: half or more of their words of three or more letters are the same. A `may_belong` line names a defect that only one tester reported and an issue or a `suggest` group of two or more testers with some of the same words: a quarter or more. When both defects have steps, the steps must also have a quarter or more of the same words, or the same path, for example `/api/cart`. A `suggest` line and a `may_belong` line are ideas, not rules. When the build has one or more issues, `merge` prints only the `suggest` lines, the `may_belong` lines, and the `check` lines. The merger does not test.
2. The verifier runs `guide <changeId> --role verifier`, then `verify <changeId> --build <build>`. `verify` prints two kinds of items, with the steps, `expected`, `actual`, and the evidence of the best report. The reason is `one reporter`: one tester reported the issue on the build, and no other actor confirmed or refuted it on the build where it was found. Or the reason is `disputed verdict` or `single verdict`: the status of the issue on the build is `disputed` or `single`. The verifier reproduces each item on the running application, and logs one observation for each item with `"confirms": "<ID>"` or `"refutes": "<ID>"` and `saw`. The ID is the ID of an issue or of a defect. The verifier does not explore beyond the list.
3. A verdict on a later build can name an issue or a defect.
4. `issues <changeId> [--build <build>]` prints one line for each issue: the ID, the severity, the title, the number of testers that reported it and their short names, the status on each later build, and `confirmed`, `unconfirmed`, or `refuted`. With `--build`, it prints only the issues with a report on that build. With `--json`, each issue has `id`, `title`, `severity`, `build`, `expected`, `actual`, `steps`, and `evidence` from the best report, `reports` (full IDs), `reporters` (the count), `actors`, `confirmed`, `refuted`, `verified` (`confirmed`, `refuted`, or `none`), `statuses`, and `note`. `statuses` has an object for each later build: `status` (`fixed`, `not_fixed`, or `no verdict`), `votes` (`fixed` and `not_fixed`, the count of testers), and `basis` (`majority`, `disputed`, `single`, `verified`, or `none`). The text line prints a status as `fixed (2 of 3)`, `not_fixed (1 of 1, single)`, `fixed (1 of 2, disputed)`, or `fixed (verified)`. The best report is the report with the most evidence, then with steps.

- `verified` comes from the last observation of an actor that did not report the issue, on the build where the issue was found, that confirms or refutes the issue or one of its reports. An issue is confirmed when two or more actors reported it, or when `verified` is `confirmed`. An issue is refuted when it is not confirmed and `verified` is `refuted`. A refuted issue stays in the record.
- The status of an issue on a later build comes from the verdicts on that build that name the issue or one of its reports. Each actor has one vote: its last verdict. The status is the result of most votes, with the basis `majority`. With one vote, the status is that result, with the basis `single`. With a tie, the status is `fixed`, with the basis `disputed`. With no vote, it is `no verdict`.
- An observation of an actor that did not report the issue, on a later build, settles the status on that build, with the basis `verified`. `confirms` means that the defect is still there: `not_fixed`. `refutes` means that the verifier could not reproduce it: `fixed`.
- When the journal has a tester, `gaps` for an actor that is not a tester, `accept`, and `reject` also print `unconfirmed`: an issue that is not confirmed and not refuted, and `no_verdict`: an issue with the status `no verdict` on the build, unless it is `fixed` on an earlier build.
- `export` has `issues`, with their reports and statuses.

## ui

```sh
checkmate ui [--workspace <path>] [--port <n>]
```

Prints `completed ui url=<url>` and serves the review UI on `127.0.0.1` until SIGINT or SIGTERM. The default port is a free port. The workspace must have a store. Read [Review in the browser](../guides/review-ui.md).

## Environment variables

| Variable                    | Read by   | Effect                                                                                                                            |
| --------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `CHECKMATE_ACTOR`           | Checkmate | The default actor of a write. `--actor` overrides it.                                                                             |
| `CHECKMATE_WORKSPACE`       | Checkmate | The workspace when the command has no `--workspace`. Use it when the agent changes the current directory.                         |
| `CHECKMATE_BUSY_TIMEOUT_MS` | Checkmate | The wait for the database lock in milliseconds. A value that is not a whole number from 1 to 2147483647 gives the default, 30000. |
| `CHECKMATE_RECORDER`        | Checkmate | `record` sets it to `1` for the recorder. `record` refuses when it is set.                                                        |
| `CLAUDE_CONFIG_DIR`         | `record`  | The Claude Code configuration directory where `record` finds the sessions. The default is `~/.claude`.                            |
| `CLAUDE_CODE_SESSION_ID`    | `record`  | The Claude Code session that runs `record`. The default session lookup skips it.                                                  |

## Next

- [Concepts](concepts.md): the terms and who owns what.
- [The record](record.md): the database and its limits.
