import { chmodSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { run } from '../plugin/src/cli.ts'
import { directory } from './support.ts'

const pm = 'pm-ana'
const testerSession = '44444444-4444-4444-8444-444444444444'

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	return c >>> 0
})

function crc(bytes: Buffer) {
	let c = 0xffffffff
	for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer) {
	const length = Buffer.alloc(4)
	length.writeUInt32BE(data.length)
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
	const sum = Buffer.alloc(4)
	sum.writeUInt32BE(crc(body))
	return Buffer.concat([length, body, sum])
}

type Box = [number, number, number, number, [number, number, number]]

export function png(width: number, height: number, boxes: Box[]) {
	const rows = Buffer.alloc((width * 3 + 1) * height)
	for (let y = 0; y < height; y++) {
		rows[y * (width * 3 + 1)] = 0
		for (let x = 0; x < width; x++) {
			const box = boxes.findLast(([left, top, w, h]) => x >= left && x < left + w && y >= top && y < top + h)
			const [r, g, b] = box ? box[4] : [246, 247, 245]
			const at = y * (width * 3 + 1) + 1 + x * 3
			rows[at] = r
			rows[at + 1] = g
			rows[at + 2] = b
		}
	}
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	header.set([8, 2, 0, 0, 0], 8)
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(rows)),
		chunk('IEND', Buffer.alloc(0)),
	])
}

const fakeClaude = `#!/usr/bin/env node
const { readFileSync } = require('node:fs')
readFileSync(0, 'utf8')
const args = process.argv.slice(2)
const recorder = args[args.indexOf('--session-id') + 1]
if (process.env.SEED_CLAUDE === 'fail') {
	process.stderr.write('API error: overloaded\\n')
	process.exit(2)
}
const result = readFileSync(process.env.SEED_REPLY, 'utf8')
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, session_id: recorder }))
`

