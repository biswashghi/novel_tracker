import globals from "globals";

const ignored = [
  "build/**",
  "dist/**",
  "dist-firefox/**",
  "dist-safari/**",
  "node_modules/**",
  "playwright-report/**",
  "release/**",
  "store-assets/**",
  "test-results/**"
];

const correctnessRules = {
  "no-constant-binary-expression": "error",
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-debugger": "error",
  "no-dupe-keys": "error",
  "no-fallthrough": "error",
  "no-import-assign": "error",
  "no-self-assign": "error",
  "no-unreachable": "error",
  "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  "no-undef": "error"
};

export default [
  { ignores: ignored },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        NovelTrackerParserCore: "readonly"
      }
    },
    rules: correctnessRules
  },
  {
    files: ["*.js", "server/**/*.js", "scripts/**/*.mjs", "tests/**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser, ...globals.webextensions }
    },
    rules: correctnessRules
  }
];
