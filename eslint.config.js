const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 12,
			sourceType: "script",
			globals: {
				...globals.browser,
				...globals.node,
				$: "readonly",
				_: "readonly",
			},
		},
		ignores: ["node_modules/"],
	},
];
