import { Page, Locator } from "@playwright/test"
import { parse, stringify } from "yaml"

export type AriaPageSnapshot = string | null
type AriaRole = Extract<Parameters<Page['getByRole']>[0], string>
type PathChunk = string | number

const ARIA_ROLES = new Set([
    "alert", "alertdialog", "application", "article", "banner", "blockquote", "button", "caption",
    "cell", "checkbox", "code", "columnheader", "combobox", "complementary", "contentinfo",
    "definition", "deletion", "dialog", "directory", "document", "emphasis", "feed", "figure",
    "form", "generic", "grid", "gridcell", "group", "heading", "img", "insertion", "link", "list",
    "listbox", "listitem", "log", "main", "marquee", "math", "meter", "menu", "menubar", "menuitem",
    "menuitemcheckbox", "menuitemradio", "navigation", "none", "note", "option", "paragraph",
    "presentation", "progressbar", "radio", "radiogroup", "region", "row", "rowgroup", "rowheader",
    "scrollbar", "search", "searchbox", "separator", "slider", "spinbutton", "status", "strong",
    "subscript", "superscript", "switch", "tab", "table", "tablist", "tabpanel", "term", "textbox",
    "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem"
]) satisfies Set<AriaRole> as Set<string>

const REF_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

type ParsedRole = { role: string; name?: string; isText?: boolean }
type LocatorCandidate = {
    pathKey: string
    locator: Locator
    role: string
    name?: string
    text?: string
    isText?: boolean
}

export type AriaSnapshotMapping = {
    snapshot: string
    references: Map<string, Locator>
    entries: Array<LocatorCandidate & { ref: string }>
}

class PathEncoder {
    static encode(path: PathChunk[]): string {
        return path.map(segment => typeof segment === "number" ? `#${segment}` : `k:${segment}`).join("|")
    }
}

class ReferenceGenerator {
    constructor(private length = 4) { }

    generate(): string {
        let ref = ""
        for (let i = 0; i < this.length; i += 1) {
            const index = Math.floor(Math.random() * REF_ALPHABET.length)
            ref += REF_ALPHABET[index]
        }
        return ref
    }
}

class RoleParser {
    parse(source: string): ParsedRole | null {
        if (!source || source.startsWith("/")) return null
        const match = source.match(/^([^\s]+)(?:\s+"([^"]+)")?/)
        if (!match) return null
        const role = match[1]
        
        // Handle 'text' as a special case - not a role but text content
        if (role.toLowerCase() === 'text') {
            return { role: 'text', isText: true }
        }
        
        if (!ARIA_ROLES.has(role.toLowerCase())) return null
        return { role, name: match[2] }
    }
}

class LocatorFactory {
    createDirect(page: Page, role: string, name: string, nthIndex?: number): Locator {
        const base = page.getByRole(role as any, { name, exact: true })
        return typeof nthIndex === 'number' ? base.nth(nthIndex) : base
    }

    createDirectText(page: Page, text: string, nthIndex?: number): Locator {
        const base = page.getByText(text, { exact: true })
        return typeof nthIndex === 'number' ? base.nth(nthIndex) : base
    }

    createTextFromAncestor(ancestor: Locator, text: string, nthIndex?: number): Locator {
        const base = ancestor.getByText(text, { exact: true })
        return typeof nthIndex === 'number' ? base.nth(nthIndex) : base.first()
    }

    createFromAncestor(ancestor: Locator, role: string, options?: { text?: string; nthIndex?: number }): Locator {
        let locator = ancestor.getByRole(role as any)
        if (options?.text) {
            locator = locator.filter({ hasText: options.text })
        }
        return typeof options?.nthIndex === 'number' ? locator.nth(options.nthIndex) : locator.first()
    }

    createFromPage(page: Page, role: string, options?: { text?: string; nthIndex?: number }): Locator {
        let locator = page.getByRole(role as any)
        if (options?.text) {
            locator = locator.filter({ hasText: options.text })
        }
        return typeof options?.nthIndex === 'number' ? locator.nth(options.nthIndex) : locator.first()
    }
}

type AncestorInfo = { role: string; name?: string; isText?: boolean }
type CollectedElement = {
    role: string
    name?: string
    text?: string
    path: PathChunk[]
    ancestors: AncestorInfo[]
    isText?: boolean
}

class AriaSnapshotCollector {
    constructor(private roleParser: RoleParser, private locatorFactory: LocatorFactory) { }

    collect(snapshot: unknown, page: Page): LocatorCandidate[] {
        // Phase 1: Collect all elements with their ancestry info
        const elements: CollectedElement[] = []
        this.collectElements(snapshot, [], [], elements)

        // Phase 2: Create optimal locators
        return this.createLocators(elements, page)
    }

