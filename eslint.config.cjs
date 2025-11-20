const { defineConfig, globalIgnores } = require("eslint/config");

const globals = require("globals");
const tsParser = require("@typescript-eslint/parser");
const typescriptEslint = require("@typescript-eslint/eslint-plugin");
const js = require("@eslint/js");
const stylistic = require("@stylistic/eslint-plugin");

const { FlatCompat } = require("@eslint/eslintrc");

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

module.exports = defineConfig([{
  languageOptions: {
    globals: {
      ...globals.browser,
      ...globals.node,
      Atomics: "readonly",
      SharedArrayBuffer: "readonly",
      GM: "readonly",
      unsafeWindow: "writable",
    },

    parser: tsParser,
    ecmaVersion: "latest",
    sourceType: "module",

    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
      projectService: true,
    },
  },

  extends: compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended"),

  plugins: {
    "@typescript-eslint": typescriptEslint,
    "@stylistic": stylistic,
  },

  rules: {
    "no-unreachable": "off",
    "@stylistic/quotes": ["error", "double"],
    "@stylistic/semi": ["error", "always"],
    "@stylistic/eol-last": ["error", "always"],
    "no-async-promise-executor": "off",
    "no-cond-assign": "off",
    "@stylistic/indent": ["error", 2, {
      "ignoredNodes": ["VariableDeclaration[declarations.length=0]"],
      "SwitchCase": 1,
    }],
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/no-unused-vars": ["warn", {
      "ignoreRestSiblings": true,
      "argsIgnorePattern": "^_",
    }],
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@stylistic/comma-dangle": ["error", "always-multiline"],
    "no-misleading-character-class": "off",
    "prefer-rest-params": "off",
  },
}, globalIgnores(["**/*.min.*", "**/*.user.js", "**/*.map", "dist/**/*", "**/test.ts"]), {
  files: ["**/**.js", "**/**.mjs", "**/**.cjs"],

  plugins: {
    "@typescript-eslint": typescriptEslint,
    "@stylistic": stylistic,
  },

  rules: {
    "@typescript-eslint/no-require-imports": "off",
    "@stylistic/quotes": ["error", "double"],
    "@stylistic/semi": ["error", "always"],
    "@stylistic/eol-last": ["error", "always"],
    "no-async-promise-executor": "off",
    "@stylistic/indent": ["error", 2, {
      "ignoredNodes": ["VariableDeclaration[declarations.length=0]"],
    }],
    "@stylistic/comma-dangle": ["error", "only-multiline"],
  },
}]);
