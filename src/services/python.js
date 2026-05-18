import BPromise from 'bluebird'
import path from 'path'
import {URL} from 'url'
import get from 'lodash/get'
import snakeCase from 'lodash/snakeCase'
import isString from 'lodash/isString'
import {DEVICE_SOURCES, CONTEXTS, LANGUAGES} from './constant'
import {buildCode, Line} from '../models/line'
import compress from '../utils/compress'
import {readFile, writeFile, createDir} from '../utils/fs-wrapper'
import {BaseAppiumScriptGenerator} from './base'

const LOCATOR_VAR_NAME_PREFIX = 'locator'
const ncpAsync = BPromise.promisify(require('ncp').ncp)

export default class PythonAppiumScriptGenerator extends BaseAppiumScriptGenerator {
  constructor({debugNamespace = 'script-generator'}) {
    super()
    this._ns = debugNamespace
  }

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
      devices, appUnderTest, deviceSource
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

  _generateDesiredCapabilitiesMethodLines({
    desiredCapabilitiesOfDevices, devices, deviceSource, appUnderTest
  }) {
    const lines = [
      new Line('')
    ]
    const desiredCapsMethodNames = new Set()

    for (const device of devices) {
      const {id, name: deviceName} = device
      const desiredCapsMethodName = snakeCase(this._getVarName({
        name: [
          deviceName,
          get(device, 'capabilities.platformName'),
          get(device, 'capabilities.platformVersion')
        ].join('_'),
        fallbackName: device.id.toString(),
        prefix: 'get',
        suffix: 'desired_capabilities',
        varNames: desiredCapsMethodNames
      }))

      const desiredCapsOfThisDevice = desiredCapabilitiesOfDevices.find(
        (desiredCap) => desiredCap.deviceId === id)
      if (!desiredCapsOfThisDevice) {
        throw new Error(
          `Cannot find the desired capabilities for device: ${JSON.stringify(device)}`)
      }

      const {desiredCapabilities = {}} = desiredCapsOfThisDevice

      lines.push(new Line('@classmethod'))
      if (DEVICE_SOURCES.KOBITON === deviceSource || appUnderTest.browserName) {
        lines.push(new Line(`def ${desiredCapsMethodName}(cls):`))
      }
      else {
        lines.push(new Line(`def ${desiredCapsMethodName}(cls, app_url):`))
      }

      lines.push(new Line('return {', 1))
      desiredCapabilities.forEach(({key, value, type}, index) => {
        const parsedValue = this._parseValue(value, type)
        const suffix = index === desiredCapabilities.length - 1 ? '' : ','
        let statement
        if (typeof parsedValue === 'boolean') {
          statement = `'${key}': ${parsedValue ? 'True' : 'False'}${suffix}`
        }
        else if (typeof parsedValue === 'string') {
          statement = `'${key}': '${parsedValue}'${suffix}`
        }
        else {
          statement = `'${key}': ${parsedValue}${suffix}`
        }
        lines.push(new Line(statement, index === 0 ? 1 : 0))
      })

      lines.push(new Line('}', -1))
      lines.push(new Line('', -1))
    }

    return lines
  }

  _generateTestCaseLines({devices, appUnderTest, deviceSource}) {
    const lines = []
    const desiredCapsMethodNames = new Set()

    for (const device of devices) {
      const {name: deviceName, capabilities: deviceCaps} = device
      const desiredCapsMethodName = snakeCase(this._getVarName({
        name: [
          deviceName,
          get(device, 'capabilities.platformName'),
          get(device, 'capabilities.platformVersion')
        ].join('_'),
        fallbackName: device.id.toString(),
        prefix: 'get',
        suffix: 'desired_capabilities',
        varNames: desiredCapsMethodNames
      }))

      const retinaScale = get(deviceCaps, 'resolution.scale') || 1
      const testFnName = snakeCase(
        `test ${deviceName} ${get(device, 'capabilities.platformName')} ` +
        `${get(device, 'capabilities.platformVersion')}`
      )
      const testDescription =
        `Run test on ${deviceName} - ${get(device, 'capabilities.platformName')} ` +
        `${get(device, 'capabilities.platformVersion')}`

      const capsCall = (DEVICE_SOURCES.KOBITON === deviceSource || appUnderTest.browserName)
        ? `Config.${desiredCapsMethodName}()`
        : `Config.${desiredCapsMethodName}(TestApp().get_app_url(${appUnderTest.appVersionId}))`

      lines.push(...[
        new Line(`def ${testFnName}():`),
        new Line(`"""${testDescription}"""`, 1),
        new Line('automation_helper = None'),
        new Line('try:'),
        new Line('automation_helper = TestApp()', 1),
        new Line(`capabilities = ${capsCall}`),
        new Line('automation_helper.find_online_device(capabilities)'),
        new Line(`automation_helper.setup(capabilities, ${retinaScale})`),
        new Line('automation_helper.run()'),
        new Line('finally:', -1),
        new Line('if automation_helper:', 1),
        new Line('automation_helper.cleanup()', 1),
        new Line('', -3)
      ])
    }

    return lines
  }

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
      lines.push(new Line(`self.set_current_command_id(${step.id})`))

