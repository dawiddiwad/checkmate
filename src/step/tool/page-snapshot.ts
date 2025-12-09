import { Page, Locator } from "@playwright/test"
import { parse, stringify } from "yaml"

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

type ParsedRole = { role: string; name?: string }
type LocatorCandidate = {
    pathKey: string
    locator: Locator
    role: string
    name?: string
    text?: string
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
    constructor(private length = 4) {}

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
        if (!ARIA_ROLES.has(role.toLowerCase())) return null
        return { role, name: match[2] }
    }
}

class LocatorFactory {
    create(parent: Page | Locator, role: string, options?: { name?: string; text?: string; siblingIndex?: number }): Locator {
        const base = options?.name ? parent.getByRole(role as any, { name: options.name, exact: true }) : parent.getByRole(role as any)
        const indexed = typeof options?.siblingIndex === "number" ? base.nth(options.siblingIndex) : base
        return options?.text ? indexed.filter({ hasText: options.text }) : indexed
    }
}

class SiblingIndexTracker {
    private tracker = new Map<string, number>()

    next(role: string): number {
        const current = this.tracker.get(role) || 0
        this.tracker.set(role, current + 1)
        return current
    }
}

class AriaSnapshotCollector {
    constructor(private roleParser: RoleParser, private locatorFactory: LocatorFactory) {}

    collect(snapshot: unknown, page: Page): LocatorCandidate[] {
        const candidates: LocatorCandidate[] = []
        const locatorSignatures = new Set<string>()

        const traverse = (node: unknown, parent: Page | Locator, siblingTracker: SiblingIndexTracker | null, path: PathChunk[]): void => {
            if (Array.isArray(node)) {
                const arrayTracker = new SiblingIndexTracker()
                node.forEach((child, index) => traverse(child, parent, arrayTracker, [...path, index]))
                return
            }

            if (typeof node === "string") {
                const parsed = this.roleParser.parse(node)
                if (!parsed) return
                const siblingIndex = parsed.name ? undefined : siblingTracker?.next(parsed.role) ?? 0
                const locator = this.locatorFactory.create(parent, parsed.role, { name: parsed.name, siblingIndex })
                this.addCandidate(locator, parsed, path, candidates, locatorSignatures)
                return
            }

            if (node && typeof node === "object") {
                const objectTracker = new SiblingIndexTracker()
                for (const [key, value] of Object.entries(node)) {
                    const parsed = this.roleParser.parse(key)
                    const nextPath = [...path, key]
                    if (!parsed) {
                        traverse(value, parent, siblingTracker, nextPath)
                        continue
                    }

                    const activeTracker = siblingTracker ?? objectTracker
                    const siblingIndex = parsed.name ? undefined : activeTracker.next(parsed.role)
                    const text = typeof value === "string" && !parsed.name ? value : undefined
                    const locator = this.locatorFactory.create(parent, parsed.role, { name: parsed.name, text, siblingIndex })
                    this.addCandidate(locator, parsed, nextPath, candidates, locatorSignatures, text)

                    if (typeof value !== "string") {
                        traverse(value, locator, siblingTracker ?? objectTracker, nextPath)
                    }
                }
            }
        }

        traverse(snapshot, page, null, [])
        return candidates
    }

    private addCandidate(locator: Locator, parsed: ParsedRole, path: PathChunk[], candidates: LocatorCandidate[], signatures: Set<string>, text?: string): void {
        const signature = locator.toString()
        if (signatures.has(signature)) return
        signatures.add(signature)
        candidates.push({ pathKey: PathEncoder.encode(path), locator, role: parsed.role, name: parsed.name, text })
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
                    const newKey = this.appendRefIfNeeded(key, nextPath, pathToRef)
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

export class AriaSnapshotMapper {
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

export class AriaSnapshotStore {
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

    getSnapshot(): string | null {
        return this.mapping?.snapshot ?? null
    }

    clear(): void {
        this.mapping = null
    }
}

export async function mapAriaSnapshot(snapshotYaml: string, page: Page): Promise<AriaSnapshotMapping> {
    const mapper = new AriaSnapshotMapper()
    return mapper.map(snapshotYaml, page)
}

export default AriaSnapshotMapper