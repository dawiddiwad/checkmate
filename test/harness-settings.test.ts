import assert from 'node:assert/strict'
import test from 'node:test'
import { selectedHarness } from '../plugin/src/pi.ts'
import {
	requestModelText,
	saveRequestModel,
	saveTesterRules,
	saveWorkspaceHarness,
	testerRulesText,
	workspaceEnv,
	workspaceUiEnv,
} from '../plugin/src/settings.ts'
import { actor, store } from './support.ts'

test('workspace harness overrides the UI default and leaves CLI environment overrides in force', (t) => {
	const opened = store(t)
	const startup = { CHECKMATE_HARNESS: 'pi' }
	assert.equal(selectedHarness(workspaceUiEnv(opened, startup)), 'pi')
	assert.equal(selectedHarness(workspaceUiEnv(opened, {})), 'claude')
	saveWorkspaceHarness(opened, actor, 'claude')
	assert.equal(selectedHarness(workspaceUiEnv(opened, startup)), 'claude')
	assert.equal(selectedHarness(workspaceEnv(opened, startup)), 'pi')
	saveWorkspaceHarness(opened, actor, 'pi')
	assert.equal(selectedHarness(workspaceEnv(opened, {})), 'pi')
	assert.throws(() => saveWorkspaceHarness(opened, actor, 'other'), /agent harness/)
})

test('tool rules and request model stay separate for each harness', (t) => {
	const opened = store(t)
	saveTesterRules(opened, actor, 'Read Bash(git status:*)')
	saveRequestModel(opened, actor, 'opus')
	saveTesterRules(opened, actor, 'Read Write', 'pi')
	saveRequestModel(opened, actor, 'openrouter/z-ai/glm-5.3-flash', 'pi')
	assert.equal(testerRulesText(opened), 'Read Bash(git status:*)')
	assert.equal(testerRulesText(opened, 'pi'), 'Read Write')
	assert.equal(requestModelText(opened), 'opus')
	assert.equal(requestModelText(opened, 'pi'), 'openrouter/z-ai/glm-5.3-flash')
	assert.throws(() => saveTesterRules(opened, actor, 'Bash(git status:*)', 'pi'), /tool name/)
})
