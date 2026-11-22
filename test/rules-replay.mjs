export function replay(_role, _session, prompt) {
	if (!prompt.includes('Goal: Check the cart.') || !prompt.includes('Source ticket.md:')) return []
	if (!prompt.includes('5 or more items get 10% off.') || !prompt.includes('A cart holds at most 20 items.'))
		return []
	return [
		{ id: 'R1', text: '5 or more items get 10% off.', source: 'ticket.md#Discount', area: 'Discount' },
		{ id: 'R2', text: 'A cart holds at most 20 items.', source: 'ticket.md#Limit', area: 'Limit' },
	]
}
