import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * 微内核分层约束（定向规则，保证依赖方向不被写坏）：
 *  1. shell/** 与 core/** 禁止 import 任何插件模块（@/plugins/*）；
 *  2. plugins/a/** 禁止 import @/plugins/b/**（b !== a），相对路径跳出插件目录同样禁止；
 *  3. plugins/** 禁止直接调用 fetch()，只能走 @/core/api 的信封解包。
 */
const pluginBoundary = {
  meta: {
    type: 'problem',
    docs: { description: 'enforce microkernel layering (shell/core ← plugins)' },
    messages: {
      shellImportPlugin: 'shell/** 与 core/** 禁止 import 插件模块（{{specifier}}）',
      crossPlugin: '插件禁止 import 其他插件模块（{{specifier}}），跨插件引用必须为 0',
      pluginFetch: '插件禁止直接调用 fetch()，请统一走 @/core/api 的信封解包',
    },
    schema: [],
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename?.() ?? '').replace(/\\/g, '/');
    const inShellOrCore =
      filename.includes('/src/shell/') || filename.includes('/src/core/');
    const pluginMatch = filename.match(/\/src\/plugins\/([^/]+)\//);

    return {
      ImportDeclaration(node) {
        const spec = node.source.value;
        if (typeof spec !== 'string') return;

        if (inShellOrCore) {
          if (spec.startsWith('@/plugins/') || spec.includes('/plugins/')) {
            context.report({ node, messageId: 'shellImportPlugin', data: { specifier: spec } });
          }
          return;
        }

        if (pluginMatch) {
          const own = pluginMatch[1];
          let target = null;

          if (spec.startsWith('@/plugins/')) {
            target = spec.slice('@/plugins/'.length).split('/')[0];
          } else if (spec.startsWith('..')) {
            // 相对路径跳出插件目录即视为跨插件引用
            target = '..';
          }

          if (target != null && target !== own) {
            context.report({ node, messageId: 'crossPlugin', data: { specifier: spec } });
          }
        }
      },

      CallExpression(node) {
        if (!pluginMatch) return;
        if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
          context.report({ node, messageId: 'pluginFetch' });
        }
      },
    };
  },
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      local: { rules: { 'plugin-boundary': pluginBoundary } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'local/plugin-boundary': 'error',
    },
  },
);