      if (!context || context === CONTEXTS.NATIVE) {
        lines.push(new Line('self.switch_to_native_context()'))
      }
      else {
        lines.push(new Line('self.switch_to_web_context()'))
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
          lines.push(new Line(`self.activate_app('${appPackage}')`))
        } break

        case 'touchOnElement': {
          const {x, y} = action
          const elementVarName = `element${rawLocatorVarName}`
          lines.push(
            new Line(
              `${elementVarName} = self.find_visible_element(` +
              `${findingElementTimeout}, ${locatorVarName})`
            )
          )
          lines.push(new Line(`self.touch_on_element(${elementVarName}, ${x}, ${y})`))
        } break

        case 'touchOnScrollableParent': {
          const {elementInfo, x, y} = action
          resourceFiles[`${id}.json`] = JSON.stringify(elementInfo)
          !isOnKeyboard && lines.push(new Line('self.hide_keyboard()'))
          const elementVarName = `element${rawLocatorVarName}`
          lines.push(
            new Line(
              `${elementVarName} = self.find_visible_element_on_scrollable(` +
              `${findingElementTimeout}, ${locatorVarName})`
            )
          )
          lines.push(new Line(`self.touch_on_element(${elementVarName}, ${x}, ${y})`))
        } break

        case 'touchAtPoint': {
          const {x, y} = action
          lines.push(new Line(`self.touch_at_relative_point(${x}, ${y})`))
        } break

        case 'swipeFromElement': {
          const {x1, y1, x2, y2, duration} = action
          !isOnKeyboard && lines.push(new Line('self.hide_keyboard()'))
          const elementVarName = `element${rawLocatorVarName}`
          lines.push(
            new Line(
              `${elementVarName} = self.find_visible_element(` +
              `${findingElementTimeout}, ${locatorVarName})`
            )
          )
          lines.push(
            new Line(
              'self.swipe_on_element(' +
              `${elementVarName}, ${x1}, ${y1}, ${x2}, ${y2}, ${duration || 800})`
            )
          )
        } break

        case 'swipeByPoints': {
          const {x1, y1, x2, y2, duration} = action
          lines.push(
            new Line(`self.swipe_by_point(${x1}, ${y1}, ${x2}, ${y2}, ${duration || 800})`)
          )
        } break

        case 'press': {
          const {value} = action
          const count = action.count || 1
          if (count === 1) {
            lines.push(new Line(`self.press_button(PressType.${value})`))
          }
          else {
            lines.push(new Line(`self.press_button_multiple(PressType.${value}, ${count})`))
          }
        } break

        case 'sendKeys': {
          const {value} = action
          lines.push(new Line(`self.send_keys_to_active_element(${this._getString(value)})`))
        } break

        case 'sendKeysWithDDT': {
          const {configurations} = action
          const keysVarName = `keys${rawLocatorVarName}`

          if (configurations.length > 1) {
            lines.push(new Line(`${keysVarName} = None`))
            configurations.forEach((configuration, index) => {
              const {value, device} = configuration
              const {deviceName, platformVersion} = device || {}
              const isFirst = index === 0
              const isLast = !device || index === configurations.length - 1
              let header
              if (isLast) {
                header = 'else:'
              }
              else if (isFirst) {
                // eslint-disable-next-line max-len
                header = `if self._device_name == "${deviceName}" and self._platform_version == "${platformVersion}":`
              }
              else {
                // eslint-disable-next-line max-len
                header = `elif self._device_name == "${deviceName}" and self._platform_version == "${platformVersion}":`
              }
              // First branch: stay at current indent. Subsequent branches dedent
              // back from the previous body level before printing elif/else.
              lines.push(new Line(header, isFirst ? 0 : -1))
              lines.push(new Line(`${keysVarName} = ${this._getString(value)}`, 1))
            })
            // Close the body indent before the trailing sendKeys call.
            lines.push(new Line(`self.send_keys_to_active_element(${keysVarName})`, -1))
          }
          else {
            if (configurations.length === 1) {
              const {value} = configurations[0]
              lines.push(new Line(`${keysVarName} = ${this._getString(value)}`))
            }
            lines.push(new Line(`self.send_keys_to_active_element(${keysVarName})`))
          }
        } break

