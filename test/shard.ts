import nodeTest from 'node:test'

const [index, count] = (process.env.CHECKMATE_TEST_SHARD ?? '1/1').split('/').map(Number)
const register = nodeTest as (...args: unknown[]) => unknown
let position = 0

export const test = ((...args: unknown[]) => {
	if (position++ % count === index - 1) return register(...args)
}) as typeof nodeTest
test.before = nodeTest.before
test.after = nodeTest.after
