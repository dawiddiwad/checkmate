import type { Store } from '../store.ts'
import type { Html } from './html.ts'
import type { Context, Page } from './layout.ts'
import type { CellStatus, ClaimBuildState } from '../rulemap.ts'
import { claimDetails, ruleMap } from '../rulemap.ts'
import type { Permission } from '../permissions.ts'
import { openPermissions } from '../permissions.ts'
import { planRequest } from '../plans.ts'
import { approvalPolicy } from '../contracts.ts'
import { storableDefects } from '../harvest.ts'
import { oracleStates } from '../journal.ts'
import {
	mergedClaims,
	mergedQuestions,
	needsYou,
	planDetail,
	planExplorations,
	planHasRevision,
	planStatus,
} from '../views.ts'
import { planCost } from '../costs.ts'
import { age, asList, costText, glyph, html, plural, words } from './html.ts'
import { crumbBar } from './layout.ts'
import { keptText, messages } from './forms.ts'
import { askBadge, askTitle, requestHref, requestName, rowOptions, waitsFor } from './permissions.ts'
import { defaultBuild } from '../modes.ts'
import { explorationEvents } from '../explorations.ts'
import { phaseOf } from './activity.ts'
import {
	copyDialog,
	followDialog,
	instanceChoice,
	ruleDialog,
	storeButton,
	storeDialog,
	testButton,
	testDialog,
	actionButton,
} from './actions.ts'
import { optionsBox } from './activity.ts'
import type { Refusal } from './records.ts'
import { evidenceViewer, recordDrawer } from './records.ts'

type Map = ReturnType<typeof ruleMap>
type Rule = Map['rows'][number]['rule']
type ClaimRow = ReturnType<typeof mergedClaims>[number]
type Detail = ReturnType<typeof claimDetails>[number]
type QuestionRow = ReturnType<typeof mergedQuestions>[number]
type Waiting = ReturnType<typeof needsYou>['items'][number]

export type Kind =
	'permission' | 'finding' | 'defect' | 'rejected' | 'question' | 'answered' | 'deferred' | 'gap' | 'approval'

export type Item = {
	key: string
	kind: Kind
	id: string
	title: string
	rule: string | null
	builds: string[]
	needs: boolean
	blocking: boolean
	severity: string | null
	topic: string | null
	href: string
	meta: string
	claim: ClaimRow | null
	detail: Detail | null
	question: QuestionRow | null
	waiting: Waiting | null
	permission: Permission | null
}

export type Area = { label: string; rules: string[]; cells: CellStatus[] }

export type Review = ReturnType<typeof reviewOf>

const severityOrder = ['critical', 'high', 'medium', 'low']
const shownBuilds = 3

export const outside = 'outside'

export function areasOf(map: Map): Area[] {
	return map.areas.map((area) => ({
		label: area.label,
		rules: area.ruleIds,
		cells: area.cells.map((cell) => cell.status),
	}))
}

const stateWords: Record<ClaimBuildState, string> = {
	new: 'New',
	still_present: 'Still present',
	fixed: 'Fixed',
	returned: 'Returned',
	disputed: 'Disputed',
	not_retested: 'Not retested',
}

export function latestClaimBuild(detail: Detail | null) {
	return detail?.builds.findLast((on) => on.state !== 'not_retested') ?? detail?.builds.at(-1) ?? null
}

function claimItem(planId: string, claim: ClaimRow, detail: Detail | null, needs: boolean): Item {
	const kind: Kind =
		claim.state === 'rejected' ? 'rejected' : oracleStates.includes(claim.state) ? 'finding' : 'defect'
	const latest = latestClaimBuild(detail)
	const meta =
		kind === 'finding'
			? `${claim.severity} · ${words(claim.state)}`
			: kind === 'rejected'
				? `rejected by ${claim.decision?.actor ?? 'someone'}`
				: [
						latest ? stateWords[latest.state] : null,
						claim.handoff ? `handed over to ${claim.handoff.to}` : null,
						`×${claim.reporters}`,
					]
						.filter(Boolean)
						.join(' · ')
	const builds =
		detail?.builds.filter((on) => ['new', 'still_present', 'returned', 'disputed'].includes(on.state)) ?? []
	return {
		key: `c:${claim.id}`,
		kind,
		id: claim.id,
		title: claim.title,
		rule: claim.rule ?? null,
		builds: builds.map((on) => on.build),
		needs,
		blocking: false,
		severity: claim.severity,
		topic: null,
		href: `/explorations/${claim.explorationId}/claims/${claim.id}`,
		meta,
		claim,
		detail,
		question: null,
		waiting: null,
		permission: null,
	}
}

function questionItem(question: QuestionRow, needs: boolean): Item {
	const open = question.answer === null
	return {
		key: `q:${question.id}`,
		kind: open ? 'question' : question.decision === 'defer' ? 'deferred' : 'answered',
		id: question.id,
		title: question.question,
		rule: question.rule ?? null,
		builds: question.builds,
		needs,
		blocking: open && question.blocking,
		severity: null,
		topic: question.label,
		href: `/explorations/${question.explorationId}/questions/${question.id}`,
		meta: [
			open ? 'open' : question.decision === 'defer' ? 'deferred' : 'answered',
			question.members.length > 1 ? `×${question.members.length}` : null,
		]
			.filter(Boolean)
			.join(' · '),
		claim: null,
		detail: null,
		question,
		waiting: null,
		permission: null,
	}
}

