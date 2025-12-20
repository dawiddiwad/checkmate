import { Page, Dialog, ConsoleMessage, Frame } from "@playwright/test"

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

        // 1. Listen for Dialogs
        this.page.on('dialog', this.handleDialog)

        // 2. Listen for Console messages (including our mutation logs)
        this.page.on('console', this.handleConsole)

        // 3. Listen for Navigation
        this.page.on('framenavigated', this.handleNavigation)

        // 4. Setup MutationObserver for transient elements
        await this.setupMutationObserver()
    }

    private handleDialog = (dialog: Dialog) => {
        const elapsed = Date.now() - this.startTime
        this.timeline.push(`[${elapsed}ms] Dialog appeared: "${dialog.message()}" (Type: ${dialog.type()}).`)
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
            this.timeline.push(`[${elapsed}ms] Navigated to: ${frame.url()}`)
            if (this.isTracking) {
                setTimeout(() => {
                    this.setupMutationObserver().catch(() => { })
                }, 150)
            }
        }
    }

    private async setupMutationObserver() {
        const logPrefix = TransientStateTracker.LOG_PREFIX
        
        // Use addScriptTag with inline content - uses console.log to communicate back
        const scriptContent = `
            (function() {
                if (window.__checkmate_mutation_observer) {
                    window.__checkmate_mutation_observer.disconnect();
                }
                
                var LOG_PREFIX = "${logPrefix}";
                
                function getSemanticText(node) {
                    if (node.nodeType === 3) return (node.textContent || "").trim();
                    if (node.nodeType === 1) {
                        return (node.textContent || "").trim().replace(/\\s+/g, ' ');
                    }
                    return "";
                }
                
                var observer = new MutationObserver(function(mutations) {
                    mutations.forEach(function(mutation) {
                        try {
                            if (mutation.type === 'attributes') {
                                var el = mutation.target;
                                var text = getSemanticText(el);
                                var roleOrTag = el.getAttribute('role') || el.tagName.toLowerCase();
                                var id = el.id ? '#' + el.id : '';
                                var attrName = mutation.attributeName;
                                var oldValue = mutation.oldValue || '';
                                var newValue = el.getAttribute(attrName) || '';
                                
                                // Skip noisy ad-related changes
                                if (attrName === 'style' && !id) return;
                                if (el.tagName === 'INS' || el.tagName === 'IFRAME') return;
                                
                                if (text && text.length > 2) {
                                    var changeDesc = '';
                                    if (attrName === 'class') {
                                        var oldClasses = oldValue.split(' ').filter(function(c) { return c; });
                                        var newClasses = newValue.split(' ').filter(function(c) { return c; });
                                        var added = newClasses.filter(function(c) { return oldClasses.indexOf(c) === -1; });
                                        var removed = oldClasses.filter(function(c) { return newClasses.indexOf(c) === -1; });
                                        if (added.length) changeDesc += '+' + added.join(',');
                                        if (removed.length) changeDesc += (changeDesc ? ' ' : '') + '-' + removed.join(',');
                                    } else {
                                        changeDesc = '"' + oldValue.substring(0, 30) + '" → "' + newValue.substring(0, 30) + '"';
                                    }
                                    console.log(LOG_PREFIX + 'Attribute "' + attrName + '" changed (' + changeDesc + '): "' + text.substring(0, 100) + '" (Role: ' + roleOrTag + id + ')');
                                }
                            } else if (mutation.type === 'childList') {
                                mutation.addedNodes.forEach(function(node) {
                                    var text = getSemanticText(node);
                                    if (text && text.length > 2) {
                                        var el = node.nodeType === 1 ? node : node.parentElement;
                                        var role = el ? (el.getAttribute('role') || el.tagName.toLowerCase()) : 'text';
                                        var id = (el && el.id) ? '#' + el.id : '';
                                        // Skip ad-related elements
                                        if (el && (el.tagName === 'INS' || el.tagName === 'IFRAME')) return;
                                        console.log(LOG_PREFIX + 'Element appeared: "' + text.substring(0, 150) + '" (Role: ' + role + id + ')');
                                    }
                                });
                                mutation.removedNodes.forEach(function(node) {
                                    var text = getSemanticText(node);
                                    if (text && text.length > 2) {
                                        var el = node.nodeType === 1 ? node : node.parentElement;
                                        var role = el ? (el.getAttribute('role') || el.tagName.toLowerCase()) : 'text';
                                        var id = (el && el.id) ? '#' + el.id : '';
                                        if (el && (el.tagName === 'INS' || el.tagName === 'IFRAME')) return;
                                        console.log(LOG_PREFIX + 'Element disappeared: "' + text.substring(0, 150) + '" (Role: ' + role + id + ')');
                                    }
                                });
                            }
                        } catch(e) { }
                    });
                });
                
                observer.observe(document, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeOldValue: true
                });
                
                window.__checkmate_mutation_observer = observer;
            })();
        `

        await this.page.addScriptTag({ content: scriptContent }).catch(() => { })
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
        }).catch(() => {
            // Ignore errors if page navigated away or closed
        })

        return this.timeline
    }

    formatTimeline(): string {
        if (this.timeline.length === 0) return ""
        return `Timeline of events after last function call:\n${this.timeline.join('\n')}\n`
    }
}
