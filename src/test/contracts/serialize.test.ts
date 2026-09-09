import { describe, expect, it } from 'vitest'
import { serializeJson } from '../../contracts/serialize.js'

describe('serializeJson', () => {
	it('sorts object keys recursively and preserves array order', () => {
		expect(
			serializeJson({
				z: 1,
				a: { zebra: true, alpha: false },
				list: [{ z: 2, a: 1 }, 'first', 'second'],
			})
		).toBe(
			'{\n' +
				'  "a": {\n' +
				'    "alpha": false,\n' +
				'    "zebra": true\n' +
				'  },\n' +
				'  "list": [\n' +
				'    {\n' +
				'      "a": 1,\n' +
				'      "z": 2\n' +
				'    },\n' +
				'    "first",\n' +
				'    "second"\n' +
				'  ],\n' +
				'  "z": 1\n' +
				'}\n'
		)
	})

	it('emits UTF-8 compatible Unicode with exactly one trailing LF and no BOM', () => {
		const serialized = serializeJson({ message: 'Zażółć 🧪' })
		const bytes = Buffer.from(serialized, 'utf8')

		expect(serialized.endsWith('\n')).toBe(true)
		expect(serialized.endsWith('\n\n')).toBe(false)
		expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf])
		expect(bytes.toString('utf8')).toContain('Zażółć 🧪')
	})

	it('preserves hostile own keys and writes every key in UTF-16 lexical order', () => {
		const value = JSON.parse(
			'{"10":"ten","2":"two","__proto__":{"polluted":true},"constructor":"ctor","prototype":"proto","01":"leading"}'
		) as Record<string, unknown>

		expect(serializeJson(value)).toBe(
			'{\n' +
				'  "01": "leading",\n' +
				'  "10": "ten",\n' +
				'  "2": "two",\n' +
				'  "__proto__": {\n' +
				'    "polluted": true\n' +
				'  },\n' +
				'  "constructor": "ctor",\n' +
				'  "prototype": "proto"\n' +
				'}\n'
		)
	})

	it('sorts UTF-16 code units without locale or integer-key reordering', () => {
		const value = JSON.parse('{"😀":1,"�":2,"A":3,"a":4,"11":5,"2":6}') as Record<string, unknown>
		expect(serializeJson(value)).toBe(
			'{\n' +
				'  "11": 5,\n' +
				'  "2": 6,\n' +
				'  "A": 3,\n' +
				'  "a": 4,\n' +
				'  "😀": 1,\n' +
				'  "�": 2\n' +
				'}\n'
		)
	})

	it.each([undefined, NaN, Infinity, 1n, new Date('2026-09-04T00:00:00Z'), { value: undefined }, [undefined]])(
		'rejects non-JSON value %#',
		(value) => {
			expect(() => serializeJson(value)).toThrow(TypeError)
		}
	)

	it('rejects sparse and circular values', () => {
		const sparse = Array<string>(1)
		const circular: Record<string, unknown> = {}
		circular.self = circular

		expect(() => serializeJson(sparse)).toThrow('sparse array')
		expect(() => serializeJson(circular)).toThrow('circular value')
	})

	it('rejects accessors, non-enumerable properties, symbols, and array extras', () => {
		const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: () => 'hidden' })
		const hidden = Object.defineProperty({}, 'value', { enumerable: false, value: 'hidden' })
		const symbol = { [Symbol('value')]: 'hidden' }
		const arrayExtra = Object.assign([], { extra: true })

		expect(() => serializeJson(accessor)).toThrow('non-enumerable or accessor')
		expect(() => serializeJson(hidden)).toThrow('non-enumerable or accessor')
		expect(() => serializeJson(symbol)).toThrow('symbol keys')
		expect(() => serializeJson(arrayExtra)).toThrow('extra properties')
	})
})