function waitingItem(planId: string, waiting: Waiting): Item {
	if (waiting.kind === 'gap')
		return {
			key: `g:${waiting.id}`,
			kind: 'gap',
			id: waiting.id,
			title: waiting.title,
			rule: null,
			builds: [],
			needs: true,
			blocking: waiting.group === 'blocking',
			severity: null,
			topic: null,
			href: `/plans/${planId}@${waiting.revision}/gaps/${waiting.id}`,
			meta: waiting.runId ? `run gap · ${waiting.runId}` : 'plan gap',
			claim: null,
			detail: null,
			question: null,
			waiting,
			permission: null,
		}
	const plan = waiting.kind === 'plan'
	return {
		key: plan ? `p:${waiting.id}` : `r:${waiting.id}`,
		kind: 'approval',
		id: waiting.id,
		title: plan ? `Approve ${waiting.id}: ${waiting.title}` : waiting.title,
		rule: null,
		builds: [],
		needs: true,
		blocking: false,
		severity: null,
		topic: null,
		href: plan ? `/plans/${waiting.id}` : `/runs/${waiting.id}`,
		meta: plan ? `plan · ${waiting.state ?? 'pending'}` : 'run result',
		claim: null,
		detail: null,
		question: null,
		waiting,
		permission: null,
	}
}

function permissionItem(item: Permission): Item {
	return {
		key: `perm:${requestName(item)}`,
		kind: 'permission',
		id: requestName(item),
		title: askTitle(item),
		rule: null,
		builds: [],
		needs: true,
		blocking: false,
		severity: null,
		topic: null,
		href: requestHref(item, null),
		meta: '',
		claim: null,
		detail: null,
		question: null,
		waiting: null,
		permission: item,
	}
}

export function reviewOf(store: Store, planId: string, harness?: Context['harness']) {
	const map = ruleMap(store, planId)
	const details = new Map(claimDetails(store, planId).map((detail) => [detail.id, detail]))
	const waiting = needsYou(store).items.filter((item) => item.planId === planId)
	const waits = new Set(waiting.map((item) => `${item.kind}:${item.id}`))
	const claims = mergedClaims(store, planId).map((claim) =>
		claimItem(planId, claim, details.get(claim.id) ?? null, waits.has(`claim:${claim.id}`))
	)
	const questions = mergedQuestions(store, planId).map((question) =>
		questionItem(question, waits.has(`question:${question.id}`))
	)
	const others = waiting.filter((item) => ['gap', 'plan', 'result'].includes(item.kind))
	const known = new Set(map.rows.map((row) => row.rule.id))
	const items = [
		...openPermissions(store, planId).map(permissionItem),
		...claims,
		...questions,
		...others.map((item) => waitingItem(planId, item)),
	].map((item) => (item.rule !== null && !known.has(item.rule) ? { ...item, rule: outside } : item))
	const { request, target } = planRequest(store, planId)
	const explorations = planExplorations(store, planId)
	const latest = planHasRevision(store, planId) ? planDetail(store, planId) : null
	const running = explorations.find((item) => item.running) ?? null
	const qa = planStatus(store, planId, harness).qa
	const answers = qa.follow.find((item) => item.available) ?? null
	return {
		phase: running ? phaseOf(explorationEvents(store, running.explorationId), running.state) : null,
		answers,
		qa,
		planId,
		objective: request.objective,
		target: `${target.profile.targetId}@${target.revision}`,
		revision: latest?.latestRevision ?? null,
		sha: latest?.sha256 ?? '',
		latestFinalizedRun: latest?.runs.findLast((run) => run.state === 'finalized') ?? null,
		map,
		areas: areasOf(map),
		items,
		explorations,
		running,
		storable: storableDefects(store, planId).reduce((sum, item) => sum + item.claims.length, 0),
		approvalRequired: approvalPolicy(target.profile).plan === 'required',
	}
}

export function buildLabel(review: Review, build: string) {
	return `B${review.map.builds.findIndex((item) => item.build === build) + 1}`
}

export function itemsOf(review: Review, view: string) {
	const items = review.items.filter((item) => item.kind !== 'permission' || view === 'needs')
	if (view === 'needs') return items.filter((item) => item.needs)
	if (view === 'all') return items
	if (view.startsWith('rule:')) {
		const id = view.slice(5)
		return items.filter((item) => (id === outside ? item.rule === outside || item.rule === null : item.rule === id))
	}
	if (view.startsWith('area:')) {
		const area = review.areas.find((each) => each.label === view.slice(5))
		return items.filter((item) => item.rule !== null && area?.rules.includes(item.rule))
	}
	if (view.startsWith('build:')) return items.filter((item) => item.builds.includes(view.slice(6)))
	return []
}

const blockingLabel = 'Questions that block testing'

type Group = { label: string; items: Item[] }

function groupsOf(items: Item[]): Group[] {
	const of = (label: string, chosen: Item[]) => ({ label, items: chosen })
	const open = (item: Item) => item.kind === 'question' || item.kind === 'gap'
	const topics = [...new Set(items.filter((item) => open(item) && !item.blocking).map((item) => item.topic))]
	const bySeverity = (a: Item, b: Item) =>
		severityOrder.indexOf(a.severity ?? '') - severityOrder.indexOf(b.severity ?? '')
	return [
		of(
			blockingLabel,
			items.filter((item) => open(item) && item.blocking)
		),
		of(
			'Permission requests',
			items.filter((item) => item.kind === 'permission')
		),
		of('Is this a defect?', items.filter((item) => item.kind === 'finding').sort(bySeverity)),
		of(
			'Approvals',
			items.filter((item) => item.kind === 'approval')
		),
		...topics
			.sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
			.map((topic) =>
				of(
					topic ? `Questions · ${topic}` : 'Questions',
					items.filter((item) => open(item) && !item.blocking && item.topic === topic)
				)
			),
		...severityOrder.map((severity) =>
			of(
				`${severity} defects`,
				items.filter((item) => item.kind === 'defect' && item.severity === severity)
			)
		),
		of(
			'Answered questions',
			items.filter((item) => item.kind === 'answered')
		),
		of(
			'Deferred questions',
			items.filter((item) => item.kind === 'deferred')
		),
		of(
			'Rejected findings',
			items.filter((item) => item.kind === 'rejected')
		),
	].filter((group) => group.items.length)
}

