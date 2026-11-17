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
- The status bar, at the bottom. It shows the path to where you are, for example `Plans › checkout › Needs you › a1/D1`, the buttons `Find`, `Keys`, `Runs`, `Log`, and `Settings`, and the keys that work where you are. On a narrow window, `More` holds `Runs`, `Log`, and `Settings`. On a window of 600 pixels or less, `More` also holds `Find`. When items wait for you, `<n> need you · all plans` shows first. It counts the items of all plans. When the keys do not fit, the status bar removes the least important keys first. `? Keys` always shows.

On a window of 900 pixels or less, the navigator is one row of chips above the list. On a window of 760 pixels or less, each row has two lines: the badge, the ID, and the title, then the short note. On the highlighted row, its options replace the note. The rows do not change height when the highlight moves. On a window of 760 pixels or less, a record covers the list, and each button is at least 40 pixels high. The status bar keeps the last level of the path, `Find`, `Keys`, and `More`.

The UI follows the light or dark setting of the system. The switch in the top bar overrides it, and the UI keeps your choice in a cookie.

When a page or a list has nothing to show, it says what is empty and gives the one next step.

## Pages

### Plans

The home page, `/`. It shows one row for each plan: the plan ID, the [loop state](../reference/commands.md#loop-states) and the role that it waits on, the latest build, the objective, one sentence about the latest build, a small map of the rules against the last two builds, and the counts of defects, findings to look at, open questions, and defects handed over. Option `1` opens the step that waits for you, for example `Answer 4 blocking questions`. The plans that wait for you are first, and the plan with the most recent activity is first among them. The other plans follow. Click a row, or press `→` or `Enter`, to open the plan. When you go back from a plan, the home page highlights that plan.

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
- A question or a gap: `1 Right` records that the build is right as it is (`accept_assumption`, with the text of what the build does). `2 Different` opens a field for how it should be (`clarify`). `3 Later` defers it. A deferred question shows `Deferred`.
- A defect: `1 Hand over` opens a field for the name of the person or team that takes it. `1 Undo hand-over` removes the hand-over.

After a decision, the next item that waits for you takes the highlight. The address keeps the view and the row, for example `/plans/checkout?view=all&at=c:a1/D1&focus=list`, so a reload or a copied link shows the same place. When somebody decides the highlighted item in another session, the item goes from the list, the next row takes the highlight, and the status bar says, for example, `k1/Q8 was answered in another session`.

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

### Testers

`/explorations/<explorationId>` is the live view of one session. It updates by itself while the session runs. It shows:

- The state of the session, its build, instance, level, and phases.
- One row for each tester, with its state (`Given to the session`, `Running`, `Paused`, `Finished`, or `Failed`), its last activity line, its step, and the time in that state. The time counts up while the tester runs.
- `After the testers`: `record`, `merge`, `verify`, and `follow-up`, with their states and reasons.
- The other sessions of the plan.

Below the list is the overview of the session, or the tester or phase that you open: `Not merged yet`, the merged claims and questions, the saved files, and `Download report`. A paused session waits for you in the Claude Code session, not in the UI. A failed session shows its reason, the kept work folder `.checkmate/work/<explorationId>`, and the log. `Not merged yet` items are the raw questions and defects of single testers. They can change before the session is completed. `Needs you` does not show them.

### Plan

`Plan @<revision>` opens the plan document, `/plans/<planId>@<revision>`. It shows the approval, the loop state, the one next step, and the sections `Overview`, `Claims`, `Questions`, `Explorations`, `Tests`, `Runs`, and `History`. A section opens by itself when it needs you. Approve or reject the revision in the panel. `Export` downloads the plan as HTML, Markdown, or JSON. A plan without a revision shows its request at `/plans/<planId>/request`.

`Edit plan` opens the editor. It has forms for the rules, tests, assertions, and coverage. `Edit as JSON` adds or removes items. Only the latest revision can change, and the rules of `plan edit` apply. To remove a test, click `Remove <testId>` on the test, write the reason, then click `Remove <testId>` again. The rules that the tester derived for a plan without a revision change only with `checkmate plan edit <planId> --patch`.

### Run

`/runs/<runId>` lists the overview, the tests, the findings, the new gaps, the coverage, and the cleanup of a run. Open a row to show it below the list. The overview has the outcome counts, the assertions that did not pass, the result decision, and `Download report` (HTML, Markdown, JSON, or JUnit XML). Each new gap that the plan does not have yet has `Answer` and `Bring into plan`.

### Runs and Log

The run list and the operation log. They page, sort, and filter. The address keeps the list state.

### Settings

`Settings` in the status bar opens `Targets`. A target page shows the entry points, the instances, the tools, the profile, and the revision history.

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

| Key             | Action                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `↑` `↓`         | Move the highlight through the rows where you are: the plans, the navigator, the records, the files. On a page without rows, scroll the page. |
| `→` `Enter`     | Go one step deeper: open the plan, enter the list, open the record, view the file. An area of rules opens.                                    |
| `←` `Esc`       | Go one step back. An area closes. `Esc` first clears a selection.                                                                             |
| `1` … `9`       | Choose an option of the highlighted record, numbered from left to right as shown. On a rule or an area, choose a build column.                |
| `Space`         | Select or clear the highlighted record. On a page without records, scroll the page.                                                           |
| `Shift` `↑` `↓` | Select the records on the way from the highlighted record. `Shift` `↑` after `Shift` `↓` makes the range smaller.                             |
| `0`             | Undo the last hand-over while its note shows. At other times `0` does nothing.                                                                |
| `/` `Ctrl` `K`  | Find a plan, a defect, or a question.                                                                                                         |
| `?`             | Show the keys.                                                                                                                                |

In a text field, typing types. `Enter` sends a one-line answer, a reason, or a name. `Shift` `Enter` starts a new line. `Ctrl` `Enter` sends a larger form, for example a decision on the plan page. `Esc` leaves the field and keeps the text. A number key acts on the row that has the highlight when you press it.

Each action also works with the mouse. `Tab` moves between the regions.

## Next

- [Decide as the oracle](oracle.md): what each decision does.
- [The record](../reference/record.md#review-ui): how the UI reads and protects the record.
