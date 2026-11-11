import tseslint from 'typescript-eslint'
import js from '@eslint/js'

export default [
	{
		ignores: [
			'node_modules/**',
			'dist/**',
			'plugin/dist/**',
			'cli/dist/**',
			'cli/plugin/**',
			'**/*.d.ts',
			'plugin/src/validators.js',
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		rules: {
			'no-empty': ['error', { allowEmptyCatch: true }],
			'@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
		},
	},
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
	{
		files: ['cli/src/ui/assets/*.js'],
		languageOptions: {
			globals: Object.fromEntries(
				['document', 'location', 'EventSource', 'DOMParser', 'FormData', 'URLSearchParams', 'CSS'].map(
					(name) => [name, 'readonly']
				)
			),
		},
	},
]
