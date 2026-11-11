import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Store } from '../store.ts'
import type { Context, Page, Theme } from './layout.ts'
import type { FormState } from './forms.ts'
import type { EditState } from './edit.ts'
import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { closeStore, openReadOnlyStore, openStore } from '../store.ts'
import { answerGap, approvePlan, editPlan, planCandidate, rejectPlan } from '../plans.ts'
import { exportPlan, exportRun } from '../render.ts'
import { acceptResult, rejectResult } from '../runs.ts'
import { changesAfter, evidenceBytes, inbox, operationLog, planDetail, runDetail } from '../views.ts'
import { defaultActor } from '../actor.ts'
import { html } from './html.ts'
import { heading, layout } from './layout.ts'
import { emptyState } from './forms.ts'
import { inboxCount, inboxItems, inboxPage, logPage, plansPage, runsPage } from './lists.ts'
import { gapPage, planHistoryList, planPage } from './plan.ts'
import { candidateFromForm, candidateJson, editPage } from './edit.ts'
import { runPage } from './run.ts'

export type UiOptions = { workspace: string; port?: number; defaultActor?: string }
export type Ui = { url: string; close(): Promise<void> }

type Request = { req: IncomingMessage; res: ServerResponse; url: URL; cookies: Record<string, string> }
type Client = { res: ServerResponse; subjects: Set<string>; last: number }
type Change = ReturnType<typeof changesAfter>[number]

