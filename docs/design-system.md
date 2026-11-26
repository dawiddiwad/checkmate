# The Scoresheet design system

The Scoresheet (A) is the design system of the Checkmate review UI. Its values are in `plugin/src/ui/tokens.css`. Each component has its stylesheet in `plugin/src/ui/components/`. The classes start with `sc-`.

## Idea

A chess scoresheet records every move in plain ink. Only one move is yours to play. The UI is a calm, exact record of what the testers did, with one clear mark for what needs a person.

## Rules

1. **One colour means "you".** Use `--signal` only for what waits on a person. Use `--pass` only for passed and accepted. Everything else is ink.
2. **Words in sans, data in mono.** Use IBM Plex Sans for words. Use IBM Plex Mono for IDs, counts, builds, paths, times, and keys.
3. **Shape before colour.** Every status has its own mark (`sc-mark`). It reads in grey, in dark mode, and for colour-blind people.
4. **One primary action per view.** Fill the next move: `sc-btn is-you` when it unblocks testing, `sc-btn is-primary` in other cases. Other actions are outlined or quiet.
5. **Quiet selection.** The selected row (`is-sel`) gets `--surface-2` and a 3 px `--ink` bar. A row that blocks testing (`is-block`) keeps a 3 px `--signal` bar.
6. **Square and flat.** Corners are 0. Depth is a 1 px `--hair` line. There are no shadows.
7. **Say less.** Use sentence case. Show the number first, then the word. Only the brand word and keys are uppercase.
8. **One bar, at the bottom.** The status bar (`sc-bar`) is the only bar.

## Tokens

`plugin/src/ui/tokens.css` is the only place for colour, space, size, and font values. Two light values are darker than in the Scoresheet files so that every text and control border meets the contrast rules on `--surface-2`: `--signal` is `#be400c` and `--edge` is `#85888d`. `npm run lint:check` fails on a raw colour in another stylesheet. Light values are in `:root`. Dark values are in `:root[data-theme='dark']` and in the `prefers-color-scheme` block, with the same names.

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
| Drawer         | `drawer`, `drawerHead`                         | `sc-scrim`, `sc-drawer`, `sc-opts`            |
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
| Target card    | `targetCard`                                   | `sc-card`, `sc-target-name`                   |

## Keys

Every action has a key, shown as a cap before its word. The status bar shows at most three key hints.

## Accessibility

- Text and background pairs meet a 4.5:1 contrast ratio, and 3:1 for text of 24 px and larger. Control borders meet 3:1.
- Every interactive element shows the 2 px `--focus` ring on `:focus-visible`.
- A status never relies on colour alone. It always has a mark and a word.
