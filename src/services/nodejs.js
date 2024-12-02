import BPromise from 'bluebird'
import path from 'path'
import get from 'lodash/get'
import {DEVICE_SOURCES, CONTEXTS, LANGUAGES} from './constant'
import {buildCode, Line} from '../models/line'
import compress from '../utils/compress'
import {readFile, writeFile, createDir} from '../utils/fs-wrapper'
import {BaseAppiumScriptGenerator} from './base'
import {URL} from 'url'

const LOCATOR_VAR_NAME_PREFIX = 'locator'
const ncpAsync = BPromise.promisify(require('ncp').ncp)

/**
 * Generates Node.js code for Appium scripts.
 */
export default class NodejsAppiumScriptGenerator extends BaseAppiumScriptGenerator {
  /**
   * Constructs a new NodejsAppiumScriptGenerator instance.
   * @param {Object} options - The options object.
   * @param {string} options.debugNamespace - The debug namespace to use.
   */
  constructor({debugNamespace = 'script-generator'}) {
    super()
    this._ns = debugNamespace
  }

  /**
   * Trigger the Node.js script generator with the specified options.
   * @param {Object} options - The options object.
   * @param {Object} options.serverInfo - The server information object.
   * @param {boolean} options.isManualSession - Whether the session is manual or not.
   * @param {string} options.manualSessionId - The ID of the manual session.
   * @param {Array} options.devices - The array of devices.
   * @param {Array} options.testSteps - The array of test steps.
   * @param {Object} options.appUnderTest - The application under test object.
   * @param {Array} options.desiredCapabilitiesOfDevices - The array desired capabilities
   * of the devices.
   * @param {Object} options.requestScript - The request script object.
   * @param {string} options.workingDir - The working directory to use.
   * @returns {Object} An object containing the output file path.
   */
  async run({
    serverInfo,
    isManualSession,
    manualSessionId,
    devices,
    testSteps,
    appUnderTest,
    desiredCapabilitiesOfDevices,
    requestScript,

    workingDir = '.cached'
  }) {
    const {testingFramework} = requestScript

    const {lines: testScriptLines, resourceFiles} = this._generateTestScriptLines({testSteps})
    const deviceSource = get(devices, '[0].deviceSource', DEVICE_SOURCES.KOBITON)

    const desiredCapsMethodLines = this._generateDesiredCapabilitiesMethodLines({
      desiredCapabilitiesOfDevices, devices, deviceSource, appUnderTest
    })

    const testCaseLines = this._generateTestCaseLines({
      devices
    })

    const outputFile = await this._packageProject({
      serverInfo,
      deviceSource,
      appUnderTest,
      isManualSession,
      manualSessionId,
      testingFramework,
      requestScript,

      desiredCapsMethodLines,
      testCaseLines,
      testScriptLines,
      resourceFiles,

      workingDir
    })

    return {outputFile}
  }

