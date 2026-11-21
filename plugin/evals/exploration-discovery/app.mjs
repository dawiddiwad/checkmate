import { createServer } from 'node:http'
import { URLSearchParams } from 'node:url'

const dayMs = 86_400_000
const assets = [
	{ id: 'lamp', name: 'Portable Lamp', depot: 'quay', stock: 1, dayCents: 1400, depositCents: 4500 },
	{ id: 'screen', name: 'Projection Screen', depot: 'ridge', stock: 1, dayCents: 2300, depositCents: 8800 },
	{ id: 'mic', name: 'Wireless Microphone', depot: 'quay', stock: 3, dayCents: 1800, depositCents: 6500 },
	{ id: 'camera', name: 'Studio Camera', depot: 'ridge', stock: 2, dayCents: 4000, depositCents: 12000 },
	{ id: 'tripod', name: 'Travel Tripod', depot: 'ridge', stock: 5, dayCents: 900, depositCents: 2500 },
]

const seed = [
	['B101', 'lamp', 'Mira Patel', '2027-04-03', '2027-04-05', 'confirmed', 'direct', 'Side entrance'],
	['B102', 'camera', 'Pat Lee, Jr.', '2027-04-01', '2027-04-03', 'cancelled', 'direct', ''],
	['B103', 'mic', 'Dana Li', '2027-04-03', '2027-04-05', 'confirmed', 'direct', ''],
	['B104', 'screen', 'Sol Rivera', '2027-04-03', '2027-04-05', 'checked-out', 'direct', ''],
	['B105', 'mic', 'Bo Nia', '2027-03-21', '2027-03-23', 'returned', 'direct', ''],
	['B106', 'camera', 'Ari Chen', '2027-04-07', '2027-04-09', 'confirmed', 'partner', 'Use the freight lift'],
	['B107', 'tripod', 'River Studio', '2027-04-09', '2027-04-12', 'confirmed', 'prepaid', ''],
	['B108', 'tripod', 'North School', '2027-04-08', '2027-04-10', 'confirmed', 'direct', ''],
]

const byId = new Map(assets.map((asset) => [asset.id, asset]))
const booking = ([id, asset, customer, from, to, status, channel, note]) => ({
	id,
	asset,
	customer,
	from,
	to,
	status,
	channel,
	note,
	depot: byId.get(asset).depot,
	depositCents: byId.get(asset).depositCents,
})

const escape = (text) =>
	String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const attr = escape

function days(from, to) {
	const dates = [from, to]
	if (!dates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date ?? ''))) return 0
	const bounds = dates.map((date) => Date.parse(date))
	if (!bounds.every(Number.isFinite)) return 0
	if (!bounds.every((bound, index) => new Date(bound).toISOString().slice(0, 10) === dates[index])) return 0
	return (bounds[1] - bounds[0]) / dayMs
}

function option(current, value, name) {
	return `<option value="${value}"${current === value ? ' selected' : ''}>${name}</option>`
}

