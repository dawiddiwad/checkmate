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
        
        if (text.startsWith(TransientStateTracker.LOG_PREFIX)) {
            if (!this.isTracking) return
            const elapsed = Date.now() - this.startTime
            const payload = text.substring(TransientStateTracker.LOG_PREFIX.length)
            const logMsg = `[${elapsed}ms] ${payload}`
            if (this.timeline.length > 0 && this.timeline[this.timeline.length - 1] === logMsg) return
            this.timeline.push(logMsg)
            return
        }
        
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
        
        await this.page.evaluate((LOG_PREFIX: string) => {
            const win = window as any
            
            if (win.__checkmate_mutation_observer) {
                win.__checkmate_mutation_observer.disconnect()
            }
            
            function getTextContent(node: Node): string {
                if (node.nodeType === 3) return (node.textContent || "").trim()
                if (node.nodeType === 1) {
                    return (node.textContent || "").trim().replace(/\s+/g, ' ')
                }
                return ""
            }
            
            function isSkippableElement(el: HTMLElement | null): boolean {
                if (!el) return false
                return el.tagName === 'INS' || el.tagName === 'IFRAME' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE'
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
                    } catch(e) { }
                })
                
                const uniqueAppeared = [...new Set(appearedTexts)]
                const uniqueDisappeared = [...new Set(disappearedTexts)]
                const uniqueAttrChanges = [...new Set(attributeChanges)]
                
                if (uniqueAppeared.length > 0) {
                    const combined = uniqueAppeared.join(' | ').substring(0, 300)
                    console.log(`${LOG_PREFIX}Appeared: ${combined}`)
                }
                if (uniqueDisappeared.length > 0) {
                    const combined = uniqueDisappeared.join(' | ').substring(0, 300)
                    console.log(`${LOG_PREFIX}Disappeared: ${combined}`)
                }
                if (uniqueAttrChanges.length > 0) {
                    const combined = uniqueAttrChanges.join(' | ').substring(0, 400)
                    console.log(`${LOG_PREFIX}Changed: ${combined}`)
                }
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
