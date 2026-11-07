import js from '@eslint/js'

export default [
	{ ignores: ['node_modules/**', 'dist/**', '**/*.d.ts'] },
	js.configs.recommended,
	{ rules: { 'no-empty': ['error', { allowEmptyCatch: true }] } },
	{
		languageOptions: {
			globals: Object.fromEntries(
				[
					'process',
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
