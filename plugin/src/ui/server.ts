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
import type { Approval } from '../plans.ts'
import {
	adoptGaps,
	answerGap,
	approvePlan,
	decisionToken,
	editPlan,
	latestApproval,
	planCandidate,
	rejectPlan,
} from '../plans.ts'
import { exportExploration, exportPlan, exportRun } from '../render.ts'
import { decideClaim, explorationRow, handOffClaims } from '../journal.ts'
import { claimPage, explorationPage, explorerFile, explorerFilePage, questionPage } from './exploration.ts'
import { acceptResult, rejectResult } from '../runs.ts'
import { addInstance, retireInstance, targetRequest } from '../targets.ts'
import {
	changesAfter,
	claimEvidence,
	claimsAcross,
	needsYou,
	mergedClaims,
	mergedQuestions,
	entryEvidence,
	evidenceBytes,
	operationLog,
	planDetail,
	planList,
	runDetail,
} from '../views.ts'
import { defaultActor } from '../actor.ts'
import { actorLimit, html, plural } from './html.ts'
import type { BulkState } from './bulk.ts'
import { answerDefaults, bulkProblem, claimDefaults } from './bulk.ts'
import { heading, layout } from './layout.ts'
import { emptyState } from './forms.ts'
import { logPage, runsPage } from './lists.ts'
import { homePage } from './home.ts'
import { reviewOf, reviewPage } from './review.ts'
import { gapPage, planHistoryList, planPage, requestPage } from './plan.ts'
import { candidateFromForm, candidateJson, editPage, emptyField, ownChanges, removedTests } from './edit.ts'
import type { AdoptError } from './run.ts'
import { runPage } from './run.ts'
import type { InstanceForm } from './settings.ts'
import { instanceFromForm, targetPage, targetsPage } from './settings.ts'

export type UiOptions = { workspace: string; port?: number; defaultActor?: string }
export type Ui = { url: string; close(): Promise<void> }

type Request = { req: IncomingMessage; res: ServerResponse; url: URL; cookies: Record<string, string> }
type Client = { res: ServerResponse; subjects: Set<string>; last: number }
type Change = ReturnType<typeof changesAfter>[number]

const id = '[A-Za-z0-9][A-Za-z0-9_-]{0,95}'
const routes = {
	plan: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})$`),
	latestPlan: new RegExp(`^/plans/(${id})$`),
	request: new RegExp(`^/plans/(${id})/request$`),
	handoff: new RegExp(`^/plans/(${id})/handoff$`),
	gap: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/gaps/(${id})$`),
	edit: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/edit$`),
	history: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/history$`),
	planExport: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/export\\.(html|md|json)$`),
	run: new RegExp(`^/runs/(${id})$`),
	runGap: new RegExp(`^/runs/(${id})/gaps/(${id})$`),
	report: new RegExp(`^/runs/(${id})/report\\.(html|md|json|junit)$`),
	evidence: /^\/evidence\/([0-9A-Z]{26})$/,
	target: new RegExp(`^/settings/targets/(${id})$`),
	addInstance: new RegExp(`^/settings/targets/(${id})/instances$`),
	retireInstance: new RegExp(`^/settings/targets/(${id})/instances/(${id})/retire$`),
	exploration: new RegExp(`^/explorations/(${id})$`),
	explorerFile: new RegExp(`^/explorations/(${id})/explorers/(${id})/(${id})/([a-z-]+\\.md)$`),
	explorationExport: new RegExp(`^/explorations/(${id})/export\\.(md|json)$`),
	question: new RegExp(`^/explorations/(${id})/questions/(${id}/${id})$`),
	claim: new RegExp(`^/explorations/(${id})/claims/(${id}/${id})$`),
	claimEvidence: new RegExp(`^/explorations/(${id})/claims/(${id}/${id})/evidence/([0-9]{1,3})$`),
	entryEvidence: new RegExp(`^/explorations/(${id})/entries/(${id}/${id})/evidence/([0-9]{1,3})$`),
	font: /^\/assets\/fonts\/(ibm-plex-sans-(?:400|600)|ibm-plex-mono-(?:400|500|600))\.woff2$/,
}
const contentSecurityPolicy =
	"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'self'"
const inlineImages = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const documentTypes: Record<string, string> = {
	html: 'text/html; charset=utf-8',
	md: 'text/markdown; charset=utf-8',
	json: 'application/json; charset=utf-8',
	junit: 'application/xml; charset=utf-8',
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

function attachmentName(name: string) {
	const plain = name.replace(/[^A-Za-z0-9._-]/g, '_')
	return `filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

