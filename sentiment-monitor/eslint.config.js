module.exports = [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        Promise: "readonly",
        URL: "readonly"
      }
    },
    rules: {
      "semi": ["error", "always"],
      "comma-dangle": ["error", "always-multiline"],
      "curly": ["error", "all"],
      "prefer-template": "error",
      "prefer-destructuring": ["error", {
        "array": true,
        "object": false
      }, {
        "enforceForRenamedProperties": false
      }],
      "no-param-reassign": ["error", { "props": false }],
      "dot-notation": "error",
      "object-shorthand": "error",
      "no-nested-ternary": "error",
      "max-depth": ["error", 4],
      "operator-linebreak": ["error", "after"],
      "keyword-spacing": "error",
      "space-before-blocks": "error"
    }
  }
];
