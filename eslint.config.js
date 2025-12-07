const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
	{
		ignores: ["**/node_modules/**", "**/public/vendor/**"],
	},
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
	},
];
