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
            "no-unused-vars": "off"
        },
        ignores: [
            "src/dist/*",
            "node_modules"
        ]
    }
];
