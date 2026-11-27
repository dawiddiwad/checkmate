import type { Html } from '../html.ts'
import type { Page } from '../layout.ts'
import { html } from '../html.ts'
import { heading } from '../components/page-heading.ts'
import { examples as banner } from '../components/banner.catalogue.ts'
import { examples as board } from '../components/board.catalogue.ts'
import { examples as brand } from '../components/brand.catalogue.ts'
import { examples as bulkBar } from '../components/bulk-bar.catalogue.ts'
import { examples as button } from '../components/button.catalogue.ts'
import { examples as chatTurn } from '../components/chat-turn.catalogue.ts'
import { examples as composer } from '../components/composer.catalogue.ts'
import { examples as confirmDialog } from '../components/confirm-dialog.catalogue.ts'
import { examples as dataTable } from '../components/data-table.catalogue.ts'
import { examples as drawer } from '../components/drawer.catalogue.ts'
import { examples as emptyState } from '../components/empty-state.catalogue.ts'
import { examples as evidenceViewer } from '../components/evidence-viewer.catalogue.ts'
import { examples as facts } from '../components/facts.catalogue.ts'
import { examples as field } from '../components/field.catalogue.ts'
import { examples as findPalette } from '../components/find-palette.catalogue.ts'
import { examples as fold } from '../components/fold.catalogue.ts'
import { examples as instanceCard } from '../components/instance-card.catalogue.ts'
import { examples as key } from '../components/key.catalogue.ts'
import { examples as keysHelp } from '../components/keys-help.catalogue.ts'
import { examples as listRow } from '../components/list-row.catalogue.ts'
import { examples as menu } from '../components/menu.catalogue.ts'
import { examples as metric } from '../components/metric.catalogue.ts'
import { examples as navRail } from '../components/nav-rail.catalogue.ts'
import { examples as notice } from '../components/notice.catalogue.ts'
import { examples as pageHeading } from '../components/page-heading.catalogue.ts'
import { examples as planTile } from '../components/plan-tile.catalogue.ts'
import { examples as radioGroup } from '../components/radio-group.catalogue.ts'
import { examples as statusBar } from '../components/status-bar.catalogue.ts'
import { examples as statusMark } from '../components/status-mark.catalogue.ts'
import { examples as tabs } from '../components/tabs.catalogue.ts'
import { examples as testerCard } from '../components/tester-card.catalogue.ts'

const entries: Array<[string, Array<[string, Html | string]>]> = [
	['banner', banner],
	['board', board],
	['brand', brand],
	['bulk-bar', bulkBar],
	['button', button],
	['chat-turn', chatTurn],
	['composer', composer],
	['confirm-dialog', confirmDialog],
	['data-table', dataTable],
	['drawer', drawer],
	['empty-state', emptyState],
	['evidence-viewer', evidenceViewer],
	['facts', facts],
	['field', field],
	['find-palette', findPalette],
	['fold', fold],
	['instance-card', instanceCard],
	['key', key],
	['keys-help', keysHelp],
	['list-row', listRow],
	['menu', menu],
	['metric', metric],
	['nav-rail', navRail],
	['notice', notice],
	['page-heading', pageHeading],
	['plan-tile', planTile],
	['radio-group', radioGroup],
	['status-bar', statusBar],
	['status-mark', statusMark],
	['tabs', tabs],
	['tester-card', testerCard],
]

function entry([name, examples]: [string, Array<[string, Html | string]>]) {
	return html`<section
		class="catalogue-entry"
		id="${name}"
		data-catalogue-entry="${name}"
		aria-labelledby="catalogue-${name}"
	>
		<h2 id="catalogue-${name}">${name}</h2>
		${examples.map(
			([state, rendered]) =>
				html`<figure class="catalogue-example" data-catalogue-example="${name}: ${state}">
					<figcaption>${state}</figcaption>
					<div class="catalogue-render">${rendered}</div>
				</figure>`
		)}
	</section>`
}

export function cataloguePage(): Page {
	return {
		title: 'Catalogue',
		section: null,
		subjects: [],
		crumbs: [['Catalogue', null]],
		back: '/',
		body: html`<div class="catalogue" data-catalogue>
			${heading({
				title: 'Component catalogue',
				sub: 'Every component of plugin/src/ui/components/ in each state. Switch the theme in the status bar.',
			})}
			<nav class="catalogue-index" aria-label="Components">
				${entries.map(([name]) => html`<a href="#${name}">${name}</a>`)}
			</nav>
			${entries.map(entry)}
		</div>`,
	}
}
