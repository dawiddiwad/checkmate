import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Store } from '../store.ts'
import type { Context, Page, Theme } from './layout.ts'
import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { closeStore, openReadOnlyStore, openStore } from '../store.ts'
import { addInstance, retireInstance, targetRequest } from '../targets.ts'
import { changesAfter, operationLog } from '../views.ts'
import { defaultActor } from '../actor.ts'
import { html } from './html.ts'
import { heading, layout } from './layout.ts'
import { logPage } from './lists.ts'
import type { InstanceForm } from './settings.ts'
import { instanceFromForm, targetPage, targetsPage } from './settings.ts'

export type UiOptions = { workspace: string; port?: number; defaultActor?: string }
export type Ui = { url: string; close(): Promise<void> }

type Request = { req: IncomingMessage; res: ServerResponse; url: URL; cookies: Record<string, string> }
type Client = { res: ServerResponse; subjects: Set<string>; last: number }
type Change = ReturnType<typeof changesAfter>[number]

const id = '[A-Za-z0-9][A-Za-z0-9_-]{0,95}'
const routes = {
	target: new RegExp(`^/settings/targets/(${id})$`),
	addInstance: new RegExp(`^/settings/targets/(${id})/instances$`),
	retireInstance: new RegExp(`^/settings/targets/(${id})/instances/(${id})/retire$`),
	font: /^\/assets\/fonts\/(inter|space-grotesk|jetbrains-mono)\.woff2$/,
}
const contentSecurityPolicy =
	"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'self'"
const themes: Theme[] = ['system', 'light', 'dark']
const maxForm = 256 * 1024

function directory(candidates: string[], file: string) {
	for (const candidate of candidates) {
		const path = fileURLToPath(new URL(candidate, import.meta.url))
		if (existsSync(path + file)) return path
	}
	throw new Error(`Checkmate UI files are missing: ${file} not found in ${candidates.join(', ')}`)
}

function assets() {
	const files = directory(['./assets/', '../src/ui/assets/', '../plugin/src/ui/assets/'], 'style.css')
	const fonts = `${files}fonts/`
	const read = (name: string) => readFileSync(files + name)
	return {
		'/assets/style.css': { type: 'text/css; charset=utf-8', body: read('style.css') },
		'/assets/client.js': { type: 'text/javascript; charset=utf-8', body: read('client.js') },
		'/assets/favicon.svg': { type: 'image/svg+xml', body: read('favicon.svg') },
		font: (name: string) => readFileSync(`${fonts}${name}.woff2`),
	}
}

function securityHeaders(): Record<string, string> {
	return {
		'Content-Security-Policy': contentSecurityPolicy,
		'X-Content-Type-Options': 'nosniff',
		'Referrer-Policy': 'same-origin',
		'X-Frame-Options': 'DENY',
	}
}

function send(
	res: ServerResponse,
	status: number,
	type: string,
	body: string | Uint8Array,
	headers: Record<string, string | string[]> = {}
) {
	res.writeHead(status, { ...securityHeaders(), 'Content-Type': type, 'Cache-Control': 'no-store', ...headers })
	res.end(body)
}

function redirect(res: ServerResponse, location: string, cookies: string[] = []) {
	res.writeHead(303, { ...securityHeaders(), Location: location, 'Set-Cookie': cookies })
	res.end()
}

function parseCookies(header: string | undefined) {
	const cookies: Record<string, string> = {}
	for (const part of (header ?? '').split(';')) {
		const index = part.indexOf('=')
		if (index < 0) continue
		try {
			cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
		} catch {}
	}
	return cookies
}

