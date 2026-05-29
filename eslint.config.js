// eslint.config.js
const js = require("@eslint/js");
const { defineConfig, globalIgnores } = require("eslint/config");

module.exports = defineConfig([
    globalIgnores(["src/dist/*"]),
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "commonjs"
        },
        rules: {
            indent: "off",
            semi: "off",
            camelcase: "off",
            "multiline-ternary": "off",
            "no-undef": "off",
            "no-unused-vars": "off",
            "no-useless-assignment": "off",
            "preserve-caught-error": "off",
            "comma-dangle": "error",
            "no-trailing-spaces": "error",
            "quote-props": ["error", "as-needed"]
        }
    }
]);
