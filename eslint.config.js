const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
	{
		ignores: ["**/node_modules/**", "**/public/vendor/**", "**/dist/**"],
	},
	js.configs.recommended,
	{
		files: ["**/*.js"],
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: "module",
			globals: {
				...globals.browser,
				...globals.node,
				$: "readonly",
				_: "readonly",
			},
		},
	},
	{
		files: ["**/*.ts"],
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: "module",
			parser: require("@typescript-eslint/parser"),
			globals: {
				...globals.node,
			},
		},
		plugins: {
			"@typescript-eslint": require("@typescript-eslint/eslint-plugin"),
		},
		rules: {
			...require("@typescript-eslint/eslint-plugin").configs.recommended.rules,
			"@typescript-eslint/no-var-requires": "off", // allow require in legacy parts if any
		},
	},
];
