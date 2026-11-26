# The Scoresheet design system

The Scoresheet is the design system of the Checkmate review UI. The values come from the `:root` blocks at the top of `plugin/src/ui/assets/style.css`.

## Idea

A chess scoresheet records every move in plain ink. Only one move is yours to play. The UI is a calm record of what the testers did, with one clear mark for what needs a person.

## Rules

1. **One colour means "you".** Use `--signal` (vermilion) only for what waits on a person. Use `--pass` (green) only for passed and accepted. Everything else is ink.
2. **Words in sans, data in mono.** Use IBM Plex Sans for words. Use IBM Plex Mono only for IDs, counts, builds, paths, and keys. Never set a sentence in mono.
3. **Shape before colour.** Every status has its own glyph. The status reads in grey, in dark mode, and for colour-blind people.
4. **One primary action per view.** The next move is filled. Other actions are outlined or plain text. Fill with `--signal` when the action unblocks testing. Fill with `--ink` in all other cases.
5. **Quiet selection.** The selected row gets `--surface-2` and a 3 px `--ink` bar on the left. Do not flood a row with colour.
6. **Say less.** Use sentence case. Do not use uppercase labels. Only the brand word and `kbd` keys are uppercase. Show the number first, then the word.

## Tokens

### Colour tokens

Light values are in `:root`. Dark values are in `:root[data-theme='dark']` and in the `prefers-color-scheme` block.

| Token           | Role                                    | Light                    | Dark                 |
| --------------- | --------------------------------------- | ------------------------ | -------------------- |
| `--ground`      | Page background                         | `#f6f5f1`                | `#0f1012`            |
| `--surface`     | Panels and cards                        | `#ffffff`                | `#16181b`            |
| `--surface-2`   | Selected row and raised areas           | `#efeee9`                | `#1d2024`            |
| `--ink`         | Text, filled buttons, selection bar     | `#14161a`                | `#eceae4`            |
| `--on-ink`      | Text on `--ink`                         | `#f6f5f1`                | `#0f1012`            |
| `--muted`       | Secondary text                          | `#5a5f68`                | `#a3a6ac`            |
| `--hair`        | 1 px row dividers                       | `#e2e0d9`                | `#2a2d32`            |
| `--edge`        | Outlines of controls                    | `#8c8f94`                | `#5c6066`            |
| `--edge-soft`   | Soft borders, empty board cells         | `#c9c6bc`                | `#3a3e44`            |
| `--row-hover`   | Row under the pointer                   | `#f3f2ee`                | `#1a1c20`            |
| `--focus`       | Focus ring                              | `#2f5bd3`                | `#8fb0ff`            |
| `--signal`      | What waits on a person                  | `#c2410c`                | `#ff8a4c`            |
| `--signal-soft` | Soft fill behind `--signal`             | `#fbeadf`                | `#2c1a10`            |
| `--on-signal`   | Text on `--signal`                      | `#ffffff`                | `#1a0c04`            |
| `--fail`        | Failed and defect                       | `#b42318`                | `#ff7a6e`            |
| `--fail-soft`   | Soft fill behind `--fail`               | `#fde6e3`                | `#2b1316`            |
| `--pass`        | Passed and accepted                     | `#1f7a4d`                | `#5cc48a`            |
| `--pass-soft`   | Soft fill behind `--pass`               | `#e3f1e9`                | `#12271b`            |
| `--on-pass`     | Text on `--pass`                        | `#ffffff`                | `#0f1012`            |
| `--scrim`       | Overlay behind the drawer               | `rgba(20, 22, 26, 0.35)` | `rgba(0, 0, 0, 0.6)` |
| `--chevron`     | Select arrow image, drawn in ink colour | dark ink                 | light ink            |

### Layout tokens

| Token         | Value   | Use                       |
| ------------- | ------- | ------------------------- |
| `--sp-bar`    | `48px`  | Height of the status bar  |
| `--sp-ctl`    | `32px`  | Height of a control       |
| `--sp-ctl-lg` | `40px`  | Height of a large control |
| `--sp-nav`    | `320px` | Width of the navigation   |
| `--sp-drawer` | `560px` | Width of the drawer       |

### Font tokens

| Token         | Value                                          |
| ------------- | ---------------------------------------------- |
| `--font-body` | IBM Plex Sans, then the system sans fonts      |
| `--font-mono` | IBM Plex Mono, then the system monospace fonts |