  /**
   * Generates the desired capabilities method lines for the specified devices.
   * @param {Array} options.desiredCapabilitiesOfDevices - The array desired capabilities of
   * the devices.
   * @param {Array} options.devices - The array of devices.
   * @param {string} options.deviceSource - The device source.
   * @param {Object} options.appUnderTest - The application under test object.
   * @returns {Array} An array of Line objects representing the desired capabilities method lines.
   * @throws {Error} If the desired capabilities for a device cannot be found.
   */
  _generateDesiredCapabilitiesMethodLines({
    desiredCapabilitiesOfDevices, devices, deviceSource, appUnderTest
  }) {
    const lines = []
    const desiredCapsMethodNames = new Set()

    for (const device of devices) {
      const {id, name: deviceName} = device
      const desiredCapsMethodName = this._getVarName({
        name: [
          deviceName,
          get(device, 'capabilities.platformName'),
          get(device, 'capabilities.platformVersion')
        ].join('_'),
        fallbackName: device.id.toString(),
        prefix: 'get',
        suffix: 'DesiredCapabilities',
        varNames: desiredCapsMethodNames
      })

      const desiredCapsOfThisDevice = desiredCapabilitiesOfDevices.find(
        (desiredCap) => desiredCap.deviceId === id)
      if (!desiredCapsOfThisDevice) {
        throw new Error(
          `Cannot find the desired capabilities for device: ${JSON.stringify(device)}`)
      }

      const {desiredCapabilities = {}} = desiredCapsOfThisDevice

      if (DEVICE_SOURCES.KOBITON === deviceSource || appUnderTest.browserName) {
        lines.push(new Line(`${desiredCapsMethodName}() {`))
      }
      else {
        lines.push(new Line(`${desiredCapsMethodName}(appURL) {`))
      }

      lines.push(new Line('return {', 1))
      desiredCapabilities.forEach(({key, value, type}, index) => {
        const finalKey = key.includes(':') ? `'${key}'` : key
        const parsedValue = this._parseValue(value, type)
        const suffix = index === desiredCapabilities.length - 1 ? '' : ','
        let statement
        if (typeof parsedValue === 'string') {
          statement = `${finalKey}: '${parsedValue}'${suffix}`
        }
        else {
          statement = `${finalKey}: ${parsedValue}${suffix}`
        }

        lines.push(new Line(statement, index === 0 ? 1 : 0))
      })

      lines.push(new Line('}', -1))
      lines.push(new Line('}', -1))
    }

    return lines
  }

  /**
   * Generates the test case lines for the specified devices.
   * @param {Array} options.devices - The array of devices.
   * @returns {Array} An array of Line objects representing the test case lines.
   */
  _generateTestCaseLines({devices}) {
    const lines = []
    const desiredCapsMethodNames = new Set()

    for (const device of devices) {
      const {
        name: deviceName,
        capabilities: deviceCaps
      } = device
      const desiredCapsMethodName = this._getVarName({
        name: [
          deviceName,
          get(device, 'capabilities.platformName'),
          get(device, 'capabilities.platformVersion')
        ].join('_'),
        fallbackName: device.id.toString(),
        prefix: 'get',
        suffix: 'DesiredCapabilities',
        varNames: desiredCapsMethodNames
      })

      const retinaScale = get(deviceCaps, 'resolution.scale') || 1
      // eslint-disable-next-line max-len
      const testCaseDescription = `Run test on ${deviceName} - ${get(device, 'capabilities.platformName')} ${get(device, 'capabilities.platformVersion')}`

      lines.push(...[
        new Line(`it('${testCaseDescription}', async () => {`),
        new Line('let automationHelper', 1),
        new Line('let error = null'),
        new Line(''),
        new Line('try {'),
        new Line('automationHelper = new TestApp()', 1),
        new Line(''),
        new Line(`const capabilities = Config.${desiredCapsMethodName}()`),
        new Line('await automationHelper.findOnlineDevice(capabilities)'),
        new Line(`await automationHelper.setup(capabilities, ${retinaScale})`),
        new Line('await automationHelper.run()'),
        new Line('}', -1),
        new Line('catch (err) {'),
        new Line('console.error(err)', 1),
        new Line('error = err'),
        new Line('automationHelper && await automationHelper.saveDebugResource()'),
        new Line('}', -1),
        new Line('finally {'),
        new Line('if (automationHelper) {', 1),
        new Line('await automationHelper.cleanup()', 1),
        new Line('}', -1),
        new Line(''),
        // eslint-disable-next-line no-template-curly-in-string
        new Line('assert(error === null, `Test case has error: ${error && error.message}`)'),
        new Line('}', -1),
        new Line('})', -1)
      ])
    }

    return lines
  }