function dashboard(rows, query) {
	const depot = query.get('depot') ?? ''
	const status = query.get('status') ?? ''
	const params = new URLSearchParams()
	if (depot) params.set('depot', depot)
	if (status) params.set('status', status)
	const exportControl = `<a id="export" href="/api/export?${attr(params)}">Download CSV</a>`
	return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Harbor Rentals</title>
<style>body{font:16px system-ui;color:#152422;margin:2rem auto;padding:0 1rem;max-width:62rem}header{border-bottom:1px solid #bbc9c1}nav,form{display:flex;gap:1rem;align-items:center;flex-wrap:wrap}table{border-collapse:collapse;width:100%}th,td{padding:.6rem;border-bottom:1px solid #e1e9e5;text-align:left}label{display:grid;gap:.3rem}a{color:#13543d}code{font-size:.9em}.panel{background:#edf5f1;padding:1rem;margin:1rem 0}</style>
<header><h1>Harbor Rentals</h1><p>Equipment reservations</p></header>
<main><h2>Reservations</h2><form action="/" method="get">
<label>Depot<select name="depot">${option(depot, '', 'All depots')}${option(depot, 'quay', 'The Quay')}${option(depot, 'ridge', 'Ridge')}</select></label>
<label>Status<select name="status">${option(status, '', 'All statuses')}${option(status, 'confirmed', 'Confirmed')}${option(status, 'checked-out', 'Checked out')}${option(status, 'returned', 'Returned')}${option(status, 'cancelled', 'Cancelled')}</select></label>
<button type="submit">Filter</button></form>
<nav class="panel">${exportControl}<span>${rows.length} reservations</span></nav>
${rows.length ? `<table><thead><tr><th>Booking</th><th>Customer</th><th>Equipment</th><th>Depot</th><th>Status</th></tr></thead><tbody>${rows.map((row) => `<tr><td><a href="/api/bookings/${row.id}">${row.id}</a></td><td>${escape(row.customer)}</td><td>${escape(byId.get(row.asset).name)}</td><td>${row.depot}</td><td>${row.status}</td></tr>`).join('')}</tbody></table>` : '<p role="status">No reservations match these filters.</p>'}
</main></html>`
}

async function input(request) {
	let body = ''
	for await (const chunk of request) {
		body += chunk
		if (body.length > 8192) throw new Error('Request body too large')
	}
	return JSON.parse(body)
}

export async function serve() {
	const bookings = new Map(seed.map((row) => [row[0], booking(row)]))
	const history = new Map(
		[...bookings.values()].map((item) => [
			item.id,
			item.status === 'returned' ? [{ action: 'booked' }, { action: 'checked-in' }] : [{ action: 'booked' }],
		])
	)
	const sortRows = (q) =>
		[...bookings.values()]
			.filter((row) => !q.get('depot') || row.depot === q.get('depot'))
			.sort((a, b) => a.id.localeCompare(b.id))
	const selectStatus = (rows, q) => rows.filter((row) => !q.get('status') || row.status === q.get('status'))

	function move(item, data) {
		const length = days(data.from, data.to)
		if (!item || item.status !== 'confirmed' || length < 1 || length > 14) return null
		return {
			...item,
			from: data.from,
			to: data.to,
			note: data.note ?? item.note,
		}
	}

	const server = createServer(async (request, response) => {
		const { pathname, searchParams: q } = new URL(request.url, 'http://127.0.0.1')
		const send = (status, value) => {
			response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
			response.end(JSON.stringify(value))
		}
		const text = (value, type = 'text/html') => {
			response.writeHead(200, { 'Content-Type': type + '; charset=utf-8' })
			response.end(value)
		}
		try {
			if (request.method === 'GET') {
				if (pathname === '/') return text(dashboard(selectStatus(sortRows(q), q), q))
				if (pathname === '/api/assets') {
					const term = q.get('q') ?? ''
					const needle = term.toLowerCase()
					return send(
						200,
						assets.filter(
							(asset) =>
								(!q.get('depot') || asset.depot === q.get('depot')) &&
								asset.name.toLowerCase().includes(needle)
						)
					)
				}
				if (pathname === '/api/bookings') {
					const size = Math.max(1, Math.min(50, Number(q.get('size') ?? 50) || 50))
					const start = (Math.max(1, Number(q.get('page') ?? 1) || 1) - 1) * size
					const rows = sortRows(q)
					const selected = selectStatus(rows, q)
					const items = selected.slice(start, start + size)
					return send(200, { items, total: selected.length })
				}
				if (pathname === '/api/export') {
					const rows = selectStatus(sortRows(q), q)
					const values = rows.map(({ id, customer, asset, depot, status }) =>
						[id, customer, asset, depot, status].map(String).join(',')
					)
					return text(['id,customer,asset,depot,status', ...values].join('\r\n') + '\r\n', 'text/csv')
				}
				if (pathname === '/api/availability' || pathname === '/api/quote') {
					const asset = byId.get(q.get('asset'))
					const from = q.get('from')
					const to = q.get('to')
					const length = days(from, to)
					if (!asset || length < 1 || length > 14)
						return send(422, { error: 'Choose an asset and 1–14 rental days' })
					if (pathname === '/api/availability') {
						const used = [...bookings.values()].filter((item) => {
							const blocks = item.status === 'confirmed' || item.status === 'checked-out'
							return item.asset === asset.id && blocks && item.from < to && item.to >= from
						}).length
						return send(200, { available: Math.max(0, asset.stock - used) })
					}
					const regular = length * asset.dayCents
					let weekend = 0
					for (let tick = Date.parse(from); tick < Date.parse(to); tick += dayMs) {
						if ([0, 6].includes(new Date(tick).getUTCDay())) weekend += 500
					}
					const member = q.get('member') === 'true'
					const discount = member ? Math.round(regular / 10) : 0
					const annual = q.get('coverage') === 'annual'
					return send(200, {
						rentalCents: regular + weekend - discount,
						depositCents: annual && asset.depot !== 'ridge' ? 0 : asset.depositCents,
					})
				}
				const historyMatch = /^\/api\/bookings\/([^/]+)\/history$/.exec(pathname)
				if (historyMatch && history.has(historyMatch[1])) return send(200, history.get(historyMatch[1]))
			}
			const match = /^\/api\/bookings\/([^/]+)(\/cancel)?$/.exec(pathname)
			const item = match && bookings.get(match[1])
			if (item) {
				if (request.method === 'GET' && !match[2]) return send(200, item)
				if (request.method === 'PATCH' && !match[2]) {
					const data = await input(request)
					const updated = move(item, data)
					if (!updated) return send(422, { error: 'Choose a confirmed reservation and 1–14 rental days' })
					bookings.set(item.id, updated)
					history.get(item.id).push({ action: 'rescheduled' })
					return send(200, updated)
				}
				if (request.method === 'POST' && match[2]) {
					if (item.status !== 'confirmed')
						return send(409, { error: 'Only confirmed reservations can be cancelled' })
					item.status = 'cancelled'
					history.get(item.id).push({ action: 'cancelled' })
					return send(200, { booking: item, refundCents: item.depositCents })
				}
			}
			return send(404, { error: 'Not found' })
		} catch (error) {
			return send(400, { error: error.message })
		}
	})
	await new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', resolve)
	})
	return {
		url: 'http://127.0.0.1:' + server.address().port,
		close: () =>
			new Promise((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()))
				server.closeAllConnections()
			}),
	}
}
