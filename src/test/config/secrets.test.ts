import { describe, expect, it } from 'vitest'
import { SecretResolver } from '../../config/secrets.js'
import { fixtureManifest } from '../fixtures/static-environment.js'

describe('secret record lookups', () => {
	it('reads a hostile binding name when it is an own property', () => {
		const manifest = structuredClone(fixtureManifest)
		manifest.secretBindings = JSON.parse('{"constructor":{"source":"environment","name":"HOSTILE_SECRET"}}')
		const resolver = new SecretResolver(manifest, (name) => (name === 'HOSTILE_SECRET' ? 'value' : undefined))

		expect(resolver.probe('constructor')).toBe(true)
		expect(resolver.read('constructor')).toBe('value')
	})

	it('does not read inherited binding names', () => {
		const resolver = new SecretResolver(fixtureManifest, () => 'value')

		expect(resolver.probe('constructor')).toBe(false)
		expect(() => resolver.read('toString')).toThrow("Unknown secret binding 'toString'")
	})
})
