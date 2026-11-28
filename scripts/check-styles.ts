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
const breakpoints = ['760px', '900px', '1279px', '1280px']
const componentBreakpoints: Record<string, string[]> = {
	'components/status-bar.css': ['400px'],
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
	const ownWidths = componentBreakpoints[name] ?? []
	const unusedWidths = new Set(ownWidths)
	for (const match of text.matchAll(/([-\w]+)\s*:\s*([^;{}]+)/g)) {
		const declaration = `${match[1]}: ${match[2].trim().replace(/\s+/g, ' ')}`
		const value = match[2].replace(/url\((?:'[^']*'|"[^"]*"|[^)]*)\)/g, '')
		if (rawColour.test(value)) colours.push(`${lineOf(match.index)}: ${declaration}`)
		if (!spacingProperty.test(match[1])) continue
		if (!(value.match(rawLength) ?? []).some((length) => parseFloat(length) !== 0)) continue
		spacing.push(`${lineOf(match.index)}: ${declaration}`)
	}
	for (const match of text.matchAll(/@media[^{]*/g)) {
		for (const [width] of match[0].matchAll(/\d+px/g)) {
			if (breakpoints.includes(width)) continue
			if (ownWidths.includes(width)) unusedWidths.delete(width)
			else widths.push(`${lineOf(match.index)}: ${match[0].trim()}`)
		}
	}
	for (const width of unusedWidths) stale.push(`componentBreakpoints, ${name}: ${width}`)
}
for (const name of Object.keys(componentBreakpoints)) {
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
report(`Use a breakpoint from this list in @media: ${breakpoints.join(', ')}:`, widths)
report('Remove these entries from scripts/check-styles.ts. The stylesheet no longer has them:', stale)