  /**
   * Generates an array of lines of test script code based on the provided test steps.
   * @param {Array} testSteps - An array of test steps.
   * @returns {Object} An object containing the generated lines of code and any resource files.
   */
  _generateTestScriptLines({testSteps}) {
    const lines = []
    const resourceFiles = {}
    const locatorVarNames = new Set()

    for (const step of testSteps) {
      const {
        id, context, actionJson, selectorConfigurations, isOnKeyboard, findingElementTimeout
      } = step
      if (!actionJson) continue

      let action
      try {
        action = JSON.parse(actionJson)
      }
      catch (error) {
        console.error(`Cannot parse actionJson: ${actionJson}`)
        throw error
      }

      const actionCommand = get(action, 'command')
      const hasSelector = selectorConfigurations && selectorConfigurations.length

      lines.push(new Line(''))
      lines.push(new Line(`this.setCurrentCommandId(${step.id})`))

      let locatorVarName, rawLocatorVarName
      if (hasSelector) {
        locatorVarName = this._getLocatorVarName(step, locatorVarNames)
        rawLocatorVarName = locatorVarName.replace(LOCATOR_VAR_NAME_PREFIX, '')
        const locatorCode = this._getLocatorCode({step, locatorVarName})
        lines.push(...locatorCode)
      }

      switch (actionCommand) {
        case 'activateApp': {
          const {appPackage} = action
          lines.push(new Line(`await this.activateApp('${appPackage}')`))
        } break

        case 'touchOnElement': {
          const {x, y} = action
          if (context === CONTEXTS.NATIVE) {
            const elementVarName = `element${rawLocatorVarName}`
            // eslint-disable-next-line max-len
            lines.push(new Line(`const ${elementVarName} = await this.findElement(${findingElementTimeout}, ${locatorVarName})`))
            // eslint-disable-next-line max-len
            lines.push(new Line(`await this.touchOnElementByType(${elementVarName}, ${x}, ${y})`))
          }
          else {
            const nativeRectVarName = `nativeRect${rawLocatorVarName}`
            // eslint-disable-next-line max-len
            lines.push(new Line(`const ${nativeRectVarName} = await this.findWebElementRect(${isOnKeyboard}, ${locatorVarName})`))
            lines.push(
              // eslint-disable-next-line max-len
              new Line(`await this.touchAtPoint(await this.getAbsolutePointOfRect(${x}, ${y}, ${nativeRectVarName}))`))
          }
        } break

        case 'touchOnScrollableElement': {
          const {elementInfo} = action
          const {touchedElementRelativeX, touchedElementRelativeY} = elementInfo
          resourceFiles[`${id}.json`] = JSON.stringify(elementInfo)
          // TODO: due to rush time, we use touchOnElementByType instead
          // of touchOnScrollableElement temporary
          const elementVarName = `element${rawLocatorVarName}`
          // eslint-disable-next-line max-len
          lines.push(new Line(`const ${elementVarName} = await this.findElement(${findingElementTimeout}, ${locatorVarName})`))
          // eslint-disable-next-line max-len
          lines.push(new Line(`await this.touchOnElementByType(${elementVarName}, ${touchedElementRelativeX}, ${touchedElementRelativeY})`))
        } break

        case 'touchAtPoint': {
          const {x, y} = action
          lines.push(new Line(`await this.touchAtRelativePoint(${x}, ${y})`))
        } break

        case 'swipeFromElement': {
          const {x1, y1, x2, y2, duration} = action
          if (context === CONTEXTS.NATIVE) {
            /* eslint-disable */
            !isOnKeyboard && lines.push(new Line('await this.hideKeyboard()'))

            const elementVarName = `element${rawLocatorVarName}`
            lines.push(new Line(`const ${elementVarName} = await this.findElement(${findingElementTimeout}, ${locatorVarName})`))

            const rectVarName = `rect${rawLocatorVarName}`
            lines.push(new Line(`const ${rectVarName} = await this.getRect(${elementVarName})`))

            const fromPointVarName = `fromPointOn${rawLocatorVarName}`
            lines.push(new Line(`const ${fromPointVarName} = await this.getAbsolutePointOfRect(${x1}, ${y1}, ${rectVarName})`))

            const toPointVarName = `toPointOn${rawLocatorVarName}`
            lines.push(new Line(`const ${toPointVarName} = await this.getAbsolutePointOfRect(${x2}, ${y2}, ${rectVarName})`))

            lines.push(new Line(`await this.swipeByPoint(${fromPointVarName}, ${toPointVarName}, ${duration})`))
            /* eslint-enable */
          }
          else {
            /* eslint-disable */
            const nativeRectVarName = `nativeRect${rawLocatorVarName}`
            lines.push(new Line(`const ${nativeRectVarName} = await this.findWebElementRect(${isOnKeyboard}, ${locatorVarName})`))

            const fromPointVarName = `fromPointOn${rawLocatorVarName}`
            lines.push(new Line(`const ${fromPointVarName} = await this.getAbsolutePointOfRect(${x1}, ${y1}, ${nativeRectVarName})`))

            const toPointVarName = `toPointOn${rawLocatorVarName}`
            lines.push(new Line(`const ${toPointVarName} = await this.getAbsolutePointOfRect(${x2}, ${y2}, ${nativeRectVarName})`))

            lines.push(new Line(`await this.swipeByPoint(${fromPointVarName}, ${toPointVarName}, ${duration})`))
            /* eslint-enable */
          }
        } break

        case 'swipeByPoints': {
          const {x1, y1, x2, y2, duration} = action
          // eslint-disable-next-line max-len
          lines.push(new Line(`await this.swipeByPoint(new Point(${x1}, ${y1}), new Point(${x2}, ${y2}), ${duration})`))
        } break

        case 'press': {
          const {value, count = 1} = action
          if (count === 1) {
            lines.push(new Line(`await this.press(PRESS_TYPES.${value})`))
          }
          else {
            lines.push(new Line(`await this.pressMultiple(PRESS_TYPES.${value}, ${count})`))
          }
        } break

        case 'sendKeys': {
          const {value} = action
          lines.push(new Line(`await this.sendKeys(${this._getString(value)})`))
        } break

        case 'sendKeysWithDDT': {
          const {configurations} = action
          const keysVarName = `keys${rawLocatorVarName}`

          if (configurations.length > 1) {
            lines.push(new Line(`const ${keysVarName} = null`))
            configurations.forEach((configuration, index) => {
              const {value, device} = configuration
              const {deviceName, platformVersion} = device || {}
              let ifStatement
              if (!device || index === configurations.length - 1) {
                ifStatement = 'else {'
              }
              else if (index === 0) {
                // eslint-disable-next-line max-len
                ifStatement = `if ('${deviceName}' === deviceName && '${platformVersion}' === platformVersion) {`
              }
              else {
                // eslint-disable-next-line max-len
                ifStatement = `else if ('${deviceName}' === deviceName && '${platformVersion}' === platformVersion) {`
              }

              lines.push(new Line(ifStatement))
              lines.push(new Line(`${keysVarName} = ${this._getString(value)}`, 1))
              lines.push(new Line('}', -1))
            })
          }
          else if (configurations.length === 1) {
            const {value} = configurations[0]
            lines.push(new Line(`const ${keysVarName} = ${this._getString(value)}`))
          }

          lines.push(new Line(`await this.sendKeys(${keysVarName})`))
        } break

        case 'rotate': {
          const {orientation} = action
          lines.push(new Line(`await this.driver.rotate(ScreenOrientation.${orientation})`))
        } break

        case 'setLocation': {
          const {lat, long} = action
          // eslint-disable-next-line max-len
          lines.push(new Line(`await this._driver.setGeoLocation({latitude: ${lat}, longitude: ${long}, altitude: 0})`))
        } break

        case 'generateRandomPhoneNumber': {
          const {length} = action
          lines.push(new Line('await this.clearTextField(12)'))
          lines.push(
            new Line(`await this.sendKeys(this.otpService.getRandomPhoneNumber(${length}))`))
        } break

        case 'findOtpPhoneNumber': {
          const {countryCode} = action
          lines.push(new Line(`await this.otpService.findOtpPhoneNumber('${countryCode}')`))
          lines.push(new Line('await this.clearTextField(12)'))
          lines.push(new Line('await this.sendKeys(this.otpService.phoneNumber)'))
        } break

        case 'findOtpEmailAddress': {
          lines.push(new Line('await this.otpService.findOtpEmailAddress()'))
          lines.push(new Line('await this.clearTextField(24)'))
          lines.push(new Line('await this.sendKeys(this.otpService.emailAddress)'))
          break
        }

        case 'findOtpCode': {
          lines.push(new Line('await this.otpService.findOtpCode()'))
          lines.push(new Line('await this.clearTextField(8)'))
          lines.push(new Line('await this.sendKeys(this.otpService.otpCode)'))
          break
        }

        default:
          throw new Error(`Not support command = ${actionCommand}`)
      }
    }

    return {lines, resourceFiles}
  }

