import moment from 'moment'
import path from 'path'
import {AppiumScriptGenerator} from '../services'
import {readFile, removeDir} from '../utils/fs-wrapper'
import {DEBUG_NAMESPACE} from '../config'

const debugNamespace = DEBUG_NAMESPACE

/**
 * Handles a gRPC request to generate an Appium script.
 *
 * @param {Object} call - The gRPC call object.
 * @param {Object} call.request - The request object containing the parameters for generating
 * the script.
 * @param {number} call.request.sentAt - The timestamp when the request was sent.
 * @param {string} call.request.manualSessionId - The ID of the manual session.
 * @param {Function} callback - The callback function to invoke when the script has been generated.
 * @returns {void}
 */
const generateHandler = async ({request}, callback) => {
  const {sentAt, manualSessionId} = request

  let ns = `${debugNamespace}-req${sentAt}`
  console.log(ns, `Recieve request: ${JSON.stringify(request)}`)

  let errorMessage
  let scriptInZipFormat

  try {
    const workingDir = path.join('.cached', `${manualSessionId}-${sentAt}`)

    const generator = new AppiumScriptGenerator({debugNamespace: ns})
    const {outputFile, errorMessage: message} = await generator.run({...request, workingDir})

    if (outputFile) {
      console.log(ns, `outputFile: ${outputFile}`)
      scriptInZipFormat = await readFile(outputFile)
    }

    if (message) {
      errorMessage = message
    }

    // Clean up cached files
    await removeDir(workingDir)
  }
  catch (error) {
    console.error(ns, error)
    errorMessage = error && error.message
  }
  finally {
    const timestamp = moment().valueOf()
    ns = `${debugNamespace}-req${sentAt}-res${timestamp}`
    if (errorMessage) {
      console.log(ns,
        `Generated script (errorMessage: ${errorMessage}). Respond to client`)
    }
    else {
      console.log(ns, 'Generated script successfully. Respond to client')
    }

    callback(null, {sentAt: timestamp, errorMessage, scriptInZipFormat})
  }
}

export default generateHandler
