import {AppiumScriptGenerator} from '../../src/services'
import generateHandler from '../../src/handlers/generate-script'

// This code block mocks the 'fs-wrapper' module for testing purposes
// using Jest's 'jest.mock' method.
// The 'readFile' function is mocked to return a Buffer containing a mock file buffer.
// The 'removeDir' function is mocked to be a Jest mock function.
jest.mock('../../src/utils/fs-wrapper', () => ({
  ...jest.requireActual('../../src/utils/fs-wrapper'),
  readFile: jest.fn().mockReturnValue(Buffer.from('mock-file-buffer')),
  removeDir: jest.fn()
}))

/**
 * Unit tests for the generateHandler function.
 */
describe('../../src/handlers/generate-script', () => {
  let mockedRun

  /**
   * Sets up a Jest spy on the 'run' method of the AppiumScriptGenerator prototype
   * before each test case.
   */
  beforeEach(() => {
    mockedRun = jest.spyOn(AppiumScriptGenerator.prototype, 'run')
  })

  /**
   * Restores the original behavior of the 'run' method of the AppiumScriptGenerator prototype
   * after each test case.
   */
  afterEach(() => {
    mockedRun.mockRestore()
  })

  /**
   * Tests that the generateHandler function generates a script and returns
   * it in zip format when passed a valid request object.
   */
  it('should generate a script and return it in zip format', async () => {
    const outputFile = 'mock-output-file'
    mockedRun.mockImplementation(() => {
      return {outputFile}
    })

    const request = {
      sentAt: Date.now(),
      manualSessionId: 'test-session-id'
    }

    const callback = jest.fn()
    const consoleLogSpy = jest.spyOn(console, 'log')

    await generateHandler({request}, callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({
      sentAt: expect.any(Number),
      scriptInZipFormat: Buffer.from('mock-file-buffer'),
      errorMessage: undefined
    }))

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.any(String), 'Generated script successfully. Respond to client')

    consoleLogSpy.mockRestore()
  })

  /**
   * Tests that the generateHandler function returns an error message if script
   * generation fails because the test language is not yet supported.
   */
  // eslint-disable-next-line max-len
  it("should return an error message if script generation fails because don't support yet", async () => {
    const errorMessage = "Don't support test-language yet"
    mockedRun.mockImplementation(() => {
      throw new Error(errorMessage)
    })

    const callback = jest.fn()
    await generateHandler({request: {}}, callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({
      sentAt: expect.any(Number),
      errorMessage,
      scriptInZipFormat: undefined
    }))
  })

  /**
   * Tests that the generateHandler function returns an error message if script generation
   * fails because of an invalid request object.
   */
  // eslint-disable-next-line max-len
  it('should return an error message if script generation fails because invalid request value', async () => {
    const callback = jest.fn()
    const consoleLogSpy = jest.spyOn(console, 'log')
    const consoleErrorSpy = jest.spyOn(console, 'error')

    // Force script generation to fail by passing an invalid request object
    const request = {}
    await generateHandler({request}, callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({
      sentAt: expect.any(Number),
      errorMessage: expect.any(String),
      scriptInZipFormat: undefined
    }))

    expect(consoleLogSpy).toHaveBeenCalledTimes(2)
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.any(String), `Recieve request: ${JSON.stringify(request)}`)
    expect(consoleLogSpy).toHaveBeenCalledWith(
      // eslint-disable-next-line max-len
      expect.any(String), expect.stringMatching('Generated script \\(errorMessage:\\s.*\\). Respond to client'))

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)

    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  /**
   * Tests that the generateHandler function logs the expected messages to the console.
   */
  it('should log the request and response', async () => {
    const outputFile = 'mock-output-file'
    mockedRun.mockImplementation(() => {
      return {outputFile}
    })

    const request = {
      sentAt: Date.now(),
      manualSessionId: 'test-session-id'
    }

    const callback = jest.fn()
    const consoleLogSpy = jest.spyOn(console, 'log')

    await generateHandler({request}, callback)

    expect(consoleLogSpy).toHaveBeenCalledTimes(3)
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.any(String), `Recieve request: ${JSON.stringify(request)}`)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.any(String), `outputFile: ${outputFile}`)
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.any(String), 'Generated script successfully. Respond to client')

    consoleLogSpy.mockRestore()
  })
})
