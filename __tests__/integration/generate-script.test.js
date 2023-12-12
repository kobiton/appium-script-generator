import BPromise from 'bluebird'
import path from 'path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import {readFile} from '../../src/utils/fs-wrapper'
import GrpcServer from '../../src/utils/grpc-server'
import generateScriptHandler from '../../src/handlers/generate-script'

const GENERATE_SCRIPT_TIMEOUT = 60000
const SERVICE_PROTO_FILE = path.resolve(
  __dirname, '../../src/appium-script-schema/generate-script.proto')
const JAVA_JUNIT_INPUT_FILE = path.resolve(
  __dirname, '../resource/java-junit-input.json')
const CSHARP_NUNIT_INPUT_FILE = path.resolve(
  __dirname, '../resource/csharp-nunit-input.json')
const NODEJS_MOCHA_INPUT_FILE = path.resolve(
  __dirname, '../resource/nodejs-mocha-input.json')

/**
 * Integration tests for the generate script gRPC service.
 */
describe('../../src/appium-script-schema/generate-script.proto', () => {
  let client, server
  const serverHost = 'localhost'
  const serverPort = 7009

  let generateScriptRpcAsync

  /**
   * Sets up the gRPC server and client before all test cases.
   */
  beforeAll(async () => {
    const serviceDefinition = protoLoader.loadSync(SERVICE_PROTO_FILE, {keepCase: false})
    const serviceProto = grpc.loadPackageDefinition(serviceDefinition).kobiton

    server = new GrpcServer({host: serverHost, port: serverPort})
    server.addService(serviceProto.GenerateScript.service, {generate: generateScriptHandler})
    await server.start()

    client = new serviceProto.GenerateScript(
      `${serverHost}:${serverPort}`,
      grpc.credentials.createInsecure()
    )

    generateScriptRpcAsync = BPromise.promisify(client.generate, {context: client})
  })

  /**
   * This test case checks that the generate method returns an error message
   * when given invalid input.
   */
  it('should generate script unsuccessfully', async () => {
    const requestJson = {sentAt: Date.now()}
    const response = await generateScriptRpcAsync(
      {...requestJson, sentAt: Date.now()},
      {deadline: Date.now() + GENERATE_SCRIPT_TIMEOUT}
    )

    expect(response).toHaveProperty('errorMessage')
    expect(response.errorMessage).toMatch(/Cannot destructure property\.*/)
    expect(response).not.toHaveProperty('scriptInZipFormat')
  })

  /**
   * This test case checks that the generate method returns a Java & JUnit script
   * when given valid input.
   */
  it('should generate a Java & JUnit script successfully', async () => {
    const requestData = await readFile(JAVA_JUNIT_INPUT_FILE, 'utf-8')
    expect(requestData).not.toBeNull()

    const requestJson = JSON.parse(requestData)
    const response = await generateScriptRpcAsync(
      {...requestJson, sentAt: Date.now()},
      {deadline: Date.now() + GENERATE_SCRIPT_TIMEOUT}
    )

    expect(response).not.toHaveProperty('errorMessage')
    expect(response).toHaveProperty('scriptInZipFormat')
    expect(response.scriptInZipFormat).toEqual(expect.any(Buffer))
  })

  /**
   * This test case checks that the generate method returns a Node.js & Mocha script
   * when given valid input.
   */
  it('should generate a Node.js & Mocha script successfully', async () => {
    const requestData = await readFile(NODEJS_MOCHA_INPUT_FILE, 'utf-8')
    expect(requestData).not.toBeNull()

    const requestJson = JSON.parse(requestData)
    const response = await generateScriptRpcAsync(
      {...requestJson, sentAt: Date.now()},
      {deadline: Date.now() + GENERATE_SCRIPT_TIMEOUT}
    )

    expect(response).not.toHaveProperty('errorMessage')
    expect(response).toHaveProperty('scriptInZipFormat')
    expect(response.scriptInZipFormat).toEqual(expect.any(Buffer))
  })

  /**
   * This test case checks that the generate method returns a C# & NUnit script
   * when given valid input.
   */
  it('should generate a c# & NUnit script successfully', async () => {
    const requestData = await readFile(CSHARP_NUNIT_INPUT_FILE, 'utf-8')
    expect(requestData).not.toBeNull()

    const requestJson = JSON.parse(requestData)
    const response = await generateScriptRpcAsync(
      {...requestJson, sentAt: Date.now()},
      {deadline: Date.now() + GENERATE_SCRIPT_TIMEOUT}
    )

    expect(response).not.toHaveProperty('errorMessage')
    expect(response).toHaveProperty('scriptInZipFormat')
    expect(response.scriptInZipFormat).toEqual(expect.any(Buffer))
  })
})
