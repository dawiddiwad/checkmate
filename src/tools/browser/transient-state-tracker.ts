import { ConsoleMessage, Dialog, Frame, Page } from '@playwright/test'
import { logger } from '../../logging/index.js'

type Clock = () => number

const TIMELINE_HEADER = 'Timeline of events after last function call:'
const MUTATION_LOG_PREFIX = '__CHECKMATE_MUTATION__'
const MUTATION_OBSERVER_KEY = '__checkmate_mutation_observer'

class TimelineRecorder {
	private events: string[] = []
	private startTime = 0
	private lastMessage: string | null = null

	constructor(private readonly clock: Clock) {}

	start(): void {
		this.startTime = this.clock()
		this.events = []
		this.lastMessage = null
	}

	clearEvents(): void {
		this.events = []
		this.lastMessage = null
	}

	record(message: string): void {
		this.events.push(this.withElapsed(message))
		this.lastMessage = message
	}

	recordUnique(message: string): void {
		if (this.lastMessage !== message) {
			this.record(message)
		}
	}

	replaceWith(message: string): void {
		this.clearEvents()
		this.record(message)
	}

	list(): string[] {
		return [...this.events]
	}

	format(): string {
		return this.events.length === 0 ? '' : `${TIMELINE_HEADER}\n${this.events.join('\n')}\n`
	}

	private withElapsed(message: string): string {
		return `[${this.clock() - this.startTime}ms] ${message}`
	}
}

class MutationObserverController {
	constructor(private readonly page: Page) {}

	async attach(): Promise<void> {
		await this.page
			.evaluate(setupMutationObserver, { logPrefix: MUTATION_LOG_PREFIX, observerKey: MUTATION_OBSERVER_KEY })
			.catch(() => {})
	}

	async detach(): Promise<void> {
		await this.page.evaluate(teardownMutationObserver, MUTATION_OBSERVER_KEY).catch((error) => {
			logger.debug(`failed to remove MutationObserver from page due to error:\n${JSON.stringify(error, null, 2)}`)
		})
	}
}

class PageEventManager {
	constructor(
		private readonly page: Page,
		private readonly timeline: TimelineRecorder,
		private readonly isTracking: () => boolean,
		private readonly onMainFrameNavigation: () => void,
		private readonly mutationLogPrefix: string
	) {}

	attach(): void {
		this.page.on('dialog', this.handleDialog)
		this.page.on('console', this.handleConsole)
		this.page.on('framenavigated', this.handleNavigation)
	}

	detach(): void {
		this.page.off('dialog', this.handleDialog)
		this.page.off('console', this.handleConsole)
		this.page.off('framenavigated', this.handleNavigation)
	}

	private handleDialog = (dialog: Dialog): void => {
		if (!this.isTracking()) {
			return
		}

		this.timeline.record(
			`Dialog appeared: "${dialog.message()}" (Type: ${dialog.type()}) and automatically dismissed.`
		)
		dialog.dismiss().catch(() => {})
	}

	private handleConsole = (message: ConsoleMessage): void => {
		if (!this.isTracking()) {
			return
		}

		const text = message.text()
		if (text.startsWith(this.mutationLogPrefix)) {
			this.timeline.recordUnique(text.substring(this.mutationLogPrefix.length))
			return
		}

		if (message.type() === 'error') {
			this.timeline.record(`Console Error: ${text.substring(0, 200)}`)
		}
	}

	private handleNavigation = (frame: Frame): void => {
		if (!this.isTracking()) {
			return
		}

		if (frame === this.page.mainFrame()) {
			this.timeline.replaceWith(`Navigated to: ${frame.url()}`)
			this.onMainFrameNavigation()
		}
	}
}

type ObserverSetupArgs = { logPrefix: string; observerKey: string }