function ruleGroups(review: Review, view: string, items: Item[]): Group[] {
	const area = review.areas.find((each) => each.label === view.slice(5))
	if (!area) return []
	return area.rules.flatMap((id) => {
		const own = items.filter((item) => item.rule === id)
		const text = review.map.rows.find((row) => row.rule.id === id)?.rule.text ?? ''
		return own.length ? [{ label: `${id} · ${text}`, items: groupsOf(own).flatMap((group) => group.items) }] : []
	})
}

const tags: Record<string, [string, string]> = {
	finding: ['Finding', 'you'],
	question: ['Question', ''],
	answered: ['Answered', 'pass'],
	deferred: ['Deferred', ''],
	gap: ['Gap', ''],
	approval: ['Approve', 'you'],
	rejected: ['Rejected', ''],
	critical: ['Critical', 'crit'],
	high: ['High', 'fail'],
	medium: ['Medium', ''],
	low: ['Low', ''],
}

export function itemTag(item: Item) {
	if (item.permission) return askBadge()
	if (item.blocking) return html`<span class="sp-pill you"><span class="dot" aria-hidden="true"></span>Blocks</span>`
	const [label, color] = tags[item.kind === 'defect' ? (item.severity ?? 'low') : item.kind] ?? tags.low
	return html`<span class="sp-pill ${color}">${label}</span>`
}

export type Option = { label: string; control: Html }

function hiddenFields(context: Context, item: Item, extra: Array<[string, string]> = []) {
	return html`<input type="hidden" name="csrf" value="${context.csrf}" />
		<input type="hidden" name="return" value="${context.path}" data-return />
		<input type="hidden" name="item" value="${item.key}" />
		${extra.map(([name, value]) => html`<input type="hidden" name="${name}" value="${value}" />`)}`
}

function action(item: Item) {
	if (item.claim) return `/explorations/${item.claim.explorationId}/claims/${item.claim.id}`
	if (item.question) return `/explorations/${item.question.explorationId}/questions/${item.question.id}`
	return item.href
}

function optionButton(n: number, label: string, name = label) {
	return html`<button class="sp-btn" data-option aria-label="${n}: ${name}" title="${name}">
		<kbd aria-hidden="true">${n}</kbd><span>${label}</span>
	</button>`
}

function optionForm(
	context: Context,
	item: Item,
	n: number,
	label: string,
	fields: Array<[string, string]>,
	name = label
) {
	return html`<form method="post" action="${action(item)}" class="sp-opt">
		${hiddenFields(context, item, fields)}${optionButton(n, label, name)}
	</form>`
}

function reveal(n: number, label: string, field: string, item: Item, name = label) {
	return html`<a
		class="sp-btn"
		href="${item.href}#${field}"
		data-option
		data-reveal="${field}"
		aria-label="${n}: ${name}"
		title="${name}"
		><kbd aria-hidden="true">${n}</kbd><span>${label}</span></a
	>`
}

export function rightAsBuilt(question: { actual: string | null }) {
	return question.actual ? `Right as built: ${question.actual}` : 'Right as built.'
}

export function optionsOf(context: Context, review: Review, item: Item): Html[] {
	if (item.kind === 'finding')
		return [
			optionForm(context, item, 1, 'Yes, a defect', [['verdict', 'approved']], 'Yes, accept as a defect'),
			reveal(2, 'No', 'reject', item, 'No, reject the finding'),
		]
	if (item.kind === 'defect')
		return [
			item.claim?.handoff
				? html`<form method="post" action="/plans/${review.planId}/handoff" class="sp-opt">
						${hiddenFields(context, item, [
							['claim', item.id],
							['undo', '1'],
						])}${optionButton(1, 'Undo hand-over', 'Undo the hand-over')}
					</form>`
				: reveal(1, 'Hand over', 'handoff', item, 'Mark as handed over'),
			html`<button
				type="button"
				class="sp-btn"
				data-option
				data-copy="${item.id}"
				aria-label="2: Copy for the developer"
				title="Copy the defect as text for the developer"
			>
				<kbd aria-hidden="true">2</kbd><span>Copy for the developer</span>
			</button>`,
		]
	if (item.kind === 'question' || item.kind === 'gap' || item.kind === 'deferred') {
		const fields: Array<[string, string]> = item.kind === 'gap' ? [['sha', review.sha]] : []
		const later = optionForm(context, item, 3, 'Later', [...fields, ['kind', 'defer']], 'Decide later')
		return [
			optionForm(
				context,
				item,
				1,
				'Right',
				[
					...fields,
					['kind', 'accept_assumption'],
					['value', rightAsBuilt({ actual: item.question?.actual ?? null })],
				],
				'Right as built'
			),
			reveal(2, 'Different', 'answer', item, 'It should be different'),
			...(item.kind === 'deferred' ? [] : [later]),
		]
	}
	return []
}

export function extraOf(context: Context, review: Review, item: Item) {
	const form = (field: string, label: string, name: string, fields: Array<[string, string]>, url = action(item)) =>
		html`<div class="sp-c-extra" data-extra="${field}" hidden>
			<form method="post" action="${url}" class="sp-form" data-field-form>
				${hiddenFields(context, item, fields)} ${item.kind === 'gap' ? html`<div data-stale-slot></div>` : ''}
				<label for="${field}-${item.key}">${label}</label>
				<textarea id="${field}-${item.key}" name="${name}" rows="2" required></textarea>
				<div class="btns">
					<button class="sp-btn pri"><span>Send</span></button>
					<span class="small">Enter sends. Shift+Enter starts a new line. Esc keeps the draft.</span>
				</div>
			</form>
		</div>`
	if (item.kind === 'finding')
		return form('reject', 'Why is it not a defect?', 'rationale', [['verdict', 'rejected']])
	if (item.kind === 'defect' && !item.claim?.handoff)
		return form('handoff', 'Hand over to whom?', 'to', [['claim', item.id]], `/plans/${review.planId}/handoff`)
	if (item.kind === 'question' || item.kind === 'gap' || item.kind === 'deferred')
		return form('answer', 'How it should be, in one sentence', 'value', [
			...(item.kind === 'gap' ? [['sha', review.sha] as [string, string]] : []),
			['kind', 'clarify'],
		])
	return ''
}

