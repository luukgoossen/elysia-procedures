module.exports = {
	env: {
		node: true, es2022: true,
	},
	extends: ['plugin:@typescript-eslint/recommended'],
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 'latest', sourceType: 'module', project: ['./tsconfig.json']
	},
	ignorePatterns: ['.eslintrc.cjs', '**/*.tst.ts', 'dist'],
	plugins: ['@typescript-eslint', '@stylistic'],
	rules: {
		'quotes': ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
		'@stylistic/semi': ['warn', 'never'],
		'padded-blocks': 'off',
		'no-trailing-spaces': ['warn', { skipBlankLines: true }],
		'no-tabs': 'off',
		'capitalized-comments': ['warn', 'never',
			{
				line: {
					'ignoreConsecutiveComments': true
				},
				block: {
					'ignorePattern': '.*'
				}
			}
		],
		'array-element-newline': 'off',
		'@typescript-eslint/no-var-requires': 'off',
		'@typescript-eslint/indent': ['warn', 'tab', { SwitchCase: 1 }],
		'@typescript-eslint/no-unused-vars': ['warn', { vars: 'all', args: 'after-used', ignoreRestSiblings: false }],
		'@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports', fixStyle: 'separate-type-imports' }],
		'@typescript-eslint/consistent-type-exports': 'warn',
		"@typescript-eslint/no-explicit-any": "off",
	}
}
