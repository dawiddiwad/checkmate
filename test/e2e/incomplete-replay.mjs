export async function replay(role) {
	if (role === 'tester') return 'The quote was not observed.'
	return [{ kind: 'criterion', rule: 'R1', text: 'The promotion quote is 240 PLN.', source: 'ticket.md' }]
}