    private collectElements(
        node: unknown,
        path: PathChunk[],
        ancestors: AncestorInfo[],
        elements: CollectedElement[]
    ): void {
        if (Array.isArray(node)) {
            node.forEach((child, index) => {
                this.collectElements(child, [...path, index], ancestors, elements)
            })
            return
        }

        if (typeof node === 'string') {
            const parsed = this.roleParser.parse(node)
            if (parsed) {
                elements.push({
                    role: parsed.role,
                    name: parsed.name,
                    path,
                    ancestors: [...ancestors],
                    isText: parsed.isText
                })
            }
            return
        }

        if (node && typeof node === 'object') {
            for (const [key, value] of Object.entries(node)) {
                const parsed = this.roleParser.parse(key)
                const nextPath = [...path, key]

                if (!parsed) {
                    this.collectElements(value, nextPath, ancestors, elements)
                    continue
                }

                // For text nodes, the value is the actual text content
                const textContent = parsed.isText && typeof value === 'string' ? value : undefined
                const text = !parsed.isText && typeof value === 'string' && !parsed.name ? value : undefined
                
                elements.push({
                    role: parsed.role,
                    name: parsed.name,
                    text: textContent ?? text,
                    path: nextPath,
                    ancestors: [...ancestors],
                    isText: parsed.isText
                })

                if (typeof value !== 'string') {
                    const newAncestors = [...ancestors, { role: parsed.role, name: parsed.name, isText: parsed.isText }]
                    this.collectElements(value, nextPath, newAncestors, elements)
                }
            }
        }
    }

    private createLocators(elements: CollectedElement[], page: Page): LocatorCandidate[] {
        const candidates: LocatorCandidate[] = []
        const signatures = new Set<string>()

        // Index named elements by role+name for duplicate detection
        const namedElementsByKey = new Map<string, CollectedElement[]>()
        // Index text elements by their text content
        const textElementsByContent = new Map<string, CollectedElement[]>()
        
        for (const el of elements) {
            if (el.isText && el.text) {
                const key = `text::${el.text}`
                if (!textElementsByContent.has(key)) textElementsByContent.set(key, [])
                textElementsByContent.get(key)!.push(el)
            } else if (el.name) {
                const key = `${el.role}::${el.name}`
                if (!namedElementsByKey.has(key)) namedElementsByKey.set(key, [])
                namedElementsByKey.get(key)!.push(el)
            }
        }

        for (const element of elements) {
            const locator = this.createOptimalLocator(element, namedElementsByKey, textElementsByContent, elements, page)
            if (!locator) continue

            const signature = locator.toString()
            if (signatures.has(signature)) continue
            signatures.add(signature)

            candidates.push({
                pathKey: PathEncoder.encode(element.path),
                locator,
                role: element.role,
                name: element.name,
                text: element.text,
                isText: element.isText
            })
        }

        return candidates
    }

    private createOptimalLocator(
        element: CollectedElement,
        namedElementsByKey: Map<string, CollectedElement[]>,
        textElementsByContent: Map<string, CollectedElement[]>,
        allElements: CollectedElement[],
        page: Page
    ): Locator | null {
        // Handle text elements specially
        if (element.isText && element.text) {
            const key = `text::${element.text}`
            const duplicates = textElementsByContent.get(key) ?? []
            const nthIndex = duplicates.length > 1 ? duplicates.indexOf(element) : undefined
            
            // Check if there's a named ancestor we can scope under
            const namedAncestorIndex = this.findNearestNamedAncestorIndex(element.ancestors)
            
            if (namedAncestorIndex >= 0) {
                const ancestor = element.ancestors[namedAncestorIndex]
                const ancestorKey = `${ancestor.role}::${ancestor.name}`
                const ancestorDuplicates = namedElementsByKey.get(ancestorKey) ?? []
                const ancestorNthIndex = this.findAncestorInstanceIndex(element, ancestor, ancestorDuplicates, allElements)
                const ancestorLocator = this.locatorFactory.createDirect(page, ancestor.role, ancestor.name!, ancestorNthIndex)
                
                // Count text siblings with same content under this ancestor
                const siblingIndex = this.countTextSiblingsUnderAncestor(element, namedAncestorIndex, allElements)
                return this.locatorFactory.createTextFromAncestor(ancestorLocator, element.text, siblingIndex)
            }
            
            // Direct page-level text lookup
            return this.locatorFactory.createDirectText(page, element.text, nthIndex)
        }
        
        if (element.name) {
            // Element has a name - use direct page lookup
            const key = `${element.role}::${element.name}`
            const duplicates = namedElementsByKey.get(key) ?? []
            const nthIndex = duplicates.length > 1 ? duplicates.indexOf(element) : undefined
            return this.locatorFactory.createDirect(page, element.role, element.name, nthIndex)
        }

        // Element has no name - find nearest named ancestor
        const namedAncestorIndex = this.findNearestNamedAncestorIndex(element.ancestors)

        if (namedAncestorIndex >= 0) {
            const ancestor = element.ancestors[namedAncestorIndex]

            // Create locator for the named ancestor
            const ancestorKey = `${ancestor.role}::${ancestor.name}`
            const ancestorDuplicates = namedElementsByKey.get(ancestorKey) ?? []
            
            // Find which instance of this ancestor we're under
            const ancestorNthIndex = this.findAncestorInstanceIndex(element, ancestor, ancestorDuplicates, allElements)
            const ancestorLocator = this.locatorFactory.createDirect(page, ancestor.role, ancestor.name!, ancestorNthIndex)

            // Count siblings of same role under this ancestor
            const siblingIndex = this.countSiblingsUnderAncestor(element, namedAncestorIndex, allElements)

            return this.locatorFactory.createFromAncestor(ancestorLocator, element.role, {
                text: element.text,
                nthIndex: siblingIndex
            })
        }

        // No named ancestor - use page-level lookup
        const siblingIndex = this.countSiblingsAtPageLevel(element, allElements)
        return this.locatorFactory.createFromPage(page, element.role, {
            text: element.text,
            nthIndex: siblingIndex
        })
    }

