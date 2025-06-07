import naverpay from '@naverpay/eslint-config'

export default [
    {
        ignores: ['**/dist/**', './data/**', './node_modules/**'],
    },
    ...naverpay.configs.node,
    ...naverpay.configs.typescript,
    ...naverpay.configs.packageJson,
    {
        rules: {
            'no-console': 'off', // Allow console statements
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
]