        case 'idle':
          lines.push(new Line('self.idle()'))
          break

        case 'generateRandomPhoneNumber': {
          const {length} = action
          const randomPhoneCall = `self.otp_service.get_random_phone_number(${length})`
          lines.push(new Line('self.clear_text_field(12)'))
          lines.push(new Line(`self.send_keys_to_active_element(${randomPhoneCall})`))
        } break

        case 'findOtpPhoneNumber': {
          const {countryCode} = action
          lines.push(new Line(`self.otp_service.find_otp_phone_number("${countryCode}")`))
          lines.push(new Line('self.clear_text_field(12)'))
          lines.push(new Line('self.send_keys_to_active_element(self.otp_service.phone_number)'))
        } break

        case 'findOtpEmailAddress':
          lines.push(new Line('self.otp_service.find_otp_email_address()'))
          lines.push(new Line('self.clear_text_field(24)'))
          lines.push(new Line('self.send_keys_to_active_element(self.otp_service.email_address)'))
          break

        case 'findOtpCode':
          lines.push(new Line('self.otp_service.find_otp_code()'))
          lines.push(new Line('self.clear_text_field(8)'))
          lines.push(new Line('self.send_keys_to_active_element(self.otp_service.otp_code)'))
          break

        case 'rotate': {
          const {orientation} = action
          lines.push(new Line(`self.rotate_screen(Orientation.${orientation})`))
        } break

        case 'setLocation': {
          const {lat, long} = action
          lines.push(new Line(`self.set_location(${lat}, ${long}, 0)`))
        } break