    private countTextSiblingsUnderAncestor(
        element: CollectedElement,
        namedAncestorIndex: number,
        allElements: CollectedElement[]
    ): number {
        const ancestor = element.ancestors[namedAncestorIndex]
        
        let count = 0
        for (const other of allElements) {
            if (!other.isText) continue
            if (other.text !== element.text) continue
            
            // Check if this element shares the same named ancestor
            const otherNamedAncestorIndex = this.findNearestNamedAncestorIndex(other.ancestors)
            if (otherNamedAncestorIndex < 0) continue
            
            const otherAncestor = other.ancestors[otherNamedAncestorIndex]
            if (otherAncestor.role !== ancestor.role || otherAncestor.name !== ancestor.name) continue
            
            // Check if they share the same ancestor instance
            if (!this.sharesSameAncestorInstance(element, other, namedAncestorIndex)) continue

            if (other === element) return count
            count++
        }

        return count
    }

    private findNearestNamedAncestorIndex(ancestors: AncestorInfo[]): number {
        for (let i = ancestors.length - 1; i >= 0; i--) {
            if (ancestors[i].name) {
                return i
            }
        }
        return -1
    }

    private findAncestorInstanceIndex(
        element: CollectedElement,
        ancestor: AncestorInfo,
        ancestorDuplicates: CollectedElement[],
        allElements: CollectedElement[]
    ): number | undefined {
        if (ancestorDuplicates.length <= 1) return undefined

        // Find which ancestor instance this element belongs to by checking path prefixes
        const elementPathStr = PathEncoder.encode(element.path)
        
        for (let i = 0; i < ancestorDuplicates.length; i++) {
            const ancestorPathStr = PathEncoder.encode(ancestorDuplicates[i].path)
            if (elementPathStr.startsWith(ancestorPathStr)) {
                return i
            }
        }

        return 0
    }

    private countSiblingsUnderAncestor(
        element: CollectedElement,
        namedAncestorIndex: number,
        allElements: CollectedElement[]
    ): number {
        const ancestor = element.ancestors[namedAncestorIndex]
        
        // Find all elements of same role that share the same named ancestor path
        let count = 0
        for (const other of allElements) {
            if (other.role !== element.role) continue
            if (other.name) continue // Named elements use direct lookup
            
            // Check if this element shares the same named ancestor
            const otherNamedAncestorIndex = this.findNearestNamedAncestorIndex(other.ancestors)
            if (otherNamedAncestorIndex < 0) continue
            
            const otherAncestor = other.ancestors[otherNamedAncestorIndex]
            if (otherAncestor.role !== ancestor.role || otherAncestor.name !== ancestor.name) continue
            
            // Check if they share the same ancestor instance (same path prefix up to ancestor)
            if (!this.sharesSameAncestorInstance(element, other, namedAncestorIndex)) continue

            if (other === element) return count
            count++
        }

        return count
    }

    private sharesSameAncestorInstance(el1: CollectedElement, el2: CollectedElement, ancestorDepth: number): boolean {
        // Compare ancestor chains up to the named ancestor depth
        if (el1.ancestors.length <= ancestorDepth || el2.ancestors.length <= ancestorDepth) return false
        
        for (let i = 0; i <= ancestorDepth; i++) {
            const a1 = el1.ancestors[i]
            const a2 = el2.ancestors[i]
            if (a1.role !== a2.role || a1.name !== a2.name) return false
        }
        
        return true
    }

