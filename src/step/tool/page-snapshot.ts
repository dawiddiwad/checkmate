import { Page } from "@playwright/test"
import { parse } from "yaml"

export type AriaPageSnapshot = string | null

export class PageSnapshot {
    private page: Page | null = null
    static lastSnapshot: AriaPageSnapshot = null

    constructor(page: Page) {
        this.page = page
    }

    private minify(snapshot: AriaPageSnapshot): AriaPageSnapshot {
        return snapshot
            .replaceAll('"', '')
            .replaceAll('\\', '')
            .replaceAll(' [', '[')
            .replaceAll('] ', ']')
    }

    async get(): Promise<AriaPageSnapshot> {
        try {
            const snapshotYAML = await (this.page as any)._snapshotForAI().then((snapshot) => snapshot.full)
            const snapshotJSON = parse(snapshotYAML)[0]
            const snapshotSTRING = JSON.stringify(snapshotJSON)
            PageSnapshot.lastSnapshot = this.minify(snapshotSTRING)
            return PageSnapshot.lastSnapshot
        } catch (error) {
            throw new Error(`Failed to create aria page snapshot:\n${error}`)
        }
    }
}