function setupMutationObserver({ logPrefix, observerKey }: ObserverSetupArgs): void {
	const win = window as unknown as Window & Record<string, MutationObserver | undefined>
	const skipTags = new Set(['INS', 'IFRAME', 'SCRIPT', 'STYLE'])

	if (win[observerKey]) {
		win[observerKey].disconnect()
	}

	const getTextContent = (node: Node): string => {
		if (node.nodeType === 3) return (node.textContent || '').trim()
		if (node.nodeType === 1) return (node.textContent || '').trim().replace(/\s+/g, ' ')
		return ''
	}

	const isSkippableElement = (element: HTMLElement | null): boolean => {
		return !!element && skipTags.has(element.tagName)
	}

	const observer = new MutationObserver((mutations) => {
		const appearedTexts: string[] = []
		const disappearedTexts: string[] = []
		const attributeChanges: string[] = []

		mutations.forEach((mutation) => {
			try {
				if (mutation.type === 'attributes') {
					const element = mutation.target as HTMLElement
					if (isSkippableElement(element)) {
						return
					}

					const text = getTextContent(element)
					if (!text || text.length <= 2) {
						return
					}

					const attrName = mutation.attributeName!
					const oldValue = mutation.oldValue || ''
					const newValue = element.getAttribute(attrName) || ''
					let changes = ''

					if (attrName === 'class') {
						const oldClasses = oldValue.split(' ').filter(Boolean)
						const newClasses = newValue.split(' ').filter(Boolean)
						const added = newClasses.filter((item) => !oldClasses.includes(item))
						const removed = oldClasses.filter((item) => !newClasses.includes(item))
						if (added.length) changes += `+${added.join(',')}`
						if (removed.length) changes += `${changes ? ' ' : ''}-${removed.join(',')}`
					} else if (!oldValue && newValue) {
						changes = `+${attrName}=${newValue.substring(0, 50)}`
					} else if (oldValue && !newValue) {
						changes = `-${attrName}`
					} else {
						changes = `~${attrName}=${newValue.substring(0, 50)}`
					}

					if (changes) {
						attributeChanges.push(`${text.substring(0, 100)} [${changes}]`)
					}
					return
				}

				if (mutation.type !== 'childList') {
					return
				}

				mutation.addedNodes.forEach((node) => {
					const element = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement
					if (isSkippableElement(element)) {
						return
					}

					if (element && typeof element.checkVisibility === 'function' && !element.checkVisibility()) {
						return
					}

					const text = getTextContent(node)
					if (text && text.length > 2) {
						appearedTexts.push(text.substring(0, 100))
					}
				})

				mutation.removedNodes.forEach((node) => {
					const element = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement
					if (isSkippableElement(element)) {
						return
					}

					const text = getTextContent(node)
					if (text && text.length > 2) {
						disappearedTexts.push(text.substring(0, 100))
					}
				})
			} catch {
				/* empty */
			}
		})

		const uniqueAppeared = [...new Set(appearedTexts)]
		const uniqueDisappeared = [...new Set(disappearedTexts)]
		const uniqueAttributeChanges = [...new Set(attributeChanges)]

		if (uniqueAppeared.length > 0) {
			console.log(`${logPrefix}Appeared: ${uniqueAppeared.join(' | ').substring(0, 300)}`)
		}

		if (uniqueDisappeared.length > 0) {
			console.log(`${logPrefix}Disappeared: ${uniqueDisappeared.join(' | ').substring(0, 300)}`)
		}

		if (uniqueAttributeChanges.length > 0) {
			console.log(`${logPrefix}Changed: ${uniqueAttributeChanges.join(' | ').substring(0, 400)}`)
		}
	})

	observer.observe(document, { childList: true, subtree: true, attributes: true, attributeOldValue: true })
	win[observerKey] = observer
}

function teardownMutationObserver(observerKey: string): void {
	const win = window as unknown as Window & Record<string, MutationObserver | undefined>
	if (win[observerKey]) {
		win[observerKey].disconnect()
		delete win[observerKey]
	}
}

export class TransientStateTracker {
	static readonly LOG_PREFIX = MUTATION_LOG_PREFIX

	private readonly timeline: TimelineRecorder
	private readonly mutationObserver: MutationObserverController
	private readonly eventManager: PageEventManager
	private isTracking = false

	constructor(
		private readonly page: Page,
		clock: Clock = () => Date.now()
	) {
		this.timeline = new TimelineRecorder(clock)
		this.mutationObserver = new MutationObserverController(page)
		this.eventManager = new PageEventManager(
			page,
			this.timeline,
			() => this.isTracking,
			() => {
				if (this.isTracking) {
					void this.stop()
				}
			},
			MUTATION_LOG_PREFIX
		)
	}

	async start(): Promise<void> {
		if (this.isTracking) {
			await this.stop()
		}

		this.timeline.start()
		this.isTracking = true
		this.eventManager.attach()
		await this.mutationObserver.attach()
	}

	async stop(): Promise<string[]> {
		if (!this.isTracking) {
			return this.timeline.list()
		}

		this.isTracking = false
		this.eventManager.detach()
		await this.mutationObserver.detach()
		return this.timeline.list()
	}

	formatTimeline(): string {
		return this.timeline.format()
	}
}