  /**
   * Packages the project into a ZIP file for upload to Kobiton.
   * @param {Object} options - The options object.
   * @param {Object} options.serverInfo - The server information object.
   * @param {boolean} options.isManualSession - Whether the session is manual.
   * @param {string} options.manualSessionId - The ID of the manual session.
   * @param {string} options.testingFramework - The name of the testing framework.
   * @param {Object} options.requestScript - The request script object.
   * @param {Array} options.desiredCapsMethodLines - An array of lines of code for
   * the desired capabilities method.
   * @param {Array} options.testCaseLines - An array of Line objects representing the
   * test case lines.
   * @param {Array} options.testScriptLines - An array of Line objects representing the
   * test script lines.
   * @param {Object} options.resourceFiles - An object containing resource files.
   * @param {string} options.workingDir - The working directory.
   * @returns {Promise<string>} A Promise that resolves with the path to the output ZIP file.
   */
  async _packageProject({
    serverInfo,
    isManualSession,
    manualSessionId,
    testingFramework,
    requestScript,

    desiredCapsMethodLines,
    testCaseLines,
    testScriptLines,
    resourceFiles,

    workingDir
  }) {
    const subDir = isManualSession ? 'manual' : 'revisit'
    const outputFile = path.join(workingDir, `${requestScript.name}.zip`)
    const compressedDir = path.join(workingDir, testingFramework)
    const outputProject = path.join(compressedDir, requestScript.name, subDir)
    const outputProjectSrc = path.join(outputProject, 'src/test')
    const outputProjectHelper = path.join(outputProject, 'src/test/helper')
    const outputProjectResourceInfo = path.join(outputProject, 'src/resources')
    const templateScriptDir = path.join(__dirname, '../templates/nodejs')
    await createDir(outputProjectSrc)
    await createDir(outputProjectHelper)
    await createDir(outputProjectResourceInfo)

    for (const resourceFileName in resourceFiles) {
      await writeFile(
        path.join(outputProjectResourceInfo, resourceFileName),
        resourceFiles[resourceFileName],
        'utf8'
      )
    }

    let testAppCode = await readFile(
      path.join(templateScriptDir, 'src/test/helper/app.js'),
      'utf8'
    )
    testAppCode = testAppCode.replace('{{testScript}}', this._buildNodejsCode(testScriptLines, 2))
    let appSpecCode = await readFile(path.join(templateScriptDir, 'src/test/mocha.spec.js'), 'utf8')
    appSpecCode = appSpecCode.replace('{{testCases}}', this._buildNodejsCode(testCaseLines, 1))

    let configCode
    const kobitonApiUrl = new URL(serverInfo.apiUrl)
    const appiumServerUrl =
      // eslint-disable-next-line max-len, no-template-curly-in-string
      `\`${kobitonApiUrl.protocol}//` + '${KOBITON_USERNAME}' + ':' + '${KOBITON_API_KEY}' + `@${kobitonApiUrl.host}\``
    configCode = await readFile(path.join(templateScriptDir, 'src/test/config.js'), 'utf8')
    configCode = configCode.replace('{{username}}', serverInfo.username)
    configCode = configCode.replace(
      '//{{desiredCaps}}', this._buildNodejsCode(desiredCapsMethodLines, 1))
    configCode = configCode.replace('//{{appiumServerUrl}}', appiumServerUrl)
    configCode = configCode.replace('//{{kobitonApiUrl}}', `'${serverInfo.apiUrl}'`)

    let readmeText = await readFile(path.join(templateScriptDir, 'README.md'), 'utf8')
    readmeText = readmeText.replace(/{{portalUrl}}/g, serverInfo.portalUrl)
    readmeText = readmeText.replace('{{manualSessionId}}', manualSessionId)

    const staticFiles = [
      'src/test/helper/base.js',
      'src/test/helper/constants.js',
      'src/test/helper/point.js',
      'src/test/helper/proxy.js',
      'src/test/helper/rectangle.js',
      'src/test/helper/utils.js',
      '.babelrc',
      'package.json',
      'package-lock.json'
    ]

    await BPromise.each(staticFiles, (fileName) =>
      ncpAsync(
        path.join(templateScriptDir, fileName),
        path.join(outputProject, fileName)
      )
    )

    await writeFile(path.join(outputProjectSrc, 'config.js'), configCode, 'utf8')
    await writeFile(path.join(outputProjectSrc, 'helper', 'app.js'), testAppCode, 'utf8')
    await writeFile(path.join(outputProjectSrc, 'mocha.spec.js'), appSpecCode, 'utf8')
    await writeFile(path.join(outputProject, 'README.md'), readmeText, 'utf8')
    await ncpAsync(
      path.join(templateScriptDir, '../resources/execute-script-on-web-element.js'),
      path.join(outputProjectResourceInfo, 'execute-script-on-web-element.js')
    )

    await compress([{source: compressedDir, name: false, type: 'dir'}], outputFile)
    return outputFile
  }