export function seedRecord(workspace: string) {
	const cli = (args: string[], actor: string, stdin: unknown = '', env: Record<string, string> = {}) => {
		const outcome = run([...args, '--workspace', workspace, '--actor', actor], {
			cwd: workspace,
			env: { ...process.env, CHECKMATE_RECORDER: '', ...env } as Record<string, string>,
			stdin: () => (typeof stdin === 'string' ? stdin : JSON.stringify(stdin)),
		})
		if ((outcome.code !== 0 || /^refused/m.test(outcome.output)) && !env.SEED_CLAUDE)
			throw new Error(`${args.join(' ')}: ${outcome.output}`)
		return outcome
	}
	const log = (actor: string, build: string | null, entries: unknown[]) =>
		cli(['log', 'coupon', ...(build ? ['--build', build] : [])], actor, entries)

	cli(
		[
			'target',
			'open',
			'shop',
			'--entry-point',
			'web:url:The shop web application and its HTTP API.',
			'--capabilities',
			'browser,http',
			'--operations',
			'read_catalog,create_fixture_order',
		],
		'opener'
	)
	cli(['target', 'instance', 'add', 'shop', 'local', '--entry', 'web=http://127.0.0.1:4173'], 'opener')
	cli(['open', 'coupon', '--target', 'shop', '--instance', 'local'], 'opener')

	mkdirSync(join(workspace, 'evidence'))
	const red: [number, number, number] = [179, 54, 44]
	const ink: [number, number, number] = [27, 36, 32]
	const line: [number, number, number] = [221, 227, 223]
	const white: [number, number, number] = [255, 255, 255]
	const green: [number, number, number] = [35, 112, 79]
	writeFileSync(
		join(workspace, 'evidence', 'cart-total.png'),
		png(360, 220, [
			[0, 0, 360, 36, ink],
			[20, 56, 320, 140, white],
			[36, 72, 180, 12, line],
			[36, 96, 140, 12, line],
			[36, 120, 200, 12, line],
			[36, 156, 120, 22, red],
			[236, 156, 88, 22, green],
		])
	)
	writeFileSync(
		join(workspace, 'evidence', 'coupon-error.png'),
		png(360, 220, [
			[0, 0, 360, 36, ink],
			[20, 56, 320, 140, white],
			[36, 76, 288, 30, line],
			[36, 120, 288, 26, [248, 228, 225]],
			[44, 128, 160, 10, red],
			[36, 160, 96, 22, ink],
		])
	)
	writeFileSync(
		join(workspace, 'evidence', 'api-total.txt'),
		[
			'POST /api/cart/coupons {"code":"SAVE10"}',
			'200 {"total":"450.00"}',
			'POST /api/cart/coupons {"code":"SAVE20"}',
			'200 {"total":"360.00","coupons":["SAVE10","SAVE20"]}',
			'',
		].join('\n')
	)

	log(pm, null, [
		{
			kind: 'criterion',
			id: 'C1',
			text: 'A cart accepts one coupon at a time.',
			source: 'Ticket SHOP-142',
			area: 'coupons',
		},
		{ kind: 'criterion', id: 'C2', text: 'The total shows two decimals.', source: 'docs/pricing.md' },
		{
			kind: 'criterion',
			id: 'C3',
			text: 'An expired coupon gives the message "This coupon expired."',
			source: 'Ticket SHOP-142',
		},
	])

	log('qa:a1', 'base', [
		{
			kind: 'observation',
			id: 'O1',
			about: 'C2',
			steps: ['Add 5 shirts of 100.00', 'Open the cart'],
			saw: 'The total is 500.00.',
			value: '500.00',
			via: 'ui',
			verdict: 'ok',
		},
		{
			kind: 'observation',
			id: 'O2',
			about: 'coupons',
			steps: 'POST /api/cart/coupons with SAVE10',
			saw: 'The API gives total 450.00.',
			value: '450.00',
			via: 'api',
		},
	])
	log('qa:a2', 'base', [
		{
			kind: 'observation',
			id: 'O1',
			about: 'C3',
			steps: 'Apply the coupon OLD5',
			saw: 'The message is "This coupon expired."',
			value: 'This coupon expired.',
			via: 'ui',
			verdict: 'ok',
		},
	])

	log('qa:a1', 'b1', [
		{
			kind: 'observation',
			id: 'O3',
			repeats: 'O1',
			about: 'C2',
			saw: 'The total is 500.00.',
			value: '500.00',
			via: 'ui',
			verdict: 'ok',
		},
		{
			kind: 'defect',
			id: 'D1',
			title: 'A second coupon stacks on the first',
			severity: 'high',
			about: 'C1',
			steps: ['Add 5 shirts of 100.00', 'Apply SAVE10', 'Apply SAVE20'],
			expected: 'The cart refuses SAVE20, and the total stays 450.00.',
			actual: 'The cart takes SAVE20, and the total is 360.00.',
			saw: 'The cart lists both SAVE10 and SAVE20.',
			via: 'ui',
			evidence: ['evidence/cart-total.png', 'evidence/api-total.txt'],
		},
		{
			kind: 'defect',
			id: 'D2',
			title: 'The total shows three decimals after a coupon',
			severity: 'medium',
			about: 'C2',
			steps: ['Add 3 shirts of 33.33', 'Apply SAVE10'],
			expected: '89.99',
			actual: '89.991',
			via: 'ui',
			evidence: 'evidence/cart-total.png',
		},
		{
			kind: 'defect',
			id: 'D3',
			title: 'The coupon field keeps the old code after an error',
			severity: 'low',
			steps: ['Apply OLD5', 'Read the coupon field'],
			expected: 'The field is empty.',
			actual: 'The field shows OLD5.',
			evidence: 'evidence/coupon-error.png',
		},
		{ kind: 'question', id: 'Q1', question: 'Can a coupon combine with a sale price?', about: 'C1' },
	])
	log('qa:a2', 'b1', [
		{ kind: 'question', id: 'Q1', question: 'Must the expired coupon message name the expiry date?', about: 'C3' },
		{ kind: 'question', id: 'Q2', question: 'Is a coupon code case-sensitive?' },
		{
			kind: 'defect',
			id: 'D1',
			title: 'Two coupons apply to one cart',
			severity: 'high',
			about: 'C1',
			steps: ['Apply SAVE10', 'Apply SAVE20 through the API'],
			expected: 'The API refuses the second coupon.',
			actual: 'The API gives 200 and total 360.00.',
			via: 'api',
			evidence: 'evidence/api-total.txt',
			links: ['Q1'],
		},
		{
			kind: 'defect',
			id: 'D2',
			title: 'The expired coupon message has no period',
			severity: 'low',
			about: 'C3',
			steps: 'Apply the coupon OLD5',
			expected: 'This coupon expired.',
			actual: 'This coupon expired',
			via: 'ui',
			evidence: 'evidence/coupon-error.png',
		},
		{
			kind: 'defect',
			id: 'D3',
			title: 'The cart page reloads twice after a coupon',
			severity: 'medium',
			suspected: true,
			steps: 'Apply SAVE10 and watch the network panel',
			expected: 'One reload.',
			actual: 'Two reloads.',
			via: 'code',
			evidence: 'The code calls refreshCart() in two handlers.',
		},
	])

	cli(['answer', 'coupon', 'a1/Q1', '--answer', 'No. A sale price takes no coupon.'], pm)
	cli(['answer', 'coupon', 'a2/Q1', '--answer', 'No. The message stays as in the ticket.'], pm)

	log('qa:merge', 'b1', [
		{
			kind: 'issue',
			id: 'I1',
			title: 'A cart takes a second coupon',
			severity: 'high',
			reports: ['a1/D1', 'a2/D1'],
			note: 'Both reports apply SAVE10, then SAVE20, and get the total 360.00.',
		},
	])
	log('qa:verify', 'b1', [
		{ kind: 'observation', id: 'O10', confirms: 'a1/D2', saw: 'The total is 89.991 after SAVE10.', via: 'ui' },
		{ kind: 'observation', id: 'O11', refutes: 'a2/D3', saw: 'The network panel shows one reload.', via: 'ui' },
	])

	log('qa:a1', 'b2', [
		{
			kind: 'verdict',
			defect: 'D1',
			result: 'fixed',
			saw: 'The cart refuses SAVE20.',
			evidence: 'evidence/coupon-error.png',
		},
		{ kind: 'verdict', defect: 'D2', result: 'not_fixed', saw: 'The total is still 89.991.' },
		{ kind: 'verdict', defect: 'D3', result: 'fixed', saw: 'The field is empty after the error.' },
		{
			kind: 'observation',
			id: 'O4',
			repeats: 'O1',
			about: 'C2',
			saw: 'The total is 500.00.',
			value: '500.00',
			via: 'ui',
			verdict: 'ok',
		},
	])
	log('qa:a2', 'b2', [
		{
			kind: 'verdict',
			defect: 'D1',
			result: 'not_fixed',
			saw: 'The API still takes SAVE20 and gives 360.00.',
			evidence: 'evidence/api-total.txt',
		},
		{ kind: 'verdict', defect: 'D2', result: 'fixed', saw: 'The message ends with a period.' },
	])

	const bin = directory()
	writeFileSync(join(bin, 'claude'), fakeClaude)
	chmodSync(join(bin, 'claude'), 0o755)
	const reply = join(bin, 'reply.json')
	writeFileSync(
		reply,
		JSON.stringify([
			{
				kind: 'observation',
				id: 'O5',
				about: 'C3',
				saw: 'The message is "This coupon expired." on b2.',
				value: 'This coupon expired.',
				repeats: 'O1',
				via: 'ui',
				verdict: 'ok',
			},
			{ kind: 'note', id: 'N1', text: 'Tested the coupon form on b2 in the browser and through the API.' },
		])
	)
	const config = directory()
	mkdirSync(join(config, 'projects', realpathSync(workspace).replace(/[^a-zA-Z0-9]/g, '-')), { recursive: true })
	const recordEnv = {
		PATH: `${bin}${delimiter}${process.env.PATH}`,
		CLAUDE_CONFIG_DIR: config,
		SEED_REPLY: reply,
	}
	cli(['record', 'coupon', '--build', 'b2', '--session', testerSession], 'qa:a2', '', {
		...recordEnv,
		SEED_CLAUDE: 'fail',
	})
	cli(['record', 'coupon', '--build', 'b2', '--session', testerSession], 'qa:a2', '', recordEnv)
	rmSync(bin, { recursive: true, force: true })
	rmSync(config, { recursive: true, force: true })

	cli(['reject', 'coupon', '--build', 'b1', '--rationale', 'I1 lets a cart take two coupons.'], 'oracle-li')
	cli(
		[
			'accept',
			'coupon',
			'--build',
			'b2',
			'--rationale',
			'The coupon rule works in the UI. The API case of I1 goes to SHOP-150.',
		],
		'oracle-li'
	)
}

if (import.meta.main) {
	const workspace = process.argv[2] ?? directory()
	mkdirSync(workspace, { recursive: true })
	seedRecord(workspace)
	process.stdout.write(`${workspace}\n`)
}
