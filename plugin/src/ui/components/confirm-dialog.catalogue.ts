import type { Html } from '../html.ts'
import { confirmDialog } from './confirm-dialog.ts'

export const examples: Array<[string, Html | string]> = [
	['confirmDialog (closed until a confirm is asked)', confirmDialog()],
]