function openedHref(review: Review, item: Item, view: string) {
	if (item.permission)
		return requestHref(
			item.permission,
			reviewHref(review.planId, view, `&at=${encodeURIComponent(item.key)}&focus=list`)
		)
	return reviewHref(review.planId, view, `&item=${encodeURIComponent(item.key)}`)
}

export function itemRow(context: Context, review: Review, item: Item, id: string, view: string) {
	const asked = item.permission
	const pickable = ['finding', 'question', 'gap', 'defect', 'permission'].includes(item.kind)
	const dim = ['answered', 'deferred', 'rejected'].includes(item.kind)
	const list = reviewHref(review.planId, view, `&at=${encodeURIComponent(item.key)}&focus=list`)
	const opened = openedHref(review, item, view)
	const listed = optionsOf(context, review, item)
	const options = asked ? rowOptions(context, asked, list) : listed.length ? optionsBox(listed) : ''
	const extra = extraOf(context, review, item)
	return html`<div
		class="sp-row${dim ? ' dim' : ''}"
		role="listitem"
		tabindex="-1"
		id="${id}"
		data-row
		data-key="${item.key}"
		data-href="${opened}"
		data-label="${item.id}"
		data-builds="${JSON.stringify(item.builds)}"
		${item.needs ? html`data-needs` : ''}
		${pickable ? html`data-pick="${pickKey(review, item)}"` : ''}
	>
		${
			pickable
				? html`<label class="sp-c-cb"
						><input type="checkbox" tabindex="-1" aria-label="Select ${item.id}" data-pick-box
					/></label>`
				: html`<span class="sp-c-cb"></span>`
		}
		<span class="sp-c-tag">${itemTag(item)}</span>
		<span class="sp-c-id" title="${item.id}">${item.id}</span>
		<a class="sp-c-title ell" title="${item.title}" tabindex="-1" href="${opened}">${item.title}</a>
		${
			asked
				? html`<span class="sp-c-meta ell">${waitsFor(asked)}</span>`
				: html`<span class="sp-c-meta ell" title="${item.meta}">${item.meta}</span>`
		}
		${options} ${extra}
	</div>`
}

export function pickKey(review: Review, item: Item) {
	if (item.kind === 'permission') return `permission:${review.planId}:${item.id}`
	if (item.kind === 'finding') return `claim:${review.planId}:${item.id}`
	if (item.kind === 'gap') return `gap:${review.planId}:${item.id}`
	if (item.kind === 'defect') return `defect:${review.planId}:${item.id}`
	return `question:${review.planId}:${item.id}`
}

function listOf(context: Context, review: Review, view: string, groups: Group[], label: string) {
	if (!groups.length) return html`<p class="sp-empty">${emptyText(view)}</p>`
	let n = 0
	return html`<div class="sp-list" role="list" aria-label="${label}" data-list>
		${groups.map(
			(group) =>
				html`<div class="sp-gh" role="presentation">${group.label} <span>${group.items.length}</span></div>
					${group.items.map((item) => itemRow(context, review, item, `row-${slug(view)}-${n++}`, view))}`
		)}
	</div>`
}

function blockingBanner(review: Review, groups: Group[], view: string) {
	const blocking = groups.find((group) => group.label === blockingLabel)?.items ?? []
	if (!blocking.length) return ''
	return html`<div class="sp-banner">
		<b class="sp-banner-n">${blocking.length}</b>
		<div class="sp-banner-t">
			<b>${blocking.length === 1 ? 'question blocks' : 'questions block'} testing</b>
			<span>Testers wait on these answers. Everything else can wait.</span>
		</div>
		<a class="sp-btn pri you big" href="${openedHref(review, blocking[0], view)}">Answer the first</a>
	</div>`
}

function slug(view: string) {
	return view.replace(/[^A-Za-z0-9-]/g, '-')
}

function emptyText(view: string) {
	if (view === 'needs') return 'Nothing waits for you in this plan.'
	if (view.startsWith('build:')) return 'No open defect or question was seen on this build.'
	return 'No defect or question here yet.'
}

const cellMarks: Record<CellStatus, [string, string, string]> = {
	failed: ['✗', 'k-fail', 'wrong'],
	question: ['?', 'k-q', 'uncertain'],
	passed: ['✓', 'k-pass', 'ok'],
	not_checked: ['', 'k-none', 'not tested'],
}

function markOf(review: Review, status: CellStatus, build: string) {
	const testing = review.running?.build === build && status === 'not_checked'
	const [symbol, look, name] = testing ? ['●', 'k-run', 'under test now'] : cellMarks[status]
	const label = `${buildLabel(review, build)} ${name}`
	return html`<span
		class="sp-mk ${look}"
		role="img"
		aria-label="${label}"
		title="${label}"
		data-mark="${build}"
		data-b="${buildLabel(review, build)}"
		>${glyph(symbol)}</span
	>`
}

function shown(review: Review) {
	return review.map.builds.slice(-shownBuilds)
}

function marks(review: Review, cells: CellStatus[]) {
	const builds = review.map.builds
	const from = Math.max(0, builds.length - shownBuilds)
	return html`<span class="sp-nmarks"
		>${cells.slice(from).map((status, index) => markOf(review, status, builds[from + index].build))}</span
	>`
}

