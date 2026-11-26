export const body = document.body
export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
export const served = new Map(
	[...document.querySelectorAll('[data-region]')].map((region) => [region.dataset.region, region.cloneNode(true)])
)
export const review = document.querySelector('[data-review]')
export const chatPage = document.querySelector('[data-chat-view]')
export const chatView = chatPage?.dataset.chatView
export const planChat = chatPage?.closest('[data-plan-chat]')
export const chatNavigator = chatView === 'list' && planChat && Boolean(document.querySelector('[data-navigator]'))
export const viewerPane = document.querySelector('[data-viewer-pane]')
export const address = new URL(location.href)
export const picks = new Set()

const drawer = document.querySelector('[data-drawer]')

export const state = {
	level: viewerPane
		? 'viewer'
		: drawer
			? 'detail'
			: review
				? address.searchParams.get('focus') === 'list'
					? 'list'
					: 'nav'
				: 'list',
	drawer,
	chatLane: chatView === 'thread' ? 'thread' : 'list',
	chatListAt: address.searchParams.get('at'),
	chosenBuild: address.searchParams.get('build'),
	anchor: null,
	rangeBase: null,
	sending: false,
	gone: null,
}

export function replaceAddress() {
	if (body.dataset.address && location.pathname + location.search !== body.dataset.address)
		window.history.replaceState(window.history.state, '', body.dataset.address + location.hash)
}
