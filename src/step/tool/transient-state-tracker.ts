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

// Tracks transient state changes in a web page by observing DOM mutations, dialog appearances, console errors, and navigations.
export class TransientStateTracker {
    private timeline: string[] = []
    private startTime: number = 0
    private isTracking: boolean = false
    private static readonly LOG_PREFIX = '__CHECKMATE_MUTATION__'

    constructor(private readonly page: Page) { }

    async start() {
        this.timeline = []
        this.startTime = Date.now()
        this.isTracking = true
        this.page.on('dialog', this.handleDialog)
        this.page.on('console', this.handleConsole)
        this.page.on('framenavigated', this.handleNavigation)
        await this.setupMutationObserver()
    }

    private handleDialog = (dialog: Dialog) => {
        const elapsed = Date.now() - this.startTime
        this.timeline.push(`[${elapsed}ms] Dialog appeared: "${dialog.message()}" (Type: ${dialog.type()}) and automatically dismissed.`)
        dialog.dismiss().catch(() => { })
    }

    private handleConsole = (msg: ConsoleMessage) => {
        const text = msg.text()
        
        // Check if this is a mutation report from our observer
        if (text.startsWith(TransientStateTracker.LOG_PREFIX)) {
            if (!this.isTracking) return
            const elapsed = Date.now() - this.startTime
            const payload = text.substring(TransientStateTracker.LOG_PREFIX.length)
            const logMsg = `[${elapsed}ms] ${payload}`
            if (this.timeline.length > 0 && this.timeline[this.timeline.length - 1] === logMsg) return
            this.timeline.push(logMsg)
            return
        }
        
        // Also capture console errors
        if (msg.type() === 'error') {
            const elapsed = Date.now() - this.startTime
            this.timeline.push(`[${elapsed}ms] Console Error: ${text.substring(0, 200)}`)
        }
    }

    private handleNavigation = (frame: Frame) => {
        if (frame === this.page.mainFrame()) {
            const elapsed = Date.now() - this.startTime
            this.timeline = []
            this.timeline.push(`[${elapsed}ms] Navigated to: ${frame.url()}`)
            if (this.isTracking) {
                this.stop().catch(() => { })
            }
        }
    }

    private async setupMutationObserver() {
        const logPrefix = TransientStateTracker.LOG_PREFIX
        
        // Use page.evaluate() instead of addScriptTag to bypass CSP restrictions
        await this.page.evaluate((LOG_PREFIX: string) => {
            const win = window as any
            
            if (win.__checkmate_mutation_observer) {
                win.__checkmate_mutation_observer.disconnect()
            }
            
            function getSemanticText(node: Node): string {
                if (node.nodeType === 3) return (node.textContent || "").trim()
                if (node.nodeType === 1) {
                    return (node.textContent || "").trim().replace(/\s+/g, ' ')
                }
                return ""
            }
            
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    try {
                        if (mutation.type === 'attributes') {
                            const el = mutation.target as HTMLElement
                            const text = getSemanticText(el)
                            const roleOrTag = el.getAttribute('role') || el.tagName.toLowerCase()
                            const id = el.id ? '#' + el.id : ''
                            const attrName = mutation.attributeName!
                            const oldValue = mutation.oldValue || ''
                            const newValue = el.getAttribute(attrName) || ''
                            
                            // Skip noisy ad-related changes
                            if (attrName === 'style' && !id) return
                            if (el.tagName === 'INS' || el.tagName === 'IFRAME') return
                            
                            if (text && text.length > 2) {
                                let changeDesc = ''
                                if (attrName === 'class') {
                                    const oldClasses = oldValue.split(' ').filter(c => c)
                                    const newClasses = newValue.split(' ').filter(c => c)
                                    const added = newClasses.filter(c => !oldClasses.includes(c))
                                    const removed = oldClasses.filter(c => !newClasses.includes(c))
                                    if (added.length) changeDesc += '+' + added.join(',')
                                    if (removed.length) changeDesc += (changeDesc ? ' ' : '') + '-' + removed.join(',')
                                } else {
                                    changeDesc = `"${oldValue.substring(0, 30)}" → "${newValue.substring(0, 30)}"`
                                }
                                console.log(`${LOG_PREFIX}Attribute "${attrName}" changed (${changeDesc}): "${text.substring(0, 100)}" (Role: ${roleOrTag}${id})`)
                            }
                        } else if (mutation.type === 'childList') {
                            mutation.addedNodes.forEach((node) => {
                                const text = getSemanticText(node)
                                if (text && text.length > 2) {
                                    const el = node.nodeType === 1 ? node as HTMLElement : (node.parentElement as HTMLElement)
                                    const role = el ? (el.getAttribute('role') || el.tagName.toLowerCase()) : 'text'
                                    const id = (el && el.id) ? '#' + el.id : ''
                                    // Skip ad-related elements
                                    if (el && (el.tagName === 'INS' || el.tagName === 'IFRAME')) return
                                    console.log(`${LOG_PREFIX}Element appeared: "${text.substring(0, 150)}" (Role: ${role}${id})`)
                                }
                            })
                            mutation.removedNodes.forEach((node) => {
                                const text = getSemanticText(node)
                                if (text && text.length > 2) {
                                    const el = node.nodeType === 1 ? node as HTMLElement : (node.parentElement as HTMLElement)
                                    const role = el ? (el.getAttribute('role') || el.tagName.toLowerCase()) : 'text'
                                    const id = (el && el.id) ? '#' + el.id : ''
                                    if (el && (el.tagName === 'INS' || el.tagName === 'IFRAME')) return
                                    console.log(`${LOG_PREFIX}Element disappeared: "${text.substring(0, 150)}" (Role: ${role}${id})`)
                                }
                            })
                        }
                    } catch(e) { }
                })
            })
            
            observer.observe(document, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeOldValue: true
            })
            
            win.__checkmate_mutation_observer = observer
        }, logPrefix).catch(() => { })
    }

    async stop(): Promise<string[]> {
        this.isTracking = false
        this.page.off('dialog', this.handleDialog)
        this.page.off('console', this.handleConsole)
        this.page.off('framenavigated', this.handleNavigation)

        await this.page.evaluate(() => {
            const win = window as any
            if (win.__checkmate_mutation_observer) {
                win.__checkmate_mutation_observer.disconnect()
                delete win.__checkmate_mutation_observer
            }
        }).catch((error) => {
            logger.debug('failed to remove MutationObserver from page due to error:\n', JSON.stringify(error, null, 2))
        })

        return this.timeline
    }

    formatTimeline(): string {
        if (this.timeline.length === 0) return ""
        return `Timeline of events after last function call:\n${this.timeline.join('\n')}\n`
    }
}
