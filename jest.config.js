module.exports = {
  testTimeout: 120000,
  testEnvironment: 'node',
  setupFiles: [
    '<rootDir>/__tests__/setup.js'
  ],
  testMatch: [
    '<rootDir>/__tests__/**/*.test.js'
  ],
  collectCoverageFrom: [
    '<rootDir>/src/**/*.js',
    '!<rootDir>/src/appium-script-schema/**',
    '!<rootDir>/src/templates/**',
    '!<rootDir>/src/.cached/**'
  ],
  coverageReporters: ['text-summary', 'json-summary', 'lcov']
}
