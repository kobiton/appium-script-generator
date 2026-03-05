import BPromise from 'bluebird'
import path from 'path'
import {URL} from 'url'
import get from 'lodash/get'
import snakeCase from 'lodash/snakeCase'
import {DEVICE_SOURCES, CONTEXTS, LANGUAGES} from './constant'
import {buildCode, Line} from '../models/line'
import compress from '../utils/compress'
import {readFile, writeFile, createDir} from '../utils/fs-wrapper'
import {BaseAppiumScriptGenerator} from './base'

const LOCATOR_VAR_NAME_PREFIX = 'locator'
const ncpAsync = BPromise.promisify(require('ncp').ncp)

/**
 * Generates Python pytest code for Appium scripts.
 */
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

    const testCaseLines = this._generateTestCaseLines({devices})

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
        suffix: 'desired_capabilities',
        varNames: desiredCapsMethodNames
      })

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
        if (typeof parsedValue === 'string') {
          statement = `'${key}': '${parsedValue}'${suffix}`
        }
        else {
          statement = `'${key}': ${parsedValue}${suffix}`
        }
        lines.push(new Line(statement, index === 0 ? 1 : 0))
      })

      lines.push(new Line('}', -1))
    }

    return lines
  }

  _generateTestCaseLines({devices}) {
    const lines = []
    const desiredCapsMethodNames = new Set()

    for (const device of devices) {
      const {name: deviceName, capabilities: deviceCaps} = device
      const desiredCapsMethodName = this._getVarName({
        name: [
          deviceName,
          get(device, 'capabilities.platformName'),
          get(device, 'capabilities.platformVersion')
        ].join('_'),
        fallbackName: device.id.toString(),
        prefix: 'get',
        suffix: 'desired_capabilities',
        varNames: desiredCapsMethodNames
      })

      const retinaScale = get(deviceCaps, 'resolution.scale') || 1
      const testFnName = snakeCase(
        `test ${deviceName} ${get(device, 'capabilities.platformName')} ${get(device, 'capabilities.platformVersion')}`
      )
      const testDescription = `Run test on ${deviceName} - ${get(device, 'capabilities.platformName')} ${get(device, 'capabilities.platformVersion')}`

      lines.push(...[
        new Line(`def ${testFnName}():`),
        new Line(`"""${testDescription}"""`, 1),
        new Line('automation_helper = None'),
        new Line('error = None'),
        new Line(''),
        new Line('try:'),
        new Line('automation_helper = TestApp()', 1),
        new Line(`capabilities = Config.${desiredCapsMethodName}()`),
        new Line('automation_helper.find_online_device(capabilities)'),
        new Line(`automation_helper.setup(capabilities, ${retinaScale})`),
        new Line('automation_helper.run()'),
        new Line('except Exception as err:', -1),
        new Line('import traceback', 1),
        new Line('traceback.print_exc()'),
        new Line('error = err'),
        new Line('if automation_helper:'),
        new Line('automation_helper.save_debug_resource()', 1),
        new Line('finally:', -1),
        new Line('if automation_helper:', 1),
        new Line('automation_helper.cleanup()', 1),
        new Line('', -1),
        new Line('assert error is None, f"Test case has error: {error}"', -1)
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
          lines.push(new Line(`${elementVarName} = self.find_visible_element(${findingElementTimeout}, ${locatorVarName})`))
          lines.push(new Line(`self.touch_on_element(${elementVarName}, ${x}, ${y})`))
        } break

        case 'touchOnScrollableParent': {
          const {elementInfo, x, y} = action
          resourceFiles[`${id}.json`] = JSON.stringify(elementInfo)
          !isOnKeyboard && lines.push(new Line('self.hide_keyboard()'))
          const elementVarName = `element${rawLocatorVarName}`
          lines.push(new Line(`${elementVarName} = self.find_visible_element_on_scrollable(${findingElementTimeout}, ${locatorVarName})`))
          lines.push(new Line(`self.touch_on_element(${elementVarName}, ${x}, ${y})`))
        } break

        case 'touchAtPoint': {
          const {x, y} = action
          lines.push(new Line(`self.touch_at_relative_point(${x}, ${y})`))
        } break

        case 'swipeFromElement': {
          const {x1, y1, x2, y2, duration} = action
          lines.push(new Line(`self.swipe(${x1}, ${y1}, ${x2}, ${y2}, ${duration || 800})`))
        } break

        case 'pressButton': {
          const {buttonType} = action
          lines.push(new Line(`self.press_button('${buttonType}')`))
        } break

        case 'setText': {
          const {text} = action
          const elementVarName = `element${rawLocatorVarName}`
          lines.push(new Line(`${elementVarName} = self.find_visible_element(${findingElementTimeout}, ${locatorVarName})`))
          lines.push(new Line(`self.send_keys(${elementVarName}, '${text}')`))
        } break

        case 'idle': {
          lines.push(new Line('self.idle()'))
        } break

        default:
          break
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
    const outputDir = path.join(workingDir, 'python')

    await createDir(outputDir)
    await ncpAsync(templateDir, outputDir)

    const {portalUrl, kobitonApiUrl, appiumServerUrl, username} = serverInfo

    const configPath = path.join(outputDir, 'config.py')
    let configContent = await readFile(configPath, 'utf8')
    const desiredCapsCode = buildCode(desiredCapsMethodLines, 4)
    configContent = configContent.replace('    #{{desiredCaps}}', desiredCapsCode)
    configContent = configContent.replace('{{username}}', username || '')
    configContent = configContent.replace('{{appiumServerUrl}}', appiumServerUrl || '')
    configContent = configContent.replace('{{kobitonApiUrl}}', kobitonApiUrl || '')
    await writeFile(configPath, configContent)

    const testAppPath = path.join(outputDir, 'test_app.py')
    let testAppContent = await readFile(testAppPath, 'utf8')
    const testScriptCode = buildCode(testScriptLines, 8)
    testAppContent = testAppContent.replace('        {{testScript}}', testScriptCode || '        pass')
    await writeFile(testAppPath, testAppContent)

    const testSuitePath = path.join(outputDir, 'test_suite.py')
    let testSuiteContent = await readFile(testSuitePath, 'utf8')
    const testCasesCode = buildCode(testCaseLines, 0)
    testSuiteContent = testSuiteContent.replace('{{testCases}}', testCasesCode)
    await writeFile(testSuitePath, testSuiteContent)

    const readmePath = path.join(outputDir, 'README.md')
    let readmeContent = await readFile(readmePath, 'utf8')
    readmeContent = readmeContent.replace(/\{\{portalUrl\}\}/g, portalUrl || '')
    readmeContent = readmeContent.replace(/\{\{manualSessionId\}\}/g, manualSessionId || '')
    await writeFile(readmePath, readmeContent)

    for (const [filename, content] of Object.entries(resourceFiles)) {
      await writeFile(path.join(outputDir, filename), content)
    }

    const outputFile = path.join(workingDir, 'python.zip')
    await compress(outputDir, outputFile)

    return outputFile
  }
}
