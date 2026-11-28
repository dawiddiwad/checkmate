# The Scoresheet design system

The Scoresheet (A) is the design system of the Checkmate review UI. Its values are in `plugin/src/ui/tokens.css`. Each component has its stylesheet in `plugin/src/ui/components/`. The classes start with `sc-`.

## Idea

A chess scoresheet records every move in plain ink. Only one move is yours to play. The UI is a calm, exact record of what the testers did, with one clear mark for what needs a person.

## Rules

1. **One colour means "you".** Use `--signal` only for what waits on a person. Use `--pass` only for passed and accepted. Everything else is ink.
2. **Words in sans, data in mono.** Use IBM Plex Sans for words. Use IBM Plex Mono for IDs, counts, builds, paths, times, and keys.
3. **Shape before colour.** Every status has its own mark (`sc-mark`). It reads in grey, in dark mode, and for colour-blind people.
4. **One primary action per view.** Fill the next move: `sc-btn is-you` when it unblocks testing, `sc-btn is-primary` in other cases. Other actions are outlined or quiet.
5. **Quiet selection.** The selected row (`is-sel`) gets `--surface-2` and a 3 px `--ink` bar. The row that is open in the drawer (`is-open`) gets a 1 px `--ink` outline. A row that blocks testing (`is-block`) keeps a 3 px `--signal` bar. In the nav rail, the current view gets the 3 px `--ink` bar and the selected row gets `--surface-2`.
6. **Square and flat.** Corners are 0. Depth is a 1 px `--hair` line. There are no shadows.
7. **Say less.** Use sentence case. Show the number first, then the word. Only the brand word and keys are uppercase.
8. **One bar, at the bottom.** The status bar (`sc-bar`) is the only bar.
9. **Gaps, not margins.** A container sets the space between its children with `gap`. Components have no outer margin. Use 8 px from a label to its control and help, 12 px from a section heading to its content, 16 px between fields, and 24 px between sections. The main area has 32 px padding.
10. **Most urgent first.** Lists put what blocks testing first, then findings and defects by severity, then approvals and open questions. Answered, deferred, and rejected items come last.

## Tokens

`plugin/src/ui/tokens.css` is the only place for colour, space, size, and font values. Two light values are darker than in the Scoresheet files so that every text and control border meets the contrast rules: `--signal` is `#be400c` (the files give `#c2410c`, 4.46:1 on `--surface-2`) and `--edge` is `#85888d` (the files give `#8c8f94`, 2.97:1 on `--surface` and 2.79:1 on `--surface-2`). `npm run lint:check` fails on a raw colour in another stylesheet. It also fails on a raw length in `gap`, `padding`, or `margin`. Use a `--space` token there. Light values are in `:root`. Dark values are in `:root[data-theme='dark']` and in the `prefers-color-scheme` block, with the same names.

| Group      | Tokens                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| Ground     | `--ground`, `--surface`, `--surface-2`, `--row-hover`                                                   |
| Text       | `--ink`, `--muted`, `--on-ink`                                                                          |
| Lines      | `--hair`, `--edge`, `--edge-soft`                                                                       |
| Needs you  | `--signal`, `--signal-soft`, `--on-signal`                                                              |
| Result     | `--pass`, `--pass-soft`, `--on-pass`, `--fail`, `--fail-soft`                                           |
| Focus      | `--focus`                                                                                               |
| Overlay    | `--scrim`                                                                                               |
| Space      | `--space-1` (4 px) to `--space-8` (64 px)                                                               |
| Size       | `--bar-h`, `--ctl`, `--ctl-lg`, `--row-h`, `--rail-w`, `--drawer-w`, `--mark`, `--cell-sm`, `--cell-lg` |
| Line width | `--hairline`, `--rule`, `--bar`, `--stroke`, `--focus-w`, `--focus-gap`                                 |
| Font       | `--font-sans`, `--font-mono`                                                                            |

The UI loads IBM Plex Sans and IBM Plex Mono from Google Fonts. The font stacks fall back to system fonts, so the UI still renders offline.

## Breakpoints

A stylesheet uses two viewport widths in `@media`: 760 px and 900 px. At 900 px and narrower, the nav rail is above the main area. At 760 px and narrower, the components use their narrow layout. `npm run lint:check` fails on another width.

Four components have their own width, because their content stops fitting there: the chat workspace (850 px), the drawer (1200 px), the plan tile (1279 px), and the status bar (1240 px and 400 px). Use a container query when a component depends on the width of its container.

`scripts/check-styles.ts` has the lists of the known exceptions: `componentBreakpoints` for the widths, and `offScaleSpacing` for the 42 spacing values that are not on the space scale (2, 6, 10, 20, and 28 px). Do not add an entry for new work. Remove an entry when you move its value to a token. The check fails on an entry that no stylesheet has.

## Status language

