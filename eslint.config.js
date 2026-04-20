import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default [
	{
		ignores: [
			'dist/**',
			'coverage/**',
			'test-reports/**',
			'test-results/**',
			'node_modules/**',
			'package/**',
			'src/test/create-examples.test.ts',
			'bin/checkmate.js',
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['**/*.ts'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
		},
	},
]
