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
            if (typeof toolResponse.response !== 'string') {
                console.error(`Snapshot response is not a string, cannot compress.`)
                return toolResponse
            }
            const compressedText = this.compressJson(toolResponse.response)
            return {
                name: toolResponse.name,
                response: compressedText
            }
        } catch (error) {
            console.error(`Failed to compress JSON snapshot: ${error}`)
            return toolResponse
        }
    }

    private compressJson(text: string): string {
        try {
            Object.entries(typeMap).forEach(([full, short]) => {
                text = text.replaceAll(full, short)
            })
            return text
        } catch (error) {
            console.error(`Failed to compress JSON: ${error}`)
            return text
        }
    }
}