import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Store } from '../store.ts'
import { recoverPiCosts } from '../pi-session-costs.ts'
import type { Context, Page, Theme } from './layout.ts'
import type { FormState } from './forms.ts'
import type { EditState } from './edit.ts'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
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
	patchPlan,
	planCandidate,
	rejectPlan,
} from '../plans.ts'
import { exportExploration, exportPlan, exportRun } from '../render.ts'
import { decideClaim, explorationRow, handOffClaims } from '../journal.ts'
import { claimPage, explorationPage, explorerFile, explorerFilePage, questionPage } from './exploration.ts'
import { acceptResult, rejectResult } from '../runs.ts'
import { declaredEntryPoints, recipes } from '../recipes.ts'
import {
	addInstance,
	instanceList,
	isLocalAddress,
	readOnlyOperation,
	requireAnswer,
	retireInstance,
	setupAssumptions,
	setupTarget,
	targetList,
	targetRequest,
	targetRevision,
	urlReachable,
} from '../targets.ts'
import { closeOpenPermissions, decidePermission, openPermissions, permissionOf } from '../permissions.ts'
import {
	explorationState,
	recordStop,
	stopPending,
	startEnding,
	startExploration,
	startFollow,
	unusedAnswers,
} from '../explorers.ts'
import { explorationEvents } from '../explorations.ts'
import { all } from '../store.ts'
import { autoMode, defaultBuild, hasRequest, runTest } from '../modes.ts'
import { upstreamBase } from '../change.ts'
import { levelNames, testLevels } from '../levels.ts'
import type { TestLevel } from '../levels.ts'
import {
	ruleTokens,
	requestModelText,
	testerEffortText,
	testerModelText,
	saveRequestModel,
	saveTesterRules,
	saveModels,
	saveWorkspaceHarness,
	testerRulesText,
	workspaceUiEnv,
} from '../settings.ts'
import type { Chat, RequestContext } from '../requests.ts'
import { chatOf, isUnread, listedChats, markRequestRead, requestOf, requestStatus, staleRequests } from '../requests.ts'
import { planRequest } from '../plans.ts'
import type { Env } from '../sessions.ts'
import type { StopDelays } from '../sessions.ts'
import { liveUi, removeUiFile, requireChild, workspaceHookToken, writeUiFile } from '../sessions.ts'
import { selectedHarness } from '../pi.ts'
import type { Harness } from '../pi.ts'
import { chatModelOrder, discoverModelCatalog } from '../model-catalog.ts'
import { launchPlan } from '../explorers.ts'
import { maxAreaCharacters, outsideRule, planRules, ticketFile } from '../rules.ts'
import { ruleMap } from '../rulemap.ts'
import { requireCondition, requireIdentifier, unusedId, validate } from '../contracts.ts'
import { actionInput } from '../actions.ts'
import { harvestExploration, storableDefects } from '../harvest.ts'
import { developerText } from '../developer.ts'
import { join, resolve } from 'node:path'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
	planExplorations,
	planList,
	runDetail,
} from '../views.ts'
import { defaultActor } from '../actor.ts'
import type { Html } from './html.ts'
import { actorLimit, html, plural } from './html.ts'
import type { BulkState } from './bulk.ts'
import { answerDefaults, bulkProblem, claimDefaults } from './bulk.ts'
import { heading, layout } from './layout.ts'
import { htmlType, imageTypes } from './evidence.ts'
import { emptyState } from './forms.ts'
import { logPage, runsPage } from './lists.ts'
import { homePage } from './home.ts'
import { assumedRows, firstRunPage, newChangePage } from './start.ts'
import { activityPage, claudeMissing, runningCount } from './activity.ts'
import { reviewHref, reviewOf, reviewPage } from './review.ts'
import { gapPage, planHistoryList, planPage, requestPage } from './plan.ts'
import { candidateFromForm, candidateJson, editPage, emptyField, ownChanges, removedTests } from './edit.ts'
import type { AdoptError } from './run.ts'
import { runPage } from './run.ts'
import type { InstanceForm } from './settings.ts'
import { harnessPage, instanceFromForm, targetPage, targetsPage } from './settings.ts'
import { invalidRecipePage, recipePage, recipesPage } from './recipes.ts'
import type { HookOptions } from './hooks.ts'
import { createHooks, sameSecret } from './hooks.ts'
import { emptyRecord, nextOpen, permissionPage, requestHref } from './permissions.ts'
import { createRequester } from './requester.ts'
import { lifecyclePath, lifecycleProof } from './lifecycle.ts'
import { chatMessagePage, screenContext } from './requests.ts'
import { chatPage, chatsPage, planChat } from './chats.ts'

export type UiOptions = HookOptions & {
	workspace: string
	port?: number
	newHookToken?: boolean
	defaultActor?: string
	env?: Env
	stopDelays?: StopDelays
}

export type Ui = { url: string; close(): Promise<void> }

type Request = { req: IncomingMessage; res: ServerResponse; url: URL; cookies: Record<string, string> }
type Client = { res: ServerResponse; subjects: Set<string>; last: number }
type Change = ReturnType<typeof changesAfter>[number]

