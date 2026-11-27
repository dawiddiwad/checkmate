import type { Html } from '../html.ts'
import { jumpLinks, pageTabs } from './tabs.ts'

const tabs = [
	{ href: '#targets', label: 'Targets' },
	{ href: '#recipes', label: 'Recipes' },
	{ href: '#harness', label: 'Coding harness' },
]

export const examples: Array<[string, Html | string]> = [
	['pageTabs current', pageTabs({ label: 'Settings pages', tabs, current: '#recipes' })],
	['jumpLinks', jumpLinks({ links: tabs })],
]