function navRow(
	review: Review,
	current: string,
	view: string,
	href: string,
	id: string | Html,
	text: string,
	end: Html,
	extra: { level?: number; area?: string; expanded?: boolean; look?: string; hidden?: boolean } = {}
) {
	const on = view === current
	return html`<a
		${extra.hidden ? html`hidden` : ''}
		class="sp-nrow${extra.look ? ` ${extra.look}` : ''}${on ? ' on' : ''}"
		role="treeitem"
		aria-level="${extra.level ?? 1}"
		aria-selected="${on ? 'true' : 'false'}"
		${extra.expanded === undefined ? '' : html`aria-expanded="${extra.expanded ? 'true' : 'false'}"`}
		${extra.area ? html`data-in-area="${extra.area}"` : ''}
		tabindex="${view === 'chats' ? '0' : '-1'}"
		href="${href}"
		data-nav
		data-target="${view}"
		data-label="${text}"
		><span class="sp-nid">${id}</span><span class="sp-ntx ell" title="${text}">${text}</span>${end}</a
	>`
}

function count(value: number, hot = false) {
	return html`<span class="sp-ncount${hot ? ' att' : ''}">${value}</span>`
}

export function reviewHref(planId: string, view: string, extra = '') {
	return `/plans/${planId}?view=${encodeURIComponent(view)}${extra}`
}

function testersEnd(review: Review, testers: Review['explorations'][number]) {
	const running = review.running
	if (running)
		return html`<span
			class="sp-ncount${running.paused ? ' att' : ''}"
			title="${review.phase ?? running.state}, since ${running.startedAt}"
			>${age(running.startedAt)}</span
		>`
	return count(testers.explorers ?? 0, false)
}

function testersLabel(review: Review, testers: Review['explorations'][number]) {
	if (review.running) return review.phase ? `Testers now · ${review.phase}` : 'Testers now'
	return ['stopped', 'interrupted', 'failed'].includes(testers.state)
		? `Testers · ${words(testers.state)}`
		: 'Testers'
}

export function navigator(
	review: Review,
	current: string,
	exploration: string | null = null,
	chat = { href: reviewHref(review.planId, current, '&chat=list'), active: false }
) {
	const { planId } = review
	const active = chat.active ? 'chats' : current
	const href = (view: string) => reviewHref(planId, view)
	const needs = itemsOf(review, 'needs')
	const testers = review.explorations.find((item) => item.explorationId === exploration) ?? review.explorations.at(-1)
	const testersRow = testers
		? navRow(
				review,
				active,
				'testers',
				`/explorations/${testers.explorationId}`,
				'',
				testersLabel(review, testers),
				testersEnd(review, testers),
				{ look: 'link' }
			)
		: ''
	const builds = shown(review)
	const outsideRow = review.map.rows.find((row) => row.rule.id === outside)!
	const ruleRows = review.areas.flatMap((area) => {
		const open =
			current === `area:${area.label}` || (current.startsWith('rule:') && area.rules.includes(current.slice(5)))
		return [
			navRow(
				review,
				active,
				`area:${area.label}`,
				href(`area:${area.label}`),
				glyph(open ? '▾' : '▸'),
				area.label,
				marks(review, area.cells),
				{
					expanded: open,
					look: 'area',
				}
			),
			...area.rules.map((id) => {
				const row = review.map.rows.find((each) => each.rule.id === id)!
				return navRow(
					review,
					active,
					`rule:${id}`,
					href(`rule:${id}`),
					id,
					row.rule.text,
					marks(
						review,
						row.cells.map((cell) => cell.status)
					),
					{
						level: 2,
						area: area.label,
						look: 'rule',
						hidden: !open,
					}
				)
			}),
		]
	})
	return html`<nav
		class="sp-nav"
		aria-label="Plan ${planId}"
		data-navigator
		data-builds="${builds.length}"
		data-region="navigator"
	>
		<h2 class="sr-only">Plan ${planId}</h2>
		<div class="sp-nlist" role="tree" aria-label="Views of ${planId}">
			<div class="sp-npin" role="none">
				${review.running ? testersRow : ''}
				${navRow(
					review,
					active,
					'needs',
					href('needs'),
					'',
					'Needs you',
					count(
						needs.length,
						needs.some((item) => item.blocking)
					)
				)}
				${navRow(review, active, 'all', href('all'), '', 'All items', count(review.items.length))}
				${navRow(review, active, 'chats', chat.href, '', 'Plan chats', html``, { look: 'link' })}
				<div class="sp-sep" aria-hidden="true"></div>
			</div>
			<div class="sp-nhead" aria-hidden="true">
				<span></span><span>Rule</span
				><span class="sp-nmarks"
					>${builds.map(
						(item, index) =>
							html`<span title="${item.build}"
								><kbd>${index + 1}</kbd
								><span class="sp-blab">${buildLabel(review, item.build)}</span></span
							>`
					)}</span
				>
			</div>
			${ruleRows}
			${navRow(
				review,
				active,
				`rule:${outside}`,
				href(`rule:${outside}`),
				'Out',
				'Outside the rules',
				marks(
					review,
					outsideRow.cells.map((cell) => cell.status)
				),
				{
					look: 'rule',
				}
			)}
			<div class="sp-sep" aria-hidden="true"></div>
			${review.map.builds.map((item) =>
				navRow(
					review,
					active,
					`build:${item.build}`,
					href(`build:${item.build}`),
					buildLabel(review, item.build),
					item.build,
					count(itemsOf(review, `build:${item.build}`).length)
				)
			)}
			${review.map.builds.length ? html`<div class="sp-sep" aria-hidden="true"></div>` : ''}
			${navRow(review, active, 'rules', href('rules'), '', 'Rules of the plan', count(review.map.rows.length - 1))}
			${review.running ? '' : testersRow}
			${navRow(review, active, 'plan', review.revision ? `/plans/${planId}@${review.revision}` : `/plans/${planId}/request`, '', review.revision ? `Plan @${review.revision}` : 'Plan request', html`<span></span>`, { look: 'link' })}
		</div>
	</nav>`
}

