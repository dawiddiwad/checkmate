export type WebToolSettings = {
	snapshotFilter: boolean
	snapshotTopPercent: number
}

export type BrowserStepIntent = {
	action: string
	expect: string
	search?: string[]
	topPercent?: number
}
