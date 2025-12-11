import { ToolResponse } from "./tool-registry"

export const typeMap: Record<string, string> = {
    alert: "alt",
    alertdialog: "ald",
    application: "app",
    article: "art",
    banner: "ban",
    blockquote: "bq",
    button: "btn",
    caption: "cap",
    cell: "cel",
    checkbox: "chk",
    code: "cod",
    columnheader: "ch",
    combobox: "cbo",
    complementary: "cmp",
    contentinfo: "inf",
    definition: "def",
    deletion: "del",
    dialog: "dlg",
    directory: "dir",
    document: "doc",
    emphasis: "em",
    feed: "fed",
    figure: "fig",
    form: "frm",
    generic: "gen",
    grid: "grd",
    gridcell: "gc",
    group: "grp",
    heading: "h",
    img: "img",
    level: "lv",
    link: "lnk",
    list: "lst",
    listbox: "lbx",
    listitem: "li",
    log: "log",
    main: "mn",
    marquee: "mrq",
    math: "mth",
    menu: "mnu",
    menubar: "mbr",
    menuitem: "mi",
    menuitemcheckbox: "mic",
    menuitemradio: "mir",
    meter: "mtr",
    navigation: "nav",
    none: "non",
    note: "nt",
    option: "opt",
    paragraph: "p",
    presentation: "prs",
    progressbar: "prg",
    radio: "rad",
    radiogroup: "rdg",
    region: "reg",
    row: "row",
    rowgroup: "rg",
    rowheader: "rh",
    scrollbar: "scr",
    search: "src",
    searchbox: "sch",
    selected: "sel",
    separator: "sep",
    slider: "sld",
    spinbutton: "spn",
    status: "sts",
    strong: "str",
    subscript: "sub",
    superscript: "sup",
    switch: "swt",
    tab: "tab",
    table: "tbl",
    tablist: "tls",
    tabpanel: "tpn",
    term: "trm",
    textbox: "txt",
    time: "tim",
    timer: "tmr",
    toolbar: "tbr",
    tooltip: "tip",
    tree: "tre",
    treegrid: "tgr",
    treeitem: "ti",
    unchanged: "unc",
}

export class SnapshotProcessor {
    getCompressed(toolResponse: ToolResponse): ToolResponse {
        try {
            const responseText = this.extractResponseText(toolResponse)
            if (!responseText) {
                return toolResponse
            }
            const compressedText = this.compressYaml(responseText)
            return this.updateResponse(toolResponse, compressedText)
        } catch (error) {
            console.error(`Failed to compress yaml snapshot: ${error}`)
            return toolResponse
        }
    }

    private extractResponseText(toolResponse: ToolResponse): string | null {
        const response = toolResponse.response
        if (typeof response === "string") {
            return response
        }
        if (response && typeof response === "object" && "text" in response && typeof response.text === "string") {
            return response.text
        }
        if (response && typeof response === "object" && "content" in response && Array.isArray(response.content)) {
            for (const item of response.content) {
                if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
                    return item.text
                }
            }
        }
        return null
    }

    private compressYaml(text: string): string {
        const yamlSectionPattern = /yaml\n([\s\S]*?)(?:\n\n|\n$|$)/
        const match = text.match(yamlSectionPattern)

        if (!match) {
            return text
        }

        try {
            const yamlContent = match[1]
            const compressedContent = this.compressAccessibilityTree(yamlContent)

            return text.replace(
                match[0],
                `accessibility-tree\n${compressedContent}\n\n`
            )
        } catch (error) {
            console.error(`Failed to compress YAML section: ${error}`)
            return text
        }
    }

    private compressAccessibilityTree(yamlContent: string): string {
        const lines = yamlContent.split("\n")
        const compressed: string[] = []

        for (const line of lines) {
            if (!line.trim()) continue

            const compressedLine = this.compressLine(line)
            if (compressedLine) {
                compressed.push(compressedLine)
            }
        }

        return compressed.join("\n")
    }

    private compressLine(line: string): string | null {
        const indent = line.search(/\S/)
        if (indent === -1) return null

        const compressedIndent = " ".repeat(Math.floor(indent / 2))
        let content = line.trim()

        if (!content.startsWith("-")) return null
        content = content.substring(1).trim()

        let elementType = ""
        const typeMatch = content.match(/^(\w+)/)
        if (typeMatch) {
            elementType = this.compressElementType(typeMatch[1])
            content = content.substring(typeMatch[0].length).trim()
        }

        let text = ""
        const textMatch = content.match(/"([^"]*)"/)
        if (textMatch) {
            text = ` #${textMatch[1]}`
            content = content.replace(textMatch[0], "").trim()
        }

        let ref = ""
        const bracketRefMatch = content.match(/\[ref=([^\]]+)\]/)
        if (bracketRefMatch) {
            ref = ` [ref=${bracketRefMatch[1]}]`
            content = content.replace(bracketRefMatch[0], "").trim()
        } else {
            const unbracketRefMatch = content.match(/\bref=([^\s\]]+)/)
            if (unbracketRefMatch) {
                ref = ` [ref=${unbracketRefMatch[1]}]`
                content = content.replace(unbracketRefMatch[0], "").trim()
            }
        }

        const attrs: string[] = []
        const attrPattern = /\[([^\]]+)\]/g
        let attrMatch
        while ((attrMatch = attrPattern.exec(content)) !== null) {
            const attr = attrMatch[1]
            if (attr.includes("=")) {
                const [key, value] = attr.split("=")
                attrs.push(`${this.compressAttrName(key.trim())}:${value.trim()}`)
            } else if (attr !== "active") {
                attrs.push(this.compressAttrName(attr))
            }
        }

        const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : ""
        return `${compressedIndent}${elementType}${text}${ref}${attrStr}`.replace(/:$/, "")
    }

    private compressElementType(type: string): string {
        return typeMap[type] || type
    }

    private compressAttrName(attr: string): string {
        const attrMap: Record<string, string> = {
            cursor: "cur",
            disabled: "dis",
            selected: "sel",
            level: "lv",
            unchanged: "unc",
        }
        return attrMap[attr] || attr
    }

    private updateResponse(toolResponse: ToolResponse, newText: string): ToolResponse {
        const response = toolResponse.response

        if (typeof response === "string") {
            return {
                ...toolResponse,
                response: { text: newText } as Record<string, unknown>
            }
        }

        if (response && typeof response === "object" && "text" in response) {
            return {
                ...toolResponse,
                response: {
                    ...response,
                    text: newText
                } as Record<string, unknown>
            }
        }

        if (response && typeof response === "object" && "content" in response && Array.isArray(response.content)) {
            const updatedContent = response.content.map((item: any) => {
                if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
                    return { ...item, text: newText }
                }
                return item
            })
            return {
                ...toolResponse,
                response: {
                    ...response,
                    content: updatedContent
                } as Record<string, unknown>
            }
        }
        return toolResponse
    }
}