        default:
          throw new Error(`Not support command = ${actionCommand}`)
      }
    }

    return {lines, resourceFiles}
  }

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
    const templateDir = path.join(__dirname, '../templates/python')
    const subDir = isManualSession ? 'manual' : 'revisit'
    const outputFile = path.join(workingDir, `${requestScript.name}.zip`)
    const compressedDir = path.join(workingDir, testingFramework)
    const outputProject = path.join(compressedDir, requestScript.name, subDir)
    const outputResourcesDir = path.join(outputProject, 'resources')

    await createDir(outputProject)
    await createDir(outputResourcesDir)
    await ncpAsync(templateDir, outputProject)

    const configPath = path.join(outputProject, 'config.py')
    let configContent = await readFile(configPath, 'utf8')
    let appiumServerUrl

    if (DEVICE_SOURCES.KOBITON === deviceSource) {
      const kobitonApiUrl = new URL(serverInfo.apiUrl)
      appiumServerUrl = `${kobitonApiUrl.protocol}//${kobitonApiUrl.host}/wd/hub`
      configContent = configContent.replace('{{your_api_key}}', 'your_api_key')
      configContent = configContent.replace('{{username}}', serverInfo.username || '')
      configContent = configContent.replace('    {{kobitonCredential}}\n', '')
    }
    else {
      const sauceLabs = get(serverInfo, 'sauceLabs')
      if (!sauceLabs) {
        throw new Error('This account is not integrated with SauceLabs')
      }

      const sauceLabsApiUrl = new URL(sauceLabs.url)
      appiumServerUrl =
        `${sauceLabsApiUrl.protocol}//ondemand.${sauceLabs.region}.` +
        `${sauceLabsApiUrl.host}:443/wd/hub`

      const additionalConfig = [
        new Line(`KOBITON_USERNAME = '${serverInfo.username}'`),
        new Line('KOBITON_API_KEY = \'your_kobiton_api_key\'')
      ]
      configContent = configContent.replace(
        '    {{kobitonCredential}}',
        this._buildPythonCode(additionalConfig, 1)
      )
      configContent = configContent.replace('{{username}}', sauceLabs.username || '')
      configContent = configContent.replace('{{your_api_key}}', 'your_sauce_labs_api_key')
    }

    const desiredCapsCode = this._buildPythonCode(desiredCapsMethodLines, 1)
    configContent = configContent.replace('    #{{desiredCaps}}', desiredCapsCode)
    configContent = configContent.replace('{{appiumServerUrl}}', appiumServerUrl)
    configContent = configContent.replace('{{kobitonApiUrl}}', serverInfo.apiUrl || '')
    configContent = configContent.replace('{{deviceSource}}', deviceSource)
    await writeFile(configPath, configContent)

    const testAppPath = path.join(outputProject, 'test_app.py')
    let testAppContent = await readFile(testAppPath, 'utf8')
    const testScriptCode = this._buildPythonCode(testScriptLines, 3)
    testAppContent = testAppContent.replace(
      '            {{testScript}}',
      testScriptCode || '            pass'
    )
    testAppContent = testAppContent.replace(/\{\{portalUrl\}\}/g, serverInfo.portalUrl || '')
    await writeFile(testAppPath, testAppContent)

    const testSuitePath = path.join(outputProject, 'test_suite.py')
    let testSuiteContent = await readFile(testSuitePath, 'utf8')
    const testCasesCode = this._buildPythonCode(testCaseLines, 0)
    testSuiteContent = testSuiteContent.replace('{{testCases}}', testCasesCode)
    await writeFile(testSuitePath, testSuiteContent)

    const readmePath = path.join(outputProject, 'README.md')
    let readmeContent = await readFile(readmePath, 'utf8')
    readmeContent = readmeContent.replace(/\{\{portalUrl\}\}/g, serverInfo.portalUrl || '')
    readmeContent = readmeContent.replace(/\{\{manualSessionId\}\}/g, manualSessionId || '')
    await writeFile(readmePath, readmeContent)

    await ncpAsync(
      path.join(templateDir, '../resources/execute-script-on-web-element.js'),
      path.join(outputResourcesDir, 'execute-script-on-web-element.js')
    )

    for (const [filename, content] of Object.entries(resourceFiles)) {
      await writeFile(path.join(outputResourcesDir, filename), content)
    }

    await compress([{source: compressedDir, name: false, type: 'dir'}], outputFile)

    return outputFile
  }

  _getLocatorCode({step, locatorVarName}) {
    const {selectorConfigurations} = step

    const getLocatorStatement = ({selector}) => {
      const value = selector.value.replace(/'/g, '"')
      let appiumBy

      switch (selector.type) {
        case 'accessibilityId':
          appiumBy = 'AppiumBy.ACCESSIBILITY_ID'
          break
        case 'id':
          appiumBy = 'AppiumBy.ID'
          break
        case 'name':
          appiumBy = 'AppiumBy.NAME'
          break
        case 'className':
          appiumBy = 'AppiumBy.CLASS_NAME'
          break
        case 'linkText':
          appiumBy = 'By.LINK_TEXT'
          break
        case 'css':
          appiumBy = 'By.CSS_SELECTOR'
          break
        case 'xpath':
          appiumBy = 'AppiumBy.XPATH'
          break
        default:
          throw new Error(`Unsupported selector type: ${selector.type}`)
      }

      return `(${appiumBy}, '${value}')`
    }

    const lines = []

    if (selectorConfigurations.length > 1) {
      lines.push(new Line(`${locatorVarName} = None`))
      selectorConfigurations.forEach((selectorConfiguration, index) => {
        const {selectors, device} = selectorConfiguration
        const {deviceName, platformVersion} = device || {}
        let ifStatement

        if (!device || index === selectorConfigurations.length - 1) {
          ifStatement = 'else:'
        }
        else if (index === 0) {
          ifStatement =
            `if '${deviceName}' == self._device_name and ` +
            `'${platformVersion}' == self._platform_version:`
        }
        else {
          ifStatement =
            `elif '${deviceName}' == self._device_name and ` +
            `'${platformVersion}' == self._platform_version:`
        }

        const locatorsStatements = selectors.map((selector) => getLocatorStatement({selector}))
        const branchOffset = index === 0 ? 0 : -1
        lines.push(new Line(ifStatement, branchOffset))
        lines.push(
          new Line(`${locatorVarName} = [${locatorsStatements.join(', ')}]`, 1)
        )
      })
      lines.push(new Line('', -1))
    }
    else if (selectorConfigurations.length === 1) {
      const {selectors} = selectorConfigurations[0]
      const locatorsStatements = selectors.map((selector) => getLocatorStatement({selector}))
      lines.push(new Line(`${locatorVarName} = [${locatorsStatements.join(', ')}]`))
    }

    return lines
  }

  _buildPythonCode(lines, initialIndent) {
    return buildCode({language: LANGUAGES.PYTHON, initialIndent, lines})
  }

  _getString(value) {
    let str
    if (isString(value)) {
      str = value
        .replace(/\\/g, '\\\\')
        .replace(/'/g, '\\\'')
    }
    else {
      str = value
    }
    return `'${str}'`
  }
}
