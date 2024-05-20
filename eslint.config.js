// eslint.config.js
const js = require("@eslint/js");

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "commonjs"
        },
        rules: {
            "indent": "off",
            "semi": "off",
            "camelcase": "off",
            "multiline-ternary": "off",
            "no-undef": "off",
            "no-unused-vars": "off",
            "comma-dangle": "error",
            "no-trailing-spaces": "error",
            "quote-props": ["error", "as-needed"]
        },
        ignores: [
            "src/dist/*",
            "node_modules"
        ]
    }
];