const id = '[A-Za-z0-9][A-Za-z0-9_-]{0,95}'
const chatId = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}'
const routes = {
	plan: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})$`),
	latestPlan: new RegExp(`^/plans/(${id})$`),
	request: new RegExp(`^/plans/(${id})/request$`),
	handoff: new RegExp(`^/plans/(${id})/handoff$`),
	rules: new RegExp(`^/plans/(${id})/rules$`),
	rule: new RegExp(`^/plans/(${id})/rules/(R[1-9][0-9]{0,3})$`),
	removeRule: new RegExp(`^/plans/(${id})/rules/(R[1-9][0-9]{0,3})/remove$`),
	defectText: new RegExp(`^/plans/(${id})/defects\\.txt$`),
	startTest: new RegExp(`^/plans/(${id})/test$`),
	startFollow: new RegExp(`^/plans/(${id})/follow$`),
	harvest: new RegExp(`^/plans/(${id})/harvest$`),
	permit: new RegExp(`^/permissions/(${id})/(P[1-9][0-9]{0,8})$`),
	requestPage: /^\/requests\/(R[1-9][0-9]{0,8})$/,
	chatPage: new RegExp(`^/chats/(${chatId})$`),
	chatMessage: new RegExp(`^/chats/(${chatId})/messages/(R[1-9][0-9]{0,8})$`),
	chatTurn: new RegExp(`^/chats/(${chatId})/turns$`),
	planChatPost: new RegExp(`^(/plans/(${id})(?:@([1-9][0-9]{0,8}))?)/chats(?:/(${chatId})/turns)?$`),
	stopRequest: /^\/requests\/(R[1-9][0-9]{0,8})\/stop$/,
	permitMany: /^\/permissions\/bulk$/,
	stopRun: new RegExp(`^/explorations/(${id})/stop$`),
	stopTester: new RegExp(`^/explorations/(${id})/explorers/(${id})/stop$`),
	gap: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/gaps/(${id})$`),
	edit: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/edit$`),
	history: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/history$`),
	planExport: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/export\\.(html|md|json)$`),
	run: new RegExp(`^/runs/(${id})$`),
	runGap: new RegExp(`^/runs/(${id})/gaps/(${id})$`),
	report: new RegExp(`^/runs/(${id})/report\\.(html|md|json|junit)$`),
	evidence: /^\/evidence\/([0-9A-Z]{26})$/,
	target: new RegExp(`^/settings/targets/(${id})$`),
	recipe: new RegExp(`^/settings/recipes/(${id})$`),
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
const previewPolicy =
	"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
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
	const files = directory(['./assets/', '../src/ui/assets/', '../plugin/src/ui/assets/'], 'favicon.svg')
	const fonts = `${files}fonts/`
	const read = (name: string) => readFileSync(files + name)
	const client = directory(['./', '../../dist/'], 'client.js')
	// scripts/build-plugin.ts joins the stylesheets of plugin/src/ui/ into plugin/dist/style.css.
	const styles = directory(['./', '../../dist/'], 'style.css')
	return {
		'/assets/style.css': { type: 'text/css; charset=utf-8', body: readFileSync(`${styles}style.css`) },
		'/assets/client.js': { type: 'text/javascript; charset=utf-8', body: readFileSync(`${client}client.js`) },
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

function hostOf(address: string) {
	try {
		return new URL(address).host || address
	} catch {
		return address
	}
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
	await recoverPiCosts(store, options.env ?? process.env).catch(() => {
		;(options.log ?? console.error)(
			'Could not recover archived Pi costs. The UI will use the costs in the workspace.'
		)
	})
	const watch = openReadOnlyStore(options.workspace)
	const csrf = randomBytes(24).toString('hex')
	const hookToken = workspaceHookToken(options.workspace, options.newHookToken)
	const hooks = createHooks(store, hookToken, options)
	const env = { ...(options.env ?? process.env) }
	const workspace = realpathSync(options.workspace)
	const pendingModels = new Map<string, ReturnType<typeof discoverModelCatalog>>()
	const launchEnv = () => workspaceUiEnv(store, env)
	const requester = createRequester(store, {
		workspace: options.workspace,
		env,
		hookPort: () => port,
		hookToken,
		delays: options.stopDelays,
		log: options.log,
	})
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
		hooks.release()
		const changes = changesAfter(watch, cursor)
		if (!changes.length) return
		cursor = changes[changes.length - 1].rowid
		for (const client of clients) for (const change of changes) deliver(client, change)
	}, 250)
	const watchedStates = () =>
		all<{ exploration_id: string }>(
			watch,
			"SELECT DISTINCT exploration_id FROM exploration_events e WHERE step = 'supervisor' AND NOT EXISTS (SELECT 1 FROM exploration_events d WHERE d.exploration_id = e.exploration_id AND d.rowid > e.rowid AND d.step IN ('done', 'followed', 'stop'))"
		)
			.map((row) => `${row.exploration_id}:${explorationState(explorationEvents(watch, row.exploration_id))}`)
			.join(',')
	let supervisors = watchedStates()
	const supervisorWatch = setInterval(() => {
		const current = watchedStates()
		if (current === supervisors) return
		supervisors = current
		hooks.release()
		for (const client of clients) client.res.write('data: *\n\n')
	}, 1000)
	const recipeFolder = join(workspace, '.checkmate', 'recipes')
	const recipeFiles = () => {
		try {
			return readdirSync(recipeFolder)
				.sort()
				.map((name) => {
					const file = statSync(join(recipeFolder, name), { throwIfNoEntry: false })
					return `${name}:${file?.size}:${file?.mtimeMs}`
				})
				.join(',')
		} catch {
			return ''
		}
	}
	let recipeState = recipeFiles()
	const recipeWatch = setInterval(() => {
		const current = recipeFiles()
		if (current === recipeState) return
		recipeState = current
		for (const client of clients)
			if (client.subjects.has('recipes') || client.subjects.has('*')) client.res.write('data: recipes\n\n')
	}, 1000)
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
			permissions: openPermissions(store).length,
			requests: requestStatus(store),
			running: runningCount(store),
			cursor: latestRowid(store),
			workspace: options.workspace,
			harness: selectedHarness(workspaceUiEnv(store, env)),
			testerRules: testerRulesText(store, selectedHarness(workspaceUiEnv(store, env))),
		}
	}

	function render(request: Request, page: Page, extraCookies: string[] = []) {
		const shown = context(request)
		const cookies = [...extraCookies]
		if (shown.toast) cookies.push(cookie('checkmate_toast', '', 0))
		const subjects = [...page.subjects, 'permissions', 'requests']
		send(request.res, page.status ?? 200, 'text/html; charset=utf-8', layout(shown, { ...page, subjects }).html, {
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

	function inQueue(
		request: Request,
		form: URLSearchParams,
		page: () => Page,
		state: FormState,
		gap?: { planId: string; revision: number; id: string }
	) {
		const key = gap ? `g:${gap.id}` : form.get('item')
		if (form.get('return') === null || key === null) return page
		const back = safeBack(form.get('return'))
		const url = new URL(back, request.url)
		const run = routes.run.exec(url.pathname)
		if (run && !gap) return () => runPage(store, context(request, back), run[1], url.searchParams, state)
		const plan = routes.latestPlan.exec(url.pathname)
		if (plan && (!gap || gap.planId === plan[1]))
			return () =>
				reviewPage(store, context(request, back), plan[1], url.searchParams, {
					key,
					state,
					subject: gap ? `${gap.planId}@${gap.revision} · ${gap.id}` : undefined,
				})
		return page
	}

	function serveClaimEvidence(request: Request, explorationId: string, claimId: string, index: number) {
		serveFile(request, claimEvidence(store, planOfExploration(explorationId), claimId, index))
	}

	function serveFile(request: Request, evidence: { name: string; mediaType: string; bytes: Uint8Array }) {
		if (evidence.mediaType === htmlType && request.url.searchParams.get('preview') === '1') {
			const theme = request.url.searchParams.get('theme') ?? request.cookies.checkmate_theme
			const scheme = theme === 'dark' || theme === 'light' ? theme : 'light dark'
			const [first, second] = evidence.bytes
			const bigEndian = first === 0xfe && second === 0xff
			const utf16 = bigEndian || (first === 0xff && second === 0xfe)
			const style = Buffer.from(
				`<style>:where(:root) { color-scheme: ${scheme} }</style>`,
				utf16 ? 'utf16le' : 'utf8'
			)
			if (bigEndian) style.swap16()
			return send(request.res, 200, htmlType, Buffer.concat([evidence.bytes, style]), {
				'Content-Security-Policy': previewPolicy,
				'Referrer-Policy': 'no-referrer',
				'X-Frame-Options': 'SAMEORIGIN',
			})
		}
		const inline = imageTypes.includes(evidence.mediaType) || evidence.mediaType === 'text/plain'
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
		serveFile(request, evidence)
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
		if (pathname === '/settings/harness/models') return modelCatalog(request)
		if (pathname === '/settings/harness/tester-count') return testerCount(request)
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
		if (pathname === '/') return render(request, startOfHome(shown))
		if (pathname === '/setup')
			return render(request, firstRunPage(store.workspace, shown, false, cameFrom(request)))
		if (pathname === '/new')
			return render(request, newChangePage(shown, changeDefaults(searchParams.get('target')), false))
		if (pathname === '/inbox' || pathname === '/plans') return redirect(request.res, '/')
		if (pathname === '/claims') return redirect(request.res, oldItem(searchParams, 'all'))
		if (pathname === '/runs') return render(request, runsPage(store, searchParams))
		if (pathname === '/log') return render(request, logPage(store, searchParams))
		if (pathname === '/activity')
			return render(request, activityPage(store, shown, searchParams, { build: defaultBuild(store.workspace) }))
		if (pathname === '/permissions') return firstRequest(request)
		const asked = routes.permit.exec(pathname)
		if (asked) return permissionRecord(request, asked[1], asked[2])
		if (pathname === '/settings/claude') return redirect(request.res, '/settings/harness')
		if (pathname === '/settings/harness') return render(request, harnessPage(store, shown, env))
		if (pathname === '/chats') return render(request, chatsPage(store, shown, searchParams, env))
		const chat = routes.chatPage.exec(pathname)
		if (chat) return openChat(request, chat[1])
		const message = routes.chatMessage.exec(pathname)
		if (message) return messageRecord(request, message[2], message[1])
		if (pathname === '/requests') return redirect(request.res, '/chats')
		const askedRequest = routes.requestPage.exec(pathname)
		if (askedRequest) return messageRecord(request, askedRequest[1])
		if (pathname === '/actor') return render(request, actorPage(shown, safeBack(searchParams.get('back'))))
		if (pathname === '/settings') return redirect(request.res, '/settings/targets')
		if (pathname === '/settings/targets') return render(request, targetsPage(store))
		if (pathname === '/settings/recipes') return render(request, recipesPage(options.workspace))
		if (pathname === '/settings/invalid-recipes') {
			const file = searchParams.get('file') ?? ''
			const page = invalidRecipePage(options.workspace, file)
			if (!page)
				return errorPage(request, 404, 'Recipe not found', `Checkmate has no invalid recipe file ${file}.`)
			return render(request, page)
		}
		const recipe = routes.recipe.exec(pathname)
		if (recipe) {
			const page = recipePage(options.workspace, recipe[1])
			if (!page) return errorPage(request, 404, 'Recipe not found', `Checkmate has no recipe ${recipe[1]}.`)
			return render(request, page)
		}
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
		if (latest) return openPlanPage(request, reviewPage(store, shown, latest[1], searchParams), latest[1])
		const defectText = routes.defectText.exec(pathname)
		if (defectText)
			return send(
				request.res,
				200,
				'text/plain; charset=utf-8',
				developerText(store, defectText[1], searchParams.getAll('claim')),
				{ 'Cache-Control': 'no-store' }
			)
		const requested = routes.request.exec(pathname)
		if (requested) return render(request, requestPage(store, requested[1], shown.harness))
		const plan = routes.plan.exec(pathname)
		if (plan)
			return openPlanPage(
				request,
				planPage(
					store,
					shown,
					plan[1],
					Number(plan[2]),
					null,
					searchParams.get('history') === 'all',
					searchParams.has('chat') || searchParams.get('newChat') === '1'
				),
				plan[1]
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
		if (exploration) return render(request, explorationPage(store, shown, exploration[1], searchParams))
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

	// The address of an instance: the value of its first url entry. A target without one has no address.
	function addressOf(targetId: string, entries: Record<string, string>) {
		const entry = targetRequest(store, targetId).entryPoints.find((item) => item.kind === 'url')
		return entry ? entries[entry.name] : undefined
	}

	function changeDefaults(target: string | null) {
		const where = (address: string | undefined) => ({
			address: address ? hostOf(address) : null,
			local: address ? !URL.canParse(address) || isLocalAddress(address) : true,
		})
		const targets = targetList(store).map((item) => {
			const active = activeInstances(item.targetId)
			return {
				targetId: item.targetId,
				...where(active[0] && addressOf(item.targetId, active[0].entries)),
				instances:
					active.length < 2
						? []
						: active.map((one) => ({
								id: one.instanceId,
								...where(addressOf(item.targetId, one.entries)),
							})),
			}
		})
		return { build: defaultBuild(store.workspace), target: target ?? '', targets }
	}

	function startOfHome(shown: Context) {
		if (!targetList(store).length) return firstRunPage(store.workspace, shown, true)
		if (!planList(store).length) return newChangePage(shown, changeDefaults(null), true)
		return homePage(store)
	}

	function cameFrom(request: Request) {
		const referer = request.req.headers.referer
		if (!referer || !URL.canParse(referer)) return '/'
		const from = new URL(referer)
		return from.host === request.req.headers.host && from.pathname === '/new' ? `/new${from.search}` : '/'
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
			state,
			{ planId, revision, id: gapId }
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
			const pending = latest.pendingDecisions.find((each) => each.gapId === gapId)
			if (latest.sha256 !== form.get('sha'))
				state.stale = html`<strong>${planId} has a newer revision (${latest.latestRevision}).</strong> Your
					answer was not recorded. Your text is kept below.
					<a href="/plans/${planId}@${latest.latestRevision}/gaps/${gapId}"
						>Review revision ${latest.latestRevision}</a
					>, then send again.`
			else if (pending && form.has('return'))
				state.stale = html`<strong>${gapId} was answered by ${pending.actor}.</strong> Your answer was not
					recorded. Your text is kept below.`
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
		const pages = [
			{ kind: 'page', id: 'Activity', title: 'Tests, follow-ups, and chats', href: '/activity' },
			{ kind: 'page', id: 'New change', title: 'Give a ticket and start the first test', href: '/new' },
			{ kind: 'page', id: 'New target', title: 'Set up the application to test', href: '/setup' },
			{ kind: 'page', id: 'Chats', title: 'Conversations with Checkmate', href: '/chats' },
		].filter((entry) => matches(`${entry.id} ${entry.title} ${entry.kind}`))
		const all = [...pages, ...found]
		const shown = 12
		return { results: all.slice(0, shown), more: Math.max(0, all.length - shown) }
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

	function actionRefusal(request: Request, back: string, message: Html | string, field = '') {
		render(request, {
			title: 'Nothing was done',
			section: 'home',
			subjects: ['inbox'],
			status: 422,
			back,
			body: html`${heading('Nothing was done')}
				<p class="form-error" role="alert" ${field ? html`data-field="${field}"` : ''}>${message}</p>
				<p class="actions"><a class="btn primary" href="${back}">Go back</a></p>`,
		})
	}

	function engineText(error: unknown) {
		const message = plainMessage(error)
		if (/No claude executable/.test(message)) return `${claudeMissing.cause} ${claudeMissing.next}`
		const hint = (error as { hint?: string }).hint
		return hint ? `${message} ${hint}` : message
	}

	function runningOf(planId: string) {
		return planExplorations(store, planId).find((item) => item.running)
	}

	function stoppingOf(planId: string) {
		return planExplorations(store, planId).find((item) => stopPending(explorationEvents(store, item.explorationId)))
	}

	function inProgress(planId: string, running: { explorationId: string }) {
		return html`A test of ${planId} is in progress: ${running.explorationId}.
			<a href="/explorations/${running.explorationId}">Open ${running.explorationId}</a> to watch or stop it.`
	}

	function ruleHref(planId: string, ruleId: string | undefined) {
		return reviewHref(planId, 'rules', ruleId ? `&at=${encodeURIComponent(`rule:${ruleId}`)}&focus=list` : '')
	}

	function ruleChange(request: Request, form: URLSearchParams, planId: string, change: () => void) {
		const back = reviewHref(planId, 'rules')
		const { origin } = planRules(store, planId)
		const refuse = (message: string, field = '') => actionRefusal(request, back, message, field)
		if (origin !== 'derived' && origin !== 'corrected' && origin !== 'harvested')
			return refuse(`The rules of ${planId} do not come from the sources. Edit them in the plan editor.`)
		try {
			change()
		} catch (error) {
			const text = engineText(error)
			refuse(
				text,
				/area/i.test(text) ? (form.get('newArea') ? 'newArea' : 'area') : /text/i.test(text) ? 'text' : ''
			)
		}
	}

	function changeRule(request: Request, form: URLSearchParams, planId: string, ruleId: string | null) {
		const back = reviewHref(planId, 'rules')
		const { actor, cookies } = actorFrom(request, form)
		const refuse = (message: string, field = '') => actionRefusal(request, back, message, field)
		const text = form.get('text')?.trim() ?? ''
		const area = form.get('newArea')?.trim() || form.get('area')?.trim() || ''
		if (!actor) return refuse('Enter your name. Checkmate records it with the rule.')
		if (!text) return refuse('Write the text of the rule.', 'text')
		if (!area) return refuse('Name the area of the rule.', 'area')
		if (area.length > maxAreaCharacters)
			return refuse(`The area has more than ${maxAreaCharacters} characters.`, 'newArea')
		const { rules } = planRules(store, planId)
		if (ruleId && !rules.some((rule) => rule.id === ruleId))
			return refuse(`${planId} has no rule ${ruleId} now. Nothing is changed.`)
		const id =
			ruleId ??
			unusedId(
				'R',
				rules.map((rule) => rule.id)
			)
		const source = form.get('source')?.trim() || 'Added in the review UI.'
		ruleChange(request, form, planId, () => {
			patchPlan(store, actor, {
				reference: planId,
				patch: { requirements: { [id]: ruleId ? { text, area } : { text, area, source } } },
			})
			redirect(request.res, ruleHref(planId, id), [
				...cookies,
				cookie('checkmate_toast', `${ruleId ? 'Changed' : 'Added'} rule ${id}`, 60),
			])
		})
	}

	function removeRule(request: Request, form: URLSearchParams, planId: string, ruleId: string) {
		const back = reviewHref(planId, 'rules')
		const { actor, cookies } = actorFrom(request, form)
		if (!actor) return actionRefusal(request, back, 'Enter your name. Checkmate records it with the rule.')
		const cited = [...mergedClaims(store, planId), ...mergedQuestions(store, planId)].filter(
			(item) => item.rule === ruleId
		).length
		const listed = ruleMap(store, planId)
			.rows.map((row) => row.rule.id)
			.filter((id) => id !== outsideRule)
		const at = listed.indexOf(ruleId)
		const next = listed[at + 1] ?? listed[at - 1]
		ruleChange(request, form, planId, () => {
			patchPlan(store, actor, { reference: planId, patch: { requirements: { [ruleId]: null } } })
			const outside = cited
				? ` ${plural(cited, 'item')} that cited it ${cited === 1 ? 'shows' : 'show'} under Outside the rules.`
				: ''
			redirect(request.res, ruleHref(planId, next), [
				...cookies,
				cookie('checkmate_toast', `Removed rule ${ruleId}.${outside}`, 60),
			])
		})
	}

	function activeInstances(targetId: string) {
		return instanceList(store, targetId).filter((instance) => !instance.retired)
	}

	function instanceFrom(form: URLSearchParams, targetId: string) {
		const names = activeInstances(targetId).map((item) => item.instanceId)
		if (names.length < 2) return { instance: undefined, error: '' }
		const instance = form.get('instance')?.trim() ?? ''
		if (names.includes(instance)) return { instance, error: '' }
		const list = names.length > 2 ? `${names.slice(0, -1).join(', ')}, or ${names.at(-1)}` : names.join(' or ')
		return { instance: undefined, error: `Choose the instance: ${list}.` }
	}

	function testerChoicesFrom(form: URLSearchParams, name: 'testerModel' | 'testerEffort') {
		const selected: Record<string, string> = {}
		const prefix = `${name}.`
		for (const [field, value] of form) {
			if (field.startsWith(prefix) && value.trim()) selected[field.slice(prefix.length)] = value.trim()
		}
		return selected
	}

	function startTest(request: Request, form: URLSearchParams, planId: string) {
		const back = `/plans/${planId}`
		const { actor, cookies } = actorFrom(request, form)
		planRequest(store, planId)
		const build = form.get('build')?.trim() ?? ''
		const level = form.get('level')?.trim() || 'normal'
		const [typedSince, until, repo] = ['since', 'until', 'repo'].map((name) => form.get(name)?.trim() || undefined)
		const refuse = (message: Html | string, field = '') => actionRefusal(request, back, message, field)
		if (!actor) return refuse('Enter your name. Checkmate records it with the test.')
		if (form.has('harness') && form.get('harness') !== selectedHarness(launchEnv()))
			return refuse('The coding harness changed. Reload the page and try again.')
		if (until && !typedSince) return refuse('Until needs Since. Fill in Since, or leave Until empty.', 'until')
		const chosen = instanceFrom(form, planRequest(store, planId).target.profile.targetId)
		if (chosen.error) return refuse(chosen.error, 'instance')
		const running = runningOf(planId)
		if (running) return refuse(inProgress(planId, running))
		const stopping = stoppingOf(planId)
		if (stopping)
			return refuse(
				`A stop of ${stopping.explorationId} is in progress. Wait until it ends, then start the test.`
			)
		try {
			const input = validate('exploration', {
				planId,
				build,
				level,
				instance: chosen.instance,
				since: typedSince,
				until,
				repo,
			})
			const since = typedSince ?? upstreamBase(resolve(store.workspace, repo ?? '.'))
			const started = startExploration(
				store,
				actor,
				{
					...input,
					since,
					mode: autoMode(store, planId),
					allow: ruleTokens(form.get('rules') ?? ''),
					claudeArgs: [],
					inheritPiTools: true,
					testerModels: testerChoicesFrom(form, 'testerModel'),
					testerEfforts: testerChoicesFrom(form, 'testerEffort'),
				},
				launchEnv(),
				true
			)
			redirect(request.res, `/explorations/${started.subject}`, [
				...cookies,
				cookie('checkmate_toast', `Started ${started.subject} on build ${build}`, 60),
			])
		} catch (error) {
			const text = engineText(error)
			refuse(text, /tool rules/.test(text) ? 'rules' : '')
		}
	}

	function startAnswers(request: Request, form: URLSearchParams, planId: string) {
		const back = `/plans/${planId}`
		const { actor, cookies } = actorFrom(request, form)
		const refuse = (message: Html | string) => actionRefusal(request, back, message)
		const explorationId = form.get('exploration') ?? ''
		if (!actor) return refuse('Enter your name. Checkmate records it with the test.')
		if (planOfExploration(explorationId) !== planId)
			return refuse(`${explorationId} is not an exploration of ${planId}.`)
		const running = runningOf(planId)
		if (running) return refuse(inProgress(planId, running))
		try {
			const answers = unusedAnswers(store, explorationId).length
			startFollow(store, actor, { explorationId, allow: [], claudeArgs: [] }, launchEnv())
			redirect(request.res, `/explorations/${explorationId}`, [
				...cookies,
				cookie('checkmate_toast', `Testing ${plural(answers, 'answer')} of ${explorationId}`, 60),
			])
		} catch (error) {
			refuse(engineText(error))
		}
	}

	function storeDefects(request: Request, form: URLSearchParams, planId: string) {
		const view = form.get('view') === 'rules' ? 'rules' : 'all'
		const { actor, cookies } = actorFrom(request, form)
		const refuse = (message: string) => actionRefusal(request, reviewHref(planId, view), message)
		if (!actor) return refuse('Enter your name. Checkmate records it with the tests.')
		const attached: Array<{ test: string; rule: string }> = []
		try {
			const storable = storableDefects(store, planId)
			requireCondition(
				storable.length,
				`Every defect of ${planId} is stored as a test already. Nothing is left to store.`
			)
			const count = storable.reduce((sum, item) => sum + item.claims.length, 0)
			requireCondition(
				!form.get('count') || form.get('count') === String(count),
				`${plural(count, 'defect')} can be stored now, not ${form.get('count')}. Nothing is stored. Close this dialog and read the count again.`
			)
			for (const { explorationId } of storable) {
				const reply = harvestExploration(store, actor, { explorationId, observations: false })
				attached.push(...(reply.data.attached as typeof attached))
			}
		} catch (error) {
			const stored = attached.length ? ` ${plural(attached.length, 'test')} stored before this refusal.` : ''
			return refuse(`${engineText(error)}${stored}`)
		}
		const list = attached.map((item) => `${item.test} → ${item.rule}`).join(', ')
		redirect(request.res, reviewHref(planId, view), [
			...cookies,
			cookie('checkmate_toast', `Stored ${plural(attached.length, 'defect')} as tests: ${list}`, 60),
		])
	}

	function stopRun(request: Request, form: URLSearchParams, explorationId: string, explorer?: string) {
		const back = `/explorations/${explorationId}`
		const { actor, cookies } = actorFrom(request, form)
		const refuse = (message: Html | string) => actionRefusal(request, back, message)
		if (!actor) return refuse('Enter your name. Checkmate records it with the stop.')
		try {
			recordStop(store, actor, {
				explorationId,
				explorer,
				reason: form.get('reason')?.trim() || undefined,
				background: true,
			})
			startEnding(store, explorationId, actor, explorer, env)
		} catch (error) {
			return refuse(engineText(error))
		}
		const flash = explorer ? `Stopping tester ${explorer} of ${explorationId}…` : `Stopping ${explorationId}…`
		redirect(request.res, back, [...cookies, cookie('checkmate_toast', flash, 60)])
	}

	function sameSiteFrom(value: string | null) {
		return value && safeBack(value) === value ? value : null
	}

	function refererPath(request: Request) {
		const referer = request.req.headers.referer
		if (!referer || !URL.canParse(referer)) return null
		const from = new URL(referer)
		return from.host === request.req.headers.host && from.pathname !== '/permissions'
			? sameSiteFrom(from.pathname + from.search)
			: null
	}

	function firstRequest(request: Request) {
		const first = nextOpen(store, null)
		redirect(request.res, first ? requestHref(first, refererPath(request)) : '/activity')
	}

	function permissionRecord(request: Request, explorationId: string, requestId: string) {
		const { searchParams } = request.url
		const view = { from: sameSiteFrom(searchParams.get('from')), history: searchParams.get('view') === 'history' }
		render(
			request,
			permissionPage(store, context(request), explorationId, requestId, view, null) ??
				emptyRecord(explorationId, requestId)
		)
	}

	function permit(request: Request, form: URLSearchParams, explorationId: string, requestId: string) {
		const { actor, cookies } = actorFrom(request, form)
		const from = sameSiteFrom(form.get('from'))
		const returnTo = form.get('return') ? safeBack(form.get('return')) : null
		const name = `${explorationId}/${requestId}`
		const refuse = (message: Html | string) => {
			const found = permissionOf(store, explorationId, requestId)
			const page =
				found && !found.decision
					? permissionPage(
							store,
							context(request),
							explorationId,
							requestId,
							{ from, history: false },
							{
								error: String(message),
								reason: form.get('reason') ?? '',
								field: form.get('decision') === 'deny' && !form.get('reason')?.trim() ? 'reason' : null,
							}
						)
					: null
			if (page) return render(request, page)
			actionRefusal(request, returnTo ?? from ?? '/activity', message)
		}
		if (!actor) return refuse('Enter your name. Checkmate records it with the answer.')
		try {
			decidePermission(
				store,
				actor,
				{
					askerId: explorationId,
					requestId,
					decision: form.get('decision') ?? '',
					reason: form.get('reason') ?? undefined,
				},
				(explorer, reason) => {
					if (requestOf(store, explorationId)) return requester.stop(actor, explorationId, reason)
					recordStop(store, actor, { explorationId, explorer, reason: reason || undefined, background: true })
					startEnding(store, explorationId, actor, explorer, env)
				}
			)
		} catch (error) {
			const found = permissionOf(store, explorationId, requestId)
			if (!found?.decision) return refuse(engineText(error))
			const flash = `${name} has an answer already: ${found.decision.text}. Nothing is recorded.`
			return redirect(
				request.res,
				returnTo ?? requestHref(found, from),
				returnTo ? [...cookies, cookie('checkmate_toast', flash, 60)] : cookies
			)
		} finally {
			hooks.release()
		}
		const answered = permissionOf(store, explorationId, requestId)!
		const next = returnTo ? null : nextOpen(store, answered)
		const where = returnTo ?? (next ? requestHref(next, from) : (from ?? '/activity'))
		redirect(request.res, where, [
			...cookies,
			cookie('checkmate_toast', `Answered ${name}: ${answered.decision!.text}`, 60),
		])
	}

	function permitMany(request: Request, form: URLSearchParams) {
		const { actor, cookies } = actorFrom(request, form)
		const back = safeBack(form.get('return'))
		const refuse = (message: string) => actionRefusal(request, back, message)
		const decision = form.get('decision')
		const reason = form.get('reason')?.trim() ?? ''
		const named = form.getAll('pick').map((pick) => /^permission:[^:]+:(.+)\/(P[1-9][0-9]{0,8})$/.exec(pick))
		if (!actor) return refuse('Enter your name. Checkmate records it with the answers.')
		if (decision !== 'allow' && decision !== 'deny') return refuse('Choose Allow once or Deny.')
		if (decision === 'deny' && !reason) return refuse('A denial needs a reason. Write it, then deny again.')
		if (!named.length || named.includes(null)) return refuse('Select at least one request.')
		const answered: string[] = []
		const gone: string[] = []
		for (const found of named) {
			const [, explorationId, requestId] = found!
			try {
				decidePermission(store, actor, { askerId: explorationId, requestId, decision, reason }, () => {})
				answered.push(`${explorationId}/${requestId}`)
			} catch {
				gone.push(`${explorationId}/${requestId}`)
			}
		}
		hooks.release()
		if (!answered.length) return refuse(`${gone.join(', ')} had an answer already, or closed. Nothing is recorded.`)
		const verb = decision === 'allow' ? 'Allowed once' : 'Denied'
		const rest = gone.length ? ` ${plural(gone.length, 'request')} had an answer already.` : ''
		redirect(request.res, back, [
			...cookies,
			cookie('checkmate_toast', `${verb}: ${plural(answered.length, 'request')}.${rest}`, 60),
		])
	}

	function messageRecord(request: Request, requestId: string, chatId?: string) {
		const found = requestOf(store, requestId)
		if (!found || (chatId && found.conversation !== chatId))
			return errorPage(request, 404, 'Message not found', 'Open Chats to choose a conversation.')
		const shown = context(request)
		if (isUnread(found) && shown.actor) markRequestRead(store, shown.actor, requestId)
		render(request, chatMessagePage(store, context(request), found))
	}

	function markChatRead(chat: Chat, actor: string | null) {
		if (actor) for (const turn of chat.turns) if (isUnread(turn)) markRequestRead(store, actor, turn.id)
	}

	function planChatHref(chat: Chat) {
		const { planId, planRevision } = chat.context
		return `/plans/${planId}${planRevision ? `@${planRevision}` : ''}?chat=${chat.id}`
	}

	function openPlanPage(request: Request, page: Page, planId: string) {
		const { pathname: path, searchParams } = request.url
		const selected = searchParams.get('chat')
		const fresh = searchParams.get('newChat') === '1'
		if (selected === null && !fresh) return render(request, page)

		const chats = listedChats(store, planId)
		const chat = chats.find((item) => item.id === selected) ?? null
		if (selected !== null && selected !== 'list' && !chat)
			return errorPage(request, 404, 'Chat not found', 'Choose a conversation from the chats of this plan.')
		const params = new URLSearchParams(searchParams)
		params.delete('chat')
		params.delete('newChat')
		const back = params.size ? `${path}?${params}` : path
		const shown = context(request)
		if (chat) markChatRead(chat, shown.actor)
		return render(request, {
			...page,
			title: `Plan chats · ${planId}`,
			crumbs: [
				['Plans', '/'],
				[path.slice('/plans/'.length), back],
				['Plan chats', null],
			],
			drawer: false,
			subjects: [
				...page.subjects,
				'chats',
				...chats.flatMap((item) => item.turns.map((turn) => `request:${turn.id}`)),
			],
			...planChat(store, shown, env, { path, params, chats, chat, fresh }),
		})
	}

	function openChat(request: Request, id: string) {
		const chat = chatOf(store, id)
		if (!chat) return errorPage(request, 404, 'Chat not found', 'Open Chats to choose a conversation.')
		if (chat.context.planChat) return redirect(request.res, planChatHref(chat))
		markChatRead(chat, context(request).actor)
		const page = chatPage(store, context(request), id, env)
		if (page) return render(request, page)
	}

	async function sendChat(request: Request, form: URLSearchParams, id?: string, plan?: RegExpExecArray) {
		const path = plan?.[1] ?? null
		const planId = plan?.[2]
		const planRevision = plan?.[3] ? Number(plan[3]) : undefined
		const returned = form.get('return')
		const params = new URLSearchParams(
			path && returned?.startsWith(`${path}?`) ? returned.slice(path.length + 1) : ''
		)
		params.delete('chat')
		params.delete('newChat')
		const planDestination = (turnId?: string) => {
			const query = new URLSearchParams(params)
			if (turnId) query.set('chat', turnId)
			else query.set('newChat', '1')
			return `${path}?${query}`
		}
		const { actor, cookies } = actorFrom(request, form)
		const back = path ? planDestination(id) : id ? `/chats/${id}` : safeBack(returned ?? '/chats')
		const refuse = (message: string) => actionRefusal(request, back, message)
		if (!actor) return refuse('Enter your name to send a message.')
		const message = form.get('text')?.trim() ?? ''
		if (!message) return refuse('Write a message first.')
		const picked = form.get('harness')
		if (picked !== null && picked !== 'pi' && picked !== 'claude') return refuse('Choose a coding harness.')
		const fromFind = request.url.pathname === '/requests'
		const workspaceHarness = selectedHarness(launchEnv())
		if (fromFind && picked !== null && picked !== workspaceHarness)
			return refuse('The coding harness changed. Reload and try again.')
		const screen = form.get('screen') ?? ''
		const chatId =
			id ??
			(fromFind
				? routes.chatPage.exec(new URL(safeBack(screen), 'http://checkmate.local').pathname)?.[1]
				: undefined)
		const chat = chatId ? chatOf(store, chatId) : null
		if (planId) {
			if (planRevision) planDetail(store, planId, planRevision)
			else planRequest(store, planId)
		}
		if (chatId && (!chat || (planId ? chat.planId !== planId : chat.context.planChat)))
			return refuse('This chat is no longer available here.')
		const harness = (fromFind ? null : picked) ?? chat?.turns.at(-1)?.harness ?? workspaceHarness
		const model = form.get('model') ?? undefined
		const effort = form.get('effort') ?? undefined
		try {
			const catalog = await catalogFor(harness, model === '').catch(() => undefined)
			const choices = { harness, model, effort, catalog }
			const scope: RequestContext | undefined = planId
				? { planId, planRevision, record: null, planChat: true }
				: undefined
			const turn = chatId
				? requester.followChat(actor, chatId, message, choices, scope)
				: requester.startChat(actor, message, scope ?? screenContext(store, screen, true), choices)
			const conversation = requestOf(store, turn)!.conversation
			redirect(request.res, path ? planDestination(conversation) : `/chats/${conversation}`, cookies)
		} catch (error) {
			return refuse(engineText(error))
		}
	}

	function askText(request: Request, form: URLSearchParams) {
		if (form.get('chat') === '1') {
			const screen = form.get('screen') ?? ''
			if (screen.startsWith('/plans/')) {
				const address = new URL(screen, request.url.origin)
				const selected = address.searchParams.get('chat')
				const plan = selected && routes.planChatPost.exec(`${address.pathname}/chats/${selected}/turns`)
				if (plan) {
					form.set('return', address.pathname + address.search)
					return sendChat(request, form, plan[4], plan)
				}
			}
			return sendChat(request, form)
		}
		const { actor, cookies } = actorFrom(request, form)
		const back = safeBack(form.get('return') ?? '/requests')
		const refuse = (message: string) => actionRefusal(request, back, message)
		if (!actor) return refuse('Enter your name to send a message.')
		const text = form.get('text')?.trim() ?? ''
		if (!text) return refuse('Write a message first.')
		if (form.has('harness') && form.get('harness') !== selectedHarness(launchEnv()))
			return refuse('The coding harness changed. Reload and try again.')
		let context
		try {
			context = form.has('context')
				? contextFromData(form.get('context') ?? '')
				: screenContext(store, form.get('screen') ?? '')
		} catch {
			return refuse('The context of the message is not valid.')
		}
		let id
		try {
			id = requester.ask(actor, text, context)
		} catch (error) {
			return refuse(engineText(error))
		}
		redirect(request.res, `/requests/${id}`, cookies)
	}

	function contextFromData(text: string) {
		const data = JSON.parse(text) as { planId?: unknown; record?: { kind?: unknown; id?: unknown } | null }
		const planId = typeof data.planId === 'string' && data.planId ? requireIdentifier(data.planId, 'plan ID') : null
		const record =
			typeof data.record?.kind === 'string' && typeof data.record.id === 'string'
				? { kind: data.record.kind.slice(0, 40), id: data.record.id.slice(0, 96) }
				: null
		return { planId, record }
	}

	function stopRequest(request: Request, form: URLSearchParams, requestId: string) {
		const { actor, cookies } = actorFrom(request, form)
		const found = requestOf(store, requestId)
		const chat = found ? `/chats/${found.conversation}` : ''
		const details = found ? `${chat}/messages/${requestId}` : ''
		const returned = form.get('return')
		const address = returned?.startsWith('/plans/') ? new URL(returned, request.url.origin) : null
		const plan = address && (routes.latestPlan.exec(address.pathname) ?? routes.plan.exec(address.pathname))
		const scoped =
			found &&
			plan &&
			address.searchParams.get('chat') === found.conversation &&
			chatOf(store, found.conversation)?.planId === plan[1]
		const back = scoped
			? address!.pathname + address!.search
			: returned && (returned === chat || returned === details)
				? returned
				: `/requests/${requestId}`
		if (!actor) return actionRefusal(request, back, 'Enter your name. Checkmate records it with the stop.')
		const flash =
			found?.state === 'running' || found?.state === 'waiting' ? 'Stopping this turn…' : 'This turn has ended.'
		requester.stop(actor, requestId, form.get('reason')?.trim() ?? '')
		hooks.release()
		redirect(request.res, back, [...cookies, cookie('checkmate_toast', flash, 60)])
	}

	function newConversation(request: Request, form: URLSearchParams) {
		const { actor, cookies } = actorFrom(request, form)
		const back = safeBack(form.get('return') ?? '/requests')
		if (!actor) return actionRefusal(request, back, 'Enter your name. Checkmate records it with the change.')
		requester.newConversation(actor)
		redirect(request.res, back, [
			...cookies,
			cookie('checkmate_toast', 'The next request starts a new conversation.', 60),
		])
	}

	function testerCount(request: Request) {
		const harness = selectedHarness(workspaceUiEnv(store, env))
		const query = request.url.searchParams
		const reply = (status: number, body: unknown) =>
			send(request.res, status, 'application/json; charset=utf-8', JSON.stringify(body), {
				'Cache-Control': 'no-store',
			})
		if (query.get('harness') !== harness)
			return reply(409, { error: 'The coding harness changed. Reload the page.' })
		const level = query.get('level') ?? ''
		if (!(levelNames as string[]).includes(level)) return reply(422, { error: 'Choose a test level.' })
		try {
			const plan = query.get('plan')
			const target = query.get('target')
			const profile = plan ? planRequest(store, plan).target.profile : targetRevision(store, target ?? '').profile
			const policy = testLevels[level as TestLevel]
			return reply(200, {
				count: profile.explore?.explorers ?? policy.explorers,
				model: testerModelText(store, harness) || (harness === 'claude' ? policy.model : ''),
				effort: testerEffortText(store, harness),
			})
		} catch {
			return reply(404, { error: 'Choose a target or plan.' })
		}
	}

	function catalogFor(harness: Harness, hostDefault = false) {
		const key = hostDefault && harness === 'pi' ? 'pi-host-default' : harness
		let pending = pendingModels.get(key)
		if (!pending) {
			pending = discoverModelCatalog(harness, store.workspace, {
				...env,
				CHECKMATE_HARNESS: harness,
				...(key === 'pi-host-default'
					? { CHECKMATE_PI_MODEL: undefined, CHECKMATE_PI_PROVIDER: undefined }
					: {}),
			})
			pendingModels.set(key, pending)
			void pending.finally(() => pendingModels.delete(key)).catch(() => {})
		}
		return pending
	}

	async function modelCatalog(request: Request) {
		const requested = request.url.searchParams.get('harness')
		const chat = request.url.searchParams.get('scope') === 'chat'
		const active = selectedHarness(launchEnv())
		const harness = chat && (requested === 'pi' || requested === 'claude') ? requested : active
		const sendJson = (status: number, body: unknown) =>
			send(request.res, status, 'application/json; charset=utf-8', JSON.stringify(body), {
				'Cache-Control': 'no-store',
			})
		if (requested !== harness) return sendJson(409, { error: 'The coding harness changed. Reload the page.' })
		try {
			const models = await catalogFor(harness, chat && request.url.searchParams.get('hostDefault') === '1')
			if (!chat && selectedHarness(launchEnv()) !== harness)
				return sendJson(409, { error: 'The coding harness changed. Reload the page.' })
			return sendJson(200, chat ? { ...models, ...chatModelOrder(models) } : models)
		} catch {
			return sendJson(503, { error: 'Could not load models. Try again.' })
		}
	}

	function saveHarness(request: Request, form: URLSearchParams) {
		const { actor, cookies } = actorFrom(request, form)
		if (!actor)
			return errorPage(request, 422, 'Coding harness', 'Enter your name. Checkmate records it with the setting.')
		try {
			saveWorkspaceHarness(store, actor, form.get('harness') ?? '')
		} catch (error) {
			return errorPage(request, 422, 'Coding harness', engineText(error))
		}
		redirect(request.res, '/settings/harness', [
			...cookies,
			cookie('checkmate_toast', 'Saved the coding harness', 60),
		])
	}

	function saveModel(request: Request, form: URLSearchParams) {
		const { actor, cookies } = actorFrom(request, form)
		const typed = form.get('model') ?? ''
		const page = (error: string) => () => harnessPage(store, context(request), env, null, { value: typed, error })
		if (!actor) return refuse(request, page('Enter your name. Checkmate records it with the setting.'), cookies)
		const harness = selectedHarness(workspaceUiEnv(store, env))
		if (form.get('harness') !== harness)
			return refuse(
				request,
				() =>
					harnessPage(store, context(request), env, null, {
						value: requestModelText(store, harness),
						error: 'The coding harness changed. Reload the page and try again.',
					}),
				cookies
			)
		try {
			saveRequestModel(store, actor, typed, harness)
		} catch (error) {
			return refuse(request, page(engineText(error)), cookies)
		}
		redirect(request.res, '/settings/harness', [
			...cookies,
			cookie(
				'checkmate_toast',
				typed.trim() ? 'Saved the model for chats' : 'Chats use the model of the coding harness',
				60
			),
		])
	}

	function saveModelSettings(request: Request, form: URLSearchParams) {
		const { actor, cookies } = actorFrom(request, form)
		const harness = selectedHarness(workspaceUiEnv(store, env))
		const tester = form.get('testerModel') ?? testerModelText(store, harness)
		const requested = form.get('requestModel') ?? requestModelText(store, harness)
		const page = (error: string) => () =>
			harnessPage(store, context(request), env, null, { value: requested, error: '' }, { value: tester, error })
		if (!actor) return refuse(request, page('Enter your name. Checkmate records it with the setting.'), cookies)
		if (form.get('harness') !== harness)
			return refuse(
				request,
				() =>
					harnessPage(
						store,
						context(request),
						env,
						null,
						{ value: requestModelText(store, harness), error: '' },
						{
							value: testerModelText(store, harness),
							error: 'The coding harness changed. Reload the page and try again.',
						}
					),
				cookies
			)
		if (!form.has('requestModel') || !form.has('testerModel'))
			return refuse(request, page('Reload the page to save both model choices.'), cookies)
		try {
			saveModels(
				store,
				actor,
				harness,
				requested,
				tester,
				form.get('requestEffort') ?? undefined,
				form.get('testerEffort') ?? undefined
			)
		} catch (error) {
			return refuse(request, page(engineText(error)), cookies)
		}
		redirect(request.res, '/settings/harness', [...cookies, cookie('checkmate_toast', 'Saved the models', 60)])
	}

	function saveRules(request: Request, form: URLSearchParams) {
		const { actor, cookies } = actorFrom(request, form)
		const typed = form.get('rules') ?? ''
		const page = (error: string) => () => harnessPage(store, context(request), env, { value: typed, error })
		if (!actor) return refuse(request, page('Enter your name. Checkmate records it with the setting.'), cookies)
		const harness = selectedHarness(workspaceUiEnv(store, env))
		if (form.get('harness') !== harness)
			return refuse(
				request,
				() =>
					harnessPage(store, context(request), env, {
						value: testerRulesText(store, harness),
						error: 'The coding harness changed. Reload the page and try again.',
					}),
				cookies
			)
		try {
			saveTesterRules(store, actor, typed, harness)
		} catch (error) {
			return refuse(request, page(engineText(error)), cookies)
		}
		redirect(request.res, '/settings/harness', [
			...cookies,
			cookie('checkmate_toast', 'Saved the tool rules of testers', 60),
		])
	}

	function setupChoice(form: URLSearchParams, url: string) {
		const typed = form.get('operations') ?? ''
		const local = url === '' || isLocalAddress(url)
		const yes = typed === 'yes' || (typed === '' && local)
		return { yes, chosen: typed === 'yes' || typed === 'no' || local, local }
	}

	function setupAddress(url: string) {
		return /^https?:\/\/[^\s/]+/i.test(url) ? URL.parse(url) : null
	}

	// The entries of an application that is not a web application: one form field for each entry that a recipe declares.
	const otherEntries = () =>
		[...declaredEntryPoints(recipes(store.workspace)).values()].filter((entry) => entry.name !== 'web')

	function otherEntryValues(form: URLSearchParams) {
		return Object.fromEntries(
			otherEntries()
				.map((entry) => [entry.name, (form.get(`entry.${entry.name}`) ?? '').trim()])
				.filter(([, value]) => value)
		) as Record<string, string>
	}

	function previewSetup(request: Request, form: URLSearchParams) {
		const url = (form.get('url') ?? '').trim()
		const others = otherEntryValues(form)
		const address = setupAddress(url)
		const reply = (body: Record<string, unknown>) =>
			send(request.res, 200, 'application/json; charset=utf-8', JSON.stringify(body))
		if (!address && !Object.keys(others).length)
			return reply({ error: 'Give a full address, for example http://localhost:3000.' })
		try {
			const choice = setupChoice(form, address ? url : '')
			const input = actionInput('setup', {
				...(address ? { url } : {}),
				entries: Object.keys(others).length ? others : undefined,
				targetId: form.get('target')?.trim() || undefined,
				environment: form.get('environment')?.trim() || undefined,
				operations: choice.yes ? undefined : [readOnlyOperation],
			})
			const planned = setupAssumptions(store.workspace, { ...input, env })
			reply({
				address: address ? address.host : Object.values(others).join(' '),
				local: choice.local,
				targetId: planned.targetId,
				assumed: assumedRows(planned.assumed.filter((line) => !line.startsWith('target='))),
			})
		} catch (error) {
			reply({ error: plainMessage(error) })
		}
	}

	async function setUp(request: Request, form: URLSearchParams) {
		const back = '/setup'
		const { actor, cookies } = actorFrom(request, form)
		const refuse = (message: Html | string, field = '') => actionRefusal(request, back, message, field)
		const typedUrl = (form.get('url') ?? '').trim()
		const others = otherEntryValues(form)
		if (!actor) return refuse('Enter your name. Checkmate records it with the target.')
		const address = setupAddress(typedUrl)
		const url = address ? typedUrl : ''
		if (!address && (typedUrl || !Object.keys(others).length)) {
			const onHome = !targetList(store).length
			const submitted = values(form, [
				'url',
				'target',
				'environment',
				'operations',
				...otherEntries().map((entry) => `entry.${entry.name}`),
			])
			return render(
				request,
				firstRunPage(store.workspace, context(request), onHome, cameFrom(request), submitted),
				cookies
			)
		}
		const choice = setupChoice(form, url)
		if (!choice.chosen)
			return refuse(
				`${address?.host} is not a local address. Choose whether testers may change data there.`,
				'operations'
			)
		if (!choice.local && form.get('confirmed') !== '1')
			return refuse(`Confirm that Checkmate may test ${address?.host}, an address that is not local.`, 'url')
		const typedTarget = form.get('target')?.trim() || undefined
		const environment = form.get('environment')?.trim() || undefined
		try {
			const input = actionInput('setup', {
				url: address ? url : undefined,
				entries: Object.keys(others).length ? others : undefined,
				targetId: typedTarget,
				environment,
				operations: choice.yes ? undefined : [readOnlyOperation],
			})
			if (address) requireAnswer(await urlReachable(url), url)
			const reply = setupTarget(store, actor, { ...input, answered: address ? true : undefined, env })
			if (reply.status !== 'completed') return refuse(reply.reasons.join(' '), 'target')
			if (!reply.data.ready) {
				const targetId = String(reply.data.targetId)
				redirect(request.res, `/settings/targets/${encodeURIComponent(targetId)}`, [
					...cookies,
					cookie(
						'checkmate_toast',
						`The application answered, but the saved profile is not ready. Recheck it: checkmate delegate setup ${targetId}`,
						60
					),
				])
				return
			}
			redirect(request.res, `/new?target=${encodeURIComponent(String(reply.data.targetId))}`, [
				...cookies,
				cookie('checkmate_toast', `Set up target ${reply.data.targetId}`, 60),
			])
		} catch (error) {
			const text = engineText(error)
			refuse(
				text,
				/\/targetId/.test(text)
					? 'target'
					: /production/.test(text)
						? 'environment'
						: /did not answer/.test(text)
							? 'url'
							: ''
			)
		}
	}

	function startChange(request: Request, form: URLSearchParams) {
		const back = '/new'
		const { actor, cookies } = actorFrom(request, form)
		const refuse = (message: Html | string, field = '') => actionRefusal(request, back, message, field)
		const text = form.get('text') ?? ''
		const typedFile = form.get('file')?.trim() ?? ''
		const planId = form.get('plan')?.trim() ?? ''
		const targetId = form.get('target')?.trim() ?? ''
		const build = form.get('build')?.trim() ?? ''
		const level = form.get('level')?.trim() || 'normal'
		const [since, until, repo] = ['since', 'until', 'repo'].map((name) => form.get(name)?.trim() || undefined)
		const allow = ruleTokens(form.get('rules') ?? '')
		if (!actor) return refuse('Enter your name. Checkmate records it with the plan and the test.')
		if (form.has('harness') && form.get('harness') !== selectedHarness(launchEnv()))
			return refuse('The coding harness changed. Reload the page and try again.')
		if (!typedFile && !text.trim())
			return refuse('Give the ticket: the path of a file in the workspace, or the pasted text.', 'file')
		if (typedFile && text.trim()) return refuse('Give the file or the pasted text, not both.', 'text')
		let source = ''
		try {
			if (typedFile) source = ticketFile(store, typedFile)
		} catch (error) {
			return refuse(engineText(error), 'file')
		}
		if (hasRequest(store, planId))
			return refuse(`A plan ${planId} exists already. Give another name, or test it from its page.`, 'plan')
		if (!targetList(store).some((item) => item.targetId === targetId))
			return refuse('Choose a target, or set one up.', 'target')
		if (until && !since) return refuse('Until needs Since. Fill in Since, or leave Until empty.', 'until')
		const chosen = instanceFrom(form, targetId)
		if (chosen.error) return refuse(chosen.error, 'instance')
		const instance =
			activeInstances(targetId).find((item) => item.instanceId === chosen.instance) ??
			activeInstances(targetId)[0]
		const address = instance && addressOf(targetId, instance.entries)
		if (address && URL.canParse(address) && !isLocalAddress(address) && form.get('confirmed') !== '1')
			return refuse(`Confirm that Checkmate may test ${hostOf(address)}, an address that is not local.`, 'target')
		const childEnv = launchEnv()
		const harness = selectedHarness(childEnv)
		const kept = text.trim() ? `.checkmate/sources/${planId}.md` : ''
		let input
		try {
			input = actionInput('start_test', {
				planId,
				target: targetId,
				sources: [kept || source],
				build,
				level,
				instance: chosen.instance,
				since,
				until,
				repo,
			})
			requireChild(childEnv, harness)
			launchPlan(
				targetRevision(store, targetId).profile,
				{
					planId,
					build,
					allow,
					claudeArgs: [],
					level: input.level,
					testerModels: testerChoicesFrom(form, 'testerModel'),
					testerEfforts: testerChoicesFrom(form, 'testerEffort'),
				},
				childEnv,
				testerModelText(store, harness),
				true
			)
		} catch (error) {
			const message = engineText(error)
			return refuse(message, /tool rules/.test(message) ? 'rules' : '')
		}
		try {
			if (kept) {
				mkdirSync(resolve(store.workspace, '.checkmate', 'sources'), { recursive: true })
				writeFileSync(resolve(store.workspace, kept), text.endsWith('\n') ? text : `${text}\n`)
			}
			const started = runTest(
				store,
				actor,
				{
					...input,
					allow,
					claudeArgs: [],
					testerModels: testerChoicesFrom(form, 'testerModel'),
					testerEfforts: testerChoicesFrom(form, 'testerEffort'),
				},
				childEnv,
				true
			)
			redirect(request.res, `/explorations/${started.subject}`, [
				...cookies,
				cookie('checkmate_toast', `Started ${started.subject} on build ${build}`, 60),
			])
		} catch (error) {
			if (kept && !hasRequest(store, planId)) rmSync(resolve(store.workspace, kept), { force: true })
			refuse(engineText(error))
		}
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
				state.field = 'json'
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
		if (!sameSecret(form.get('csrf') ?? '', csrf))
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
		if (pathname === '/settings/harness/select') return saveHarness(request, form)
		if (pathname === '/settings/harness/models') return saveModelSettings(request, form)
		if (pathname === '/settings/claude' || pathname === '/settings/harness/rules') return saveRules(request, form)
		if (pathname === '/settings/claude/model' || pathname === '/settings/harness/model')
			return saveModel(request, form)
		if (pathname === '/requests') return askText(request, form)
		if (pathname === '/chats') return sendChat(request, form)
		const chat = routes.chatTurn.exec(pathname)
		if (chat) return sendChat(request, form, chat[1])
		const planChatForm = routes.planChatPost.exec(pathname)
		if (planChatForm) return sendChat(request, form, planChatForm[4], planChatForm)
		if (pathname === '/requests/conversation') return newConversation(request, form)
		const stoppingRequest = routes.stopRequest.exec(pathname)
		if (stoppingRequest) return stopRequest(request, form, stoppingRequest[1])
		if (pathname === '/setup/assumed') return previewSetup(request, form)
		if (pathname === '/setup') return await setUp(request, form)
		if (pathname === '/new') return startChange(request, form)
		const handoff = routes.handoff.exec(pathname)
		if (handoff) return handOver(request, form, handoff[1])
		const adding = routes.rules.exec(pathname)
		if (adding) return changeRule(request, form, adding[1], null)
		const editing = routes.rule.exec(pathname)
		if (editing) return changeRule(request, form, editing[1], editing[2])
		const removing = routes.removeRule.exec(pathname)
		if (removing) return removeRule(request, form, removing[1], removing[2])
		const starting = routes.startTest.exec(pathname)
		if (starting) return startTest(request, form, starting[1])
		const following = routes.startFollow.exec(pathname)
		if (following) return startAnswers(request, form, following[1])
		const harvesting = routes.harvest.exec(pathname)
		if (harvesting) return storeDefects(request, form, harvesting[1])
		if (routes.permitMany.test(pathname)) return permitMany(request, form)
		const permitting = routes.permit.exec(pathname)
		if (permitting) return permit(request, form, permitting[1], permitting[2])
		const stopping = routes.stopRun.exec(pathname)
		if (stopping) return stopRun(request, form, stopping[1])
		const stoppingTester = routes.stopTester.exec(pathname)
		if (stoppingTester) return stopRun(request, form, stoppingTester[1], stoppingTester[2])
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
			if (req.method === 'POST' && request.url.pathname === lifecyclePath) {
				const action = req.headers['x-checkmate-action']
				const nonce = req.headers['x-checkmate-nonce']
				const proof = req.headers['x-checkmate-proof']
				if (
					(action !== 'status' && action !== 'open-pi' && action !== 'stop') ||
					typeof nonce !== 'string' ||
					!/^[0-9a-f]{48}$/.test(nonce) ||
					typeof proof !== 'string' ||
					!sameSecret(proof, lifecycleProof(hookToken, workspace, process.pid, action, nonce)) ||
					closed
				)
					return send(res, 403, 'text/plain; charset=utf-8', 'Refused.')
				if (action === 'open-pi') env.CHECKMATE_HARNESS = 'pi'
				if (action === 'stop') res.once('finish', () => void close())
				const body = JSON.stringify({ harness: selectedHarness(launchEnv()) })
				return send(res, 200, 'application/json; charset=utf-8', body, {
					'X-Checkmate-Proof': lifecycleProof(hookToken, workspace, process.pid, action, nonce, body),
				})
			}
			if (req.method === 'POST' && hooks.handles(request.url.pathname))
				return await hooks.handle(req, res, request.url.pathname)
			if (req.method === 'GET' || req.method === 'HEAD') return await get(request)
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

	async function close() {
		if (closed) return
		closed = true
		await requester.close()
		hooks.close()
		clearInterval(poll)
		clearInterval(heartbeat)
		clearInterval(supervisorWatch)
		clearInterval(recipeWatch)
		for (const client of clients) client.res.end()
		clients.clear()
		await new Promise<void>((resolve) => {
			const forceClose = setTimeout(() => server.closeAllConnections(), 1000)
			server.close(() => {
				clearTimeout(forceClose)
				resolve()
			})
		})
		closeStore(watch)
		closeStore(store)
		if (port) removeUiFile(options.workspace, port)
	}

	try {
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject)
			server.listen(options.port ?? 0, '127.0.0.1', () => {
				server.off('error', reject)
				resolve()
			})
		})
		const address = server.address()
		port = typeof address === 'object' && address ? address.port : 0
		if (!liveUi(options.workspace)) {
			closeOpenPermissions(store, 'ui-stopped')
			staleRequests(store)
		}
		writeUiFile(options.workspace, { port, pid: process.pid, hookToken })
	} catch (error) {
		await close()
		throw error
	}

	return { url: `http://127.0.0.1:${port}/`, close }
}