## Type scale

| Use                  | Size and line | Weight | Font |
| -------------------- | ------------- | ------ | ---- |
| Page title (`h1`)    | 32/36         | 600    | Sans |
| Section title (`h2`) | 18/24         | 600    | Sans |
| Row title            | 14/20         | 400    | Sans |
| Body                 | 14/20         | 400    | Sans |
| Small                | 12 to 13      | 400    | Sans |
| Data                 | 12 to 13      | 500    | Mono |
| Numbers              | 24/28         | 500    | Mono |
| Key                  | 11            | 600    | Mono |

## Space and shape

- Space moves in 4 px steps: 4, 8, 12, 16, 24, 32, and 48.
- Corners are 0 everywhere.
- There are no shadows. The only exception is the inset selection bar.
- Rows have a 1 px `--hair` divider.
- A page heading (`.sp-h`) has a 2 px `--ink` rule under it.

## Components

### Status mark

Class: `.sp-pill` with a tone class. Use it to show the status of a run, a result, or an item that waits.

| Tone class    | Mark                      | Use                                     |
| ------------- | ------------------------- | --------------------------------------- |
| `.run`        | Hatched ink square        | Testing, running                        |
| `.pass`       | Filled green square       | Passed, accepted, allowed               |
| `.fail`       | Red cross                 | Failed, denied, high severity           |
| `.you`        | Filled vermilion square   | Blocks, asks, needs approval            |
| `.you.triage` | Outlined vermilion square | Findings and needs triage: decide first |
| `.crit`       | Filled red label          | Critical defect                         |
| No tone       | Outlined grey square      | Questions, stopped, deferred            |

The mark comes from CSS (`::before`). Its colours come from `--mark-edge` and `--mark-fill`, which each tone class sets. The word is in sentence case. A pill for a duration or a cost has no mark.

### Board cell

Class: `.sp-mk` with a state class. Use it in the rule by build board on the Plans page and in the plan rule map.

| State class | Look                  |
| ----------- | --------------------- |
| `.k-pass`   | Green fill            |
| `.k-fail`   | Red outline with ✗    |
| `.k-run`    | Ink hatch             |
| `.k-q`      | Vermilion fill with ? |
| `.k-none`   | Empty, soft border    |

### Buttons

Classes: `.sp-btn` and `.btn`.

- `.pri` or `.primary` makes a filled ink button. Use it for the one primary action of a view.
- Add `.you` to fill the button with vermilion. Use it for an action that unblocks testing.
- Other buttons stay outlined or plain.
- On the Plans page, the first option of the selected plan is filled.

### Rows and plan tiles

Classes: `.sp-row` and `.sp-ct`. Add `.hl` to mark the selected item. A selected item gets `--surface-2` and the 3 px `--ink` bar.

### Numbers

Class: `.sp-nums`. Use it for a group of counts.

- `b.att` marks a count that waits on a person. It is vermilion.
- `b.zero` marks a count of zero. It is grey.

### Status bar

The status bar (`footer.statusbar`) is the only bar. It is at the bottom of the page. There is no top bar. It shows these items:

1. The brand.
2. The links: Plans, Activity, Chats, Runs, Log, Settings. The current page has a 2 px `--ink` line on top.
3. The key hints, and the Find and Keys buttons.
4. The items that wait for you, for example the "need you" counter. They are vermilion.
5. The live state, the name, and the theme switch.

The path to the current page is in the status bar for screen readers only. The page shows it above its title.

### Blocking banner

Class: `.sp-banner`. The Needs you view shows it when questions block testing. It shows the count, one sentence, and one vermilion button that opens the first blocking question. Blocking questions come first in the list, after permission requests.

### Keys

Element: `kbd`. Use it for a key name in a hint. Keys are uppercase mono.

## Change the design

1. Change the value in the `:root` blocks. Change it in both the light and the dark block.
2. Do not write a raw colour in a component rule.
3. Use an existing token.
4. Add a token only when no existing token has the same meaning.
5. Add the new token to this page.

## Accessibility

- Text and background pairs meet a 4.5:1 contrast ratio.
- Every interactive element shows the `--focus` ring on `:focus-visible`.
- A status never relies on colour alone. It always has a glyph and a word.
