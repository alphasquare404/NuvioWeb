import js from "@eslint/js";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

const runtimeGlobals = {
  ...globals.browser,
  ...globals.node,
  // Substituted by scripts/build.mjs, so it is absent while linting. config.js
  // reads it behind a typeof guard precisely because it may not exist.
  __NUVIO_BUILD_ENV__: "readonly",
  // Same shape: the service worker source carries this until build.mjs writes
  // the real locale list in its place.
  __NUVIO_LOCALE_ASSETS__: "readonly",
  // assets/libs/qrcode-generator.js defines this, loaded by a script tag in
  // index.html and precached by the service worker.
  qrcode: "readonly"
};

export default [
  {
    ignores: [
      "assets/**",
      "build/**",
      "dist/**",
      "node_modules/**",
      "res/**",
      "services/**/runtime/**"
    ]
  },
  {
    // Everything that is ours. services/** and the root scripts carried no
    // enabled rules at all before this, so the bridges and the service worker
    // were never checked -- which is how a bridge that refused every request
    // stayed that way.
    files: [
      "js/**/*.{js,mjs,cjs}",
      "scripts/**/*.{js,mjs,cjs}",
      "services/**/*.{js,mjs,cjs}",
      "*.{js,mjs,cjs}"
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: runtimeGlobals
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_"
        }
      ]
    }
  },
  eslintConfigPrettier
];