function canChoose(view: string) {
	return view.startsWith('rule:') || view.startsWith('area:')
}

export function viewTitle(review: Review, view: string) {
	if (view === 'needs') return 'Needs you'
	if (view === 'all') return 'All items'
	if (view === 'rules') return 'Rules of the plan'
	if (view === `rule:${outside}`) return 'Outside the rules'
	if (view.startsWith('rule:')) return view.slice(5)
	if (view.startsWith('area:')) return view.slice(5)
	if (view.startsWith('build:')) return `Build ${buildLabel(review, view.slice(6))}`
	return view
}

const cellWords: Record<CellStatus, [string, string]> = {
	failed: ['failed', 'fail'],
	question: ['uncertain', 'you'],
	passed: ['passed', 'pass'],
	not_checked: ['not tested', ''],
}

function buildHeadline(review: Review, defects: number, critical: number) {
	if (review.running)
		return `Build ${review.qa.activeBuild} is under test now by ${plural(review.running.explorers ?? 0, 'tester')}.`
	const last = review.explorations.at(-1)
	if (last && (last.state === 'stopped' || last.state === 'interrupted'))
		return `The test of build ${last.build} was ${last.state}.`
	const build = review.map.builds.length ? review.qa.build : null
	if (build) return `Build ${build}: ${plural(defects, 'open defect')}${critical ? `, ${critical} critical` : ''}.`
	const run = review.latestFinalizedRun
	if (!run) return 'No build is tested yet.'
	const counts = Object.entries(run.counts).map(([outcome, count]) => `${count} ${words(outcome)}`)
	const outcome =
		run.completion === 'completed' && counts.length ? counts.join(', ') : words(run.completion ?? 'finalized')
	return `Build ${run.build}: ${outcome}.`
}

export function verdictLine(review: Review) {
	const defects = review.items.filter((item) => item.kind === 'defect' && item.claim?.open)
	const critical = defects.filter((item) => item.severity === 'critical').length
	const findings = review.items.filter((item) => item.kind === 'finding').length
	const open = review.items.filter((item) => item.kind === 'question' || item.kind === 'gap')
	const blocking = open.filter((item) => item.blocking).length
	const head = buildHeadline(review, defects.length, critical)
	const tail = [
		findings ? `${plural(findings, 'finding')} ${findings === 1 ? 'needs' : 'need'} your look.` : null,
		open.length
			? `${plural(open.length, 'question')} open${blocking ? `, ${blocking} ${blocking === 1 ? 'blocks' : 'block'} testing` : ''}.`
			: null,
	]
		.filter(Boolean)
		.join(' ')
	return { head, tail, defects: defects.length, critical, findings, open: open.length, blocking }
}

function viewHead(review: Review, view: string) {
	const verdict = verdictLine(review)
	if (view === 'needs')
		return {
			sub: `${verdict.head} Questions to answer and findings to decide, blocking ones first.`,
			pills: html``,
		}
	if (view === 'all') return { sub: `${verdict.head} ${verdict.tail}`, pills: html`` }
	if (view === 'rules') {
		const origin = review.map.rulesOrigin
		const rows = review.map.rows.filter((row) => row.rule.id !== outside)
		const stored = rows.filter((row) => row.storedTests).length
		const edit =
			origin === 'harvested'
				? `The tester derived these rules from the sources. Edit the rules that have no stored test here, or with checkmate plan edit ${review.planId} --patch. Edit the others in the plan editor.`
				: origin === 'derived' || origin === 'corrected'
					? `The tester derived these rules from the sources${origin === 'corrected' ? ', and they were corrected' : ''}. Edit them here, or with checkmate plan edit ${review.planId} --patch.`
					: origin
						? 'The rules come from the plan. Edit them in the plan editor.'
						: 'This plan has no rules yet.'
		return {
			sub: stored ? `${stored} of ${rows.length} rules have a stored test. ${edit}` : edit,
			pills: html``,
		}
	}
	if (view.startsWith('rule:')) {
		const row = review.map.rows.find((each) => each.rule.id === view.slice(5))
		return {
			sub: row?.rule.text ?? '',
			pills: html`${row?.cells.map((cell) => {
				const [label, color] = cellWords[cell.status]
				return html`<span class="sp-pill ${color}" title="${cell.build}"
					>${buildLabel(review, cell.build)}: ${label}</span
				>`
			})}${row?.storedTests ? html`<span class="sp-pill" title="${storedNote(review, row.rule.id)}">${plural(row.storedTests, 'stored test')}</span>` : ''}`,
		}
	}
	if (view.startsWith('area:')) {
		const area = review.areas.find((each) => each.label === view.slice(5))
		return { sub: `${plural(area?.rules.length ?? 0, 'rule')}. The items are grouped by rule.`, pills: html`` }
	}
	if (view.startsWith('build:')) {
		const build = review.map.builds.find((item) => item.build === view.slice(6))
		return { sub: `${build?.build ?? ''}. The defects and questions seen on this build.`, pills: html`` }
	}
	return { sub: '', pills: html`` }
}

function storedNote(review: Review, ruleId: string) {
	return `${ruleId} has a stored test, so it belongs to revision ${review.revision}. Edit it in the plan editor.`
}