const id = '[A-Za-z0-9][A-Za-z0-9_-]{0,95}'
const routes = {
	plan: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})$`),
	latestPlan: new RegExp(`^/plans/(${id})$`),
	gap: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/gaps/(${id})$`),
	edit: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/edit$`),
	history: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/history$`),
	planExport: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/export\\.(html|md|json)$`),
	run: new RegExp(`^/runs/(${id})$`),
	report: new RegExp(`^/runs/(${id})/report\\.(html|md|json)$`),
	evidence: /^\/evidence\/([0-9A-Z]{26})$/,
	font: /^\/assets\/fonts\/(inter|space-grotesk|jetbrains-mono)\.woff2$/,
}
const contentSecurityPolicy =
	"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'self'"
const inlineImages = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const documentTypes: Record<string, string> = {
	html: 'text/html; charset=utf-8',
	md: 'text/markdown; charset=utf-8',
	json: 'application/json; charset=utf-8',
}
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

function readForm(req: IncomingMessage): Promise<URLSearchParams> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		let length = 0
		req.on('data', (chunk: Buffer) => {
			length += chunk.length
			if (length > maxForm) {
				reject(new Error('The form is too large.'))
				req.destroy()
			} else chunks.push(chunk)
		})
		req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))))
		req.on('error', reject)
	})
}

function same(a: string, b: string) {
	const x = Buffer.from(a)
	const y = Buffer.from(b)
	return x.length === y.length && timingSafeEqual(x, y)
}

function safeBack(value: string | null) {
	return value && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

function attachmentName(name: string) {
	const plain = name.replace(/[^A-Za-z0-9._-]/g, '_')
	return `filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`
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
			inboxCount: inboxCount(inbox(store)),
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
			subjects: ['inbox'],
			status,
			body: html`${heading(title, message)}
				<p class="actions">
					<a class="btn primary" href="/">Back to inbox</a> <a class="btn" href="/plans">Plans</a>
					<a class="btn" href="/runs">Runs</a>
				</p>`,
		})
	}

	function nextItem(flash: string, actorCookie: string[]) {
		const next = inboxItems(inbox(store))[0] ?? '/'
		return { location: next, cookies: [...actorCookie, cookie('checkmate_toast', flash, 60)] }
	}

	function serveEvidence(request: Request, evidenceId: string) {
		let evidence
		try {
			evidence = evidenceBytes(store, evidenceId)
		} catch {
			return errorPage(request, 404, 'Evidence not found', `Checkmate has no evidence ${evidenceId}.`)
		}
		const inline = inlineImages.includes(evidence.mediaType) || evidence.mediaType === 'text/plain'
		send(request.res, 200, evidence.mediaType, evidence.bytes, {
			'Content-Disposition': `${inline ? 'inline' : 'attachment'}; ${attachmentName(evidence.name)}`,
			'Cache-Control': 'private, max-age=31536000, immutable',
		})
	}

	function download(request: Request, body: string, format: string, name: string) {
		send(request.res, 200, documentTypes[format], body, {
			'Content-Disposition': `attachment; ${attachmentName(name)}`,
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
		const evidence = routes.evidence.exec(pathname)
		if (evidence) return serveEvidence(request, evidence[1])
		const shown = context(request)
		if (pathname === '/') return render(request, inboxPage(store))
		if (pathname === '/plans') return render(request, plansPage(store, searchParams))
		if (pathname === '/runs') return render(request, runsPage(store, searchParams))
		if (pathname === '/log') return render(request, logPage(store, searchParams))
		if (pathname === '/actor') return render(request, actorPage(shown, safeBack(searchParams.get('back'))))
		const latest = routes.latestPlan.exec(pathname)
		if (latest) {
			const detail = planDetail(store, latest[1])
			return redirect(request.res, `/plans/${latest[1]}@${detail.latestRevision}`)
		}
		const plan = routes.plan.exec(pathname)
		if (plan)
			return render(
				request,
				planPage(store, shown, plan[1], Number(plan[2]), null, searchParams.get('history') === 'all')
			)
		const edit = routes.edit.exec(pathname)
		if (edit) return render(request, editPage(store, shown, edit[1], Number(edit[2])))
		const history = routes.history.exec(pathname)
		if (history) {
			const detail = planDetail(store, history[1], Number(history[2]))
			return send(request.res, 200, 'text/html; charset=utf-8', planHistoryList(store, detail, true).html)
		}
		const planExport = routes.planExport.exec(pathname)
		if (planExport) {
			const [, planId, revision, format] = planExport
			const body = exportPlan(store, `${planId}@${revision}`, format)
			return download(request, body, format, `${planId}-${revision}-plan.${format}`)
		}
		const report = routes.report.exec(pathname)
		if (report) {
			const [, runId, format] = report
			if (!runDetail(store, runId).result)
				return errorPage(
					request,
					409,
					'Report not ready',
					`${runId} is in progress. The report is ready when it finishes.`
				)
			return download(request, exportRun(store, runId, format), format, `${runId}-report.${format}`)
		}
		const gap = routes.gap.exec(pathname)
		if (gap) return render(request, gapPage(store, shown, gap[1], Number(gap[2]), gap[3]))
		const run = routes.run.exec(pathname)
		if (run) return render(request, runPage(store, shown, run[1]))
		return errorPage(request, 404, 'Page not found', `Checkmate has no page at ${pathname}. Start from the inbox.`)
	}

	function actorPage(shown: Context, back: string): Page {
		return {
			title: 'Your name',
			section: null,
			subjects: ['inbox'],
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
		const actor = request.cookies.checkmate_actor?.trim() || typed || fallbackActor
		return { actor, cookies: typed ? [cookie('checkmate_actor', typed)] : [] }
	}

	function values(form: URLSearchParams, names: string[]) {
		return Object.fromEntries(names.map((name) => [name, form.get(name) ?? '']))
	}

	function refuse(request: Request, page: () => Page, cookies: string[] = []) {
		const shown = page()
		render(request, { ...shown, status: shown.status ?? 422 }, cookies)
	}

	function answer(request: Request, form: URLSearchParams, planId: string, revision: number, gapId: string) {
		const state: FormState = {
			...emptyState(),
			values: values(form, ['kind', 'value', 'source', 'rationale', 'actor']),
		}
		const { actor, cookies } = actorFrom(request, form)
		const kind = state.values.kind
		const page = () => gapPage(store, context(request), planId, revision, gapId, state)
		const check = (condition: boolean, message: string) => {
			if (!condition) state.error ??= message
		}
		check(Boolean(actor), 'Enter your name. Checkmate records it with your answer.')
		check(['clarify', 'accept_assumption', 'defer'].includes(kind), 'Choose Clarify, Accept assumption, or Defer.')
		check(Boolean(state.values.value.trim()), 'Write the answer.')
		check(
			kind !== 'clarify' || Boolean(state.values.source.trim()),
			'A clarification needs a source. Name where the answer comes from.'
		)
		check(Boolean(state.values.rationale.trim()), 'Write a rationale. Checkmate records it with your answer.')
		if (state.error) return refuse(request, page, cookies)
		try {
			answerGap(store, actor, {
				planId,
				gapId,
				kind,
				value: state.values.value.trim(),
				source: kind === 'clarify' ? state.values.source.trim() : null,
				rationale: state.values.rationale.trim(),
				expectSha256: form.get('sha') ?? '',
			})
		} catch (error) {
			const latest = planDetail(store, planId)
			if (latest.sha256 !== form.get('sha'))
				state.stale = html`<strong>${planId} has a newer revision (${latest.latestRevision}).</strong> Your
					answer was not recorded. Your text is kept below.
					<a href="/plans/${planId}@${latest.latestRevision}/gaps/${gapId}"
						>Review revision ${latest.latestRevision}</a
					>, then send again.`
			else state.error = plainMessage(error)
			return refuse(request, page, cookies)
		}
		const next = nextItem(`Answered ${planId} · ${gapId}`, cookies)
		redirect(request.res, next.location, next.cookies)
	}

	function verdictState(form: URLSearchParams) {
		return { ...emptyState(), values: values(form, ['verdict', 'rationale', 'actor']) }
	}

	function decide(
		request: Request,
		form: URLSearchParams,
		choices: string[],
		page: (state: FormState) => Page,
		record: (actor: string, verdict: string, rationale: string, sha: string) => string,
		staleCheck: (sha: string) => FormState['stale']
	) {
		const state = verdictState(form)
		const { actor, cookies } = actorFrom(request, form)
		const view = () => page(state)
		if (form.get('back')) return refuse(request, () => ({ ...view(), status: 200 }), cookies)
		if (!choices.includes(state.values.verdict)) state.error = 'Choose a decision.'
		else if (!actor) state.error = 'Enter your name. Checkmate records it with your decision.'
		else if (!state.values.rationale.trim())
			state.error = 'Write a rationale. Checkmate records it with your decision.'
		if (state.error) return refuse(request, view, cookies)
		if (form.get('confirmed') !== '1') {
			state.confirm = true
			return refuse(request, () => ({ ...view(), status: 200 }), cookies)
		}
		const sha = form.get('sha') ?? ''
		let flash: string
		try {
			flash = record(actor, state.values.verdict, state.values.rationale.trim(), sha)
		} catch (error) {
			state.stale = staleCheck(sha)
			if (!state.stale) state.error = plainMessage(error)
			return refuse(request, view, cookies)
		}
		const next = nextItem(flash, cookies)
		redirect(request.res, next.location, next.cookies)
	}

	function decidePlan(request: Request, form: URLSearchParams, planId: string, revision: number) {
		const subject = `${planId}@${revision}`
		decide(
			request,
			form,
			['approve', 'reject'],
			(state) => planPage(store, context(request), planId, revision, state),
			(actor, verdict, rationale, sha) => {
				const input = { reference: subject, rationale, expectSha256: sha }
				if (verdict === 'approve') approvePlan(store, actor, input)
				else rejectPlan(store, actor, input)
				return `${verdict === 'approve' ? 'Approved' : 'Rejected'} ${subject}`
			},
			(sha) => {
				const detail = planDetail(store, planId, revision)
				if (detail.sha256 === sha) return null
				return html`<strong>${subject} has another digest now.</strong> Your decision was not recorded. Your
					text is kept below. Review the plan, then send again.`
			}
		)
	}

	function decideRun(request: Request, form: URLSearchParams, runId: string) {
		decide(
			request,
			form,
			['accept', 'reject'],
			(state) => runPage(store, context(request), runId, state),
			(actor, verdict, rationale, sha) => {
				const input = { runId, rationale, expectSha256: sha }
				if (verdict === 'accept') acceptResult(store, actor, input)
				else rejectResult(store, actor, input)
				return `${verdict === 'accept' ? 'Accepted' : 'Rejected'} ${runId}`
			},
			(sha) => {
				const result = runDetail(store, runId).result
				if (result?.sha256 === sha) return null
				return html`<strong>${runId} has a new result.</strong> Your decision was not recorded. Your text is
					kept below. Review the result, then send again.`
			}
		)
	}

	function saveEdit(request: Request, form: URLSearchParams, planId: string, revision: number) {
		const { actor, cookies } = actorFrom(request, form)
		const subject = `${planId}@${revision}`
		const detail = planDetail(store, planId, revision)
		const base = planCandidate(detail.plan)
		const mode = form.get('mode') === 'json' ? 'json' : 'form'
		const sha = form.get('sha') ?? ''
		const state: EditState = {
			mode,
			candidate: base,
			json: form.get('json') ?? '',
			actor: form.get('actor') ?? '',
			error: null,
			stale: null,
		}
		const page = () => editPage(store, context(request), planId, revision, state)
		let candidate: unknown
		if (mode === 'json') {
			try {
				candidate = JSON.parse(state.json)
			} catch (error) {
				state.error = `The JSON is not valid: ${plainMessage(error)}`
			}
		} else {
			state.candidate = candidateFromForm(base, form)
			state.json = candidateJson(state.candidate)
			candidate = state.candidate
		}
		if (!actor) state.error ??= 'Enter your name. Checkmate records it with the edit.'
		if (state.error) return refuse(request, page, cookies)
		let saved
		try {
			saved = editPlan(store, actor, { reference: subject, candidate, expectSha256: sha }).data
		} catch (error) {
			const latest = planDetail(store, planId)
			if (latest.latestRevision !== revision || latest.sha256 !== sha)
				state.stale = html`<strong>${planId} changed after you opened the editor.</strong> Your edits were not
					saved. Your text is kept below.
					<a href="/plans/${planId}@${latest.latestRevision}/edit">Open the latest version</a>, then edit
					again.`
			else state.error = plainMessage(error)
			return refuse(request, page, cookies)
		}
		const saving = `${planId}@${saved.revision}`
		const flash =
			saved.edit === 'in_place'
				? `Saved ${saving} in place`
				: `Saved ${saving}${planDetail(store, planId).approval.policy === 'none' ? '' : '. It needs approval.'}`
		redirect(request.res, `/plans/${saving}`, [...cookies, cookie('checkmate_toast', flash, 60)])
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
		const edit = routes.edit.exec(pathname)
		if (edit) return saveEdit(request, form, edit[1], Number(edit[2]))
		const gap = routes.gap.exec(pathname)
		if (gap) return answer(request, form, gap[1], Number(gap[2]), gap[3])
		const plan = routes.plan.exec(pathname)
		if (plan) return decidePlan(request, form, plan[1], Number(plan[2]))
		const run = routes.run.exec(pathname)
		if (run) return decideRun(request, form, run[1])
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
