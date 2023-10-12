import * as grpc from '@grpc/grpc-js'

/**
 * Represents a gRPC server.
 */
class GrpcServer {
  /**
   * Creates a new instance of the GrpcServer class.
   * @param {Object} [opts] - The options object.
   * @param {string} [opts.host='0.0.0.0'] - The host to bind the server to.
   * @param {number} opts.port - The port to bind the server to.
   * @param {string} [opts.debugNamespace='grpc-server'] - The debug namespace to use.
   */
  constructor(opts = {}) {
    const {
      host = '0.0.0.0',
      port,
      debugNamespace = 'grpc-server'
    } = opts

    this._host = host
    this._port = port
    this._debugNamespace = debugNamespace

    this._server = new grpc.Server()
  }

  /**
   * Starts the gRPC server.
   * @returns {Promise<void>} A promise that resolves when the server has started.
   */
  start() {
    const address = `${this._host}:${this._port}`
    console.log(this._debugNamespace, `Starting gRPC server at: ${address}`)

    return new Promise((resolve, reject) => {
      this._server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (err) => {
        if (err) {
          return reject(err)
        }

        this._server.start()
        console.log(this._debugNamespace, 'Start gRPC server success')

        resolve()
      })
    })
  }

  /**
   * Adds a service to the gRPC server.
   * @param {Object} nativeProtoService - The native protobuf service object.
   * @param {Object} serviceImplementation - The service implementation object.
   */
  addService(nativeProtoService, serviceImplementation) {
    this._server.addService(nativeProtoService, serviceImplementation)
  }
}

export default GrpcServer
