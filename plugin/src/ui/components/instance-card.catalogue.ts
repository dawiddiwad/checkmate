import type { Html } from '../html.ts'
import { html } from '../html.ts'
import { button } from './button.ts'
import { instanceCard, instanceCards } from './instance-card.ts'
import { statusMark } from './status-mark.ts'

export const examples: Array<[string, Html | string]> = [
	[
		'instanceCards',
		instanceCards([
			instanceCard({
				id: 'staging',
				mark: statusMark({ state: 'active' }),
				added: 'qa-lead · 3 d',
				action: button({ label: 'Retire' }),
				entries: [
					['web', 'https://staging--sandbox.example.my.salesforce.com'],
					['org', 'shop-next-staging'],
				],
				rows: [
					[
						'Environment',
						'Salesforce sandbox staging, Salesforce CLI org alias shop-next-staging. Metadata must not be changed.',
					],
					['References', html`<code>STAGING_LOGIN</code>`],
				],
			}),
			instanceCard({
				id: 'preview',
				mark: statusMark({ state: 'retired' }),
				added: 'checkmate-agent · 9 d',
				action: '',
				entries: [['web', 'http://127.0.0.1:4100']],
				rows: [['Environment', 'Old preview build']],
			}),
		]),
	],
]