    private countSiblingsAtPageLevel(element: CollectedElement, allElements: CollectedElement[]): number {
        let count = 0
        for (const other of allElements) {
            if (other.role !== element.role) continue
            if (other.name) continue
            if (this.findNearestNamedAncestorIndex(other.ancestors) >= 0) continue // Has named ancestor
            
            if (other === element) return count
            count++
        }
        return count
    }
}

class LocatorVisibilityFilter {
    async filter(candidates: LocatorCandidate[]): Promise<Array<LocatorCandidate & { ref: string }>> {
        const results = await Promise.all(
            candidates.map(async candidate => {
                try {
                    const visible = await candidate.locator.isVisible()
                    return visible
                } catch {
                    return false
                }
            })
        )

        const generator = new ReferenceGenerator()
        const withRefs: Array<LocatorCandidate & { ref: string }> = []
        const used = new Set<string>()

        candidates.forEach((candidate, index) => {
            if (!results[index]) return
            let ref = generator.generate()
            while (used.has(ref)) ref = generator.generate()
            used.add(ref)
            withRefs.push({ ...candidate, ref })
        })

        return withRefs
    }
}

class SnapshotRenderer {
    render(snapshot: unknown, pathToRef: Map<string, string>): string {
        const transform = (node: unknown, path: PathChunk[]): unknown => {
            if (Array.isArray(node)) return node.map((child, index) => transform(child, [...path, index]))
            if (typeof node === "string") return this.appendRefIfNeeded(node, path, pathToRef)
            if (node && typeof node === "object") {
                const entries = Object.entries(node).map(([key, value]) => {
                    const nextPath = [...path, key]
                    // For 'text' keys, don't add ref to the key - it will be on the value instead
                    const isTextNode = key.toLowerCase() === 'text' || key.toLowerCase().startsWith('text:')
                    const newKey = isTextNode ? key : this.appendRefIfNeeded(key, nextPath, pathToRef)
                    const newValue = transform(value, nextPath)
                    return [newKey, newValue]
                })
                return Object.fromEntries(entries)
            }
            return node
        }

        const transformed = transform(snapshot, [])
        return stringify(transformed)
    }

    private appendRefIfNeeded(label: string, path: PathChunk[], pathToRef: Map<string, string>): string {
        const ref = pathToRef.get(PathEncoder.encode(path))
        if (!ref) return label
        return `${label} [ref=${ref}]`
    }
}

class AriaSnapshotMapper {
    private roleParser = new RoleParser()
    private locatorFactory = new LocatorFactory()
    private collector = new AriaSnapshotCollector(this.roleParser, this.locatorFactory)
    private visibilityFilter = new LocatorVisibilityFilter()
    private renderer = new SnapshotRenderer()

    async map(snapshotYaml: string, page: Page): Promise<AriaSnapshotMapping> {
        const parsed = parse(snapshotYaml)
        const candidates = this.collector.collect(parsed, page)
        const visibleCandidates = await this.visibilityFilter.filter(candidates)

        const pathToRef = new Map<string, string>()
        const referenceMap = new Map<string, Locator>()

        visibleCandidates.forEach(candidate => {
            pathToRef.set(candidate.pathKey, candidate.ref)
            referenceMap.set(candidate.ref, candidate.locator)
        })

        const snapshot = this.renderer.render(parsed, pathToRef)

        return { snapshot, references: referenceMap, entries: visibleCandidates }
    }
}

export class PageSnapshotStore {
    static lastSnapshot: AriaPageSnapshot = null
    private mapping: AriaSnapshotMapping | null = null

    set(mapping: AriaSnapshotMapping): void {
        this.mapping = mapping
    }

    getLocator(ref: string): Locator {
        const locator = this.mapping?.references.get(ref)
        if (!locator) {
            throw new Error(`Locator not found for ref: ${ref}`)
        } else return locator
    }

    getEntries(): AriaSnapshotMapping['entries'] {
        return this.mapping?.entries ?? []
    }

    getSnapshot(): string | null {
        const snapshot = this.mapping?.snapshot ?? null
        PageSnapshotStore.lastSnapshot = snapshot ? 'page snapshot:\n```yaml\n' + snapshot + '\n```' : null
        return PageSnapshotStore.lastSnapshot
    }

    clear(): void {
        this.mapping = null
    }
}

export class PageSnapshot {
    private readonly store: PageSnapshotStore
    private readonly mapper: AriaSnapshotMapper
    private page: Page | null = null

    constructor(store?: PageSnapshotStore) {
        this.store = store ?? new PageSnapshotStore()
        this.mapper = new AriaSnapshotMapper()
    }

    async get(page: Page): Promise<AriaPageSnapshot> {
        this.page = page
        const rawSnapshot = await this.page.locator('body').ariaSnapshot()
        const mapping = await this.mapper.map(rawSnapshot, this.page)
        this.store.set(mapping)
        return this.store.getSnapshot()
    }
}