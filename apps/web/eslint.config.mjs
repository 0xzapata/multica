import nextConfig from "@multica/eslint-config/next";

export default [
  ...nextConfig,
  { ignores: [".next/", ".source/"] },
  {
    files: ["runtime-server.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.{ts,tsx}"],
    rules: {
      "react/display-name": "off",
    },
  },
];