function cookie(name: string, value: string, maxAge = 60 * 60 * 24 * 365) {
	return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict`
}

function readForm(req: IncomingMessage): Promise<URLSearchParams | null> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		let length = 0
		req.on('data', (chunk: Buffer) => {
			length += chunk.length
			if (length <= maxForm) chunks.push(chunk)
		})
		req.on('end', () =>
			resolve(length > maxForm ? null : new URLSearchParams(Buffer.concat(chunks).toString('utf8')))
		)
		req.on('error', reject)
	})
}

function same(a: string, b: string) {
	const x = Buffer.from(a)
	const y = Buffer.from(b)
	return x.length === y.length && timingSafeEqual(x, y)
}

function safeBack(value: string | null) {
	if (!value) return '/'
	try {
		const decoded = decodeURIComponent(value)
		return /^\/[^/\\]/.test(decoded) && /^[\x21-\x7e]+$/.test(decoded) && !decoded.includes('\\') ? value : '/'
	} catch {
		return '/'
	}
}

function notFoundError(message: string) {
	return /^Unknown|has no revision|not found/i.test(message)
}

function plainMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

export async function startUi(options: UiOptions): Promise<Ui> {
	const files = assets()
	const store = openStore(options.workspace)
	const watch = openReadOnlyStore(options.workspace)
	const csrf = randomBytes(24).toString('hex')
	const fallbackActor = options.defaultActor ?? defaultActor(options.workspace, process.env) ?? ''
	const clients = new Set<Client>()
	let port = 0

	const latestRowid = (source: Store) => operationLog(source, { limit: 1 })[0]?.rowid ?? 0
	const dataVersion = () => Number(watch.db.prepare('PRAGMA data_version').get()?.data_version ?? 0)
	let version = dataVersion()
	let cursor = latestRowid(watch)

	function deliver(client: Client, change: Change) {
		if (change.rowid <= client.last) return
		const matched = client.subjects.has('*')
			? change.subjects
			: change.subjects.filter((subject) => client.subjects.has(subject))
		if (!matched.length && !client.subjects.has('*')) return
		client.last = change.rowid
		client.res.write(`id: ${change.rowid}\ndata: ${matched.join(',') || '*'}\n\n`)
	}

	const poll = setInterval(() => {
		const current = dataVersion()
		if (current === version) return
		version = current
		const changes = changesAfter(watch, cursor)
		if (!changes.length) return
		cursor = changes[changes.length - 1].rowid
		for (const client of clients) for (const change of changes) deliver(client, change)
	}, 250)
	const heartbeat = setInterval(() => {
		for (const client of clients) client.res.write(': heartbeat\n\n')
	}, 15_000)

	function context(request: Request, path = request.url.pathname + request.url.search): Context {
		const theme = themes.includes(request.cookies.checkmate_theme as Theme)
			? (request.cookies.checkmate_theme as Theme)
			: 'system'
		return {
			path,
			csrf,
			actor: request.cookies.checkmate_actor?.trim() || fallbackActor || null,
			theme,
			toast:
				(request.req.headers['sec-fetch-mode'] ?? 'navigate') === 'navigate'
					? request.cookies.checkmate_toast || null
					: null,
			cursor: latestRowid(store),
			workspace: options.workspace,
		}
	}

	function render(request: Request, page: Page, extraCookies: string[] = []) {
		const shown = context(request)
		const cookies = [...extraCookies]
		if (shown.toast) cookies.push(cookie('checkmate_toast', '', 0))
		send(request.res, page.status ?? 200, 'text/html; charset=utf-8', layout(shown, page).html, {
			'Set-Cookie': cookies,
			Vary: 'Cookie',
		})
	}

	function errorPage(request: Request, status: number, title: string, message: string) {
		render(request, {
			title,
			section: null,
			subjects: [],
			status,
			body: html`${heading(title, message)}
				<p class="actions">
					<a class="btn primary" href="/log">Log</a> <a class="btn" href="/settings/targets">Targets</a>
				</p>`,
		})
	}

	function events(request: Request) {
		const subjects = new Set(
			(request.url.searchParams.get('subjects') ?? '')
				.split(',')
				.map((subject) => subject.trim())
				.filter(Boolean)
		)
		const header = request.req.headers['last-event-id']
		const after = Number(header ?? request.url.searchParams.get('after') ?? Number.NaN)
		request.res.writeHead(200, {
			...securityHeaders(),
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-store',
			Connection: 'keep-alive',
		})
		request.res.write('retry: 2000\n\n')
		const client: Client = { res: request.res, subjects, last: -1 }
		if (Number.isInteger(after) && after >= 0) {
			client.last = after
			for (const change of changesAfter(watch, after)) deliver(client, change)
		} else client.last = cursor
		clients.add(client)
		request.req.on('close', () => clients.delete(client))
	}

	function get(request: Request) {
		const { pathname, searchParams } = request.url
		const asset = files[pathname as keyof typeof files]
		if (asset && typeof asset === 'object')
			return send(request.res, 200, asset.type, asset.body, { 'Cache-Control': 'no-cache' })
		const font = routes.font.exec(pathname)
		if (font)
			return send(request.res, 200, 'font/woff2', files.font(font[1]), {
				'Cache-Control': 'public, max-age=31536000, immutable',
			})
		if (pathname === '/events') return events(request)
		const shown = context(request)
		if (pathname === '/') return redirect(request.res, '/log')
		if (pathname === '/log') return render(request, logPage(store, searchParams))
		if (pathname === '/actor') return render(request, actorPage(shown, safeBack(searchParams.get('back'))))
		if (pathname === '/settings') return redirect(request.res, '/settings/targets')
		if (pathname === '/settings/targets') return render(request, targetsPage(store))
		const target = routes.target.exec(pathname)
		if (target) {
			const revision = searchParams.get('revision')
			const number = revision && /^[1-9][0-9]{0,8}$/.test(revision) ? Number(revision) : null
			return render(request, targetPage(store, shown, target[1], number))
		}
		return errorPage(request, 404, 'Page not found', `Checkmate has no page at ${pathname}. Start from the log.`)
	}

	function actorPage(shown: Context, back: string): Page {
		return {
			title: 'Your name',
			section: null,
			subjects: [],
			body: html`${heading('Your name', 'Checkmate records this name with each decision you make in this browser.')}
				<form method="post" action="/actor" class="panel narrow">
					<input type="hidden" name="csrf" value="${csrf}" />
					<input type="hidden" name="back" value="${back}" />
					<label class="lab" for="actor-name">Name</label>
					<input id="actor-name" name="actor" required autocomplete="name" value="${shown.actor ?? ''}" />
					<div class="btns">
						<button class="btn primary">Save name</button> <a class="btn" href="${back}">Cancel</a>
					</div>
				</form>`,
		}
	}

	function actorFrom(request: Request, form: URLSearchParams) {
		const typed = form.get('actor')?.trim() ?? ''
		const actor = typed || request.cookies.checkmate_actor?.trim() || fallbackActor
		return { actor, cookies: typed ? [cookie('checkmate_actor', typed)] : [] }
	}

	function values(form: URLSearchParams, names: string[]) {
		return Object.fromEntries(names.map((name) => [name, form.get(name) ?? '']))
	}

	function refuse(request: Request, page: () => Page, cookies: string[] = []) {
		const shown = page()
		render(request, { ...shown, status: shown.status ?? 422 }, cookies)
	}

	function saveInstance(request: Request, form: URLSearchParams, targetId: string) {
		const { actor, cookies } = actorFrom(request, form)
		const entryPoints = targetRequest(store, targetId).entryPoints
		const state: InstanceForm = {
			values: values(form, [
				'instanceId',
				'environment',
				'references',
				...entryPoints.map((entry) => `entry.${entry.name}`),
			]),
			error: null,
		}
		const page = () => targetPage(store, context(request), targetId, null, state)
		const instanceId = state.values.instanceId.trim()
		if (!actor) state.error = 'Enter your name. Checkmate records it with the instance.'
		else if (!instanceId) state.error = 'Enter an instance ID.'
		if (state.error) return refuse(request, page, cookies)
		try {
			addInstance(store, actor, { targetId, instanceId, instance: instanceFromForm(entryPoints, form) })
		} catch (error) {
			state.error = plainMessage(error)
			return refuse(request, page, cookies)
		}
		redirect(request.res, `/settings/targets/${targetId}#instance-${instanceId}`, [
			...cookies,
			cookie('checkmate_toast', `Added instance ${instanceId} to ${targetId}`, 60),
		])
	}

	function retire(request: Request, form: URLSearchParams, targetId: string, instanceId: string) {
		const { actor, cookies } = actorFrom(request, form)
		const page = (error: string) => () =>
			targetPage(store, context(request), targetId, null, null, { instanceId, error })
		if (form.get('confirmed') !== '1')
			return refuse(request, page('Confirm that you want to retire the instance.'), cookies)
		if (!actor) return refuse(request, page('Enter your name. Checkmate records it with the change.'), cookies)
		try {
			retireInstance(store, actor, { targetId, instanceId })
		} catch (error) {
			return refuse(request, page(plainMessage(error)), cookies)
		}
		redirect(request.res, `/settings/targets/${targetId}#instance-${instanceId}`, [
			...cookies,
			cookie('checkmate_toast', `Retired instance ${instanceId} of ${targetId}`, 60),
		])
	}

	async function post(request: Request) {
		const origin = request.req.headers.origin
		if (origin !== undefined && origin !== `http://${request.req.headers.host}`)
			return send(
				request.res,
				403,
				'text/plain; charset=utf-8',
				'Refused: the request comes from another origin.'
			)
		const form = await readForm(request.req)
		if (!form)
			return errorPage(
				request,
				413,
				'Form too large',
				'The form has more than 256 KiB of text. Checkmate did not record it. Go back, make the text shorter, then send the form again.'
			)
		if (!same(form.get('csrf') ?? '', csrf))
			return errorPage(
				request,
				403,
				'Form expired',
				'This form came from an earlier start of the UI. Load the page again, then send the form again.'
			)
		const { pathname } = request.url
		if (pathname === '/theme') {
			const theme = form.get('theme') as Theme
			return redirect(request.res, safeBack(form.get('back')), [
				cookie('checkmate_theme', themes.includes(theme) ? theme : 'system'),
			])
		}
		if (pathname === '/actor') {
			const name = form.get('actor')?.trim() ?? ''
			if (!name)
				return errorPage(request, 422, 'Your name', 'Enter a name. Checkmate records it with each decision.')
			return redirect(request.res, safeBack(form.get('back')), [cookie('checkmate_actor', name)])
		}
		const added = routes.addInstance.exec(pathname)
		if (added) return saveInstance(request, form, added[1])
		const retired = routes.retireInstance.exec(pathname)
		if (retired) return retire(request, form, retired[1], retired[2])
		return errorPage(request, 404, 'Page not found', `Checkmate has no form at ${pathname}.`)
	}

	async function handle(req: IncomingMessage, res: ServerResponse) {
		const host = req.headers.host
		if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
			return send(
				res,
				421,
				'text/plain; charset=utf-8',
				'Refused: unknown host. Open the URL that checkmate ui printed.'
			)
		const request: Request = {
			req,
			res,
			url: new URL(req.url ?? '/', `http://${host}`),
			cookies: parseCookies(req.headers.cookie),
		}
		try {
			if (req.method === 'GET' || req.method === 'HEAD') return get(request)
			if (req.method === 'POST') return await post(request)
			send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed.', { Allow: 'GET, POST' })
		} catch (error) {
			const message = plainMessage(error)
			if (res.headersSent) return res.end()
			if (notFoundError(message)) return errorPage(request, 404, 'Not found', message)
			errorPage(request, 500, 'Something went wrong', `Checkmate could not finish the request: ${message}`)
		}
	}

	const server = createServer((req, res) => {
		void handle(req, res)
	})
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(options.port ?? 0, '127.0.0.1', () => resolve())
	})
	const address = server.address()
	port = typeof address === 'object' && address ? address.port : 0

	return {
		url: `http://127.0.0.1:${port}/`,
		close: async () => {
			clearInterval(poll)
			clearInterval(heartbeat)
			for (const client of clients) client.res.end()
			clients.clear()
			await new Promise<void>((resolve) => {
				server.close(() => resolve())
				server.closeAllConnections()
			})
			closeStore(watch)
			closeStore(store)
		},
	}
}
