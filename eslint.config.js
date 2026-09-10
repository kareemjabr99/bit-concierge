import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.react-router/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // Packages run under plain `node file.ts` (strip-only). Syntax that needs
      // a transform, not a strip, is rejected here rather than at runtime.
      '@typescript-eslint/parameter-properties': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Node cannot strip enums; use a const object or a union type.',
        },
      ],
    },
  },
  {
    // The raw Drizzle handle bypasses row-level security. Only packages/db may hold it.
    files: ['apps/**/*.ts', 'packages/!(db)/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@bitc/db/unsafe',
              message:
                'Unscoped database access. Use withTenant() from @bitc/db — see docs/adr/0003-multi-tenancy.md',
            },
          ],
        },
      ],
    },
  },
);
