import { ToolResponse } from "./tool-registry"

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
        const refMatch = content.match(/\[ref=([^\]]+)\]/)
        if (refMatch) {
            ref = ` ref=${refMatch[1]}`
            content = content.replace(refMatch[0], "").trim()
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
        const typeMap: Record<string, string> = {
            generic: "g",
            button: "b",
            link: "l",
            img: "i",
            navigation: "nav",
            list: "ul",
            listitem: "li",
            combobox: "cb",
            searchbox: "sb",
            tooltip: "tltp",
            heading: "h",
            paragraph: "p",
            table: "tbl",
            row: "tr",
            cell: "cl",
            rowheader: "rh",
            gridcell: "gcl",
            columnheader: "ch",
            rowgroup: "rgrp",
            article: "art",
            separator: "hr",
            tree: "tree",
            treeitem: "ti",
            tab: "tab",
            tablist: "tlst",
            tabpanel: "tpnl",
            group: "grp",
            status: "stat",
            main: "main"
        }
        return typeMap[type] || type
    }

    private compressAttrName(attr: string): string {
        const attrMap: Record<string, string> = {
            cursor: "cur",
            disabled: "dis",
            selected: "sel",
            level: "lv"
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