/**
 * Tracks transient state changes (from action-triggered to settled snapshot) in a web page during test execution.
 * It helps LLM-based test agents understand what changed on the page as a result of their actions.
 * It mitigates blind spot in timeline between action triggered and final after-action return snapshot.
 * 
 * Monitors DOM mutations, dialog appearances, console errors, and page navigations,
 * creating a timestamped timeline of events. Uses a MutationObserver to capture
 * element additions, removals, and attribute changes, and listens to Playwright
 * page events to track dialogs and navigation.
 * 
 * @example
 * ```typescript
 * const tracker = new TransientStateTracker(page);
 * await tracker.start();
 * // ... perform actions ...
 * const events = await tracker.stop();
 * console.log(tracker.formatTimeline());
 * ```
 */
import { Page, Dialog, ConsoleMessage, Frame } from "@playwright/test"
import { logger } from "../openai/openai-test-manager"

type Clock = () => number

const TIMELINE_HEADER = 'Timeline of events after last function call:'
const MUTATION_LOG_PREFIX = '__CHECKMATE_MUTATION__'
const MUTATION_OBSERVER_KEY = '__checkmate_mutation_observer'

class TimelineRecorder {
    private events: string[] = []
    private startTime = 0
    private lastMessage: string | null = null

    constructor(private readonly clock: Clock) { }

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
        if (this.lastMessage === message) return
        this.record(message)
    }

    replaceWith(message: string): void {
        this.clearEvents()
        this.record(message)
    }

    list(): string[] {
        return [...this.events]
    }

    format(): string {
        if (this.events.length === 0) return ""
        return `${TIMELINE_HEADER}\n${this.events.join('\n')}\n`
    }

    private withElapsed(message: string): string {
        const elapsed = this.clock() - this.startTime
        return `[${elapsed}ms] ${message}`
    }
}

class MutationObserverController {
    constructor(private readonly page: Page) { }

    async attach(): Promise<void> {
        await this.page.evaluate(setupMutationObserver, {
            logPrefix: MUTATION_LOG_PREFIX,
            observerKey: MUTATION_OBSERVER_KEY,
        }).catch(() => { })
    }

    async detach(): Promise<void> {
        await this.page.evaluate(teardownMutationObserver, MUTATION_OBSERVER_KEY).catch((error) => {
            logger.debug('failed to remove MutationObserver from page due to error:\n', JSON.stringify(error, null, 2))
        })
    }
}

class PageEventManager {
    constructor(
        private readonly page: Page,
        private readonly timeline: TimelineRecorder,
        private readonly isTracking: () => boolean,
        private readonly onMainFrameNavigation: () => void,
        private readonly mutationLogPrefix: string,
    ) { }

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
        if (!this.isTracking()) return
        this.timeline.record(`Dialog appeared: "${dialog.message()}" (Type: ${dialog.type()}) and automatically dismissed.`)
        dialog.dismiss().catch(() => { })
    }

    private handleConsole = (msg: ConsoleMessage): void => {
        if (!this.isTracking()) return
        const text = msg.text()

        if (text.startsWith(this.mutationLogPrefix)) {
            const payload = text.substring(this.mutationLogPrefix.length)
            this.timeline.recordUnique(payload)
            return
        }

        if (msg.type() === 'error') {
            this.timeline.record(`Console Error: ${text.substring(0, 200)}`)
        }
    }

    private handleNavigation = (frame: Frame): void => {
        if (!this.isTracking()) return
        if (frame === this.page.mainFrame()) {
            this.timeline.replaceWith(`Navigated to: ${frame.url()}`)
            this.onMainFrameNavigation()
        }
    }
}

type ObserverSetupArgs = {
    logPrefix: string
    observerKey: string
}