  /**
   * Gets the locator code for a step.
   * @param {Object} options - The options object.
   * @param {Object} options.step - The step object.
   * @param {string} options.locatorVarName - The name of the locator variable.
   * @returns {Array} An array of Line objects representing the locator code for the step.
   */
  _getLocatorCode({step, locatorVarName}) {
    const {selectorConfigurations} = step
    const getLocatorStatement = ({selector}) => {
      const value = selector.value.replace(/'/g, '"')
      let selectorCode

      switch (selector.type) {
        case 'accessibilityId':
          selectorCode = '~' + value
          break
        case 'id':
          selectorCode = `//*[@id="${value}"]`
          break
        case 'name':
          selectorCode = `[name="${value}"]`
          break
        case 'className':
          selectorCode = value
          break
        case 'linkText':
          selectorCode = '=' + value
          break
        case 'css':
          selectorCode = value
          break
        case 'xpath':
          selectorCode = value
          break
        default:
          throw new Error(`Unsupported selector type: ${selector.type}`)
      }

      return `'${selectorCode}'`
    }

    const lines = []
    if (selectorConfigurations.length > 1) {
      lines.push(new Line(`const ${locatorVarName} = []`))
      selectorConfigurations.forEach((selectorConfiguration, index) => {
        const {selectors, device} = selectorConfiguration
        const {deviceName, platformVersion} = device || {}
        let ifStatement
        if (!device || index === selectorConfigurations.length - 1) {
          ifStatement = 'else {'
        }
        else if (index === 0) {
          // eslint-disable-next-line max-len
          ifStatement = `if ('${deviceName}' === deviceName && '${platformVersion}' === platformVersion) {`
        }
        else {
          // eslint-disable-next-line max-len
          ifStatement = `else if ('${deviceName}' === deviceName && '${platformVersion}' === platformVersion) {`
        }

        const locatorsStatements = selectors.map((selector) => getLocatorStatement({selector}))
        lines.push(new Line(ifStatement))
        lines.push(new Line(`${locatorVarName} = [${locatorsStatements.join(', ')}]`, 1))
        lines.push(new Line('}', -1))
      })
    }
    else if (selectorConfigurations.length === 1) {
      const {selectors} = selectorConfigurations[0]
      const locatorsStatements = selectors.map((selector) => getLocatorStatement({selector}))
      lines.push(new Line(`const ${locatorVarName} = [${locatorsStatements.join(', ')}]`))
    }

    return lines
  }

  /**
   * Builds Node.js code from an array of lines with the specified initial indent.
   * @param {Array} lines - The array of lines to build Java code from.
   * @param {number} initialIndent - The initial indent to use for the Java code.
   * @returns {string} The Node.js code generated from the array of lines with the specified
   * initial indent.
   */
  _buildNodejsCode(lines, initialIndent) {
    return buildCode({language: LANGUAGES.NODEJS, initialIndent, lines})
  }
}