function ruleButtons(context: Context, review: Review, rule: Rule, count: number, numbered: boolean) {
	if (review.map.rows.find((row) => row.rule.id === rule.id)?.storedTests)
		return [
			html`<a
				class="sp-btn"
				${numbered ? html`data-option` : ''}
				href="/plans/${review.planId}@${review.revision}/edit"
				aria-label="${numbered ? '1: ' : ''}Edit ${rule.id} in the plan editor"
				title="${storedNote(review, rule.id)}"
			>
				${numbered ? html`<kbd aria-hidden="true">1</kbd>` : ''}<span>Edit in the plan editor</span>
			</a>`,
		]
	const cited = review.items.filter((item) => item.rule === rule.id).length
	const area = review.areas.find((each) => each.rules.includes(rule.id))?.label ?? ''
	const fill = JSON.stringify({ text: rule.text, area, newArea: '' })
	const ends = cited
		? `${plural(cited, 'item')} ${cited === 1 ? 'cites it. It moves' : 'cite it. They move'} to Outside the rules.`
		: 'No item cites it.'
	const key = (n: number) => (numbered ? html`<kbd aria-hidden="true">${n}</kbd>` : '')
	const option = numbered ? html`data-option` : ''
	return [
		html`<button
			type="button"
			class="sp-btn"
			${option}
			data-act="rule-edit"
			data-action="/plans/${review.planId}/rules/${rule.id}"
			data-title="Edit rule ${rule.id}"
			data-fill="${fill}"
			aria-label="${numbered ? '1: ' : ''}Edit rule ${rule.id}"
			title="Edit the text and the area of ${rule.id}"
		>
			${key(1)}<span>${numbered ? 'Edit…' : `Edit ${rule.id}…`}</span>
		</button>`,
		html`<form method="post" action="/plans/${review.planId}/rules/${rule.id}/remove" class="sp-opt">
			<input type="hidden" name="csrf" value="${context.csrf}" />
			<button
				class="sp-btn"
				${option}
				data-ask-title="Remove rule ${rule.id}?"
				data-ask-text="${ends} The plan keeps the other ${plural(count - 1, 'rule')}."
				data-ask-yes="Remove ${rule.id}"
				aria-label="${numbered ? '2: ' : ''}Remove rule ${rule.id}"
				title="${count === 1 ? 'Keep at least one rule.' : `Remove ${rule.id} from the rules of the plan`}"
				${count === 1 ? html`disabled` : ''}
			>
				${key(2)}<span>${numbered ? 'Remove…' : `Remove ${rule.id}…`}</span>
			</button>
		</form>`,
	]
}

function ruleEditable(review: Review) {
	return ['derived', 'corrected', 'harvested'].includes(review.map.rulesOrigin ?? '')
}

function ruleMeta(row: Review['map']['rows'][number]) {
	const source = row.rule.source ?? ''
	if (!row.storedTests) return source
	return `${plural(row.storedTests, 'stored test')} · ${source}`
}

function rulesList(context: Context, review: Review) {
	const rows = review.map.rows.filter((row) => row.rule.id !== outside)
	if (!rows.length) return html`<p class="sp-empty">This plan has no rules yet.</p>`
	const editable = ruleEditable(review)
	return html`<div class="sp-list wide-title" role="list" aria-label="Rules of the plan" data-list>
		<div class="sp-gh" role="presentation">Rules <span>${rows.length}</span></div>
		${rows.map(
			(row, index) =>
				html`<div
					class="sp-row"
					role="listitem"
					tabindex="-1"
					id="row-rules-${index}"
					data-row
					data-key="rule:${row.rule.id}"
					data-href="${reviewHref(review.planId, `rule:${row.rule.id}`)}"
					data-label="${row.rule.id}"
				>
					<span class="sp-c-cb"></span>
					<span class="sp-c-tag"><span class="sp-pill">Rule</span></span>
					<span class="sp-c-id">${row.rule.id}</span>
					<span class="sp-c-title ell" title="${row.rule.text}">${row.rule.text}</span>
					<span class="sp-c-meta ell" title="${ruleMeta(row)}">${ruleMeta(row)}</span>
					${editable ? optionsBox(ruleButtons(context, review, row.rule, rows.length, true)) : ''}
				</div>`
		)}
	</div>`
}

export function viewsOf(review: Review) {
	return [
		'needs',
		'all',
		...review.areas.map((area) => `area:${area.label}`),
		...review.map.rows.map((row) => `rule:${row.rule.id}`),
		...review.map.builds.map((item) => `build:${item.build}`),
		'rules',
	]
}

function panel(context: Context, review: Review, view: string, current: string, cost: string | null) {
	const head = viewHead(review, view)
	const items = itemsOf(review, view)
	const groups = view.startsWith('area:') ? ruleGroups(review, view, items) : groupsOf(items)
	const title = viewTitle(review, view)
	const edit =
		view === 'rules' && review.revision
			? html`<a class="sp-btn" href="/plans/${review.planId}@${review.revision}/edit"
					><span>Edit the rules</span></a
				>`
			: ''
	const add =
		view === 'rules' && ruleEditable(review)
			? actionButton(
					'rule-add',
					'Add a rule…',
					html`data-action="/plans/${review.planId}/rules" data-title="Add a rule to ${review.planId}"`
				)
			: ''
	const rule = view.startsWith('rule:') ? review.map.rows.find((row) => row.rule.id === view.slice(5)) : undefined
	const own =
		rule && rule.rule.id !== outside && ruleEditable(review)
			? ruleButtons(context, review, rule.rule, review.map.rows.length - 1, false)
			: ''
	const store =
		(view === 'all' || view === 'rules') && review.storable ? storeButton(review.planId, review.storable, view) : ''
	const tools = html`${edit}${add}${own}${review.running ? '' : testButton(review.planId)}${
		review.answers ? actionButton('follow', `Test the answers (${review.answers.count})…`) : ''
	}${store}`
	return html`<section
		class="sp-panel"
		data-panel="${view}"
		data-title="${title}"
		aria-labelledby="title-${slug(view)}"
		${view === current ? '' : html`hidden`}
	>
		<div class="sp-ch">
			${crumbBar([
				[review.planId, `/plans/${review.planId}`],
				[review.target, null],
			])}
			${
				view === current
					? html`<h1 id="title-${slug(view)}" data-view-title>${title}</h1>`
					: html`<h2 id="title-${slug(view)}" data-view-title>${title}</h2>`
			}
			${head.sub ? html`<p class="sp-sub">${head.sub}</p>` : ''}
			<div class="sp-pills">${head.pills}</div>
			${
				cost === null
					? ''
					: html`<p class="sp-sub" title="Reported cost across this plan’s explorations, chats, and structured runs">
							Total cost ${cost}
						</p>`
			}
			${canChoose(view) ? html`<p class="sp-sub att" data-build-note></p>` : ''}
		</div>
		<div class="sp-tools" data-actions>${tools}</div>
		${view === 'needs' ? blockingBanner(review, groups, view) : ''}
		${view === 'rules' ? rulesList(context, review) : listOf(context, review, view, groups, title)}
	</section>`
}

