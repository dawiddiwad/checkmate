import { readdirSync, readFileSync } from 'node:fs'

const ui = new URL('../plugin/src/ui/', import.meta.url)
const named =
	'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(
		' '
	)
const rawColour = new RegExp(
	`#[0-9a-f]{3,8}\\b|\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(|\\b(?:${named.join('|')})\\b`,
	'i'
)
const spacingProperty = /^(?:(?:row-|column-)?gap|(?:padding|margin)(?:-[a-z-]+)?)$/
const rawLength = /(?<![\w.-])-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)\b/g
const breakpoints = ['760px', '900px']
const componentBreakpoints: Record<string, string[]> = {
	'components/chat-workspace.css': ['850px'],
	'components/drawer.css': ['1200px'],
	'components/plan-tile.css': ['1279px'],
	'components/status-bar.css': ['1240px', '400px'],
}
const offScaleSpacing: Record<string, string[]> = {
	'components/banner.css': ['padding: var(--space-4) 20px', 'gap: 2px'],
	'components/board.css': ['gap: var(--space-2) 20px', 'gap: 6px'],
	'components/brand.css': ['gap: 10px'],
	'components/button.css': ['padding-left: 10px'],
	'components/chat-turn.css': ['padding: 6px var(--space-3)'],
	'components/chat-workspace.css': ['gap: 2px', 'gap: 2px', 'padding: 10px var(--space-4)'],
	'components/chips.css': ['padding: var(--space-4) 20px'],
	'components/data-table.css': ['padding: 10px var(--space-4)'],
	'components/field.css': ['margin-right: 6px', 'margin-bottom: 6px'],
	'components/find-palette.css': ['padding: 10px var(--space-4)'],
	'components/fold.css': ['gap: 10px', 'gap: 10px'],
	'components/key.css': ['gap: 6px', 'margin-left: 2px'],
	'components/keys-help.css': ['padding: 6px var(--space-3)'],
	'components/list-row.css': ['gap: 10px', 'padding: 10px var(--space-4)', 'padding: 0 6px', 'gap: 2px'],
	'components/nav-rail.css': ['gap: 28px', 'padding: 0 var(--space-5) 6px'],
	'components/notice.css': ['padding: 10px var(--space-4)'],
	'components/plan-tile.css': ['gap: 6px'],
	'components/radio-group.css': ['margin-bottom: 6px', 'padding: 0 var(--space-3) 0 10px'],
	'components/record-list.css': ['padding: 0 6px'],
	'components/request-record.css': ['gap: 2px', 'padding-left: 28px'],
	'components/status-bar.css': ['gap: 6px', 'padding: 0 10px', 'margin-left: 6px'],
	'components/status-mark.css': ['padding: 0 6px'],
	'components/tabs.css': ['gap: 6px'],
	'components/tester-card.css': ['gap: 2px var(--space-3)', 'gap: 2px', 'padding: 6px 0'],
	'layout.css': ['gap: 10px'],
}

const files = readdirSync(ui, { recursive: true })
	.map(String)
	.filter((name) => name.endsWith('.css') && name !== 'tokens.css')
	.sort()
const colours: string[] = []
const spacing: string[] = []
const widths: string[] = []
const stale: string[] = []
for (const name of files) {
	const text = readFileSync(new URL(name, ui), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
	const lineOf = (index: number) => `plugin/src/ui/${name}:${text.slice(0, index).split('\n').length}`
	const knownSpacing = [...(offScaleSpacing[name] ?? [])]
	const ownWidths = componentBreakpoints[name] ?? []
	const unusedWidths = new Set(ownWidths)
	for (const match of text.matchAll(/([-\w]+)\s*:\s*([^;{}]+)/g)) {
		const declaration = `${match[1]}: ${match[2].trim().replace(/\s+/g, ' ')}`
		const value = match[2].replace(/url\((?:'[^']*'|"[^"]*"|[^)]*)\)/g, '')
		if (rawColour.test(value)) colours.push(`${lineOf(match.index)}: ${declaration}`)
		if (!spacingProperty.test(match[1])) continue
		if (!(value.match(rawLength) ?? []).some((length) => parseFloat(length) !== 0)) continue
		const known = knownSpacing.indexOf(declaration)
		if (known === -1) spacing.push(`${lineOf(match.index)}: ${declaration}`)
		else knownSpacing.splice(known, 1)
	}
	for (const match of text.matchAll(/@media[^{]*/g)) {
		for (const [width] of match[0].matchAll(/\d+px/g)) {
			if (breakpoints.includes(width)) continue
			if (ownWidths.includes(width)) unusedWidths.delete(width)
			else widths.push(`${lineOf(match.index)}: ${match[0].trim()}`)
		}
	}
	for (const declaration of knownSpacing) stale.push(`offScaleSpacing, ${name}: ${declaration}`)
	for (const width of unusedWidths) stale.push(`componentBreakpoints, ${name}: ${width}`)
}
for (const name of [...Object.keys(offScaleSpacing), ...Object.keys(componentBreakpoints)]) {
	if (!files.includes(name)) stale.push(`${name} is not a stylesheet`)
}

function report(title: string, problems: string[]) {
	if (!problems.length) return
	console.error(title)
	for (const problem of problems) console.error(`  ${problem}`)
	process.exitCode = 1
}

report('Use a colour token from plugin/src/ui/tokens.css, not a raw colour:', colours)
report('Use a --space token from plugin/src/ui/tokens.css for gap, padding, and margin:', spacing)
report(`Use a breakpoint of ${breakpoints.join(' or ')} in @media:`, widths)
report('Remove these entries from scripts/check-styles.ts. The stylesheet no longer has them:', stale)
