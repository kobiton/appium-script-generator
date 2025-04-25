import BPromise from 'bluebird'
import path from 'path'
import {URL} from 'url'
import get from 'lodash/get'
import {FRAMEWORK_NAMES, DEVICE_SOURCES, CONTEXTS, LANGUAGES} from './constant'
import {buildCode, Line} from '../models/line'
import compress from '../utils/compress'
import {readFile, writeFile, createDir} from '../utils/fs-wrapper'
import {BaseAppiumScriptGenerator} from './base'

const LOCATOR_VAR_NAME_PREFIX = 'locator'
const ncpAsync = BPromise.promisify(require('ncp').ncp)

/**
 * Generates Java code for Appium scripts.
 */
export default class JavaAppiumScriptGenerator extends BaseAppiumScriptGenerator {
  /**
   * Creates a new instance of the `JavaAppiumScriptGenerator` class with the
   * specified debug namespace.
   * @param {Object} options - The options object.
   * @param {string} options.debugNamespace - The debug namespace to use for the new instance.
   */
  constructor({debugNamespace = 'script-generator'}) {
    super()
    this._ns = debugNamespace
  }

  /**
   * Triggers the test script generation process.
   * @param {Object} options - The options object.
   * @param {Object} options.serverInfo - The server information object.
   * @param {boolean} options.isManualSession - Whether the session is manual or not.
   * @param {string} options.manualSessionId - The ID of the manual session.
   * @param {Array} options.devices - The array of devices to run the test on.
   * @param {Array} options.testSteps - The array of test steps.
   * @param {Object} options.appUnderTest - The app under test object.
   * @param {Array} options.desiredCapabilitiesOfDevices - The array desired capabilities
   * of the devices.
   * @param {Object} options.requestScript - The request script object.
   * @param {string} options.workingDir - The working directory for the test script generation
   * process.
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
      appUnderTest, devices, testingFramework, deviceSource
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
   * Generates an array of `Line` objects representing the desired capabilities
   * method lines for the specified options.
   * @param {Object} options - The options object.
   * @param {Array} options.desiredCapabilitiesOfDevices - The array of desired
   * capabilities of devices.
   * @param {Array} options.devices - The array of devices.
   * @param {string} options.deviceSource - The device source.
   * @param {Object} options.appUnderTest - The application under test object.
   * @returns {Array} An array of `Line` objects representing the desired capabilities
   * method lines for the specified options.
   */
  _generateDesiredCapabilitiesMethodLines({
    desiredCapabilitiesOfDevices, devices, deviceSource, appUnderTest
  }) {
    const desiredCapsLines = []
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

      // Create a method to generate the DesiredCapabilities object.
      // The output of this block of code like:
      // public static DesiredCapabilities getPixel5aAndroid13DesiredCapabilities() {
      //   DesiredCapabilities capabilities = new DesiredCapabilities();
      //
      //   capabilities.setCapability("sessionName", "Automation test session");
      //   capabilities.setCapability("sessionDescription", "");
      //   ...
      //
      //   return capabilities;
      // }
      if (DEVICE_SOURCES.KOBITON === deviceSource || appUnderTest.browserName) {
        desiredCapsLines.push(
          new Line(`public static DesiredCapabilities ${desiredCapsMethodName}() {`))
      }
      else {
        desiredCapsLines.push(
          new Line(`public static DesiredCapabilities ${desiredCapsMethodName}(String appURL) {`))
      }

      desiredCapsLines.push(
        new Line('DesiredCapabilities capabilities = new DesiredCapabilities();', 1))
      desiredCapsLines.push(new Line(''))

      desiredCapabilities.forEach(({key, value, type}) => {
        let statement

        const parsedValue = this._parseValue(value, type)
        if (typeof parsedValue === 'string') {
          statement = `capabilities.setCapability("${key}", "${parsedValue}");`
        }
        else {
          statement = `capabilities.setCapability("${key}", ${parsedValue});`
        }

        desiredCapsLines.push(new Line(statement))
      })
      desiredCapsLines.push(new Line(''))

      desiredCapsLines.push(new Line('return capabilities;'))
      desiredCapsLines.push(new Line('}', -1))
      desiredCapsLines.push(new Line(''))
    }

