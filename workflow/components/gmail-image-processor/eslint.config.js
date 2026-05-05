import js from "@eslint/js";

export default [
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "module",
			globals: {
				console: "readonly",
				Buffer: "readonly",
				setTimeout: "readonly",
				Promise: "readonly",
				Date: "readonly",
				Math: "readonly",
				parseInt: "readonly",
				parseFloat: "readonly",
				RegExp: "readonly",
				Error: "readonly",
			},
		},
		rules: {
			// Disable some rules that are too strict for this project
			"no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
				},
			],
			"no-console": "off", // Allow console.log for Pipedream logging
			quotes: ["error", "double"],
			semi: ["error", "always"],
		},
	},
	{
		files: ["**/*.mjs"],
		languageOptions: {
			sourceType: "module",
		},
	},
];