function setupMutationObserver({ logPrefix, observerKey }: ObserverSetupArgs): void {
    const win = window as any
    const SKIP_TAGS = new Set(['INS', 'IFRAME', 'SCRIPT', 'STYLE'])

    if (win[observerKey]) {
        win[observerKey].disconnect()
    }

    const getTextContent = (node: Node): string => {
        if (node.nodeType === 3) return (node.textContent || "").trim()
        if (node.nodeType === 1) return (node.textContent || "").trim().replace(/\s+/g, ' ')
        return ""
    }

    const isSkippableElement = (el: HTMLElement | null): boolean => {
        if (!el) return false
        return SKIP_TAGS.has(el.tagName)
    }

    const observer = new MutationObserver((mutations) => {
        const appearedTexts: string[] = []
        const disappearedTexts: string[] = []
        const attributeChanges: string[] = []

        mutations.forEach((mutation) => {
            try {
                if (mutation.type === 'attributes') {
                    const el = mutation.target as HTMLElement
                    if (isSkippableElement(el)) return

                    const text = getTextContent(el)
                    if (!text || text.length <= 2) return

                    const attrName = mutation.attributeName!
                    const oldValue = mutation.oldValue || ''
                    const newValue = el.getAttribute(attrName) || ''

                    let changes = ''
                    if (attrName === 'class') {
                        const oldClasses = oldValue.split(' ').filter(c => c)
                        const newClasses = newValue.split(' ').filter(c => c)
                        const added = newClasses.filter(c => !oldClasses.includes(c))
                        const removed = oldClasses.filter(c => !newClasses.includes(c))
                        if (added.length) changes += '+' + added.join(',')
                        if (removed.length) changes += (changes ? ' ' : '') + '-' + removed.join(',')
                    } else {
                        if (!oldValue && newValue) changes = `+${attrName}=${newValue.substring(0, 50)}`
                        else if (oldValue && !newValue) changes = `-${attrName}`
                        else changes = `~${attrName}=${newValue.substring(0, 50)}`
                    }

                    if (changes) {
                        attributeChanges.push(`${text.substring(0, 100)} [${changes}]`)
                    }
                } else if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        const el = node.nodeType === 1 ? node as HTMLElement : node.parentElement
                        if (isSkippableElement(el)) return

                        if (el && typeof el.checkVisibility === 'function' && !el.checkVisibility()) return

                        const text = getTextContent(node)
                        if (text && text.length > 2) {
                            appearedTexts.push(text.substring(0, 100))
                        }
                    })
                    mutation.removedNodes.forEach((node) => {
                        const el = node.nodeType === 1 ? node as HTMLElement : node.parentElement
                        if (isSkippableElement(el)) return

                        const text = getTextContent(node)
                        if (text && text.length > 2) {
                            disappearedTexts.push(text.substring(0, 100))
                        }
                    })
                }
            } catch { /* empty */ }
        })

        const uniqueAppeared = [...new Set(appearedTexts)]
        const uniqueDisappeared = [...new Set(disappearedTexts)]
        const uniqueAttrChanges = [...new Set(attributeChanges)]

        if (uniqueAppeared.length > 0) {
            const combined = uniqueAppeared.join(' | ').substring(0, 300)
            console.log(`${logPrefix}Appeared: ${combined}`)
        }
        if (uniqueDisappeared.length > 0) {
            const combined = uniqueDisappeared.join(' | ').substring(0, 300)
            console.log(`${logPrefix}Disappeared: ${combined}`)
        }
        if (uniqueAttrChanges.length > 0) {
            const combined = uniqueAttrChanges.join(' | ').substring(0, 400)
            console.log(`${logPrefix}Changed: ${combined}`)
        }
    })

    observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true,
    })

    win[observerKey] = observer
}

function teardownMutationObserver(observerKey: string): void {
    const win = window as any
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

    constructor(private readonly page: Page, clock: Clock = () => Date.now()) {
        this.timeline = new TimelineRecorder(clock)
        this.mutationObserver = new MutationObserverController(page)
        this.eventManager = new PageEventManager(
            page,
            this.timeline,
            () => this.isTracking,
            () => { if (this.isTracking) void this.stop() },
            MUTATION_LOG_PREFIX,
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