    return desiredCapsLines
  }

  /**
   * Generates an array of `Line` objects representing the test case lines
   * for the specified options.
   * @param {Object} options - The options object.
   * @param {Object} options.appUnderTest - The application under test object.
   * @param {Array} options.devices - The array of devices to generate test cases for.
   * @param {string} options.testingFramework - The testing framework to use.
   * @param {string} options.deviceSource - The device source.
   * @returns {Array} An array of `Line` objects representing the test case lines
   * for the specified options.
   */
  _generateTestCaseLines({appUnderTest, devices, testingFramework, deviceSource}) {
    const testCaseLines = []
    const desiredCapsMethodNames = new Set()
    const testCaseMethodNames = new Set()

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
      const testCaseMethodName = this._getVarName({
        name: [
          deviceName,
          get(device, 'capabilities.platformName'),
          get(device, 'capabilities.platformVersion')
        ].join('_'),
        fallbackName: device.id.toString(),
        prefix: 'testOn',
        suffix: '',
        varNames: testCaseMethodNames
      })

      testCaseLines.push(new Line('@Test'))
      testCaseLines.push(new Line(`public void ${testCaseMethodName}() throws Exception {`))

      if (testingFramework === FRAMEWORK_NAMES.JUNIT) {
        if (DEVICE_SOURCES.KOBITON === deviceSource || appUnderTest.browserName) {
          testCaseLines.push(new Line(
            `DesiredCapabilities capabilities = Config.${desiredCapsMethodName}();`, 1))
        }
        else {
          testCaseLines.push(new Line(
            `String appURL = getAppUrl(${appUnderTest.appVersionId});`, 1))
          testCaseLines.push(new Line(
            `DesiredCapabilities capabilities = Config.${desiredCapsMethodName}(appURL);`))
        }
        testCaseLines.push(new Line('findOnlineDevice(capabilities);'))
        testCaseLines.push(new Line(`setup(capabilities, ${retinaScale});`))
        testCaseLines.push(new Line('runTest();'))
      }
      else if (testingFramework === FRAMEWORK_NAMES.TESTNG) {
        testCaseLines.push(new Line('TestApp testApp = new TestApp();', 1))
        if (DEVICE_SOURCES.KOBITON === deviceSource || appUnderTest.browserName) {
          testCaseLines.push(new Line(
            `DesiredCapabilities capabilities = Config.${desiredCapsMethodName}();`))
        }
        else {
          testCaseLines.push(new Line(
            `String appURL = testApp.getAppUrl(${appUnderTest.appVersionId});`))
          testCaseLines.push(new Line(
            `DesiredCapabilities capabilities = Config.${desiredCapsMethodName}(appURL);`))
        }
        testCaseLines.push(new Line('testApp.findOnlineDevice(capabilities);'))
        testCaseLines.push(new Line(`testApp.setup(capabilities, ${retinaScale});`))
        testCaseLines.push(new Line('testApp.runTest();'))
      }

      testCaseLines.push(new Line('}', -1))
      testCaseLines.push(new Line(''))
    }

    return testCaseLines
  }

  /**
   * Generates an array of lines for a test script based on the provided test steps.
   * @param {Object} options - The options object.
   * @param {Array} options.testSteps - The array of test steps to generate the test
   * script lines from.
   * @returns {Object} An object containing the generated lines and resource files.
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
      lines.push(new Line(`setCurrentCommandId(${step.id});`))

      if (!context || context === CONTEXTS.NATIVE) {
        lines.push(new Line('switchToNativeContext();'))
      }
      else {
        lines.push(new Line('switchToWebContext();'))
      }

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
          lines.push(new Line(`driver.activateApp("${appPackage}");`))
        } break

        case 'touchOnElement': {
          const {x, y} = action
          const elementVarName = `element${rawLocatorVarName}`
          // eslint-disable-next-line max-len
          lines.push(new Line(`MobileElement ${elementVarName} = findVisibleElement(${findingElementTimeout}, ${locatorVarName});`))
          // eslint-disable-next-line max-len
          lines.push(new Line(`touchOnElement(${elementVarName}, ${x}, ${y});`))
        } break

        case 'touchOnScrollableParent': {
          const {elementInfo, x, y} = action
          resourceFiles[`${id}.json`] = JSON.stringify(elementInfo)

          !isOnKeyboard && lines.push(new Line('hideKeyboard();'))
          const elementVarName = `element${rawLocatorVarName}`
          // eslint-disable-next-line max-len
          lines.push(new Line(`MobileElement ${elementVarName} = findVisibleElementOnScrollable(${findingElementTimeout}, ${locatorVarName});`))
          // eslint-disable-next-line max-len
          lines.push(new Line(`touchOnElement(${elementVarName}, ${x}, ${y});`))
        } break

        case 'touchAtPoint': {
          const {x, y} = action
          lines.push(new Line(`touchAtPoint(${x}, ${y});`))
        } break

        case 'swipeFromElement': {
          const {x1, y1, x2, y2, duration} = action

          !isOnKeyboard && lines.push(new Line('hideKeyboard();'))
          const elementVarName = `element${rawLocatorVarName}`
          // eslint-disable-next-line max-len
          lines.push(new Line(`MobileElement ${elementVarName} = findVisibleElement(${findingElementTimeout}, ${locatorVarName});`))
          // eslint-disable-next-line max-len
          lines.push(new Line(`swipeOnElement(${elementVarName}, ${x1}, ${y1}, ${x2}, ${y2}, ${duration});`))
        } break

        case 'swipeByPoints': {
          const {x1, y1, x2, y2, duration} = action
          lines.push(new Line(`swipeByPoint(${x1}, ${y1}, ${x2}, ${y2}, ${duration});`))
        } break

        case 'press': {
          const {value} = action
          const count = action.count || 1
          if (count === 1) {
            lines.push(new Line(`press(PRESS_TYPES.${value});`))
          }
          else {
            lines.push(new Line(`pressMultiple(PRESS_TYPES.${value}, ${count});`))
          }
        } break

        case 'sendKeys': {
          const {value} = action
          lines.push(new Line(`sendKeys(${this._getString(value)});`))
        } break

        case 'sendKeysWithDDT': {
          const {configurations} = action
          const keysVarName = `keys${rawLocatorVarName}`

          if (configurations.length > 1) {
            lines.push(new Line(`String ${keysVarName} = null;`))
            configurations.forEach((configuration, index) => {
              const {value, device} = configuration
              const {deviceName, platformVersion} = device || {}
              let ifStatement
              if (!device || index === configurations.length - 1) {
                ifStatement = 'else {'
              }
              else if (index === 0) {
                // eslint-disable-next-line max-len
                ifStatement = `if ("${deviceName}".equals(deviceName) && "${platformVersion}".equals(platformVersion)) {`
              }
              else {
                // eslint-disable-next-line max-len
                ifStatement = `else if ("${deviceName}".equals(deviceName) && "${platformVersion}".equals(platformVersion)) {`
              }

              lines.push(new Line(ifStatement))
              lines.push(new Line(`${keysVarName} = ${this._getString(value)};`, 1))
              lines.push(new Line('}', -1))
            })
          }
          else if (configurations.length === 1) {
            const {value} = configurations[0]
            lines.push(new Line(`String ${keysVarName} = ${this._getString(value)};`))
          }

          lines.push(new Line(`sendKeys(${keysVarName});`))
        } break

        case 'rotate': {
          const {orientation} = action
          lines.push(new Line(`driver.rotate(ScreenOrientation.${orientation});`))
        } break

        case 'setLocation': {
          const {lat, long} = action
          // eslint-disable-next-line max-len
          lines.push(new Line(`driver.setLocation(new Location((long)Double.parseDouble("${lat}"), (long)Double.parseDouble("${long}"), 0.0));`))
        } break

        case 'generateRandomPhoneNumber': {
          const {length} = action
          lines.push(new Line('clearTextField(12);'))
          lines.push(new Line(`sendKeys(otpService.getRandomPhoneNumber(${length}));`))
        } break

        case 'findOtpPhoneNumber': {
          const {countryCode} = action
          lines.push(new Line(`otpService.findOtpPhoneNumber("${countryCode}");`))
          lines.push(new Line('clearTextField(12);'))
          lines.push(new Line('sendKeys(otpService.phoneNumber);'))
        } break

        case 'findOtpEmailAddress': {
          lines.push(new Line('otpService.findOtpEmailAddress();'))
          lines.push(new Line('clearTextField(24);'))
          lines.push(new Line('sendKeys(otpService.emailAddress);'))
          break
        }

        case 'findOtpCode': {
          lines.push(new Line('otpService.findOtpCode();'))
          lines.push(new Line('clearTextField(8);'))
          lines.push(new Line('sendKeys(otpService.otpCode);'))
          break
        }

        default:
          throw new Error(`Not support command = ${actionCommand}`)
      }
    }

    return {lines, resourceFiles}
  }

  /**
   * Packages the project into a ZIP file and returns the path to the ZIP file.
   * @param {Object} options - The options object.
   * @param {Object} options.serverInfo - The server information object.
   * @param {string} options.deviceSource - The device source.
   * @param {Object} options.appUnderTest - The application under test object.
   * @param {boolean} options.isManualSession - Indicates whether the session is manual.
   * @param {string} options.manualSessionId - The ID of the manual session.
   * @param {string} options.testingFramework - The testing framework to use.
   * @param {Object} options.requestScript - The request script object.
   * @param {Array} options.desiredCapsMethodLines - The desired capabilities method lines.
   * @param {Array} options.testCaseLines - The test case lines.
   * @param {Array} options.testScriptLines - The test script lines.
   * @param {Object} options.resourceFiles - The resource files object.
   * @param {string} options.workingDir - The working directory.
   * @returns {string} The path to the ZIP file.
   */
  async _packageProject({
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
  }) {
    const subDir = isManualSession ? 'manual' : 'revisit'
    const outputFile = path.join(workingDir, `${requestScript.name}.zip`)
    const compressedDir = path.join(workingDir, testingFramework)
    const outputProject = path.join(compressedDir, requestScript.name, subDir)
    const outputProjectSrc = path.join(
      outputProject, 'src/test/java/com/kobiton/scriptlessautomation')
    const outputProjectResourceInfo = path.join(outputProject, 'src/test/resources')
    const templateScriptDir = path.join(__dirname, '../templates/java')

    await createDir(outputProjectSrc)
    await createDir(outputProjectResourceInfo)

    for (const resourceFileName in resourceFiles) {
      await writeFile(
        path.join(outputProjectResourceInfo, resourceFileName),
        resourceFiles[resourceFileName],
        'utf8'
      )
    }

    let testAppCode = await readFile(
      path.join(templateScriptDir, testingFramework, 'TestApp.java'),
      'utf8'
    )
    testAppCode = testAppCode.replace('{{testCases}}', this._buildJavaCode(testCaseLines, 1))
    testAppCode = testAppCode.replace('{{testScript}}', this._buildJavaCode(testScriptLines, 3))

    let testSuiteCode
    if (testingFramework === FRAMEWORK_NAMES.TESTNG) {
      testAppCode = testAppCode.replace(/{{portalUrl}}/g, serverInfo.portalUrl)

      testSuiteCode = await readFile(path.join(templateScriptDir, 'testng/TestSuite.java'), 'utf8')
      testSuiteCode = testSuiteCode.replace('{{testCases}}', this._buildJavaCode(testCaseLines, 1))
    }

    const staticJavaFiles = [
      'Utils.java',
      'ProxyServer.java',
      'OtpService.java',
      'TestBase.java'
    ]

    let configCode, appiumServerUrl
    configCode = await readFile(path.join(templateScriptDir, 'Config.java'), 'utf8')

    if (DEVICE_SOURCES.KOBITON === deviceSource) {
      const kobitonApiUrl = new URL(serverInfo.apiUrl)
      appiumServerUrl = `"${kobitonApiUrl.protocol}//${kobitonApiUrl.host}/wd/hub"`
      configCode = configCode.replace('{{your_api_key}}', 'your_api_key')
      configCode = configCode.replace('{{username}}', serverInfo.username)
      configCode = configCode.replace('{{kobitonCredential}}', '')
    }
    else {
      const additionalConfig = []
      additionalConfig.push(
        new Line('public static final String KOBITON_USERNAME = "{{kobiton_username}}";'))
      additionalConfig.push(
        new Line('public static final String KOBITON_API_KEY = "your_kobiton_api_key";', 1))
      configCode = configCode.replace(
        '{{kobitonCredential}}', this._buildJavaCode(additionalConfig, 0))

      const sauceLabs = get(serverInfo, 'sauceLabs')
      if (!sauceLabs) {
        throw new Error('This account is not integrated with SauceLabs')
      }

      const sauceLabsApiUrl = new URL(sauceLabs.url)
      appiumServerUrl =
        // eslint-disable-next-line max-len
        `"${sauceLabsApiUrl.protocol}//" + SAUCE_LABS_USERNAME + ":" + SAUCE_LABS_API_KEY + "@ondemand.${sauceLabs.region}.${sauceLabsApiUrl.host}:443/wd/hub"`
      configCode = configCode.replace('{{USER_NAME}}', 'SAUCE_LABS_USERNAME')
      configCode = configCode.replace('{{API_KEY}}', 'SAUCE_LABS_API_KEY')
      configCode = configCode.replace('{{kobiton_username}}', serverInfo.username)
      configCode = configCode.replace('{{username}}', sauceLabs.username)
      configCode = configCode.replace('{{your_api_key}}', 'your_sauce_labs_api_key')
    }

    configCode = configCode.replace('{{kobiton_api_url}}', serverInfo.apiUrl)
    configCode = configCode.replace('{{baseUrl}}', serverInfo.apiUrl)
    configCode = configCode.replace(
      '{{desiredCaps}}', this._buildJavaCode(desiredCapsMethodLines, 1))
    configCode = configCode.replace('{{appiumServerUrl}}', appiumServerUrl)
    configCode = configCode.replace('{{deviceSource}}', deviceSource)

    let readmeText = await readFile(path.join(templateScriptDir, 'README.md'), 'utf8')
    readmeText = readmeText.replace(/{{portalUrl}}/g, serverInfo.portalUrl)
    readmeText = readmeText.replace('{{manualSessionId}}', manualSessionId)

    await ncpAsync(
      path.join(templateScriptDir, testingFramework, 'pom.xml'),
      path.join(outputProject, 'pom.xml'))

    if (testingFramework === FRAMEWORK_NAMES.TESTNG) {
      await ncpAsync(
        path.join(templateScriptDir, testingFramework, 'testng.xml'),
        path.join(outputProject, 'testng.xml'))
    }

    await BPromise.each(staticJavaFiles, (fileName) =>
      ncpAsync(
        path.join(templateScriptDir, fileName),
        path.join(outputProjectSrc, fileName)
      )
    )

    if (testingFramework === FRAMEWORK_NAMES.JUNIT) {
      await ncpAsync(
        path.join(templateScriptDir, testingFramework, 'TestRunner.java'),
        path.join(outputProjectSrc, 'TestRunner.java')
      )
    }

    await writeFile(path.join(outputProjectSrc, 'Config.java'), configCode, 'utf8')
    await writeFile(path.join(outputProjectSrc, 'TestApp.java'), testAppCode, 'utf8')
    await writeFile(path.join(outputProject, 'README.md'), readmeText, 'utf8')
    await ncpAsync(
      path.join(templateScriptDir, '../resources/execute-script-on-web-element.js'),
      path.join(outputProjectResourceInfo, 'execute-script-on-web-element.js')
    )

    if (testingFramework === FRAMEWORK_NAMES.TESTNG) {
      await writeFile(path.join(outputProjectSrc, 'TestSuite.java'), testSuiteCode, 'utf8')
    }

    await compress([{source: compressedDir, name: false, type: 'dir'}], outputFile)
    return outputFile
  }

  /**
   * Gets the locator code for a step.
   * @param {Object} options - The options object.
   * @param {Object} options.step - The step object.
   * @param {string} options.locatorVarName - The name of the locator variable.
   * @returns {Array} An array of `Line` objects representing the locator code for the step.
   */
  _getLocatorCode({step, locatorVarName}) {
    const {selectorConfigurations} = step
    const getLocatorStatement = ({selector}) => {
      let body

      switch (selector.type) {
        case 'accessibilityId':
          body = 'AccessibilityId'
          break
        case 'id':
          body = 'id'
          break
        case 'name':
          body = 'name'
          break
        case 'className':
          body = 'className'
          break
        case 'linkText':
          body = 'linkText'
          break
        case 'css':
          body = 'cssSelector'
          break
        case 'xpath':
          body = 'xpath'
          break
        default:
          throw new Error(`Unsupported selector type: ${selector.type}`)
      }

      const selectorValue = selector.value.replace(/"/g, '\\"')
      const suffix = `("${selectorValue}")`
      return 'MobileBy.' + body + suffix
    }

    const lines = []
    if (selectorConfigurations.length > 1) {
      lines.push(new Line(`By[] ${locatorVarName};`))
      selectorConfigurations.forEach((selectorConfiguration, index) => {
        const {selectors, device} = selectorConfiguration
        const {deviceName, platformVersion} = device || {}
        let ifStatement
        if (!device || index === selectorConfigurations.length - 1) {
          ifStatement = 'else {'
        }
        else if (index === 0) {
          // eslint-disable-next-line max-len
          ifStatement = `if ("${deviceName}".equals(deviceName) && "${platformVersion}".equals(platformVersion)) {`
        }
        else {
          // eslint-disable-next-line max-len
          ifStatement = `else if ("${deviceName}".equals(deviceName) && "${platformVersion}".equals(platformVersion)) {`
        }

        const locatorsStatements = selectors.map((selector) => getLocatorStatement({selector}))
        lines.push(new Line(ifStatement))
        lines.push(new Line(`${locatorVarName} = new By[] {${locatorsStatements.join(', ')}};`, 1))
        lines.push(new Line('}', -1))
      })
    }
    else if (selectorConfigurations.length === 1) {
      const {selectors} = selectorConfigurations[0]
      const locatorsStatements = selectors.map((selector) => getLocatorStatement({selector}))
      lines.push(new Line(`By[] ${locatorVarName} = new By[] {${locatorsStatements.join(', ')}};`))
    }

    return lines
  }

  /**
   * Builds Java code from an array of lines with the specified initial indent.
   * @param {Array} lines - The array of lines to build Java code from.
   * @param {number} initialIndent - The initial indent to use for the Java code.
   * @returns {string} The Java code generated from the array of lines with the specified
   * initial indent.
   */
  _buildJavaCode(lines, initialIndent) {
    return buildCode({language: LANGUAGES.JAVA, initialIndent, lines})
  }
}
