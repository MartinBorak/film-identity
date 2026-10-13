import eslintConfigPrettier from 'eslint-config-prettier'
import perfectionist from 'eslint-plugin-perfectionist'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  // Disable ESLint stylistic rules that would conflict with Prettier; Prettier owns formatting.
  eslintConfigPrettier,
  {
    plugins: { perfectionist },
    rules: {
      // Named functions read as `function foo() {}`, not `const foo = () => {}`.
      'func-style': ['error', 'declaration'],
      // Always require { } around if/else/for/while bodies, even single-statement ones.
      curly: ['error', 'all'],
      // A comment spanning multiple lines must be a /** */ block, not stacked // lines.
      'multiline-comment-style': ['error', 'starred-block'],
      // Packages first, then relative imports, alphabetical within each group.
      'perfectionist/sort-imports': [
        'error',
        {
          groups: [['builtin', 'external'], ['parent', 'sibling', 'index'], 'unknown'],
          newlinesBetween: 1,
        },
      ],
    },
  },
  globalIgnores(['dist/**']),
])

export default eslintConfig
