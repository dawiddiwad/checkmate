import type { Html } from '../html.ts'
import type { EvidenceFile } from '../evidence.ts'
import { evidenceFiles, evidenceList, evidenceOverlay, evidencePreview } from './evidence-viewer.ts'

const pixel =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const files: EvidenceFile[] = [
	{ name: 'T1-account.png', mediaType: 'image/png', size: 68, href: pixel, text: null },
	{
		name: 'console.log',
		mediaType: 'text/plain',
		size: 24,
		href: null,
		text: () => 'GET /account 200\nGET /api 500',
	},
	{ name: 'trace.zip', mediaType: 'application/zip', size: 2048, href: null, text: null },
]

export const examples: Array<[string, Html | string]> = [
	['evidenceFiles in a drawer', evidenceFiles({ files, base: '#', current: null })],
	['evidenceFiles in the viewer, second chosen', evidenceFiles({ files, base: '#', current: 1, inViewer: true })],
	['evidenceFiles empty', evidenceFiles({ files: [], base: '#', current: null })],
	...files.map((file): [string, Html | string] => [`evidencePreview ${file.mediaType}`, evidencePreview({ file })]),
	['evidenceList', evidenceList(files)],
	['evidenceList empty', evidenceList([], 'The tester gave no evidence.')],
	['evidenceOverlay (hidden until a file is opened)', evidenceOverlay],
]
