import test from 'node:test'
import assert from 'node:assert/strict'
import { openTarget, saveTarget, showTarget, targetRevision } from '../plugin/src/targets.ts'
import { actor, profile, store, target } from './support.ts'

const request = {
	targetId: 'checkout-local',
	baseUrl: 'http://127.0.0.1:4173',
	capabilities: ['browser', 'http'],
	allowedOperations: ['read_catalog', 'create_fixture_order', 'apply_fixture_discount'],
}

test('target open records the setup request once; an identical open is a no-op', (t) => {
	const opened = store(t)
	assert.equal(openTarget(opened, actor, request).data.recorded, true)
	assert.equal(openTarget(opened, actor, request).data.recorded, false)
	assert.throws(
		() => openTarget(opened, actor, { ...request, capabilities: ['http'] }),
		/Target checkout-local is open with other values/
	)
	assert.throws(() => openTarget(opened, actor, { ...request, targetId: 'bad id' }), /Invalid target ID: bad id/)
	assert.throws(() => openTarget(opened, actor, { ...request, baseUrl: 'ftp://x' }), /HTTP or HTTPS/)
	assert.throws(() => openTarget(opened, actor, { ...request, allowedOperations: [] }), /Missing operations/)
})

test('target save checks the profile against the setup request and the revision order', (t) => {
	const opened = store(t)
	assert.throws(
		() => saveTarget(opened, actor, { targetId: 'checkout-local', profile: profile() }),
		/Run target open/
	)
	openTarget(opened, actor, request)
	const save = (overrides: Parameters<typeof profile>[0]) =>
		saveTarget(opened, actor, { targetId: 'checkout-local', profile: profile(overrides) })
	assert.throws(() => save({ baseUrl: 'http://127.0.0.1:9999' }), /baseUrl differs/)
	assert.throws(() => save({ capabilities: ['browser'] }), /capabilities differ|Unlisted tool capability/)
	assert.throws(() => save({ allowedOperations: ['read_catalog'] }), /allowedOperations differ/)
	assert.throws(() => save({ revision: 2 }), /Profile revision must be 1, not 2/)
	assert.throws(() => save({ contractVersion: 'toolkit-1' as 'toolkit-2' }), /Invalid profile/)
	assert.throws(
		() =>
			save({
				tooling: [
					...profile().tooling.slice(0, 1),
					{ capability: 'http', executable: 'node', version: 'unknown' },
				],
			}),
		/actual version of node/
	)
	const first = save({ readyForLiveExecution: false })
	assert.equal(first.status, 'needs_decision')
	assert.deepEqual(first.reasons, ['Target prerequisites are not ready. Inspect the profile.'])
	assert.equal(save({ readyForLiveExecution: false }).data.recorded, false)
	assert.throws(() => save({ readyForLiveExecution: true }), /exists with other content. Save revision 2/)
	const second = save({ revision: 2, approvals: { plan: 'none', result: 'required' } })
	assert.equal(second.status, 'completed')
	assert.equal(second.subject, 'checkout-local@2')
	assert.equal(targetRevision(opened, 'checkout-local').revision, 2)
	assert.equal(targetRevision(opened, 'checkout-local', 1).profile.readyForLiveExecution, false)
})

test('target show prints a revision with the default approval policy', (t) => {
	const opened = store(t)
	target(opened)
	const shown = showTarget(opened, 'checkout-local')
	assert.equal(shown.subject, 'checkout-local@1')
	assert.deepEqual(shown.data.approvals, { plan: 'required', result: 'required' })
	assert.throws(() => showTarget(opened, 'checkout-local@3'), /Unknown target profile: checkout-local@3/)
	assert.throws(() => showTarget(opened, 'checkout-local@x'), /Use <id> or <id>@<revision>/)
})
