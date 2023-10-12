module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/__tests__/**/*.test.js'
  ],
  collectCoverageFrom: [
    '<rootDir>/src/**/*.js',
    '!<rootDir>/src/appium-script-schema/**',
    '!<rootDir>/src/.cached/**'
  ],
  coverageReporters: ['text-summary', 'json-summary', 'lcov']
}
