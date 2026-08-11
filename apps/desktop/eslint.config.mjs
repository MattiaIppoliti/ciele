import config from "@agent-hub/eslint-config";

export default [
  ...config,
  { ignores: ["out/**", "dist/**"] },
  {
    files: ["**/*.tsx"],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
];
