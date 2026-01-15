import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default [
	{ ignores: ['dist/**', 'coverage/**', 'test-reports/**', 'test-results/**', 'node_modules/**'] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['**/*.ts'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
		},
	},
	{
		files: ['**/*.test.ts', '**/test/**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
]
