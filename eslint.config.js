import tseslint from 'typescript-eslint'
import js from '@eslint/js'

export default [
	{ ignores: ['node_modules/**', 'dist/**', '**/*.d.ts'] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{ rules: { 'no-empty': ['error', { allowEmptyCatch: true }] } },
	{
		languageOptions: {
			globals: Object.fromEntries(
				[
					'process',
					'window',
					'console',
					'Buffer',
					'URL',
					'fetch',
					'AbortSignal',
					'setTimeout',
					'clearTimeout',
					'structuredClone',
				].map((name) => [name, 'readonly'])
			),
		},
	},
]
