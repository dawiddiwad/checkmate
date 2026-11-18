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
checkmate ui [--workspace <path>] [--port <n>]
```

The command prints `completed ui url=<url>`. Open that URL in a browser on the same computer. The UI listens on `127.0.0.1` only. It runs until you stop it with Ctrl+C. The plugin contains the UI, so you do not need npm.

## The layout

Each page has the same four parts:

- The top bar: `Checkmate` opens the home page. At the right are the live state, your name, and the switch for light and dark.
- The navigator, at the left on the pages of a plan.
- The centre: the list or the page.
- The status bar, at the bottom. It shows the path to where you are, for example `Plans › checkout › Needs you › a1/D1`, the buttons `Find`, `Keys`, `Activity`, `Runs`, `Log`, and `Settings`, and the keys that work where you are. `Activity` shows `Activity · <n> running` while <n> tests run. On a narrow window, `More` holds `Activity`, `Runs`, `Log`, and `Settings`. On a window of 600 pixels or less, `More` also holds `Find`. When items wait for you, `<n> need you · all plans` shows first. It counts the items of all plans. When the keys do not fit, the status bar removes the least important keys first. `? Keys` always shows. A message in the status bar comes before the keys: the keys make room for it, and a message that still does not fit shows in full in a strip above the status bar.

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
- `Outside the rules`: items that concern no rule of the plan.
- One row for each build, `B1`, `B2`, and so on, in the order in which the plan tested them.
- `Rules of the plan`, then `Plan @<revision>` (or `Plan request` for a plan without a revision).

The centre shows the items of the highlighted row. The items are in groups: `Is this a defect?` (the findings that are `suspected` or `unresolved`), `Questions that block testing`, `Approvals`, the other questions by topic, the defects by severity, `Answered questions`, and `Rejected findings`. An area shows the items of all its rules, grouped by rule. A rule shows its state on each build. Click a mark of a rule or an area, or press its number, to show only the items of that build.

Each row shows a box for the selection, a badge, the ID, the title, and a short note, for example `Returned · ×3`. The highlighted row also shows its options, numbered from left to right:

- A finding: `1 Yes, a defect` accepts it at once. `2 No` opens a field for the reason. A reject needs a reason.
- A question or a gap: `1 Right` records that the build is right as it is (`accept_assumption`, with the text of what the build does). `2 Different` opens a field for how it should be (`clarify`). `3 Later` defers it. A deferred question shows `Deferred` and keeps `1 Right` and `2 Different`, so you can answer it later.
- A defect: `1 Hand over` opens a field for the name of the person or team that takes it. `1 Undo hand-over` removes the hand-over.

After a decision, the next item that waits for you takes the highlight. When you decide inside a record, the next record that waits opens. A hand-over keeps the highlight on its record. The address keeps the view and the row, for example `/plans/checkout?view=all&at=c:a1/D1&focus=list`, so a reload or a copied link shows the same place. When somebody decides the highlighted item in another session, the item goes from the list, the next row takes the highlight, and the status bar says, for example, `k1/Q8 was answered in another session`. The next number key records nothing and says so, because you did not choose the new row. Press the number again to act on it.

### Act on several records

Select rows with their boxes, with `Space`, or with `Shift` `↑` `↓`. A strip directly above the status bar shows the number of selected rows and the actions that apply to them, numbered: `Accept <n> findings as defects`, `<n> questions right as built`, `Defer <n> questions`, `Hand over <n> defects`, and `Clear the selection` last. While rows are selected, the number keys act on the selection. Each action on more than one record asks first and names the count. `Enter` or `1` confirms. `Esc` or `←` cancels and keeps the selection. The selection clears when the action is complete. The strip and the notes after an action never cover a row: while they show, the navigator and the list end above them. A hand-over shows a note with `0 Undo` for some seconds. Press `0` or click `Undo` to remove the hand-over. The other decisions have no undo in Checkmate.

### Find

`/`, `Ctrl` `K`, or `Find` in the status bar opens the find bar. Type words to find plans, claims, and questions of all plans that contain each word. The bar shows the first 12 results and the number of other results. `↑` and `↓` move in the results, `Enter` opens the highlighted result and does nothing while the query is empty, `←` and `→` move the caret, and `Esc` closes the bar.

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
- The instance `local`, the entry point `web`, the capabilities, the operations, `reset=none`, and `authentication=none`, each as one line of text.

`Testers may change data` is the choice `--operations`. `Yes` lets the testers do any action that the application offers to a test user. `No` limits the testers to reading. For a local address (`localhost`, a loopback address, or a private range) the choice starts as `Yes`. For another address the choice has no start value. Choose `Yes` or `No`. When you set up a target on an address that is not local, a dialog asks once more and names the address.

Press `Enter` to set up the target. The new-change form opens. When the application does not answer, the form shows the sentence of the engine at the address field, and keeps your text. The form sets up the target with the same function as `checkmate setup`.

`New target` in the new-change form opens the same form. `Esc` goes back to the new-change form and keeps your draft.

**New change.** The form has these fields:

- `Ticket file`: the path of a file inside the workspace. The form refuses a path outside the workspace, a file that does not exist, and a folder.
- `Ticket text`: the text of the ticket, when you have no file. Fill in the file or the text, not both. Checkmate saves the text in `.checkmate/sources/<plan>.md` and gives that path to the plan as its source. Checkmate creates no file outside `.checkmate/`.
- `Name of the plan`. Checkmate gives a name from the file name, or from the first line of the text, as the product makes the ID of a target. You can change it. The form refuses a name of a plan that exists.
- `Target`. The form shows the choice only when the record has more than one target.
- `Build`, `Level`, and `Testers may use without asking`, as in the `Test build…` dialog.
- `More`: `Since`, `Until`, and `Repository folder`.

Press `Enter` to make the plan and start the test with the same function as `checkmate test <plan> --source <file>`. The Testers view of the new test opens. Each refusal shows at its field, and the form keeps your text. When the target is on an address that is not local, a dialog asks first.

A form keeps your text as a draft. It stays when you press `Esc`, reload the page, or leave for `New target`.

### Start a test

`Test build…` is in the action row of each view of a plan. The row shows an action only when the action applies. `Test build…` does not show while a test of the plan runs.

1. Choose `Test build…`. A dialog opens.
2. Write the build name. The field has the name that `checkmate test` gives when you give no `--build`: the short git commit, or the date and time in UTC.
3. Choose the level: `smoke`, `normal`, or `deep`. `normal` is the first choice. Press `1`, `2`, or `3` to choose a level.
4. Check `Testers may use without asking`. The field has the tool rules of the testers, one rule for each word, as in `checkmate test --allow`, for example `Read Bash`. It starts with the rules of the workspace setting `Tool rules of testers` (see [Settings](#settings)). The engine needs at least one rule today. A tester cannot answer a permission prompt, so a tool without a rule is not usable.
5. Open `More` to give `Since`, `Until`, and `Repository folder`. Without `Since`, the UI uses the default branch of `origin`, as `checkmate test` does.
6. Press `Enter`. The Testers view of the new test opens.

The UI starts the testers as new Claude Code processes with the rules of the field. The follow-up of a test uses the rules of that test. The test runs without the UI: closing the UI does not stop it. The UI starts a test only when no test of the plan is in progress. When one is in progress, the dialog stays open, names the running test, and links to it.

When the engine refuses the start, the dialog shows the reason in a sentence at the field, and keeps your text. An empty rules field shows the refusal of the engine at that field. For example, when `claude` is not on `PATH`, the dialog says so and gives the next step.

`Test the answers (<n>)…` shows when the last test of the plan is completed and <n> answers of the product owner are not tested yet. A dialog names the count. Press `Enter` or `1` to start the follow-up.

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

### Plan

`Plan @<revision>` opens the plan document, `/plans/<planId>@<revision>`. It shows the approval, the loop state, the one next step, and the sections `Overview`, `Claims`, `Questions`, `Explorations`, `Tests`, `Runs`, and `History`. A section opens by itself when it needs you. Approve or reject the revision in the panel. `Export` downloads the plan as HTML, Markdown, or JSON. A plan without a revision shows its request at `/plans/<planId>/request`.

`Edit plan` opens the editor. It has forms for the rules, tests, assertions, and coverage. `Edit as JSON` adds or removes items. Only the latest revision can change, and the rules of `plan edit` apply. To remove a test, click `Remove <testId>` on the test, write the reason, then click `Remove <testId>` again. The rules that the tester derived for a plan without a revision change only with `checkmate plan edit <planId> --patch`.

### Run

`/runs/<runId>` lists the overview, the tests, the findings, the new gaps, the coverage, and the cleanup of a run. Open a row to show it below the list. The overview has the outcome counts, the assertions that did not pass, the result decision, and `Download report` (HTML, Markdown, JSON, or JUnit XML). Each new gap that the plan does not have yet has `Answer` and `Bring into plan`.

### Runs and Log

The run list and the operation log. They page, sort, and filter. The address keeps the list state.

### Settings

`Settings` in the status bar opens `Targets`. `Claude Code` shows the path of `claude`, or says that no `claude` is on `PATH`. It also shows the default model alias of each test level. The page makes no call to Claude Code. The host wins: a test that you start from a shell with `--claude-arg --model --claude-arg <model>` uses that model. A test that you start in the UI uses the alias of its level.

`Tool rules of testers` has the rules that the `Test build…` dialog and the new-change form start with. A rule lets a tester use a tool without asking you, for example `Read` or `Bash`. Write one rule for each word. The engine needs at least one rule today. Checkmate keeps the setting in the record, with the name and the time of the change, and the Log shows it as `setting set`.

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

Each page updates when another process writes to the record, for example a delegated worker. The top bar shows `Live` while the connection is open. A form with your typed text is never replaced. When somebody decides the item that you have open, a notice shows above the form at once, and your text stays. When the UI starts again, the page connects again by itself and gets a new form token, so you can send the form without loading the page again. Without JavaScript, the pages still work, and a reload shows the current state. Click the title of a row to open its record.

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
| `/` `Ctrl` `K`  | Find a plan, a defect, or a question.                                                                                                                                                           |
| `?`             | Show the keys.                                                                                                                                                                                  |

In a text field, typing types. `Enter` sends a one-line answer, a reason, or a name. `Shift` `Enter` starts a new line. `Ctrl` `Enter` sends a larger form, for example a decision on the plan page. `Esc` leaves the field and keeps the text. A number key acts on the row that has the highlight when you press it.

Typed text is not lost. When you leave a record or a page with text in a field, the browser keeps the text as a draft. When you come back, the field shows the text and the note `Draft kept.` The plan editor asks before it goes back with changes that are not saved: `Keep editing` or `Leave and lose the changes`. A save without changes records no revision.

`↑` on the first row of a list moves to its action row, for example `Test build…`. `→` and `←` move between the actions, `Enter` chooses one, and `↓` or `Esc` returns to the list. When a list has no row, `→` on its name in the navigator moves to the action row.

The first-run form and the new-change form follow the same keys. `↑` and `↓` move between the fields and the buttons. In a field with more than one line, `↑` and `↓` first move the caret to the first or the last line. On a choice, press `1` or `2` (or `3`) to choose an option. `Esc` leaves a field and keeps the text. `Esc` again goes back one level. `Enter` in a field of one line sends the form.

In a dialog with fields, `↑` and `↓` move between the fields and the buttons. `Esc` leaves a field and keeps the text. `Esc` again closes the dialog. `Enter` sends. A refusal shows inside the dialog, and the focus stays on the field. When you close the dialog, the focus returns to where it came from. `Back` in the browser closes the dialog.

In a list with pages, for example `Log`, `↓` on the last row opens the next page, and `↑` on the first row opens the previous page. The status bar shows the page, for example `Log · page 2 of 7`. `←` goes to the first page.

The browser Back button acts as `←`. When the find bar, the key list, or a dialog is open, Back closes it. When an area is open in the navigator, Back closes the area.

When you print a record, the page shows only the record, in dark text on white.

Each action also works with the mouse. `Tab` moves between the regions.

## Next

- [Decide as the oracle](oracle.md): what each decision does.
- [The record](../reference/record.md#review-ui): how the UI reads and protects the record.
