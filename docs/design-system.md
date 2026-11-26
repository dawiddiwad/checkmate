# Review UI design system

The review UI has one design system. It has three parts:

| Part           | Where                                             | What it is                                                                 |
| -------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| Tokens         | `:root` block of `plugin/src/ui/assets/style.css` | Every color, type style, space, size, width, line, layer and motion value. |
| Reference page | `/design` in `checkmate ui`                       | The tokens and every component in each state, in light and dark.           |
| Tests          | `test/e2e/design.test.ts`                         | Token rule, geometry, overflow, layers and screenshots.                    |

Open `/design` to see the system. The theme button in the top bar switches light and dark. The "Grid overlay" button shows the columns and the 4px rows. On another page, run `document.documentElement.toggleAttribute('data-grid')` in the browser console to show the same overlay.

## Tokens

Each token has one declaration. A color token has a light value and a dark value: `light-dark(light, dark)`.

| Group  | Tokens                                                                                                                                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Color  | `ground`, `surface`, `surface-2`, `ink`, `muted`, `neutral`, `hair`, `edge-soft`, `edge`, `accent`, `accent-hover`, `on-accent`, `select-muted`, `attention`, `scrim`, and `red`, `amber`, `blue`, `green` with their `-soft` fills                       |
| Type   | `type-h1` 24/32, `type-h2` 18/24, `type-title` 16/24, `type-body` 14/20, `type-small` 12/16, `type-label` 12/16 mono, `type-mono` 12/16, `type-code` 13/20, `type-num` 20/28, `type-brand` 16/16; `bold`, `track`, `text-sm`                              |
| Space  | `sp-1` 4, `sp-2` 8, `sp-3` 12, `sp-4` 16, `sp-6` 24, `sp-8` 32                                                                                                                                                                                            |
| Size   | `size-icon` 16, `size-pill` 20, `size-mark` 24, `size-control` 28, `size-row` 32, `size-list-row` 36, `size-touch` 40, `size-top` 48                                                                                                                      |
| Width  | `w-col-s` 80, `w-col-m` 120, `w-col-l` 176, `w-col-xl` 240, `w-num` 88, `w-aside` 320, `w-panel` 400, `w-dialog-s` 560, `w-dialog-m` 656, `w-dialog-l` 944, `w-form` 720, `w-record` 880, `w-wide` 960; heights `h-tile` 200, `h-frame` 256, `h-list` 384 |
| Layout | `cols`, `gutter` 16, `margin` 16, `app-col`, `col`, `top-h`, `bar-h`, `drawer-w` 560, `measure` 72ch                                                                                                                                                      |
| Line   | `radius` 2px, `line-w` 1px, `mark-w` 2px, `line`, `sep`, `sep-top`, `mark-inset`, `focus-ring`, `focus-offset`, `focus-inset`                                                                                                                             |
| Layer  | `z-raised`, `z-frame`, `z-sticky`, `z-menu`, `z-drawer`, `z-pane`, `z-bar`, `z-sheet`, `z-viewer`, `z-notice`, `z-skip`, `z-grid`, from bottom to top                                                                                                     |
| Motion | `motion-fade` 0.3s, `motion-flash` 2s                                                                                                                                                                                                                     |

There are no drop shadows. The UI is flat.

## Grid

- The unit is 4px. Each space, size and line height is a multiple of 4px. Only 1px lines and 2px marks are smaller.
- The page has 12 columns above 1100px, 8 columns from 761px to 1100px, and 4 columns at 760px and below.
- The gutter is 16px. The margin is 16px at each side, or the safe area if it is larger.
- Each column is a whole number of pixels. The last column takes the remaining pixels.
- The plan nav takes columns 1 to 3. The page content takes columns 4 to 12.
- The drawer takes columns 8 to 12 and the right margin. The page content then stops at column 7. At 1100px and below, the drawer covers the page.
- Viewport breakpoints: 400px, 760px, 1100px and 1240px. Content-width breakpoints: 560px, 976px and 1100px.

## Lines and rows

Each box top and each box height is on the 4px rows. A line must not add to the height of a box:

- A framed container draws its frame with the shared `::after` overlay.
- A separator between rows is an inset shadow: `--sep` or `--sep-top`.
- A control has a fixed height that includes its border.
- A scroll container keeps its border and makes its padding smaller by the line width.

## Small parts

Key caps, pills, tags, result marks, check boxes and icon buttons have a fixed height from the size tokens. Their content is centred in that height. In running text, a key cap or a pill sits in the 20px line. It does not make the line taller. Hover, focus, active, selected and disabled states change only color, outline or shadow. They do not change the size or the position of a box.

## Components

The reference page shows each component: button (default, small, primary, link, icon), pill, tag, key cap, glyph, result mark, form fields, banner, notices, list with group header and rows, plan tile, plan nav, page heading, panel and decision, summary strip and facts, tabs, table, fold, menu, cards, evidence tile and code, toast, bulk bar, say strip, top bar, status bar, drawer, dialogs (keys, find, confirm), run list with timeline, chat, pager and filters, and viewer. Each component uses the class names of the real templates.

## Tests

`test/e2e/design.test.ts` runs in `npm run phase:verify`. It uses the Chromium headless shell that `playwright-core` pins. Install it once:

```sh
npx playwright-core install chromium-headless-shell
```

The tests check these rules:

1. No value outside the token block is a raw length, color or layer number. Each `var()` names a token.
2. On each page, at 390px, 820px and 1440px, and at device scale 2: each box is on the 4px rows; small parts are centred to 0.5px; the items in a row share one centre line; list columns start at the same x; framed text starts 16px from the frame.
3. Light and dark have the same geometry.
4. States do not move or resize a box.
5. No page is wider than the window.
6. The top bar, the status bar, menus and the nav strip stack above the page and the drawer.
7. Each component block of `/design`, and three main pages at three widths, match the screenshots in `test/e2e/screens/<platform>/` with zero different pixels.

To accept a changed screenshot after a deliberate UI change, run:

```sh
CHECKMATE_UPDATE_SCREENS=1 node --test test/e2e/design.test.ts
```

Make the screenshots on the platform of the folder. CI makes the `linux` screenshots. When they differ, CI keeps the new files in the `design-screens` artifact. Download the artifact, examine each file, and copy the files into `test/e2e/screens/linux/`.

## Rules for a change

1. Use a token for each value. Add a token only when no token fits.
2. Put page blocks on the column grid.
3. Draw lines inside boxes.
4. Give each small part a fixed height from the size tokens.
5. Add each new component to `plugin/src/ui/assets/design-parts.html`, with each state that applies.
6. Run the design tests. Examine each changed screenshot before you accept it.
