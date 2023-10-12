// The debug namespace for the appium-script-generator process. Defaults to a unique
// namespace based on the process ID.
export const DEBUG_NAMESPACE =
  process.env.KOBITON_ROOT_DEBUG_NAMESPACE || `appium-script-generator-p${process.pid}`

// The host for the gRPC server. Defaults to '0.0.0.0' if not specified.
export const GRPC_SERVER_HOST =
  process.env.KOBITON_APPIUM_SCRIPT_GENERATOR_GRPC_SERVER_HOST || '0.0.0.0'

// The port for the gRPC server. Defaults to 7009 if not specified.
export const GRPC_SERVER_PORT =
  Number(process.env.KOBITON_APPIUM_SCRIPT_GENERATOR_GRPC_SERVER_PORT) || 7009
