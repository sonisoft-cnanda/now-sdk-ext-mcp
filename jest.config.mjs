/** @type {import('ts-jest').JestConfigWithTsJest} */
const config = {
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/index.ts",
  ],
  coverageReporters: ["html", "text", "text-summary", "cobertura"],
  detectOpenHandles: true,
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testMatch: ["**/*.test.ts"],
  testTimeout: 30_000,
  transform: {
    "^.+\\.ts?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  verbose: true,
};

export default config;