export function reviewPage(
	store: Store,
	context: Context,
	planId: string,
	params: URLSearchParams,
	refusal: Refusal | null = null,
	notice: string | null = null
): Page {
	const review = reviewOf(store, planId, context.harness)
	const views = viewsOf(review)
	const asked = params.get('view') ?? 'needs'
	const current = views.includes(asked) ? asked : 'needs'
	const chatting = params.has('chat') || params.get('newChat') === '1'
	const title = viewTitle(review, current)
	const key = refusal?.key ?? params.get('item')
	const item =
		key && !(refusal?.subject && refusal.state.stale)
			? (review.items.find((each) => each.key === key && each.kind !== 'permission') ?? null)
			: null
	const refusedAnswer =
		refusal?.subject && !item
			? html`<section aria-labelledby="refused-answer">
					<h2 id="refused-answer">Answer for ${refusal.subject}</h2>
					${messages(refusal.state)}${keptText(refusal.state)}
				</section>`
			: ''
	const file = params.get('file')
	const record = item
		? file !== null && /^[0-9]{1,3}$/.test(file) && item.claim
			? evidenceViewer(store, review, item, current, Number(file))
			: recordDrawer(store, context, review, item, current, refusal)
		: ''
	const cost = planCost(store, planId)
	const panels = views.map((view) => panel(context, review, view, current, cost.costUsd === null ? null : costText(cost.costUsd, cost.costPartial)))
	return {
		title: `${item ? `${item.id} · ` : ''}${title} · ${planId}`,
		section: 'home',
		subjects: [
			`plan:${planId}`,
			'inbox',
			...review.explorations.map((each) => `exploration:${each.explorationId}`),
		],
		status: refusal || notice ? 422 : 200,
		crumbs: [
			['Plans', '/'],
			[planId, `/plans/${planId}`],
			[title, item ? reviewHref(planId, current) : null],
			...(item ? [[item.id, null] as [string, null]] : []),
		],
		back: item
			? reviewHref(planId, current, `&at=${encodeURIComponent(item.key)}&focus=list`)
			: `/?at=${encodeURIComponent(`plan:${planId}`)}`,
		drawer: Boolean(item),
		nav: navigator(review, current, null, { href: reviewHref(planId, current, '&chat=list'), active: chatting }),
		body: html`${notice ? html`<p class="form-error" role="alert" data-notice>${notice}</p>` : ''}${refusedAnswer}
			<div
				class="sp-review"
				data-review
				data-plan="${planId}"
				data-qa-status="${JSON.stringify(review.qa)}"
				data-region="review"
				${item ? html`data-open="${item.key}"` : ''}
			>
				${panels}
			</div>
			${record}
			<div data-region="plan-actions">
				${review.running ? '' : testDialog(context, planId, { build: '', level: 'normal', since: '', until: '', repo: '' }, defaultBuild(store.workspace), asList(instanceChoice(store, planId)))}
				${review.answers ? followDialog(context, planId, { ...review.answers, planId }, review.answers.count) : ''}
				${
					ruleEditable(review)
						? html`${ruleDialog(
								'edit',
								context,
								planId,
								review.areas.map((area) => area.label)
							)}${ruleDialog(
								'add',
								context,
								planId,
								review.areas.map((area) => area.label)
							)}`
						: ''
				}
				${review.storable ? storeDialog(context, planId, review.storable, review.approvalRequired) : ''}
				${review.items.some((item) => item.kind === 'defect') ? copyDialog() : ''}
			</div>
			<div
				class="sp-bulk"
				data-bulk
				data-plan="${planId}"
				data-csrf="${context.csrf}"
				role="group"
				aria-label="Selection"
				hidden
			>
				<span class="sp-path" data-bulk-count aria-live="polite"></span>
				<button type="button" class="sp-btn" data-bulk-action="accept"><kbd></kbd><span></span></button>
				<button type="button" class="sp-btn" data-bulk-action="right"><kbd></kbd><span></span></button>
				<button type="button" class="sp-btn" data-bulk-action="defer"><kbd></kbd><span></span></button>
				<button type="button" class="sp-btn" data-bulk-action="handoff"><kbd></kbd><span></span></button>
				<button type="button" class="sp-btn" data-bulk-action="copy"><kbd></kbd><span></span></button>
				<button type="button" class="sp-btn" data-bulk-action="allow"><kbd></kbd><span></span></button>
				<button type="button" class="sp-btn" data-bulk-action="deny"><kbd></kbd><span></span></button>
				<button type="button" class="sp-btn" data-bulk-action="clear">
					<kbd></kbd><span>Clear the selection</span>
				</button>
			</div>`,
	}
}

export type { Rule }
