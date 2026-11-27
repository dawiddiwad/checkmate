import { readdirSync, readFileSync } from 'node:fs'

// Colours of the review UI come only from plugin/src/ui/tokens.css. Other stylesheets use var(--token).
const ui = new URL('../plugin/src/ui/', import.meta.url)
const named =
	'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(
		' '
	)
const raw = new RegExp(
	`#[0-9a-f]{3,8}\\b|\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(|\\b(?:${named.join('|')})\\b`,
	'i'
)
const files = readdirSync(ui, { recursive: true })
	.map(String)
	.filter((name) => name.endsWith('.css') && name !== 'tokens.css')
	.sort()
const problems: string[] = []
for (const name of files) {
	const text = readFileSync(new URL(name, ui), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
	for (const match of text.matchAll(/([-\w]+)\s*:\s*([^;{}]+)/g)) {
		const value = match[2].replace(/url\((?:'[^']*'|"[^"]*"|[^)]*)\)/g, '')
		if (raw.test(value)) {
			const line = text.slice(0, match.index).split('\n').length
			problems.push(`plugin/src/ui/${name}:${line}: ${match[1]}: ${match[2].trim()}`)
		}
	}
}
if (problems.length) {
	console.error('Use a colour token from plugin/src/ui/tokens.css, not a raw colour:')
	for (const problem of problems) console.error(`  ${problem}`)
	process.exit(1)
}
