# Review in the browser

> **Guide** · For a human who makes the oracle's decisions in the review UI.

The review UI is a local web page on top of the same record. It shows what waits for you, and it lets you decide with the full context in front of you.

## Start the UI

In Claude Code:

```text
/checkmate:ui
```

With the npm CLI:

```sh
checkmate ui [--workspace <path>] [--port <n>] [--new-hook-token]
```

The command prints `completed ui url=<url>`. Open that URL in a browser on the same computer. The UI listens on `127.0.0.1` only. It runs until you stop it with Ctrl+C. When you start it again on the same port (`--port <n>`), the testers that run keep asking you. On another port, the turn that runs cannot ask, and the next turn asks again. `--new-hook-token` makes a new secret for the testers. Use it only when you think that another process read `.checkmate/hook-token`. The plugin contains the UI, so you do not need npm.

## The layout

Each page has the same four parts:

- The top bar: `Checkmate` opens the home page. At the right are the live state, your name, and the switch for light and dark.
- The navigator, at the left on the pages of a plan.
- The centre: the list or the page.
- The status bar, at the bottom. It shows the path to where you are, for example `Plans › checkout › Needs you › a1/D1`, the buttons `Find`, `Keys`, `Activity`, `Runs`, `Log`, and `Settings`, and the keys that work where you are. `Activity` shows `Activity · <n> running` while <n> tests run. On a narrow window, `More` holds `Activity`, `Runs`, `Log`, and `Settings`. On a window of 600 pixels or less, `More` also holds `Find`. While a request runs, `Request R3 · running` shows first. When tester or request permission requests wait, `<n> permissions` follows it. When replies are not read, `<n> reply` or `<n> replies` follows that. When items wait for you, `<n> need you · all plans` comes next. It counts the items of all plans. When the keys do not fit, the status bar removes the least important keys first. `? Keys` always shows. A message shows in the case that it is written, so a build name keeps its case. It comes before the keys: the keys make room for it, and a message that still does not fit shows in full in a strip above the status bar.

On a window of 900 pixels or less, the navigator is one row of chips. The row stays under the top bar when you scroll, and each mark shows its build, for example `B1`. On a window of 760 pixels or less, each row has two lines: the badge, the ID, and the title, then the short note. On the highlighted row, its options replace the note. The rows do not change height when the highlight moves. On a window of 760 pixels or less, a record covers the list, and each button is at least 40 pixels high. The status bar keeps the last level of the path, `Find`, `Keys`, and `More`.

The UI follows the light or dark setting of the system. The switch in the top bar overrides it, and the UI keeps your choice in a cookie.

When a page or a list has nothing to show, it says what is empty and gives the one next step.

## Pages

### Plans