| State                | Class                 | Word                   |
| -------------------- | --------------------- | ---------------------- |
| Testing, running     | `sc-mark is-run`      | Testing                |
| Passed, accepted     | `sc-mark is-pass`     | Passed, Accepted       |
| Failed, defect       | `sc-mark is-fail`     | Failed, Defect         |
| Blocks, waits on you | `sc-mark is-you`      | Blocks, Needs approval |
| Approve              | `sc-mark is-approve`  | Approve                |
| Finding, triage      | `sc-mark is-triage`   | Finding, Needs triage  |
| Question, open       | `sc-mark is-question` | Question, Open         |
| Not run              | `sc-mark is-none`     | Not run                |
| Stopped, interrupted | `sc-mark is-stop`     | Stopped                |
| Critical             | `sc-mark is-crit`     | Critical               |

Board cells: `sc-cell k-pass`, `k-fail` (×), `k-run` (hatch), `k-q` (?), and `k-none`.

## Components

Each component is one function in `plugin/src/ui/components/<name>.ts`, with its rules in `<name>.css` and its catalogue examples in `<name>.catalogue.ts`.

| Component      | Function                                       | Classes                                       |
| -------------- | ---------------------------------------------- | --------------------------------------------- |
| Status mark    | `statusMark`, `wordMark`, `statusCounts`       | `sc-mark is-*`, `sc-word`                     |
| Board          | `boardCell`, `board`, `boardKey`, `resultCell` | `sc-cell k-*`, `sc-plan-board`, `sc-legend`   |
| Button         | `button`, `optionButton`, `formButton`         | `sc-btn`, `is-primary`, `is-you`, `is-lg`     |
| Key            | `key`                                          | `sc-key`, `sc-key-hint`                       |
| List row       | `listRow`, `groupHeader`, `listPageRow`        | `sc-list`, `sc-row`, `sc-group-h`             |
| Plan tile      | `planTile`, `newChangeTile`                    | `sc-plans`, `sc-plan`                         |
| Metric         | `metrics`                                      | `sc-metrics`, `sc-metric is-hot`              |
| Banner         | `blockingBanner`                               | `sc-banner`                                   |
| Notice         | `notice`                                       | `sc-notice is-error`                          |
| Nav rail       | `navRail`, `railRow`                           | `sc-rail`                                     |
| Status bar     | `statusBar`                                    | `sc-bar`                                      |
| Brand          | `brand`                                        | `sc-brand`                                    |
| Drawer         | `drawer`, `drawerHead`                         | `sc-drawer`, `sc-opts`                        |
| Page heading   | `heading`, `crumbBar`                          | `sc-h`, `sc-h-meta`, `sc-h-act`, `sc-crumb`   |
| Facts          | `facts`, `recordFacts`                         | `sc-facts`                                    |
| Field          | `field`, `textInput`, `textArea`               | `sc-field`, `sc-label`, `sc-input`, `sc-help` |
| Radio group    | `radioGroup`                                   | `sc-radios`, `sc-radio`                       |
| Data table     | `dataTable`, `tableRow`                        | `sc-table`, `sc-table-wrap`                   |
| Tabs           | `pageTabs`, `jumpLinks`                        | `sc-tabs`, `sc-tab`                           |
| Fold           | `fold`                                         | `sc-fold`                                     |
| Empty state    | `emptyNotice`, `emptyLine`                     | `sc-empty`                                    |
| Menu           | `downloadMenu`                                 | `menu`, `sc-btn`                              |
| Find palette   | `findPalette`                                  | `sc-find`                                     |
| Confirm dialog | `confirmDialog`                                | `sc-confirm`                                  |
| Keys help      | `keysHelp`                                     | `sc-confirm is-keys`                          |
| Bulk bar       | `bulkBar`                                      | `sc-bulk`                                     |
| Evidence       | `evidenceFiles`, `evidencePreview`             | `sc-files`, `sc-file`                         |
| Chat turn      | `chatTurn`                                     | `sc-turn`, `sc-turn-saved`                    |
| Composer       | `composer`                                     | `sc-composer`                                 |
| Tester card    | `testerCard`, `timeline`                       | `sc-tcard`, `sc-timeline`, `sc-event`         |
| Instance card  | `instanceCard`, `instanceCards`                | `sc-instances`, `sc-instance`                 |

## Keys

Every action has a key, shown as a cap before its word. The status bar shows at most three key hints.

## Accessibility

- Text and background pairs meet a 4.5:1 contrast ratio, and 3:1 for text of 24 px and larger. Control borders meet 3:1.
- Every interactive element shows the 2 px `--focus` ring on `:focus-visible`. `--focus` has the value of `--ink`. Rows that the arrow keys move through (`[data-row]`, `[data-nav]`, `[data-sub]`, `[data-vfile]`) show `is-sel` instead.
- A status never relies on colour alone. It always has a mark and a word.
