import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'

const inputLimit = 128 * 1024
const jobPhases = ['afterScope', 'afterFactory', 'afterVerify', 'afterExploration', 'afterReview']

function mapping(value, label, keys) {
	assert(value && typeof value === 'object' && !Array.isArray(value), label + ' must be a mapping')
	for (const key of Object.keys(value)) assert(keys.includes(key), 'Unknown ' + label + ' setting ' + key)
	return value
}

function integer(value, label, min, max) {
	assert(Number.isInteger(value) && value >= min && value <= max, label + ' must be between ' + min + ' and ' + max)
	return value
}

function role(value, name, fields = []) {
	const settings = mapping(value, name, ['model', 'effort', ...fields])
	assert(
		typeof settings.model === 'string' && /^[\w.-]+\/[^\s]+$/.test(settings.model),
		name + '.model must be provider/model'
	)
	assert(
		settings.effort === undefined ||
			['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(settings.effort),
		name + '.effort is invalid'
	)
	return settings
}

function command(value, label) {
	assert(
		Array.isArray(value) && value.length && value.every((item) => typeof item === 'string' && item.trim()),
		label + ' must be a command and its arguments'
	)
	return value
}

export function readConfig(path) {
	const document = parseDocument(readFileSync(path, 'utf8'))
	if (document.errors.length) throw document.errors[0]
	return validateConfig(document.toJS({ maxAliasCount: 0 }))
}

export function validateConfig(value) {
	const config = mapping(value, 'factory', [
		'oracle',
		'factory',
		'qa',
		'maxBuilds',
		'maxExplorations',
		'timeoutSeconds',
		'jobs',
		'verify',
	])
	const oracle = role(config.oracle, 'oracle', ['maxCorrections'])
	const { maxCorrections = 2 } = oracle
	const qa = role(config.qa, 'qa', ['level', 'minutes', 'exploreBeforeFactory'])
	assert(['smoke', 'normal', 'deep'].includes(qa.level), 'qa.level must be smoke, normal, or deep')
	assert(
		qa.exploreBeforeFactory === undefined || typeof qa.exploreBeforeFactory === 'boolean',
		'qa.exploreBeforeFactory must be true or false'
	)
	const jobs = config.jobs === undefined ? {} : mapping(config.jobs, 'jobs', jobPhases)
	const phaseJobs = Object.fromEntries(
		Object.entries(jobs).map(([phase, commands]) => {
			assert(Array.isArray(commands), 'jobs.' + phase + ' must be a list of commands')
			return [phase, commands.map((item, index) => command(item, `jobs.${phase}[${index}]`))]
		})
	)
	if (config.verify !== undefined) {
		assert(phaseJobs.afterFactory === undefined, 'Use either verify or jobs.afterFactory')
		phaseJobs.afterFactory = [command(config.verify, 'verify')]
	}
	return {
		oracle: {
			...oracle,
			maxCorrections: integer(maxCorrections, 'oracle.maxCorrections', 0, 10),
		},
		factory: role(config.factory, 'factory'),
		qa: { ...qa, minutes: integer(qa.minutes, 'qa.minutes', 1, 60) },
		maxBuilds: integer(config.maxBuilds, 'maxBuilds', 1, 20),
		maxExplorations: integer(config.maxExplorations, 'maxExplorations', qa.exploreBeforeFactory ? 2 : 1, 50),
		timeoutSeconds: integer(config.timeoutSeconds, 'timeoutSeconds', 60, 7200),
		jobs: phaseJobs,
	}
}

function gh(root, args) {
	return execFileSync('gh', args, {
		cwd: root,
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: 30_000,
		maxBuffer: inputLimit * 3,
	})
}

function githubFile(root, owner, repo, suffix) {
	const parts = suffix.split('/').map(decodeURIComponent)
	const encode = (items) => items.map(encodeURIComponent).join('/')
	for (let split = 1; split < parts.length; split++) {
		const path = encode(parts.slice(split))
		const ref = parts.slice(0, split).join('/')
		let response
		try {
			response = gh(root, [
				'api',
				'--method',
				'GET',
				`repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
			])
		} catch (error) {
			if (!String(error.stderr).includes('HTTP 404')) throw error
			continue
		}
		const parsed = JSON.parse(response)
		assert(parsed.encoding === 'base64', 'Give a GitHub text file link')
		return Buffer.from(parsed.content, 'base64').toString('utf8')
	}
	throw new Error('GitHub did not find that file on the linked ref')
}

async function remoteText(url) {
	const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
	assert(response.ok && response.body, 'Could not read request file. HTTP ' + response.status)
	const reader = response.body.getReader()
	const pieces = []
	let size = 0
	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			size += value.byteLength
			assert(size <= inputLimit, 'Request exceeds 128 KiB')
			pieces.push(value)
		}
	} finally {
		await reader.cancel()
	}
	return Buffer.concat(pieces).toString('utf8')
}

async function readSource(root, file) {
	if (file.startsWith('file:')) return readFileSync(fileURLToPath(file), 'utf8')
	if (!/^https?:\/\//i.test(file)) return readFileSync(resolve(root, file), 'utf8')
	const url = new URL(file)
	const blob = url.hostname === 'github.com' && /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.pathname)
	if (blob) return githubFile(root, blob[1], blob[2], blob[3])
	return remoteText(url)
}

export async function requestSource(root, options) {
	const keys = ['issue', 'prompt', 'file'].filter((key) => options[key] !== undefined)
	assert(keys.length === 1 && options[keys[0]].trim(), 'Give one of --issue, --prompt, or --file')
	const kind = keys[0]
	const value = options[kind]
	let source = { kind, label: 'Direct prompt' }
	let text = value
	if (kind === 'issue') {
		assert(
			/^\d+$|^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+\/?$/.test(value),
			'Give a GitHub issue number or URL'
		)
		const issue = JSON.parse(gh(root, ['issue', 'view', value, '--json', 'title,body,url']))
		source = { kind, label: issue.url }
		text = '# ' + issue.title + '\n\n' + issue.body
	}
	if (kind === 'file') {
		source = { kind, label: value }
		text = await readSource(root, value)
	}
	assert(text.trim() && Buffer.byteLength(text) <= inputLimit, 'Request must contain text and be at most 128 KiB')
	return { source, text }
}

const idPattern = /^[a-zA-Z][\w-]{0,39}$/

function decisionId(id, label) {
	assert(
		typeof id === 'string' && idPattern.test(id),
		`Invalid ${label}${typeof id === 'string' ? ' ' + JSON.stringify(id.slice(0, 80)) : ''}. Use a letter followed by up to 39 letters, digits, underscores, or hyphens`
	)
}

function hasText(value) {
	return typeof value === 'string' && value.trim()
}

export function validateDecisions(value, answered = new Set()) {
	assert(Array.isArray(value), 'Oracle decisions must be a list')
	const seen = new Set()
	for (const item of value) {
		decisionId(item?.id, 'Oracle decision ID')
		assert(!seen.has(item.id), 'Duplicate oracle decision ID: ' + item.id)
		assert(!answered.has(item.id), 'Oracle decision ID already answered: ' + item.id)
		seen.add(item.id)
		assert(hasText(item.question) && hasText(item.reason), 'Each decision needs a question and reason')
		assert(
			Array.isArray(item.options) && item.options.length >= 2 && item.options.length <= 5,
			'Each decision needs two to five options'
		)
		const ids = new Set()
		for (const option of item.options) {
			decisionId(option?.id, 'Decision option ID')
			assert(!ids.has(option.id), 'Duplicate option ID for ' + item.id + ': ' + option.id)
			assert(hasText(option.label) && hasText(option.tradeoff), 'Each option needs a label and tradeoff')
			ids.add(option.id)
		}
		assert(ids.has(item.recommended), 'Recommend one of the decision options')
	}
	return value
}

export function chooseOptions(decisions, choices) {
	mapping(
		choices,
		'answer',
		decisions.map(({ id }) => id)
	)
	return decisions.map((decision) => {
		const option = decision.options.find(({ id }) => id === choices[decision.id])
		assert(option, 'Choose a listed option for ' + decision.id)
		return {
			id: decision.id,
			question: decision.question,
			option: option.id,
			answer: option.label,
			...(decision.questionIds?.length ? { questionIds: decision.questionIds } : {}),
			...(decision.claimIds?.length ? { claimIds: decision.claimIds } : {}),
		}
	})
}
