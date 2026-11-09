// Jest runs TypeScript directly via ts-jest. The backend is an ESM package
// ("type": "module"), so tests run as ESM too (see the "test" script, which
// passes --experimental-vm-modules). moduleNameMapper strips the ".js"
// extension the source uses for NodeNext resolution, so Jest can find the
// ".ts" file behind it.
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: "<rootDir>/tsconfig.test.json" }],
  },
};