The home page, `/`. It shows one row for each plan: the plan ID, the [loop state](../reference/commands.md#loop-states) and the role that it waits on, the latest build, the objective, one sentence about the latest build, a small map of the rules against the last two builds, and the counts of defects, findings to look at, open questions, and defects handed over. Option `1` opens the step that waits for you, for example `Answer 4 blocking questions`. A plan with a test in progress shows `Testing`, the step, and the time since the start. A plan whose last test was stopped or interrupted shows `stopped` or `interrupted`. The row `Testers now` of the navigator shows the same step and time. The plans that wait for you are first, and the plan with the most recent activity is first among them. The other plans follow. Click a row, or press `→` or `Enter`, to open the plan. When you go back from a plan, the home page highlights that plan.

The row `New change` is after the plans. It opens the new-change form. When the record has no target, the home page is the first-run form. When the record has a target and no plan, the home page is the new-change form. See [Start from nothing](#start-from-nothing).

The old addresses `/plans`, `/inbox`, and `/claims` open the home page. `/claims?plan=<planId>` opens `All items` of the plan. An old link `/?item=<item>` opens the item in its plan.

### A plan

`/plans/<planId>` shows one plan. The navigator at the left has these rows:

- `Testers now` (while a session runs) or `Testers`: the live view of the latest session.
- `Needs you`: the items that wait for your decision. The count is orange when an item blocks testing.
- `All items`: the claims, questions, and gaps of the plan.
- The areas of the rules. Each area shows one mark for each of the last three builds: `✓` right, `✗` wrong, `?` uncertain, empty for not tested, and `●` for the build that is under test now. An area opens to show its rules, with the same marks. A rule without an area is in the area `Rules`.
- `Outside the rules`: items that concern no rule of the plan, and items that cite a rule that the plan does not have now (for example a rule that you removed).
- One row for each build, `B1`, `B2`, and so on, in the order in which the plan tested them.
- `Rules of the plan`, then `Plan @<revision>` (or `Plan request` for a plan without a revision).

The centre shows the items of the highlighted row. The items are in groups: `Is this a defect?` (the findings that are `suspected` or `unresolved`), `Questions that block testing`, `Approvals`, the other questions by topic, the defects by severity, `Answered questions`, and `Rejected findings`. An area shows the items of all its rules, grouped by rule. A rule shows its state on each build. Click a mark of a rule or an area, or press its number, to show only the items of that build.

Each row shows a box for the selection, a badge, the ID, the title, and a short note, for example `Returned · ×3`. The highlighted row also shows its options, numbered from left to right:

- A finding: `1 Yes, a defect` accepts it at once. `2 No` opens a field for the reason. A reject needs a reason.
- A question or a gap: `1 Right` records that the build is right as it is (`accept_assumption`, with the text of what the build does). `2 Different` opens a field for how it should be (`clarify`). `3 Later` defers it. A deferred question shows `Deferred` and keeps `1 Right` and `2 Different`, so you can answer it later.
- A defect: `1 Hand over` opens a field for the name of the person or team that takes it. `1 Undo hand-over` removes the hand-over. `2 Copy for the developer` copies the defect as text. Read [Copy for the developer](#copy-for-the-developer).
- A rule in `Rules of the plan`, when the tester derived the rules: `1 Edit…` and `2 Remove…`. Read [Rules of the plan](#rules-of-the-plan).

After a decision, the next item that waits for you takes the highlight. When you decide inside a record, the next record that waits opens. A hand-over keeps the highlight on its record. The address keeps the view and the row, for example `/plans/checkout?view=all&at=c:a1/D1&focus=list`, so a reload or a copied link shows the same place. When somebody decides the highlighted item in another session, the item goes from the list, the next row takes the highlight, and the status bar says, for example, `k1/Q8 was answered in another session`. The next number key records nothing and says so, because you did not choose the new row. Press the number again to act on it.

### Act on several records

Select rows with their boxes, with `Space`, or with `Shift` `↑` `↓`. A strip directly above the status bar shows the number of selected rows and the actions that apply to them, numbered: `Accept <n> findings as defects`, `<n> questions right as built`, `Defer <n> questions`, `Hand over <n> defects`, `Copy <n> defects for the developer`, and `Clear the selection` last. While rows are selected, the number keys act on the selection. Each action on more than one record asks first and names the count. `Enter` or `1` confirms. `Esc` or `←` cancels and keeps the selection. The selection clears when the action is complete. The strip and the notes after an action never cover a row: while they show, the navigator and the list end above them. A hand-over shows a note with `0 Undo` for some seconds. A copy shows the toast `Copied <n> defects` and keeps the selection. Press `0` or click `Undo` to remove the hand-over. The other decisions have no undo in Checkmate.

### Store defects as tests

`Store <n> defects as tests…` is in the actions of `All items` and of `Rules of the plan`. It shows only when the plan has defects to store. A defect to store is a claim in the state observed, confirmed, or accepted that is not stored as a test yet. `<n>` is their number. The count comes from the same code as the command `checkmate harvest`, so the two always agree.

The action asks first. The dialog names the count and says what happens: Checkmate stores each defect as a test of this plan and attaches it to the rule that the defect cites. The rules, areas, and marks of the plan stay the same. A defect that cites no rule, the outside rule, or a removed rule gets a new rule `HR1`, `HR2`, and so on. When the plan has an approval policy, the dialog adds that the stored tests wait for the approval of the plan. `Enter` or `1` stores. `Esc` or `2` cancels.

The page calls `harvest` once for each exploration that has defects to store. Each reply shows in one toast, for example `Stored 3 defects as tests: H1 → R2, H2 → R7, H3 → HR1`. A long toast is cut, and its title has the full text. A refusal of the engine shows in the dialog, and the dialog stays open. When the count changed after you opened the dialog, the dialog refuses and stores nothing. Close it, read the new count, and try again.

After a store, the navigator, the marks, and the counts of the rules stay the same. These things change: each new rule `HR<n>` is in the area `Rules`. A new revision of the plan exists, so `Plan @<revision>` replaces `Plan request`. When the plan has an approval policy, the revision is an approval that waits for you, and `Needs you` and `All items` show it. The `Tests` section of the plan lists the new tests, and each test shows the rule that it is attached to.

The command `checkmate harvest` stores a whole exploration. For this reason, the review UI has no action to store a selection of defects.

### Rules of the plan

`Rules of the plan` lists the rules. The rules come from one of four places. The tester derived them from the sources, or you corrected them: you edit them in this view, as described here. They come from the request of the plan, or from a revision of the plan: this view has no edit, and a plan with a revision has `Edit the rules`, which opens the plan editor. After a store, the rules have the origin `harvested`, as the next paragraphs say.

For derived rules, each rule row has two options, and `Add a rule…` is in the actions above the list. A rule view has `Edit <ID>…` and `Remove <ID>…` in its actions too, so that a pointer reaches them.

- `1 Edit…` opens a dialog with the text of the rule and its area. The area is a choice of the areas that the plan has now, numbered from `1`. Type a name in `Or a new area` to use another area. `Enter` saves. A plan can have 9 areas, and an area name can have 40 characters. The field takes a longer name, and the dialog refuses it at the field with the limit. Checkmate does not cut the name. A refusal shows in the dialog at its field, and nothing changes.
- `2 Remove…` asks first, and names the items that cite the rule. `Enter` or `1` confirms. A plan keeps at least one rule, so the option is not available for the last rule.
- `Add a rule…` opens a dialog with the text, the area (as above), and the source. The source is optional. Without it, the source is `Added in the review UI.` The new rule has the next free ID, for example `R7`.

A rule shows how many stored tests it has, for example `1 stored test`, in its row and in its view. The header shows how many rules have one, for example `4 of 13 rules have a stored test`, when the plan has any.

After a store, the rules have the origin `harvested`. This holds also for a plan whose rules come from its request and that has no revision before the store: the plan keeps the rules of the request that have no stored test, in the order of the request, and the rules with a stored test belong to the revision. A rule without a stored test keeps `1 Edit…` and `2 Remove…`, and `Add a rule…` stays. A rule with a stored test belongs to the revision of the plan. Its row has one option, `1 Edit in the plan editor`, which opens the editor of the revision. When the rule gets a stored test after you opened its dialog, the dialog shows the refusal of the engine, and nothing changes. A rule `HR<n>` always has a stored test.

Each change is a `plan edit <planId> --patch` with only `requirements`: the UI and the command use the same code. The stored rules get the origin `corrected`. Rules with the origin `harvested` keep it. After a change, the navigator, the area marks, and the counts show the new rules.

A removed rule does not change the entries that cite it. The record keeps the rule ID of each defect and question. The review shows an item that cites a rule that the plan does not have as an item of `Outside the rules`, as Checkmate does for a new entry that cites an unknown rule. Add the rule again with the same ID to bring the items back.

### Copy for the developer

`2 Copy for the developer` on a defect, and `Copy <n> defects for the developer` for a selection of defects, put plain text on the clipboard. Each defect has the title, the severity, the rule that it breaks (the ID and the text), the steps, the expected result, the actual result, the state on each build, and the names of the evidence files. Several defects have a line of dashes between them. A toast says `Copied 3 defects`. The action changes no record, asks nothing, and keeps the selection.

The page gets the text from `/plans/<planId>/defects.txt?claim=<claimId>` (one `claim` for each defect), and the same function, `developerText` in `plugin/src/developer.ts`, can serve a command or an agent. The page writes the text with the clipboard of the browser, on your click or key. When the browser has no clipboard, or does not allow it, a panel shows the text, selected, with the sentence to copy it with `Ctrl` `C` or `Cmd` `C`. `Esc` closes the panel.

### Find

`/`, `Ctrl` `K`, or `Find` in the status bar opens the find bar. Type words to find plans, claims, and questions of all plans that contain each word. The bar shows the first 12 results and the number of other results. `↑` and `↓` move in the results, `Enter` opens the highlighted result and does nothing while the query is empty, `←` and `→` move the caret, and `Esc` closes the bar. When the text has a word, the last row is `Ask Checkmate: <text>`. It is the highlighted row when nothing matches. See [Requests](#requests).

### A record

Open a row to show its record at the right of the list. The record shows the same options as the row, and:

- A claim: the expected and the actual result, the steps, the evidence, its state on each build (for example `new in build B1, fixed in build B2, present again in build B3`), the rule, who saw it, the decision, and the hand-over.
- A question: what the build does now, the rule, the topic, the builds, and the questions that it answers. A merged question answers all its members with one answer. `Source and reason` opens two optional fields. When you leave them empty, the record names you and the review UI as the source.

Each text field has a `Send` button. `Enter` also sends. When somebody decided the item after you opened it, the UI does not record your decision. It names who decided and how, and it shows your text again. When the UI does not answer, for example because it stopped, the record says that nothing is recorded and keeps your text.

The old addresses of a claim and a question, `/explorations/<id>/claims/<claimId>` and `/explorations/<id>/questions/<questionId>`, open the record in its plan.

### Evidence

Open a file of a claim to show the evidence viewer. It lists the files at the left and shows one at the right. Move between the files with `↑` and `↓`. An image shows at its size, up to the width of the window. A small text file shows as text. Each file has `Download`. An empty file shows `Empty file`, and an image that the browser cannot show shows `This image cannot be shown.`.

The run page and the testers view show evidence as tiles. Click a tile to open it in a viewer. `Esc` closes the viewer.

### Start from nothing

The find bar lists `New change` (`/new`) and `New target` (`/setup`).

**First run.** The first-run form has one field that you must fill in: the address of the application, for example `http://localhost:3000`. Type the address. Below it, the form shows what Checkmate assumes, as `checkmate setup` reports it:

- The target name. It comes from the host of the address. You can change it.
- The environment. It is empty. You can fill it in. A name that starts with `prod` makes a production instance.
- A list of the instance, the entry point, the capabilities, the operations, the reset, and the authentication. Each has a plain label and the value as the engine gives it, for example `Capabilities` and `http (no browser tool on PATH)`.

`Testers may change data` is the choice `--operations`. `Yes` lets the testers do any action that the application offers to a test user. `No` limits the testers to reading. For a local address (`localhost`, a loopback address, or a private range) the choice starts as `Yes`. For another address the choice has no start value. Choose `Yes` or `No`. When you set up a target on an address that is not local, a dialog asks once more and names the address.

Press `Enter` to set up the target. The new-change form opens. When the application does not answer, the form shows the sentence of the engine at the address field, and keeps your text. The form sets up the target with the same function as `checkmate setup`.

`New target` in the new-change form opens the same form. `Esc` goes back to the new-change form and keeps your draft.

**New change.** The form has these fields:

- `Ticket file`: the path of a file inside the workspace. The form refuses a path outside the workspace, a file that does not exist, and a folder.
- `Ticket text`: the text of the ticket, when you have no file. Fill in the file or the text, not both. Checkmate saves the text in `.checkmate/sources/<plan>.md` and gives that path to the plan as its source. Checkmate creates no file outside `.checkmate/`.
- `Name of the plan`. Checkmate gives a name from the file name, or from the first line of the text, as the product makes the ID of a target. You can change it. The form refuses a name of a plan that exists.
- `Target`. The form shows the choice only when the record has more than one target.
- `Instance`. The form shows the choice only when the chosen target has more than one active instance. The form refuses a start with no instance. When the instance has an address that is not local, the dialog for that address asks first.
- `Build`, `Level`, and `Testers may use without asking`, as in the `Test build…` dialog.
- `More`: `Since`, `Until`, and `Repository folder`.

Press `Enter` to make the plan and start the test with the same function as `checkmate test <plan> --source <file>`. The Testers view of the new test opens. Each refusal shows at its field, and the form keeps your text. When the target is on an address that is not local, a dialog asks first.

A form keeps your text as a draft. It stays when you press `Esc`, reload the page, or leave for `New target`.

### Start a test

`Test build…` is in the action row of each view of a plan. The row shows an action only when the action applies. `Test build…` does not show while a test of the plan runs.

1. Choose `Test build…`. A dialog opens.
2. Write the build name. The field has the name that `checkmate test` gives when you give no `--build`: the short git commit, or the date and time in UTC.
3. Choose the level: `smoke`, `normal`, or `deep`. `normal` is the first choice. Press `1`, `2`, or `3` to choose a level.
4. Check `Testers may use without asking`. The field has the tool rules of the testers, one rule for each word, as in `checkmate test --allow`, for example `Read Bash`. It starts with the rules of the workspace setting `Tool rules of testers` (see [Settings](#settings)). The engine needs at least one rule today. A tool without a rule asks you in the UI, if the UI runs.
5. Open `More` to give `Since`, `Until`, and `Repository folder`. Without `Since`, the UI uses the default branch of `origin`, as `checkmate test` does.
6. Press `Enter`. The Testers view of the new test opens.

When the target of the plan has more than one active instance, the dialog has the choice `Instance` after the build. Each instance has a number: press `1`, `2`, and so on to choose it. The choice starts on the instance of the last test of the plan when that instance is active. Without such an instance, the choice has no start value, and the dialog refuses at the field with `Choose the instance: <names>.` until you choose one. The UI gives the choice to the engine as `--instance`. `Test again` and `Test build… again` start on the instance of their run. With one active instance, the dialog has no `Instance` choice. A retired instance is not in the choice.

The UI starts the testers as new Claude Code processes with the rules of the field. The follow-up of a test uses the rules of that test. The test runs without the UI: closing the UI does not stop it. The UI starts a test only when no test of the plan is in progress. When one is in progress, the dialog stays open, names the running test, and links to it.

When the engine refuses the start, the dialog shows the reason in a sentence at the field, and keeps your text. An empty rules field shows the refusal of the engine at that field. For example, when `claude` is not on `PATH`, the dialog says so and gives the next step.

`Test the answers (<n>)…` shows when the last test of the plan is completed and <n> answers of the product owner are not tested yet. A dialog names the count. Press `Enter` or `1` to start the follow-up. The follow-up uses the instance of its test.

### Activity

`/activity` lists every test and follow-up of all plans, one row each. Runs in progress come first. The other runs follow, newest first. A row shows the state, the run ID, the plan, the build, the level, the person who started it, the time, the duration, the cost when Claude Code reported it, and one line about the outcome: the counts of defects and questions, or the reason that it failed or stopped. `→` opens the Testers view of the run.

- `1 Stop…` shows on a run in progress. A dialog asks first.
- `1 Test again` shows on a failed, stopped, or interrupted run. The `Test build…` dialog opens with the same build, level, `Since`, `Until`, and folder.

A row shows its numbered options only when all of them fit in the row. When they do not fit, the row shows `→ <n> options`, and the number keys do nothing in the list. Open the row. The detail view lists each option on its own line, numbered, and the number keys act there. In the Testers view, the overview of a run lists `Stop…` or `Test again`, and the detail of a tester lists `Stop`.

`Activity` is also in the find bar. The list pages like `Log`: `↓` on the last row opens the next page.

### Testers

`/explorations/<explorationId>` is the live view of one session. It updates by itself while the session runs. It shows:

- The state of the session, its build, instance, level, and phases. While the session runs, a strip shows the steps `study`, `test`, `record`, `merge`, and `check`. Only the step that runs now is lit. Checkmate reads the step from the events of the testers: `study` while each running tester is in its study turn, and `test` from the first tester in its test turn. The banner names the same step. The header says when the session started, for example `started just now` or `started 1 min ago`. On a session that is over, it also says when the session ended and how long it took. The title is `Testers now` while the session runs, and `Testers` after it. The time since the start counts up, and the cost so far shows when Claude Code reported it.
- One row for each tester, with its state (`Given to the session`, `Running`, `Paused`, `Finished`, `Failed`, `Stopping…`, or `Stopped`), its first line, its step, and the time in that state. The time counts up while the tester runs. The first line is the last activity line with its age, for example `… · 2 min ago`. Checkmate does not invent activity. While a tester has no activity line, the line says where the tester is, for example `In its study turn. The first activity line comes when the turn ends.`
- `After the testers`: `record`, `merge`, `verify`, and `follow-up`, with their states and reasons.
- The other sessions of the plan.

Below the list is the overview of the session, or the tester or phase that you open: `Not merged yet`, the merged claims and questions, the saved files, and `Download report`. A paused session waits for you in the Claude Code session, not in the UI.

`Stop the test…` is in the action row while the session runs as processes. A dialog names the plan and the build, and has an optional reason. A tester that runs has `Stop` as its last option. Both ask first. A stop ends the supervisor and the Claude Code processes of the test. It keeps the record and the work folder. The UI answers at once: the view shows `Stopping…` while the processes end, and no other page waits. A background process ends the processes. The view shows `Stopped` when they have ended, or names the processes that are still alive. While a stop runs, a new test of the plan does not start. The dialog closes with a message when the test or the tester ends before you confirm.

A stopped session shows `Stopped by <name>`, the reason, and the work folder where reports that were not recorded stay. When the supervisor dies without a stop, the session shows `The run was interrupted: the supervisor stopped before the end.` Both give `Test build… again`. A session of the Claude Code session path cannot stop here. Stop its testers in the session.

A failed session says why and what to do next: `claude` was not found, Claude Code is not signed in, a tester did not end in time, or another reason with its text. A failed session shows its reason, the kept work folder `.checkmate/work/<explorationId>`, and the log. `Not merged yet` items are the raw questions and defects of single testers. They can change before the session is completed. `Needs you` does not show them.

A tester can always write in its own work folder. When a tester leaves files outside it, a line under the banner says `Tester a1 left files outside its work folder: <names>. Checkmate did not touch them.` Move or delete them yourself.

### Permission requests

While the UI runs, a tester that needs a permission asks you. The tester waits for your answer for up to 10 minutes. Without the UI, or when the hook is blocked, a tester behaves as before: Claude Code denies the call.

Open requests show in these places:

- The status bar shows `1 permission` or `<n> permissions` on every page, before `<n> need you`. It updates by itself. Click it to open the first open request.
- `Needs you` of the plan has the first group, `Permission requests`, above `Is this a defect?`. Each row has the badge `ASKS`, the ID (`x-1/P3`), who asks and the first line of what it asks, and how long it waits. The group shows the oldest request first. A new request joins at the end of the group. The highlight stays on its record. The rows count in `Needs you` and in `<n> need you · all plans`.
- In the Testers view, the row of a tester that asks has the state `Asks`. Its first line says what it asks. A step that is not a tester shows a link under the banner.
- `Activity` says `waits for you: <n> permission requests` on the run.

`→` or `Enter` on a request row opens the request record. A row has up to six options, so it shows `1 Allow once` and `→ more`. Press `1` to allow the request once without opening it. When the highlight moved because of a live update, `1` records nothing and says so. Press `1` again to act on the new row.

**The request record.** `/permissions/<exploration>/<request>` has one short heading, for example `Tester a1 asks to run a command`, `Tester a2 asks to write a file`, or `The recorder of a1 asks to read a file`. Under it is what the tester asks, in full, once: the command or the path, and for `Write` and `Edit` the first 40 lines of the content or of the change. The options follow directly, one on each line and numbered. So options 1 and 2 are in view on a window of 1440 by 900 pixels, also for a long command. The destructive option is last. An option that does not apply is not shown, and the numbers have no gap. Each option, also `Deny…`, is a button with its number. After the options, the details show in a list of two columns: the tool, the folder, who asks, since when, the run, and the plan. The folder breaks only at a `/`.

1. `Allow once`. Answers yes. Checkmate stores no rule.
2. `Allow this command for this test`. Shows only when Claude Code suggests a rule. Answers yes, and answers every later request with the same rule, from any tester of the run. Checkmate stores the rule in the record of the run.
3. `Allow every <Tool> call for this test`. Answers yes, and answers every later call of the same tool in the run. Checkmate stores the rule in the record of the run.
4. `Always allow this command in this project`. Shows only when Claude Code suggests a rule. Claude Code writes the rule to `.claude/settings.local.json`. Checkmate writes no settings file.
5. `Deny…`. Opens a field for the reason. The reason is required, and the tester gets it.
6. `Stop tester <name>…`. For a step that is not a tester, `Stop the run…`. A dialog asks first.

The number keys act in the record. The rules of the run show under the options, for example `Allowed for this test: every Bash call, set by dawid 2 min ago`, and in the Testers view under the banner.

After an answer, the next open request opens in the same view. When no request is open, you return to where you came from, and a message names the answer. When another session or a rule answered the request, or when it closed (time-out, tester stopped, UI restarted), the record says so in plain words and has no options. It moves on after 2 seconds, or at any key.

**Many requests.** Select rows with their boxes, `Space`, or `Shift` `↑` `↓`. The strip offers `Allow once (<n>)` and `Deny… (<n>)`. Each asks first and names the count. Deny asks for one reason for all. A bulk answer makes no rule. A request that has an answer already is skipped, and the message says so.

**History.** The Testers view of a run has the fold `Permission requests (<n>)`. It lists each request and its answer, who answered, and when, newest first, 20 for each page. `↓` on the last row opens the next page. `Enter` opens the record, which does not move on.

A rule for this test answers the same request of every other tester of the run at once. The record shows `allowed by rule <rule>, set by <name>`. A rule of one run does not apply to another run. A request with no answer in 10 minutes closes, and the call is denied. A request also closes when the tester or the run stops, and when the UI stops. A request of a run or of a request that has ended gets an empty answer and does not show: Claude Code denies the call. The same answers are in `checkmate explore permit`. Each request and each answer is an event of the exploration, so the record shows who decided what.

`/permissions` opens the first open request, or `Activity` when none is open.

A request of the find bar asks in the same way. Its record says `Request R3 asks to run a command`. The options are the same six. `for this test` reads `for this conversation`. A rule lasts for the later requests of the same conversation, and ends when you start a new conversation. `Stop the request…` stops the request. A request has no `Run` in its details: it shows `Request` with a link.

### Requests

A request is a free-form task for Claude Code, for example `why does D3 fail?` or `hand over all high defects`. Press `/`, type the text, and choose the last row, `Ask Checkmate: <text>`. `Enter` sends it. The bar shows `Asking… R3`, and `Enter` does nothing more until you close the bar. `Esc` closes the bar, and the request goes on. The find bar says that asking starts Claude Code on this computer.

The request runs in your own Claude Code, in the workspace folder. It has your login, your settings, and all your tools. Checkmate removes no tool and sets no model, unless you set `Model for requests` in Settings. A tool that needs an approval asks you in the UI, as a tester does. The request also gets the Checkmate plugin of the UI, and a short instruction: the reply shows in a narrow pane, and records change with the `checkmate` command. The text of the request goes to Claude Code. When a plan or a record was on screen, one more line follows it: `For context only: the person had plan checkout and question a1/Q1 on screen. Use this only when the request refers to it.` Nothing that you type goes on a command line.

One request runs at a time. A second request waits and starts when the first ends. All requests of a workspace share one conversation, so a later request knows the earlier ones. `New conversation` starts a new one.

- **The request page.** `/requests/<R>` shows your question and its context. While the request runs, it shows the lines of activity as they come, the newest last, the time that passed, and `1 Stop the request…`. A dialog asks first. When a permission request of the request is open, the page says `This request waits for you: a permission request` and links to it. When the request ended, the page shows the reply as plain paragraphs and lists, the cost, the time it took, the records that the request changed (each is a link), and the tool calls that Claude Code denied. The options are `1 Ask a follow-up` (the find bar, in ask mode), `2 Ask again` (the same text, a new request), and `3 New conversation`. A request that failed shows the reason and `1 Ask again`. Opening a reply marks it read. Text from the model is always shown as text, never as HTML.
- **Replies.** `/requests` lists the requests. The requests that you did not read come first, then the others, newest first. A row has the state, the ID, the first line of the question, the first line of the reply, who asked, when, and the cost. `→` opens the request. `←` and Back return to the list. The list pages like `Log`.
- **The status bar.** `Request R3 · running` opens the running request. `1 reply` opens the reply, and `<n> replies` opens the list.
- **Activity.** The list shows requests next to the runs, with their state and cost.
- **Stop.** `Stop the request…` sends `SIGINT` to Claude Code. After 5 seconds it sends `SIGTERM`, and after 1.5 more seconds `SIGKILL`. The state is `stopped`, and the conversation goes on with the next request. When the UI stops, the running request ends in the same way with the state `interrupted`. A request that waits when the UI stops is `interrupted` too.

The states are `waiting`, `running`, `answered`, `failed`, `stopped`, and `interrupted`. A request fails when Claude Code is not found, is not signed in, prints a line that is not JSON, or ends without a reply. The page gives the sentence and the last 20 lines of the messages of Claude Code.

Checkmate sets `CHECKMATE_REQUEST=R3` for Claude Code. Each write of the `checkmate` command stores `R3` in `operations.via`, also when the session gives its own `--actor`. Without `--actor`, the actor is `<your name> via request R3`. The Log shows `via request R3` on these rows, and the link opens the request. While the request runs, the page says `Changes show when the request ends.` When the request ends, the page lists the operations with `via` `R3`, for example `handed over a1/D1, a1/D2` and `answered a1/Q4`. The page says `The request changed no record.` only when the Log has no operation with `via` `R3`. A request that you stop shows its lines of activity and the changes that it made before the stop.

An activity line of a request or a tester shows the tool and the first line of its main input, at most 120 characters. For a shell command, the line drops a leading `cd <path> &&` or `cd <path>;` and the leading variable assignments. A command that runs the Checkmate command line, also through a variable, shows as `checkmate <arguments>`. The path of the workspace shows as `.`. Checkmate masks secrets. The permission record shows the full command.

### Plan

`Plan @<revision>` opens the plan document, `/plans/<planId>@<revision>`. It shows the approval, the loop state, the one next step, and the sections `Overview`, `Claims`, `Questions`, `Explorations`, `Tests`, `Runs`, and `History`. A section opens by itself when it needs you. Approve or reject the revision in the panel. `Export` downloads the plan as HTML, Markdown, or JSON. A plan without a revision shows its request at `/plans/<planId>/request`.

`Edit plan` opens the editor. It has forms for the rules, tests, assertions, and coverage. `Edit as JSON` adds or removes items. Only the latest revision can change, and the rules of `plan edit` apply. To remove a test, click `Remove <testId>` on the test, write the reason, then click `Remove <testId>` again. The rules that the tester derived for a plan without a revision change only with `checkmate plan edit <planId> --patch`.

### Run

`/runs/<runId>` lists the overview, the tests, the findings, the new gaps, the coverage, and the cleanup of a run. Open a row to show it below the list. The overview has the outcome counts, the assertions that did not pass, the result decision, and `Download report` (HTML, Markdown, JSON, or JUnit XML). Each new gap that the plan does not have yet has `Answer` and `Bring into plan`.

### Runs and Log

The run list and the operation log. They page, sort, and filter. The address keeps the list state.

### Settings

`Settings` in the status bar opens `Targets`. `Claude Code` shows the path of `claude`, or says that no `claude` is on `PATH`. It also shows the default model alias of each test level. The page makes no call to Claude Code. The host wins: a test that you start from a shell with `--claude-arg --model --claude-arg <model>` uses that model. A test that you start in the UI uses the alias of its level.

`Requests` has `Model for requests`, an alias or an ID that Claude Code gets with `--model`. Empty means the model that Claude Code chooses by itself, and is the default. It also says when the conversation started and how many requests it has, and has `New conversation`.

`Tool rules of testers` has the rules that the `Test build…` dialog and the new-change form start with. A rule lets a tester use a tool without asking you, for example `Read` or `Bash`. Write one rule for each word. The engine needs at least one rule today. Checkmate keeps the setting in the record, with the name and the time of the change, and the Log shows it as `setting set`. With the rule `Bash`, testers run commands without asking. Without it, each command asks you in the UI, and a tester waits up to 10 minutes for the answer. The page also says whether testers that start now can ask you for a permission in the UI. They can when `.checkmate/ui.json` names a UI that runs.

`Targets`. A target page shows the entry points, the instances, the tools, the profile, and the revision history.

- **Add instance.** Give an instance ID and a value for each entry point. Adding an instance needs no new revision and no approval.
- **Retire.** Click `Retire` on the instance row, then `Confirm retire`. No new run can start on a retired instance.

Each change records your name and shows in the Log.

## How a decision works

1. Type a rationale. The action button stays disabled until the rationale has text.
2. Click the action, for example `Approve checkout@2`. The panel shows a short summary and a `Confirm` button.
3. Click `Confirm`. The UI records the decision and opens `Needs you`.

Each form sends the digest of the snapshot that you see. A decision form also sends a token of the latest decision on the subject. When the record changed after the page loaded, the UI refuses the action, keeps your text, and shows a message.

- When another oracle decided after the page loaded, the message names the decision and the actor, for example `run-7 was accepted by qa-lead`. Your decision is not recorded. Read the decision, then send yours again.
- A form that you send a second time, for example after Back in the browser, is refused in the same way. The UI records each decision once.
- When the plan changed after you opened the editor, the editor shows the latest version. `Your changes (not saved)` lists the values from your form that differ from it. Apply them again, then save.
- A form with more than 256 KiB of text is refused with the status 413. Nothing is recorded.

## Back

`←` and `Esc` go back one level: from the evidence to the record, from the record to the list, from the list to the navigator, and from the navigator to the plans. Back in the browser does the same, and Forward goes one level deeper again.

## Your name

Each decision records an actor. The UI fills in the same default as the commands. The top bar shows your name. Click it to change the name. The UI keeps the new name in a cookie.

## Live updates

Each page updates when another process writes to the record, for example a delegated worker. The top bar shows `Live` while the connection is open. A form with your typed text, a field that has the focus, an open dialog, and a form that shows a refusal are never replaced. A key that you press while an update is on its way acts on the row that has the highlight when you press it. An update keeps the highlight, the focus, and the position on the screen of the row that you work on. When a dialog closes and the row that had the focus is new, the highlighted row takes the focus. An update that comes while the page sends a form, or leaves for another page, is dropped. When somebody decides the item that you have open, a notice shows above the form at once, and your text stays. When the UI starts again, the page connects again by itself and gets a new form token, so you can send the form without loading the page again. Without JavaScript, the pages still work, and a reload shows the current state. Click the title of a row to open its record.

## Keyboard

One table drives the keys, the hints in the status bar, and the list that `?` shows. The UI has no letter keys.

| Key             | Action                                                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `↑` `↓`         | Move the highlight through the rows where you are: the plans, the navigator, the records, the files. On a page without rows, scroll the page.                                                   |
| `→` `Enter`     | Go one step deeper: open the plan, enter the list, open the record, view the file. An area of rules opens.                                                                                      |
| `←` `Esc`       | Go one step back. An area closes. `Esc` first clears a selection.                                                                                                                               |
| `1` … `9`       | Choose an option of the highlighted record, numbered from left to right as shown. On a rule or an area, choose a build column. In a dialog, choose the level or a button that shows its number. |
| `Space`         | Select or clear the highlighted record. On a page without records, scroll the page.                                                                                                             |
| `Shift` `↑` `↓` | Select the records on the way from the highlighted record. `Shift` `↑` after `Shift` `↓` makes the range smaller.                                                                               |
| `0`             | Undo the last hand-over while its note shows. At other times `0` does nothing.                                                                                                                  |
| `/` `Ctrl` `K`  | Find a plan, a defect, or a question, or ask Checkmate.                                                                                                                                         |
| `?`             | Show the keys.                                                                                                                                                                                  |

In a text field, typing types. `Enter` sends a one-line answer, a reason, or a name. `Shift` `Enter` starts a new line. `Ctrl` `Enter` sends a larger form, for example a decision on the plan page. `Esc` leaves the field and keeps the text. A number key acts on the row that has the highlight when you press it.

Typed text is not lost. When you leave a record or a page with text in a field, the browser keeps the text as a draft. When you come back, the field shows the text and the note `Draft kept.` The plan editor asks before it goes back with changes that are not saved: `Keep editing` or `Leave and lose the changes`. A save without changes records no revision.

`↑` on the first row of a list moves to its action row, for example `Test build…`. `→` and `←` move between the actions, `Enter` chooses one, and `↓` or `Esc` returns to the list. When a list has no row, `→` on its name in the navigator moves to the action row.

The first-run form and the new-change form follow the same keys. `↑` and `↓` move between the fields and the buttons. In a field with more than one line, `↑` and `↓` first move the caret to the first or the last line. On a choice, press `1` or `2` (or `3`) to choose an option. `Esc` leaves a field and keeps the text. `Esc` again goes back one level. `Enter` in a field of one line sends the form.

In a dialog with fields, `↑` and `↓` move between the fields and the buttons. `Esc` leaves a field and keeps the text. `Esc` again closes the dialog. `Enter` sends. A refusal shows inside the dialog, and the focus stays on the field. The refusal goes away when you change that field. A field that you leave empty shows a sentence of Checkmate at the field, not the message of the browser. When you close the dialog, the focus returns to where it came from. `Back` in the browser closes the dialog.

In a list with pages, for example `Log`, `↓` on the last row opens the next page, and `↑` on the first row opens the previous page. The status bar shows the page, for example `Log · page 2 of 7`. `←` goes to the first page.

The browser Back button acts as `←`. When the find bar, the key list, or a dialog is open, Back closes it. When an area is open in the navigator, Back closes the area.

When you print a record, the page shows only the record, in dark text on white.

Each action also works with the mouse. `Tab` moves between the regions.

## Next

- [Decide as the oracle](oracle.md): what each decision does.
- [The record](../reference/record.md#review-ui): how the UI reads and protects the record.
