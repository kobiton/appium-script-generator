import path from 'path'
import * as grpcJs from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import GrpcServer from './utils/grpc-server'
import generateScriptHandler from './handlers/generate-script'
import {GRPC_SERVER_HOST, GRPC_SERVER_PORT, DEBUG_NAMESPACE} from './config'
import {HealthImplementation} from 'grpc-health-check'

const SERVICE_PROTO_FILE = path.resolve(__dirname, 'appium-script-schema/generate-script.proto')
const serviceDefinition = protoLoader.loadSync(SERVICE_PROTO_FILE, {
  // `keepCase = false` means that @grpc/proto-loader will auto convert the property like
  // this_is_property (in .proto files) to thisIsProperty that is more friendly in javascript.
  keepCase: false
})
const serviceProto = grpcJs.loadPackageDefinition(serviceDefinition).kobiton

const servingStatusMap = {
  '': 'SERVING' // The empty string means that the server is serving all services.
}

/**
 * Starts a gRPC server with the specified options.
 *
 * @param {Object} options - The options for the gRPC server.
 * @param {string} options.host - The host to bind the server to.
 * @param {number} options.port - The port to bind the server to.
 * @param {string} options.debugNamespace - The debug namespace for the server.
 * @returns {Promise<void>} A promise that resolves when the server has started.
 */
async function startGrpcServer(options = {}) {
  const {host, port, debugNamespace} = options

  const server = new GrpcServer({host, port, debugNamespace})

  const healthImpl = new HealthImplementation(servingStatusMap)
  healthImpl.addToServer(server)

  server.addService(serviceProto.GenerateScript.service, {generate: generateScriptHandler})
  await server.start()
}

async function main() {
  await startGrpcServer({
    host: GRPC_SERVER_HOST,
    port: GRPC_SERVER_PORT,
    debugNamespace: DEBUG_NAMESPACE
  })
}

main().catch((err) => {
  console.log(DEBUG_NAMESPACE, `Fatal error, exit: ${err.message}`)
})