function notFoundError(message: string) {
	return /^Unknown|has no revision|not found/i.test(message)
}

function plainMessage(error: unknown) {
	const message = error instanceof Error ? error.message : String(error)
	const schema = /^Invalid [\w-]+: (.+)$/.exec(message)
	if (!schema || !/ must /.test(schema[1])) return message
	return schema[1]
		.split(', ')
		.map((problem) => {
			const [path, rule] = problem.split(/ must (.*)/)
			const place = path
				.split('/')
				.slice(1)
				.map((part) =>
					/^\d+$/.test(part) ? String(Number(part) + 1) : part.replace(/([a-z])([A-Z])/g, '$1 $2')
				)
				.join(' ')
			const what = place ? place[0].toUpperCase() + place.slice(1) : 'The form'
			if (/fewer than 1 characters|fewer than 1 items/.test(rule)) return `${what} cannot be empty.`
			return `${what} is not valid.`
		})
		.join(' ')
}

export async function startUi(options: UiOptions): Promise<Ui> {
	const files = assets()
	const store = openStore(options.workspace)
	const watch = openReadOnlyStore(options.workspace)
	const csrf = randomBytes(24).toString('hex')
	const fallbackActor = options.defaultActor ?? defaultActor(options.workspace, process.env) ?? ''
	const clients = new Set<Client>()
	let port = 0
	let closed = false

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
			actor: request.cookies.checkmate_actor?.trim().slice(0, actorLimit) || fallbackActor || null,
			theme,
			toast:
				(request.req.headers['sec-fetch-mode'] ?? 'navigate') === 'navigate' ||
				request.req.headers['x-checkmate-queue'] === '1'
					? request.cookies.checkmate_toast || null
					: null,
			queueCount: needsYou(store).urgent,
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
			back: '/',
			body: html`${heading(title, message)}
				<p class="actions">
					<a class="btn primary" href="/">Needs you</a> <a class="btn" href="/plans">Plans</a>
					<a class="btn" href="/runs">Runs</a>
				</p>`,
		})
	}

	function nextItem(flash: string, actorCookie: string[], form: URLSearchParams) {
		return {
			location: safeBack(form.get('return') ?? '/'),
			cookies: [...actorCookie, cookie('checkmate_toast', flash, 60)],
		}
	}

	function inQueue(request: Request, form: URLSearchParams, page: () => Page, state: FormState) {
		const key = form.get('item')
		if (form.get('return') === null || key === null) return page
		const back = safeBack(form.get('return'))
		const url = new URL(back, request.url)
		const run = routes.run.exec(url.pathname)
		if (run) return () => runPage(store, context(request, back), run[1], url.searchParams, state)
		const plan = routes.latestPlan.exec(url.pathname)
		if (plan) return () => reviewPage(store, context(request, back), plan[1], url.searchParams, { key, state })
		return page
	}

	function serveClaimEvidence(request: Request, explorationId: string, claimId: string, index: number) {
		serveFile(request, claimEvidence(store, planOfExploration(explorationId), claimId, index))
	}

	function serveFile(request: Request, evidence: { name: string; mediaType: string; bytes: Uint8Array }) {
		const inline = inlineImages.includes(evidence.mediaType) || evidence.mediaType === 'text/plain'
		send(request.res, 200, evidence.mediaType, evidence.bytes, {
			'Content-Disposition': `${inline ? 'inline' : 'attachment'}; ${attachmentName(evidence.name)}`,
			'Cache-Control': 'private, max-age=31536000, immutable',
		})
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
		if (pathname === '/find')
			return send(
				request.res,
				200,
				'application/json; charset=utf-8',
				JSON.stringify(find(searchParams.get('q') ?? '')),
				{
					'Cache-Control': 'no-store',
				}
			)
		const evidence = routes.evidence.exec(pathname)
		if (evidence) return serveEvidence(request, evidence[1])
		const shown = context(request)
		if (pathname === '/' && searchParams.has('item')) return redirect(request.res, oldItem(searchParams))
		if (pathname === '/') return render(request, homePage(store))
		if (pathname === '/inbox' || pathname === '/plans') return redirect(request.res, '/')
		if (pathname === '/claims') return redirect(request.res, oldItem(searchParams, 'all'))
		if (pathname === '/runs') return render(request, runsPage(store, searchParams))
		if (pathname === '/log') return render(request, logPage(store, searchParams))
		if (pathname === '/actor') return render(request, actorPage(shown, safeBack(searchParams.get('back'))))
		if (pathname === '/settings') return redirect(request.res, '/settings/targets')
		if (pathname === '/settings/targets') return render(request, targetsPage(store))
		const target = routes.target.exec(pathname)
		if (target) {
			const revision = searchParams.get('revision')
			const number = revision && /^[1-9][0-9]{0,8}$/.test(revision) ? Number(revision) : null
			const kept = keptInstance(request)
			return render(
				request,
				targetPage(store, shown, target[1], number, kept),
				kept ? [cookie('checkmate_instance', '', 0)] : []
			)
		}
		const latest = routes.latestPlan.exec(pathname)
		if (latest) return render(request, reviewPage(store, shown, latest[1], searchParams))
		const requested = routes.request.exec(pathname)
		if (requested) return render(request, requestPage(store, requested[1]))
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
			const name = format === 'junit' ? `${runId}-junit.xml` : `${runId}-report.${format}`
			return download(request, exportRun(store, runId, format), format, name)
		}
		const exploration = routes.exploration.exec(pathname)
		if (exploration) return render(request, explorationPage(store, exploration[1], searchParams))
		const file = routes.explorerFile.exec(pathname)
		if (file && searchParams.has('download')) {
			const [, explorationId, explorer, phase, name] = file
			const saved = explorerFile(store, explorationId, explorer, phase, name)
			return download(request, saved.text, 'md', `${explorationId}-${explorer}-${name}`)
		}
		if (file) return render(request, explorerFilePage(store, file[1], file[2], file[3], file[4]))
		const explorationExport = routes.explorationExport.exec(pathname)
		if (explorationExport) {
			const [, explorationId, format] = explorationExport
			return download(
				request,
				exportExploration(store, explorationId, format),
				format,
				`${explorationId}-report.${format}`
			)
		}
		const question = routes.question.exec(pathname)
		if (question) return redirect(request.res, recordHref(question[1], `q:${question[2]}`, searchParams))
		const claim = routes.claim.exec(pathname)
		if (claim) return redirect(request.res, recordHref(claim[1], `c:${claim[2]}`, searchParams))
		const claimFile = routes.claimEvidence.exec(pathname)
		if (claimFile) return serveClaimEvidence(request, claimFile[1], claimFile[2], Number(claimFile[3]))
		const entryFile = routes.entryEvidence.exec(pathname)
		if (entryFile) return serveFile(request, entryEvidence(store, entryFile[1], entryFile[2], Number(entryFile[3])))
		const gap = routes.gap.exec(pathname)
		if (gap) return render(request, gapPage(store, shown, gap[1], Number(gap[2]), gap[3]))
		const run = routes.run.exec(pathname)
		if (run) return render(request, runPage(store, shown, run[1], searchParams))
		return errorPage(request, 404, 'Page not found', `Checkmate has no page at ${pathname}. Start from Needs you.`)
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
					<input
						id="actor-name"
						name="actor"
						required
						maxlength="${actorLimit}"
						autocomplete="name"
						value="${shown.actor ?? ''}"
					/>
					<div class="btns">
						<button class="btn primary">Save name</button> <a class="btn" href="${back}">Cancel</a>
					</div>
				</form>`,
		}
	}

	function actorFrom(request: Request, form: URLSearchParams) {
		const typed = form.get('actor')?.trim().slice(0, actorLimit) ?? ''
		const actor = typed || request.cookies.checkmate_actor?.trim() || fallbackActor
		return { actor, cookies: typed ? [cookie('checkmate_actor', typed)] : [] }
	}

	function keptInstance(request: Request): InstanceForm | null {
		try {
			const kept = JSON.parse(request.cookies.checkmate_instance ?? '')
			return typeof kept?.error === 'string' && typeof kept.values === 'object' ? kept : null
		} catch {
			return null
		}
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
		const input = answerInput(form, state, actor)
		const page = inQueue(
			request,
			form,
			() => gapPage(store, context(request), planId, revision, gapId, state),
			state
		)
		state.error = answerProblem(input, actor)
		if (state.error) return refuse(request, page, cookies)
		try {
			answerGap(store, actor, {
				planId,
				gapId,
				kind: input.kind,
				value: input.value,
				source: input.source || null,
				rationale: input.rationale,
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
		const next = nextItem(`${input.kind === 'defer' ? 'Deferred' : 'Answered'} ${planId} · ${gapId}`, cookies, form)
		redirect(request.res, next.location, next.cookies)
	}

	function answerInput(form: URLSearchParams, state: FormState, actor: string) {
		const typed = state.values
		const trimmed = {
			kind: typed.kind || 'clarify',
			value: typed.value.trim(),
			source: typed.source.trim(),
			rationale: typed.rationale.trim(),
		}
		if (form.get('return') === null) return { ...trimmed, kind: typed.kind }
		return {
			...trimmed,
			value: trimmed.value || (trimmed.kind === 'defer' ? 'Deferred in the review UI.' : ''),
			source: trimmed.source || `${actor}, in the review UI`,
			rationale: trimmed.rationale || 'Answered in the review UI. No reason was given.',
		}
	}

	function answerProblem(input: ReturnType<typeof answerInput>, actor: string) {
		const { kind, value, source, rationale } = input
		if (!actor) return 'Enter your name. Checkmate records it with your answer.'
		if (!['clarify', 'accept_assumption', 'defer'].includes(kind))
			return 'Choose Clarify, Accept assumption, or Defer.'
		if (!value.trim()) return 'Write the answer.'
		if (kind === 'clarify' && !source.trim())
			return 'A clarification needs a source. Name where the answer comes from.'
		if (!rationale.trim()) return 'Write a rationale. Checkmate records it with your answer.'
		return null
	}

	function answerExplorationQuestion(
		request: Request,
		form: URLSearchParams,
		explorationId: string,
		questionId: string
	) {
		const state: FormState = {
			...emptyState(),
			values: values(form, ['kind', 'value', 'source', 'rationale', 'actor']),
		}
		const { actor, cookies } = actorFrom(request, form)
		const input = answerInput(form, state, actor)
		const planId = planOfExploration(explorationId)
		const page = () => questionPage(store, context(request), explorationId, questionId, state)
		const asked = mergedQuestions(store, planId).find((item) => item.id === questionId)
		if (asked && asked.answer !== null && (asked.decision !== 'defer' || input.kind === 'defer')) {
			state.stale = html`<strong>${questionId} has an answer now: ${asked.answer}</strong> Your answer was not
				recorded. Your text is kept below.`
			return refuse(request, inQueue(request, form, page, state), cookies)
		}
		state.error = answerProblem(input, actor)
		if (state.error) return refuse(request, inQueue(request, form, page, state), cookies)
		try {
			answerGap(store, actor, {
				planId,
				gapId: questionId,
				kind: input.kind,
				value: input.value,
				source: input.source || null,
				rationale: input.rationale,
			})
		} catch (error) {
			state.error = plainMessage(error)
			return refuse(request, inQueue(request, form, page, state), cookies)
		}
		const next = nextItem(
			`${input.kind === 'defer' ? 'Deferred' : 'Answered'} ${planId} · ${questionId}`,
			cookies,
			form
		)
		redirect(request.res, next.location, next.cookies)
	}

	function decideExplorationClaim(request: Request, form: URLSearchParams, explorationId: string, claimId: string) {
		const state: FormState = { ...emptyState(), values: values(form, ['verdict', 'rationale', 'actor']) }
		const { actor, cookies } = actorFrom(request, form)
		const planId = planOfExploration(explorationId)
		const verdict = state.values.verdict
		const page = inQueue(
			request,
			form,
			() => claimPage(store, context(request), explorationId, claimId, state),
			state
		)
		if (verdict !== 'approved' && verdict !== 'rejected') {
			state.error = 'Choose Accept as a defect or Reject.'
			return refuse(request, page, cookies)
		}
		const decided = mergedClaims(store, planId).find((item) => item.id === claimId)?.decision
		if (decided) {
			const verdict = decided.verdict === 'approved' ? 'accepted' : 'rejected'
			const what = `${claimId} was ${verdict} by ${decided.actor}.`
			state.stale = html`<strong>${what}</strong> Your decision was not recorded. Your text is kept below.`
			return refuse(request, page, cookies)
		}
		const typed = state.values.rationale.trim()
		const quick = form.get('return') !== null
		if (quick && verdict === 'rejected' && !typed) {
			state.error = 'Write a short reason for the reject.'
			return refuse(request, page, cookies)
		}
		const rationale = typed || (quick ? 'Accepted in the review UI. No reason was given.' : '')
		try {
			decideClaim(store, actor, { planId, claimId, verdict, rationale })
		} catch (error) {
			state.error = plainMessage(error)
			return refuse(request, page, cookies)
		}
		const next = nextItem(
			`${verdict === 'approved' ? 'Accepted' : 'Rejected'} ${planId} · ${claimId}`,
			cookies,
			form
		)
		redirect(request.res, next.location, next.cookies)
	}

	function bulkPage(request: Request, back: string, state: BulkState) {
		const url = new URL(back, request.url)
		const plan = routes.latestPlan.exec(url.pathname)
		if (!plan) return () => homePage(store)
		const shown = context(request, url.pathname + url.search)
		return () => reviewPage(store, shown, plan[1], url.searchParams, null, state.error)
	}

	function bulk(request: Request, form: URLSearchParams) {
		const what = form.get('what') === 'claims' ? 'claims' : 'questions'
		const picks = form.getAll('pick')
		const back = safeBack(form.get('return'))
		const { actor, cookies } = actorFrom(request, form)
		const state: BulkState = {
			what,
			values: values(
				form,
				what === 'claims'
					? ['verdict', 'rationale', 'actor']
					: ['kind', 'value', 'source', 'rationale', 'actor']
			),
			error: null,
			confirm: false,
		}
		const page = bulkPage(request, back, state)
		const waiting =
			what === 'claims'
				? claimsAcross(store)
						.filter((claim) => !claim.decision)
						.map((claim) => ({
							key: `claim:${claim.planId}:${claim.id}`,
							planId: claim.planId,
							id: claim.id,
							explorationId: claim.explorationId,
						}))
				: needsYou(store).items.filter((item) => item.kind === 'question' || item.kind === 'gap')
		const found = picks.map((key) => waiting.find((item) => item.key === key))
		const gone = picks.filter((_, index) => !found[index])
		if (!picks.length) state.error = 'Select at least one item.'
		else if (gone.length)
			state.error = `${gone.map((key) => key.split(':').slice(1).join(' · ')).join(', ')} ${gone.length === 1 ? 'does' : 'do'} not wait for a decision now. Nothing is recorded. Clear the selection and select again.`
		else state.error = bulkProblem(what, state.values, actor)
		if (!state.error && form.get('confirmed') !== '1')
			state.error = `Confirm the action for ${plural(picks.length, 'item')}. Nothing is recorded.`
		if (state.error) return refuse(request, page, cookies)
		const items = found.map((item) => item!)
		if (what === 'claims') {
			const decision = claimDefaults(state.values)
			for (const item of items)
				decideClaim(store, actor, {
					planId: item.planId,
					claimId: item.id,
					verdict: decision.verdict,
					rationale: decision.rationale,
				})
			const flash = `${decision.verdict === 'approved' ? 'Accepted' : 'Rejected'} ${plural(items.length, 'claim')}`
			return redirect(request.res, back, [...cookies, cookie('checkmate_toast', flash, 60)])
		}
		const answer = answerDefaults(state.values, actor)
		for (const item of items)
			answerGap(store, actor, {
				planId: item.planId,
				gapId: item.id,
				kind: answer.kind as 'clarify' | 'accept_assumption' | 'defer',
				value: answer.value,
				source: answer.source,
				rationale: answer.rationale,
				...(item.explorationId ? {} : { expectSha256: planDetail(store, item.planId).sha256 }),
			})
		const flash = `${answer.kind === 'defer' ? 'Deferred' : 'Answered'} ${plural(items.length, 'question')}`
		redirect(request.res, back, [...cookies, cookie('checkmate_toast', flash, 60)])
	}

	function recordHref(explorationId: string, key: string, params: URLSearchParams) {
		const view = params.get('view') ?? 'all'
		return `/plans/${planOfExploration(explorationId)}?view=${encodeURIComponent(view)}&item=${encodeURIComponent(key)}`
	}

	function find(query: string) {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean)
		const matches = (text: string) => words.every((word) => text.toLowerCase().includes(word))
		const found = planList(store).flatMap((plan) => {
			const review = reviewOf(store, plan.planId)
			const head = {
				kind: 'plan',
				id: plan.planId,
				title: review.objective,
				href: `/plans/${plan.planId}`,
			}
			const items = review.items.map((item) => ({
				kind: item.kind,
				id: `${plan.planId} · ${item.id}`,
				title: item.title,
				href: `/plans/${plan.planId}?view=all&item=${encodeURIComponent(item.key)}`,
			}))
			return [head, ...items].filter((entry) => matches(`${entry.id} ${entry.title} ${entry.kind}`))
		})
		const shown = 12
		return { results: found.slice(0, shown), more: Math.max(0, found.length - shown) }
	}

	function oldItem(params: URLSearchParams, view = 'needs') {
		const [kind, planId, ...rest] = (params.get('item') ?? '').split(':')
		const id = rest.join(':')
		const short: Record<string, string> = { question: 'q', claim: 'c', gap: 'g' }
		if (kind === 'plan' && planId) return `/plans/${planId}`
		if (kind === 'run' && planId) return `/runs/${planId}`
		if (short[kind] && planId && id)
			return `/plans/${planId}?view=${view}&at=${encodeURIComponent(`${short[kind]}:${id}`)}&focus=list`
		const plan = params.get('plan')
		return plan ? `/plans/${plan}?view=${view}` : '/'
	}

	function handOver(request: Request, form: URLSearchParams, planId: string) {
		const { actor, cookies } = actorFrom(request, form)
		const claimIds = form.getAll('claim')
		const named = claimIds.length === 1 ? claimIds[0] : plural(claimIds.length, 'defect')
		const undo = form.get('undo') === '1'
		const to = form.get('to')?.trim() ?? ''
		const back = safeBack(form.get('return') ?? `/plans/${planId}`)
		const fail = (message: string) =>
			redirect(request.res, back, [...cookies, cookie('checkmate_toast', message, 60)])
		if (!undo && !to) return fail(`Name who takes ${named}. Nothing is recorded.`)
		try {
			handOffClaims(store, actor, { planId, claimIds, ...(undo ? {} : { to }), undo })
		} catch (error) {
			return fail(`${plainMessage(error)} Nothing is recorded.`)
		}
		redirect(request.res, back, [
			...cookies,
			cookie('checkmate_toast', undo ? `${named} not handed over` : `Handed ${named} over to ${to}`, 60),
		])
	}

	function planOfExploration(explorationId: string) {
		return explorationRow(store, explorationId).plan_id
	}

	function verdictState(form: URLSearchParams) {
		return { ...emptyState(), values: values(form, ['verdict', 'rationale', 'actor']) }
	}

	function decide(
		request: Request,
		form: URLSearchParams,
		choices: string[],
		page: (state: FormState) => Page,
		record: (actor: string, verdict: string, rationale: string, sha: string, token: string) => string,
		staleCheck: (sha: string, token: string) => FormState['stale']
	) {
		const state = verdictState(form)
		const { actor, cookies } = actorFrom(request, form)
		const view = () => page(state)
		const sha = form.get('sha') ?? ''
		const token = form.get('decision') ?? ''
		state.stale = staleCheck(sha, token)
		if (state.stale) return refuse(request, view, cookies)
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
		let flash: string
		try {
			flash = record(actor, state.values.verdict, state.values.rationale.trim(), sha, token)
		} catch (error) {
			state.stale = staleCheck(sha, token)
			if (!state.stale) state.error = plainMessage(error)
			return refuse(request, view, cookies)
		}
		const next = nextItem(flash, cookies, form)
		redirect(request.res, next.location, next.cookies)
	}

	function decidedBanner(subject: string, latest: Approval | undefined, verdicts: Record<string, string>) {
		const what = latest
			? html`${subject} was ${verdicts[latest.verdict]} by ${latest.actor} after you opened this page.`
			: html`${subject} has another decision now.`
		return html`<strong>${what}</strong> Your decision was not recorded. Your text is kept below. Review the
			decision, then send again.`
	}

	function decidePlan(request: Request, form: URLSearchParams, planId: string, revision: number) {
		const subject = `${planId}@${revision}`
		decide(
			request,
			form,
			['approve', 'reject'],
			(state) =>
				inQueue(request, form, () => planPage(store, context(request), planId, revision, state), state)(),
			(actor, verdict, rationale, sha, token) => {
				const input = { reference: subject, rationale, expectSha256: sha, expectDecision: token }
				if (verdict === 'approve') approvePlan(store, actor, input)
				else rejectPlan(store, actor, input)
				return `${verdict === 'approve' ? 'Approved' : 'Rejected'} ${subject}`
			},
			(sha, token) => {
				const detail = planDetail(store, planId, revision)
				if (detail.sha256 !== sha)
					return html`<strong>${subject} has another digest now.</strong> Your decision was not recorded. Your
						text is kept below. Review the plan, then send again.`
				if (decisionToken(store, 'plan', subject) === token) return null
				return decidedBanner(subject, latestApproval(store, 'plan', subject), {
					approved: 'approved',
					rejected: 'rejected',
				})
			}
		)
	}

	function decideRun(request: Request, form: URLSearchParams, runId: string) {
		decide(
			request,
			form,
			['accept', 'reject'],
			(state) => inQueue(request, form, () => runPage(store, context(request), runId, undefined, state), state)(),
			(actor, verdict, rationale, sha, token) => {
				const input = { runId, rationale, expectSha256: sha, expectDecision: token }
				if (verdict === 'accept') acceptResult(store, actor, input)
				else rejectResult(store, actor, input)
				return `${verdict === 'accept' ? 'Accepted' : 'Rejected'} ${runId}`
			},
			(sha, token) => {
				const result = runDetail(store, runId).result
				if (!result) return null
				if (result.sha256 !== sha)
					return html`<strong>${runId} has a new result.</strong> Your decision was not recorded. Your text is
						kept below. Review the result, then send again.`
				if (decisionToken(store, 'result', runId) === token) return null
				return decidedBanner(runId, latestApproval(store, 'result', runId), {
					approved: 'accepted',
					rejected: 'rejected',
				})
			}
		)
	}

	function adopt(request: Request, form: URLSearchParams, runId: string, gapId: string) {
		const { actor, cookies } = actorFrom(request, form)
		const planId = runDetail(store, runId).planId
		const sha = form.get('sha') ?? ''
		const page = (message: AdoptError['message']) => () =>
			runPage(store, context(request), runId, undefined, null, { gapId, message })
		if (!actor) return refuse(request, page('Enter your name. Checkmate records it with the change.'), cookies)
		const latest = planDetail(store, planId)
		let adopted
		try {
			adopted = adoptGaps(store, actor, {
				reference: `${planId}@${latest.latestRevision}`,
				runId,
				gapIds: [gapId],
				expectSha256: sha,
			})
		} catch (error) {
			const message =
				latest.sha256 === sha
					? plainMessage(error)
					: html`<strong>${planId} changed after you opened this page.</strong> ${gapId} was not brought into
							the plan. Review the plan, then send again.`
			return refuse(request, page(message), cookies)
		}
		redirect(request.res, `/runs/${runId}?item=${encodeURIComponent(`gap:${gapId}`)}`, [
			...cookies,
			cookie('checkmate_toast', `Brought ${gapId} into ${adopted.subject}`, 60),
		])
	}

	function saveEdit(request: Request, form: URLSearchParams, planId: string, revision: number) {
		const { actor, cookies } = actorFrom(request, form)
		const subject = `${planId}@${revision}`
		const detail = planDetail(store, planId, revision)
		const base = planCandidate(detail.plan)
		const removing = form.get('mode') === 'remove' ? (form.get('test') ?? '') : null
		const mode = form.get('mode') === 'json' || removing !== null ? 'json' : 'form'
		const sha = form.get('sha') ?? ''
		const state: EditState = {
			mode,
			candidate: base,
			json: form.get('json') ?? '',
			actor: form.get('actor') ?? '',
			error: null,
			field: null,
			stale: null,
			unsaved: null,
			orig: form.get('orig') ?? JSON.stringify(base),
			removed: [],
			rationale: form.get('rationale') ?? '',
		}
		const page = () => editPage(store, context(request), planId, revision, state)
		let candidate: unknown
		if (removing !== null) {
			candidate = { ...base, tests: base.tests.filter((test) => test.id !== removing) }
			state.json = candidateJson(candidate)
			if (!base.tests.some((test) => test.id === removing)) state.error = `${subject} has no test ${removing}.`
		} else if (mode === 'json') {
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
		state.removed = removedTests(base, candidate)
		const rationale = state.rationale.trim()
		const blank = mode === 'form' ? emptyField(base, form) : null
		if (blank && !state.error)
			[state.error, state.field] = [`Fill in ${blank.label}. It cannot be empty.`, blank.name]
		if (!state.error && !state.removed.length && candidateJson(candidate) === candidateJson(base))
			return redirect(request.res, `/plans/${subject}`, [
				...cookies,
				cookie('checkmate_toast', `No changes. ${subject} is not saved again.`, 60),
			])
		if (!actor) state.error ??= 'Enter your name. Checkmate records it with the edit.'
		if (state.removed.length && !rationale)
			state.error ??= `The edit removes ${state.removed.join(', ')}. Write the reason in Reason for removal.`
		if (state.error) return refuse(request, page, cookies)
		let saved
		try {
			saved = editPlan(store, actor, {
				reference: subject,
				candidate,
				expectSha256: sha,
				...(rationale ? { rationale } : {}),
			}).data
		} catch (error) {
			const latest = planDetail(store, planId)
			if (latest.latestRevision === revision && latest.sha256 === sha) {
				state.error = plainMessage(error)
				return refuse(request, page, cookies)
			}
			const fresh = planCandidate(latest.plan)
			state.unsaved = ownChanges(form, fresh)
			state.orig = JSON.stringify(fresh)
			state.candidate = fresh
			state.json = candidateJson(fresh)
			state.removed = []
			state.stale = html`<strong>${planId} changed after you opened the editor.</strong> Your edits were not
				saved. The editor shows ${planId}@${latest.latestRevision} as it is now. Your changes are listed above
				it.`
			return refuse(
				request,
				() => editPage(store, context(request), planId, latest.latestRevision, state),
				cookies
			)
		}
		const saving = `${planId}@${saved.revision}`
		const flash =
			saved.edit === 'in_place'
				? `Saved ${saving} in place`
				: `Saved ${saving}${planDetail(store, planId).approval.policy === 'none' ? '' : '. It needs approval.'}`
		redirect(request.res, `/plans/${saving}`, [...cookies, cookie('checkmate_toast', flash, 60)])
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
			field: null,
		}
		const again = () => {
			const kept = JSON.stringify(state)
			if (kept.length > 3000)
				return refuse(request, () => targetPage(store, context(request), targetId, null, state), cookies)
			redirect(request.res, `/settings/targets/${targetId}#add-instance`, [
				...cookies,
				cookie('checkmate_instance', kept, 60),
			])
		}
		const instanceId = state.values.instanceId.trim()
		const empty = entryPoints.find((entry) => !state.values[`entry.${entry.name}`].trim())
		if (!actor)
			[state.error, state.field] = ['Enter your name. Checkmate records it with the instance.', 'instance-actor']
		else if (!instanceId) [state.error, state.field] = ['Enter an instance ID.', 'instance-id']
		else if (empty)
			[state.error, state.field] = [`Fill in ${empty.name}. It cannot be empty.`, `entry-${empty.name}`]
		if (state.error) return again()
		try {
			addInstance(store, actor, { targetId, instanceId, instance: instanceFromForm(entryPoints, form) })
		} catch (error) {
			state.error = plainMessage(error)
			return again()
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
			if (name.length > actorLimit)
				return errorPage(request, 422, 'Your name', `Use a name of ${actorLimit} characters or fewer.`)
			return redirect(request.res, safeBack(form.get('back')), [cookie('checkmate_actor', name)])
		}
		if (pathname === '/bulk') return bulk(request, form)
		const handoff = routes.handoff.exec(pathname)
		if (handoff) return handOver(request, form, handoff[1])
		const edit = routes.edit.exec(pathname)
		if (edit) return saveEdit(request, form, edit[1], Number(edit[2]))
		const question = routes.question.exec(pathname)
		if (question) return answerExplorationQuestion(request, form, question[1], question[2])
		const claim = routes.claim.exec(pathname)
		if (claim) return decideExplorationClaim(request, form, claim[1], claim[2])
		const gap = routes.gap.exec(pathname)
		if (gap) return answer(request, form, gap[1], Number(gap[2]), gap[3])
		const plan = routes.plan.exec(pathname)
		if (plan) return decidePlan(request, form, plan[1], Number(plan[2]))
		const run = routes.run.exec(pathname)
		if (run) return decideRun(request, form, run[1])
		const runGap = routes.runGap.exec(pathname)
		if (runGap) return adopt(request, form, runGap[1], runGap[2])
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
			if (closed) return
			closed = true
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
