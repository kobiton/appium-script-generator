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

  /* eslint-disable */
  // Samples request value:
  // {
  //   "sentAt": {
  //     "low": -1998577640,
  //     "high": 394,
  //     "unsigned": true
  //   },
  //   "serverInfo": {
  //     "apiUrl": "http://localhost:3000",
  //     "portalUrl": "http://localhost:8181",
  //     "username": "test",
  //     "apiKey": "your_kobiton_api_key"
  //   },
  //   "isManualSession": true,
  //   "manualSessionId": "447",
  //   "devices": [
  //     {
  //       "id": 421,
  //       "name": "iPhone 11",
  //       "capabilities": {
  //         "platformName": "iOS",
  //         "platformVersion": "16.2",
  //         "resolution": {
  //           "width": 828,
  //           "height": 1792,
  //           "scale": 2
  //         }
  //       }
  //     }
  //   ],
  //   "testSteps": [
  //     {
  //       "id": "15107",
  //       "context": "NATIVE",
  //       "selectorConfigurations": [
  //         {
  //           "selectors": [
  //             {
  //               "type": "id",
  //               "value": "TabBarItemTitle"
  //             },
  //             {
  //               "type": "id",
  //               "value": "Address"
  //             },
  //             {
  //               "type": "className",
  //               "value": "XCUIElementTypeTextField"
  //             },
  //             {
  //               "type": "xpath",
  //               "value": "//XCUIElementTypeTextField[@name='TabBarItemTitle']"
  //             },
  //             {
  //               "type": "xpath",
  //               "value": "//XCUIElementTypeTextField[@label='Address']"
  //             },
  //             {
  //               "type": "name",
  //               "value": "TabBarItemTitle"
  //             }
  //           ]
  //         }
  //       ],
  //       "actionJson": "{\"command\":\"touchOnElement\",\"x\":\"0.469\",\"y\":\"0.457\"}",
  //       "findingElementTimeout": 6968,
  //       "isOnKeyboard": false
  //     },
  //     {
  //       "id": "15108",
  //       "context": "NATIVE",
  //       "actionJson": "{\"command\":\"sendKeys\",\"value\":\"sunnova.com\"}",
  //       "findingElementTimeout": 8124,
  //       "isOnKeyboard": false
  //     },
  //     {
  //       "id": "15109",
  //       "context": "NATIVE",
  //       "actionJson": "{\"command\":\"press\",\"value\":\"ENTER\"}",
  //       "findingElementTimeout": 2562,
  //       "isOnKeyboard": false
  //     },
  //     {
  //       "id": "15110",
  //       "context": "WEB",
  //       "selectorConfigurations": [
  //         {
  //           "selectors": [
  //             {
  //               "type": "css",
  //               "value": "html#sunnova-root"
  //             },
  //             {
  //               "type": "id",
  //               "value": "sunnova-root"
  //             }
  //           ]
  //         }
  //       ],
  //       "actionJson": "{\"command\":\"swipeFromElement\",\"x1\":\"0.467\",\"y1\":\"0.956\",\"x2\":\"0.522\",\"y2\":\"0.235\",\"duration\":889}",
  //       "findingElementTimeout": 10973,
  //       "isOnKeyboard": false
  //     },
  //     {
  //       "id": "15111",
  //       "context": "WEB",
  //       "selectorConfigurations": [
  //         {
  //           "selectors": [
  //             {
  //               "type": "linkText",
  //               "value": "Start Your Quote"
  //             },
  //             {
  //               "type": "css",
  //               "value": "a.w-full.md:w-auto.md:text-lg.font-bold.text-app-deep-purple.border.border-app-deep-purple.py-3.px-6.rounded-4xl.text-center.inline-block.hover:bg-app-light-purple-hover.outline-none.focus:ring-1.ring-offset-2.ring-gray-dark.focus:outline-1.self-start"
  //             },
  //             {
  //               "type": "css",
  //               "value": ".w-full.md:w-auto.md:text-lg.font-bold.text-app-deep-purple.border.border-app-deep-purple.py-3.px-6.rounded-4xl.text-center.inline-block.hover:bg-app-light-purple-hover.outline-none.focus:ring-1.ring-offset-2.ring-gray-dark.focus:outline-1.self-start"
  //             },
  //             {
  //               "type": "xpath",
  //               "value": "//a[text()='Start Your Quote']"
  //             },
  //             {
  //               "type": "xpath",
  //               "value": "//*[text()='Start Your Quote']"
  //             }
  //           ]
  //         }
  //       ],
  //       "actionJson": "{\"command\":\"touchOnElement\",\"x\":\"0.509\",\"y\":\"0.550\"}",
  //       "findingElementTimeout": 5997,
  //       "isOnKeyboard": false
  //     },
  //     {
  //       "id": "15112",
  //       "context": "WEB",
  //       "selectorConfigurations": [
  //         {
  //           "selectors": [
  //             {
  //               "type": "xpath",
  //               "value": "//*[@for='email']"
  //             }
  //           ]
  //         }
  //       ],
  //       "actionJson": "{\"command\":\"touchOnElement\",\"x\":\"0.892\",\"y\":\"0.518\"}",
  //       "findingElementTimeout": 4072,
  //       "isOnKeyboard": false
  //     },
  //     {
  //       "id": "15113",
  //       "context": "NATIVE",
  //       "actionJson": "{\"command\":\"sendKeys\",\"value\":\"phuong@g.c\"}",
  //       "findingElementTimeout": 5576,
  //       "isOnKeyboard": false
  //     },
  //     {
  //       "id": "15114",
  //       "context": "WEB",
  //       "selectorConfigurations": [
  //         {
  //           "selectors": [
  //             {
  //               "type": "xpath",
  //               "value": "/html/body/main/section/div/div/div/div/form/div/div/div[1]/div/ul/li[3]"
  //             }
  //           ]
  //         }
  //       ],
  //       "actionJson": "{\"command\":\"touchOnElement\",\"x\":\"0.496\",\"y\":\"0.550\"}",
  //       "findingElementTimeout": 5929,
  //       "isOnKeyboard": false
  //     }
  //   ],
  //   "appUnderTest": {
  //     "id": "com.apple.mobilesafari"
  //   },
  //   "desiredCapabilitiesOfDevices": [
  //     {
  //       "deviceId": 421,
  //       "desiredCapabilities": [
  //         {
  //           "key": "sessionName",
  //           "value": "Automation on iPhone 11",
  //           "type": "string"
  //         },
  //         {
  //           "key": "sessionDescription",
  //           "value": "",
  //           "type": "string"
  //         },
  //         {
  //           "key": "deviceOrientation",
  //           "value": "portrait",
  //           "type": "string"
  //         },
  //         {
  //           "key": "noReset",
  //           "value": "false",
  //           "type": "bool"
  //         },
  //         {
  //           "key": "fullReset",
  //           "value": "true",
  //           "type": "bool"
  //         },
  //         {
  //           "key": "captureScreenshots",
  //           "value": "true",
  //           "type": "bool"
  //         },
  //         {
  //           "key": "newCommandTimeout",
  //           "value": "900",
  //           "type": "int"
  //         },
  //         {
  //           "key": "keepScreenOn",
  //           "value": "true",
  //           "type": "bool"
  //         },
  //         {
  //           "key": "ensureWebviewsHavePages",
  //           "value": "true",
  //           "type": "bool"
  //         },
  //         {
  //           "key": "kobiton:visualValidation",
  //           "value": "false",
  //           "type": "bool"
  //         },
  //         {
  //           "key": "kobiton:textValidation",
  //           "value": "false",
  //           "type": "bool"
  //         },
  //         {
  //           "key": "kobiton:flexCorrect",
  //           "value": "false",
  //           "type": "bool"
  //         },
  //         {
  //           "key": "kobiton:includeSystemWindows",
  //           "value": "true",
  //           "type": "bool"
  //         },
  //         {
  //           "key": "browserName",
  //           "value": "safari",
  //           "type": "string"
  //         },
  //         {
  //           "key": "deviceGroup",
  //           "value": "ORGANIZATION",
  //           "type": "string"
  //         },
  //         {
  //           "key": "deviceName",
  //           "value": "iPhone 11",
  //           "type": "string"
  //         },
  //         {
  //           "key": "platformVersion",
  //           "value": "16.2",
  //           "type": "string"
  //         },
  //         {
  //           "key": "platformName",
  //           "value": "iOS",
  //           "type": "string"
  //         },
  //         {
  //           "key": "kobiton:baselineSessionId",
  //           "value": "447",
  //           "type": "int"
  //         }
  //       ]
  //     }
  //   ],
  //   "requestScript": {
  //     "name": "kobiton-appium-script-s447-p348-manual-java-junit-v5",
  //     "language": "java",
  //     "testingFramework": "junit"
  //   }
  // }
  /* eslint-enable */
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
