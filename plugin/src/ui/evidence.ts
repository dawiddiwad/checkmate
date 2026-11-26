export type EvidenceFile = {
	name: string
	mediaType: string
	size: number
	href: string | null
	text: (() => string) | null
}

export type Opener = { name: string; kind: 'image' | 'text'; page: string; src: string }

export const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const htmlType = 'text/html'
const textTypes = ['text/plain', 'text/markdown', 'application/json', 'application/xml', 'text/csv']
const inlineLimit = 64 * 1024

export function size(bytes: number) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function shownAsText(mediaType: string, bytes: number) {
	return textTypes.includes(mediaType) && bytes <= inlineLimit
}
