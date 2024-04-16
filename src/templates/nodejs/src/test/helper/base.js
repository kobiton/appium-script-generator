import BPromise from 'bluebird'
import canvas from 'canvas'
import axios from 'axios'
import path from 'path'
import xPath from 'xpath'
import get from 'lodash/get'
import flatten from 'lodash/flatten'
import {remote} from 'webdriverio'
import {DOMParser} from '@xmldom/xmldom'
import Utils from './utils'
import Proxy from './proxy'
import Rectangle from './rectangle'
import Point from './point'
import Config from '../config'
import {DEVICE_SOURCES, PRESS_TYPES} from './constants'

const NATIVE_CONTEXT = 'NATIVE_APP'
const PLATFORM_NAMES = {
  IOS: 'IOS',
  ANDROID: 'ANDROID'
}
const MOBILE_CAPABILITY_TYPES = {
  PLATFORM_NAME: 'platformName',
  DEVICE_NAME: 'deviceName',
  PLATFORM_VERSION: 'platformVersion',
  DEVICE_GROUP: 'deviceGroup'
}

// Wait a bit for animation to complete
const SLEEP_AFTER_ACTION = 200
const fs = BPromise.promisifyAll(require('fs'))

export default class TestBase {
  constructor() {
    this._driver = null
    this._proxy = null
    this._isIos = false
    this._screenSize = null
    this._retinaScale = null
    this._deviceName = null
    this._platformVersion = null
    this._currentContext = null
  }

  async setup(desiredCaps, retinaScale) {
    this._retinaScale = retinaScale

    const platformName = get(desiredCaps, MOBILE_CAPABILITY_TYPES.PLATFORM_NAME, '')
    this._isIos = platformName.toUpperCase() === PLATFORM_NAMES.IOS
    this._deviceName = get(desiredCaps, MOBILE_CAPABILITY_TYPES.DEVICE_NAME, '')
    this._platformVersion = get(desiredCaps, MOBILE_CAPABILITY_TYPES.PLATFORM_NAME, '')

    if (Config.deviceSource === DEVICE_SOURCES.KOBITON) {
      this._proxy = new Proxy()
      await this._proxy.start()
    }

    console.log(`Initialize Appium driver with desiredCaps: ${JSON.stringify(desiredCaps)}`)
    const options = this._buildOptions(desiredCaps)
    this._driver = remote(options)

    return this._driver.init()
  }

  async cleanup() {
    if (this._driver) {
      await this._driver.end()
    }

    if (this._proxy) {
      this._proxy.stop()
    }
  }

  async switchContext(context) {
    if (this._currentContext === context) return

    console.log(`Switch to ${context} context`)
    await this._driver.context(context)
    this._currentContext = context
    await this.sleep(SLEEP_AFTER_ACTION)
  }

  async switchToNativeContext() {
    const context = await this.getContext()
    if (NATIVE_CONTEXT === context) {
      return
    }

    return this.switchContext(NATIVE_CONTEXT)
  }

  async getContext() {
    const response = await this._driver.context()
    return get(response, 'value')
  }

  async getContexts() {
    const response = await this._driver.contexts()
    return get(response, 'value')
  }

  async switchToWebContext() {
    for (let tryTime = 1; tryTime <= 3; tryTime++) {
      console.log(`Find a web context, ${Utils.convertToOrdinal(tryTime)} time`)
      const contextInfos = []

      await this.switchToNativeContext()
      const source = await this._driver.getSource()
      const nativeDocument = this.loadXMLFromString(source)
      const textNodeSelector = this._isIos
        ? '//XCUIElementTypeStaticText' : '//android.widget.TextView'
      const elements = this._getElementsInXmlDom(nativeDocument, textNodeSelector)

      const nativeTexts = []
      for (const element of elements) {
        let textAttr = (element.attributes[this._isIos ? 'value' : 'text'] || '')
        textAttr = textAttr.trim().toLowerCase()

        if (textAttr.length > 0) nativeTexts.push(textAttr)
      }

      // Find the most webview is usable
      const contexts = await this.getContexts()
      for (const context of contexts) {
        if (context.startsWith('WEBVIEW') || context === 'CHROMIUM') {
          let source = null
          try {
            await this.switchContext(context)
            source = await this._driver.getSource()
          }
          catch (error) {
            console.log(`Bad context ${context}, error "${error.message}", skipping...`)
            continue
          }

          if (source === null) continue

          let contextInfo = contextInfos.find(e => e.context === context)
          if (!contextInfo) {
            contextInfo = {
              context,
              sourceLength: source.length,
              matchTextsPercent: 0
            }

            contextInfos.push(contextInfo)
          }

          if (nativeTexts.length === 0) continue

          const htmlDoc = this.loadHtmlFromString(source)
          const bodyElements = htmlDoc.getElementsByTagName('body')
          if (bodyElements.length === 0) continue

          const bodyElement = bodyElements[0]
          let bodyString = (bodyElement.getAttribute('text') || '')

          if (bodyString.length === 0) continue
          bodyString = bodyString.toLowerCase()

          let matchTexts = 0
          for (const nativeText of nativeTexts) {
            if (bodyString.includes(nativeText)) matchTexts++
          }

          contextInfo.matchTexts = matchTexts
          contextInfo.matchTextsPercent = matchTexts * 100 / nativeTexts.length
          if (contextInfo.matchTextsPercent >= 80) {
            break
          }
        }
      }

      if (contextInfos.length !== 0) {
        contextInfos.sort((c1, c2) => c2.matchTextsPercent - c1.matchTextsPercent)

        let bestWebContext
        if (contextInfos[0].matchTextsPercent > 40) {
          bestWebContext = contextInfos[0].context
        }
        else {
          contextInfos.sort((c1, c2) => c2.sourceLength - c1.sourceLength)
          bestWebContext = contextInfos[0].context
        }

        await this.switchContext(bestWebContext)

        console.log(`Switched to ${bestWebContext} web context successfully`)
        return bestWebContext
      }

      await BPromise.delay(10000)
    }

    throw new Error('Cannot find any usable web contexts')
  }

  async findWebElementRect(isOnKeyboard, locators) {
    if (isOnKeyboard === false) {
      await this.hideKeyboard()
    }

    await this.switchToWebContext()
    const webElement = await this.findVisibleWebElement(locators)
    await this.scrollToWebElement(webElement)

    const webElementRect = await this.getWebElementRect(webElement)

    await this.switchToNativeContext()
    const rect = await this.calculateNativeRect(webElementRect)
    console.log(`Web element rectangle: ${JSON.stringify(rect)}`)

    return rect
  }

  async executeScriptOnWebElement(element, command) {
    const script = await this.getResourceAsString('execute-script-on-web-element.js')
    const res = await this._driver.execute(script, element, command)

    return get(res, 'value')
  }

  async scrollToWebElement(element) {
    console.log(`Scroll to web element, ${JSON.stringify(element)}`)
    await this.executeScriptOnWebElement(element, 'scrollIntoView')
    this.sleep(SLEEP_AFTER_ACTION)
  }

  async getWebElementRect(element) {
    const resultString = await this.executeScriptOnWebElement(element, 'getBoundingClientRect')
    const resultJson = JSON.parse(resultString)

    const height = resultJson.windowInnerHeight ? Math.min(resultJson.height, resultJson.windowInnerHeight) : resultJson.height
    return new Rectangle({
      x: Math.floor(resultJson.x / this._retinaScale),
      y: Math.floor(resultJson.y / this._retinaScale),
      height: Math.floor(height / this._retinaScale),
      width: Math.floor(resultJson.width / this._retinaScale)
    })
  }

  async calculateNativeRect(webElementRect) {
    const nativeWebElement = await this.findWebview()
    if (!nativeWebElement || !nativeWebElement.value) throw new Error('Cannot find any native webview')

    let nativeWebElementRect = await this.getRect(nativeWebElement)

    let topToolbarRect
    if (this._isIos) {
      try {
        topToolbar = await this.findElement(0,
          ["//*[@name='TopBrowserBar' or @name='topBrowserBar' or @name='TopBrowserToolbar' or child::XCUIElementTypeButton[@name='URL']]"]
        )

        topToolbarRect = await this.getRect(topToolbar)
      }
      catch (ignored) {
        // Try more chance by finding the TopBrowserBar in the xml source.
        const source = await this._driver.getSource()
        const nativeDocument = this.loadXMLFromString(source)

        const elementXMLNodes = xPath.select('//XCUIElementTypeWebView', nativeDocument)
        if (elementXMLNodes.length > 0) {
          const currentElementXMLNode = elementXMLNodes[0]

          let parentElementXMLNode = currentElementXMLNode.parentNode
          while (parentElementXMLNode) {
            let firstChildElementXMLNode
            // Get the first child element node has attributes
            for (let i = 0; i < parentElementXMLNode.childNodes.length; i++) {
              const child = parentElementXMLNode.childNodes[i]
              if (child.attributes) {
                firstChildElementXMLNode = child
                break
              }
            }

            if (!firstChildElementXMLNode) continue

            // Translate child's attributes array to an JSON object
            let attributes = {}
            for (let attribute of this._o2a(firstChildElementXMLNode.attributes) || []) {
              attributes[attribute.name] = attribute.value
            }

            const rect = new Rectangle({
              x: parseInt(attributes.x),
              y: parseInt(attributes.y),
              height: parseInt(attributes.height),
              width: parseInt(attributes.width)
            })

            if (!nativeWebElementRect.equals(rect) && nativeWebElementRect.includes(rect)) {
              topToolbarRect = rect
              break
            }

            parentElementXMLNode = parentElementXMLNode.parentNode
          }
        }
      }
    }

    let deltaHeight = 0
    let nativeWebElementTop = nativeWebElementRect.y

    // Adjust the nativeWebElementRect if there is a top toolbar
    if (topToolbarRect) {
      nativeWebElementTop = topToolbarRect.y + topToolbarRect.height
      deltaHeight = nativeWebElementTop - nativeWebElementRect.y
    }

    nativeWebElementRect = new Rectangle({
      x: nativeWebElementRect.x,
      y: nativeWebElementTop,
      height: nativeWebElementRect.height - deltaHeight,
      width: nativeWebElementRect.width
    })

    return new Rectangle({
      x: nativeWebElementRect.x + webElementRect.x,
      y: nativeWebElementRect.y + webElementRect.y,
      height: Math.min(webElementRect.height, nativeWebElementRect.height),
      width: Math.min(webElementRect.width, nativeWebElementRect.width)
    })
  }

  async findElement(timeout, locators) {
    console.log(`Find element by locators: ${JSON.stringify(locators)}`)

    for (const locator of locators) {
      try {
        await this._driver.waitForExist(locator, timeout)
        const element = await this._driver.element(locator)
        if (element !== null) return element
      }
      catch (ignored) {
      }
    }

    throw new Error(`Cannot find element by locators ${JSON.stringify(locators)}}`)
  }

  async findElements(locators) {
    console.log(`Find elements by locators: ${JSON.stringify(locators)}`)

    const result = []
    for (const locator of locators) {
      try {
        const response = await this._driver.elements(locator)
        if (!response || !response.value) continue

        const elements = response.value
        if (elements && elements.length > 0) {
          elements.forEach(element => {
            if (element) {
              const isExisting = result.find(e => e.ELEMENT === element.ELEMENT)
              !isExisting && result.push(element)
            }
          })
        }
      }
      catch (ignored) {
      }
    }

    return result
  }

  async findVisibleWebElement(locators) {
    console.log(`Finding visible web element with locators ${JSON.stringify(locators)}`)
    const foundElements = await this.findElements(locators)

    let visibleElement = null
    for (const element of foundElements) {
      const isElementVisible = await this.executeScriptOnWebElement(element, 'isElementVisible')
      if (isElementVisible === 'true') {
        visibleElement = element
        break
      }
    }

    if (!visibleElement) {
      throw new Error('Cannot find visible web element')
    }

    return visibleElement
  }

  async findWebview() {
    const xpathSelector = this._isIos ? '//XCUIElementTypeWebView' : '//android.webkit.WebView'
    await this._driver.waitForExist(xpathSelector, Config.explicitWaitInMs)
    return this._driver.element(xpathSelector)
  }

  /**
   * Touch at center of element (element need to be visible)
   */
  async touchAtCenterOfElement(element) {
    console.log(`Touch at center of element`)

    const centerPoint = element.rect.getCenterPoint()
    return this.touchAtPoint(centerPoint)
  }

  /**
   * Handle event touch element
   */
  async touchOnElementByType(element, relativePointX, relativePointY) {
    await this.touchAtRelativePointOfElement(element, relativePointX, relativePointY)
  }

  /**
   * Click element (element need to be visible)
   */
  async clickElement(element) {
    console.log(`Click on element with type`)
    return this._driver.elementIdClick(element.getId())
  }

  /**
   * Touch at relative point of element (element need to be visible)
   */
  async touchAtRelativePointOfElement(element, relativePointX, relativePointY) {
    console.log(`Touch on element at relative point (${relativePointX}, ${relativePointY})`)

    const absolutePoint = await this.getAbsolutePointOfRect(
      relativePointX, relativePointY, await this.getRect(element))
    return this.touchAtPoint(absolutePoint)
  }

  /**
   * Touch at a relative position
   */
  async touchAtRelativePoint(relativePointX, relativePointY) {
    console.log(`Touch at relative point (${relativePointX}, ${relativePointY})`)

    const absolutePoint = await this.getAbsolutePoint(relativePointX, relativePointY)
    return this.touchAtPoint(absolutePoint)
  }

  /**
   * Touch at a Point
   */
  async touchAtPoint(point) {
    console.log(`Touch at point (${point.x}, ${point.y})`)

    const touchPerformSteps = [
      {action: 'tap', options: point}
    ]

    await this._driver.touchPerform(touchPerformSteps)
    await this.sleep(SLEEP_AFTER_ACTION)
  }

  /**
   * Swipe from Point to Point (with accelerate)
   */
  async swipeByPoint(fromPoint, toPoint, durationInMs) {
    console.log(`Swipe from point (${fromPoint.x}, ${fromPoint.y}) to point (${toPoint.x}, ${toPoint.y}) with duration ${durationInMs}`)

    await this._driver.touchPerform([
      {action: 'press', options: fromPoint},
      {action: 'moveTo', options: toPoint},
      {action: 'wait', options: {ms: durationInMs}},
      {action: 'release'}
    ])

    // Animation on iOS could be longer
    await this.sleep(this._isIos ? 3000 : SLEEP_AFTER_ACTION)
  }

  async sendKeys(keys) {
    await this.sleep(Config.sleepBeforeSendingKeysInMs)

    console.log(`Send keys: ${keys}`)

    if (this._isIos) {
      await this._driver.keys(keys)
    }
    // Use POST /actions api for Android
    else {
      const chars = [...keys]
      const actions = flatten(chars.map((char) => [
        {type: 'keyDown', value: char},
        {type: 'keyUp', value: char}
      ]))

      await this._driver.actions([{type: 'key', id: 'keyboard', actions}])
    }

    await this.sleep(SLEEP_AFTER_ACTION)
  }

  async clearTextField(maxChars) {
    console.log(`Clear text field, maximum ${maxChars} characters`)

    for (let i = 0; i < maxChars; i++) {
      await this.press(PRESS_TYPES.DELETE)
    }
  }

  async press(type) {
    console.log(`Press on ${type} key`)

    switch (type) {
      case PRESS_TYPES.HOME:
        if (this._isIos) {
          const isLocked = (await this._driver.isLocked()).value
          isLocked === true && await this._driver.unlock()

          await this._driver.execute('mobile: pressButton', {name: 'home'})
        }
        else {
          await this._driver.pressKeycode('3')
        }
        break

      case PRESS_TYPES.BACK:
        await this._driver.pressKeycode('4')
        break

      case PRESS_TYPES.POWER:
        if (this._isIos) {
          const isLocked = (await this._driver.isLocked()).value
          isLocked === true
            ? await this._driver.unlock() : await this._driver.lock()
        }
        else {
          await this._driver.pressKeycode('26')
        }
        break

      case PRESS_TYPES.APP_SWITCH:
        await this._driver.pressKeycode('187')
        break

      case PRESS_TYPES.ENTER:
        this._isIos ? await this._driver.keys('\n') : await this._driver.pressKeycode('66')
        break

      case PRESS_TYPES.DELETE:
        this._isIos ? await this._driver.keys('\b') : await this._driver.pressKeycode('67')
        break

      default:
        throw new Error(`Don't support press ${type} key`)
    }

    await this.sleep(SLEEP_AFTER_ACTION)
  }

  async hideKeyboard() {
    try {
      const isKeyboardShown = (await this._driver.isKeyboardShown()).value
      if (!isKeyboardShown) return

      console.log('Keyboard is shown, hiding it')
      await this._driver.hideKeyboard()
      await this.sleep(SLEEP_AFTER_ACTION)
    }
    catch (ignored) {
    }
  }

  setImplicitWaitInMiliSecond(ms) {
    return this._driver.timeouts({type: 'implicit', ms})
  }

  async updateSettings() {
    const settings = this._isIos ? {shouldUseCompactResponses: false} : {ignoreUnimportantViews: true}
    return this._driver.settings(settings)
  }

  async activateApp(appId) {
    const response = await axios.post(
      `${this._proxy.getServerUrl()}/wd/hub/session/${this._driver.requestHandler.sessionID}/appium/device/activate_app`,
      {bundleId: appId}
    )

    await this.sleep(SLEEP_AFTER_ACTION)
    return response.data.value
  }

  async getScreenSize() {
    if (this._screenSize == null) {
      const screenshot = (await this._driver.screenshot()).value
      const screenshotBytes = Buffer.from(screenshot, 'base64')
      const image = await canvas.loadImage(screenshotBytes)
      const {width, height} = image

      this._screenSize = new Point(width, height)
    }

    return this._screenSize
  }

  async getAppOffset() {
    if (!this._isIos) return new Point(0, 0)

    try {
      const rootElement = await this._driver.element(
        '//XCUIElementTypeApplication | //XCUIElementTypeOther')
      const rootElementSize = await this.getSize(rootElement)
      const screenSize = await this.getScreenSize()
      const screenWidthScaled = screenSize.x / this._retinaScale
      const screenHeightScaled = screenSize.y / this._retinaScale

      let offsetX = 0
      let offsetY = 0
      if (screenWidthScaled > rootElementSize.width) {
        offsetX = Math.floor((screenWidthScaled - rootElementSize.width) / 2)
      }

      if (screenHeightScaled > rootElementSize.height) {
        offsetY = Math.floor((screenHeightScaled - rootElementSize.height) / 2)
      }

      return new Point(offsetX, offsetY)
    }
    catch (error) {
      console.error(error)
      return new Point(0, 0)
    }
  }

  async getRect(element) {
    console.log(`Get rect of element: ${JSON.stringify(element)}`)
    const rectInJson = (await this._driver.elementIdRect(element.value.ELEMENT)).value
    return new Rectangle(rectInJson)
  }

  async getSize(element) {
    return (await this._driver.elementIdSize(element.value.ELEMENT)).value
  }

  async getAbsolutePoint(relativePointX, relativePointY) {
    const screenSize = await this.getScreenSize()

    if (this._retinaScale > 1) {
      return new Point(
        Math.round(relativePointX * screenSize.x / this._retinaScale),
        Math.round(relativePointY * screenSize.y / this._retinaScale)
      )
    }

    return new Point(
      Math.round(relativePointX * screenSize.x),
      Math.round(relativePointY * screenSize.y)
    )
  }

  async getAbsolutePointOfRect(relativePointX, relativePointY, rect) {
    const appOffset = await this.getAppOffset()
    const x = rect.x + rect.width * relativePointX + appOffset.x
    const y = rect.y + rect.height * relativePointY + appOffset.y

    return new Point(Math.round(x), Math.round(y))
  }

  async sleep(durationInMs) {
    console.log(`Waiting ${durationInMs}ms`)
    return BPromise.delay(durationInMs)
  }

  loadXMLFromString(xmlString) {
    return (new DOMParser()).parseFromString(xmlString, 'text/xml')
  }

  loadHtmlFromString(htmlString) {
    return (new DOMParser()).parseFromString(htmlString, 'text/html')
  }

  async getResourceAsString(resourceName) {
    const resourcePath = path.join(__dirname, '../..', 'resources', resourceName)
    return Utils.readFile(resourcePath, 'utf8')
  }

  compareNodes(expected, actual) {
    if (expected.getName() !== actual.getName()) {
      return false
    }

    const compareAttrs = [
      'label',
      'text',
      'visible',
      'class',
      'name',
      'type',
      'resource-id',
      'content-desc',
      'accessibility-id'
    ]
    for (const attrName of compareAttrs) {
      let v1 = null
      let v2 = null

      try {
        v1 = expected.attributeValue(attrName)
        v2 = actual.attributeValue(attrName)
      }
      catch (ignored) {}

      if (v1 !== null && v2 !== null && v1 !== '' && v2 !== '' && v1 !== v2) {
        return false
      }
    }

    if (expected.elements().size() !== actual.elements().size()) {
      return false
    }

    for (let i = 0; i < expected.elements().size(); i++) {
      const expectedChild = expected.elements().get(i)
      const actualChild = actual.elements().get(i)

      const isEqual = this.compareNodes(expectedChild, actualChild)
      if (!isEqual) {
        return false
      }
    }

    return true
  }

  getCenterOfRect(rect) {
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2
    }
  }

  async getAvailableDevice(capabilities) {
    const deviceListUri = `${Config.kobitonApiUrl}/v1/devices`
    const params = {
      isOnline: true,
      isBooked: false,
      deviceName: get(capabilities, 'deviceName'),
      platformVersion: get(capabilities, 'platformVersion'),
      platformName: get(capabilities, 'platformName'),
      deviceGroup: get(capabilities, 'deviceGroup')
    }

    const config = {
      headers: {
        Authorization: Config.getBasicAuthString()
      },
      params
    }

    try {
      const response = await axios.get(deviceListUri, config)
      if (!Utils.isStatusCodeSuccess(response.status)) {
        throw new Error(response.data)
      }

      const deviceListResponse = response.data
      const deviceList = [...deviceListResponse.cloudDevices, ...deviceListResponse.privateDevices]

      if (deviceList.length === 0) {
        return null
      }

      return deviceList[0]
    }
    catch (error) {
      throw new Error(error)
    }
  }

  async findOnlineDevice(capabilities) {
    if (Config.deviceSource !== DEVICE_SOURCES.KOBITON) {
      return null
    }

    let tryTime = 1
    let device = null
    const deviceName = get(capabilities, MOBILE_CAPABILITY_TYPES.DEVICE_NAME)
    const deviceGroup = get(capabilities, MOBILE_CAPABILITY_TYPES.DEVICE_GROUP)
    const platformVersion = get(capabilities, MOBILE_CAPABILITY_TYPES.PLATFORM_VERSION)
    const platformName = get(capabilities, MOBILE_CAPABILITY_TYPES.PLATFORM_NAME)

    while (tryTime <= Config.deviceWaitingMaxTryTimes) {
      console.log(`Is device with capabilities: (deviceName: ${deviceName}, deviceGroup: ${deviceGroup}, platformName: ${platformName}, platformVersion: ${platformVersion}) online? Retrying at ${Utils.convertToOrdinal(tryTime)} time`)

      device = await this.getAvailableDevice(capabilities)
      if (device !== null) {
        console.log(`Found an online device with capabilities: (deviceName: ${device.deviceName}, deviceGroup: ${deviceGroup}, platformName: ${device.platformName}, platformVersion: ${device.platformVersion})`)
        break
      }

      tryTime++
      await this.sleep(Config.deviceWaitingIntervalInMs)
    }

    if (device === null) {
      throw new Error(`Cannot find any online devices with capabilities: (deviceName: ${deviceName}, deviceGroup: ${deviceGroup}, platformName: ${platformName}, platformVersion: ${platformVersion})`)
    }

    return device
  }

  async getAppUrl(appVersionId) {
    const config = {
      headers: {
        Authorization: Config.getBasicAuthString(),
        'Content-Type': 'application/json'
      }
    }

    const {body} = await axios.get(
      `${Config.kobitonApiUrl}/v1/app/versions/${appVersionId}/downloadUrl`,
      config
    )

    const {url} = JSON.stringify(body)
    return url
  }

  async saveDebugResource(options = {}) {
    let {source, screenshot} = options

    try {
      const currentContext = await this.getContext()
      console.log(`Current context: ${currentContext}`)

      const rootDir = process.cwd()
      const debugDirName = `${this._deviceName} ${this._platformVersion}`.replace(/[^a-zA-Z0-9]/g, '_')
      const debugDir = path.join(rootDir, 'debug', debugDirName)

      console.log(`Save source & screenshot for debugging at ${debugDir}`)
      await fs.mkdirAsync(debugDir, {recursive: true})

      if (!source) {
        source = await this._driver.getSource()
      }

      await fs.writeFileAsync(path.join(debugDir, 'source.xml'), source, 'utf8')

      if (!screenshot) {
        screenshot = (await this._driver.screenshot()).value
      }

      await fs.writeFileAsync(
        path.join(debugDir, 'screenshot.png'), screenshot, {encoding: 'base64'})
    }
    catch (error) {
      console.error(error)
    }
  }

  getCurrentCommandId() {
    return this._proxy != null ? this._proxy.currentCommandId : 0
  }

  getKobitonSessionId() {
    return this._proxy != null ? this._proxy.kobitonSessionId : 0
  }

  setCurrentCommandId(currentCommandId) {
    if (this._proxy != null) {
      this._proxy.currentCommandId = currentCommandId
    }
  }

  _buildOptions(desiredCaps) {
    const options = {
      protocol: 'http',
      host: 'localhost',
      port: this._proxy.listeningPort,
      user: Config.kobitonUsername,
      key: Config.kobitonApiKey,
      desiredCapabilities: desiredCaps
    }

    return options
  }

  _getElementsInXmlDom(xmlDom, selector) {
    const elementXMLNodes = xPath.select(selector, xmlDom)
    const elements = elementXMLNodes
      .map((node) => this._parseXmlNode(xmlDom, this._retinaScale, node))
      .filter((element) => !!element)

    return elements
  }

  _parseXmlNode(xmlDOM, xmlScaled, xmlNode) {
    const recursive = (dom, scale, node, nodeLevel) => {

      // Translate attributes array to an object
      let attributes = {}
      for (let attribute of this._o2a(node.attributes) || []) {
        attributes[attribute.name] = attribute.value
      }

      attributes['xpath'] = this._getAbsoluteXPath(dom, node)
      const level = nodeLevel !== undefined ? nodeLevel + 1 : 0

      return {
        children: [...this._o2a(node.childNodes)]
          .filter((childNode) => !!childNode.tagName &&
            !UNUSED_TAG_NAMES.includes(childNode.tagName))
          .map((childNode, childIndex) => recursive(dom, scale, childNode, level)),
        tagName: node.tagName,
        attributes,
        level,
        rect: new Rectangle({...attributes, scale})
      }
    }

    const element = recursive(xmlDOM, xmlScaled, xmlNode)
    return element
  }

  _o2a(o) {
    const result = []
    for (let key in o) {
      if (o.hasOwnProperty(key)) {
        const n = Number(key)
        if (!isNaN(n)) {
          result[n] = o[key]
        }
      }
    }

    return result
  }

  /**
   * Get the absolute XPath for a DOMNode
   * @param {*} domNode {DOMNode}
   */
  _getAbsoluteXPath(doc, domNode) {
    try {
      // If this isn't an element, we're above the root, return empty string
      if (!domNode.tagName || domNode.nodeType !== 1) {
        return ''
      }

      // Get the relative xpath of this node using tagName
      let xpath = `/${domNode.tagName}`

      // If this node has siblings of the same tagName, get the index of this node
      if (domNode.parentNode) {
        // Get the siblings
        const childNodes = Array.prototype.slice
          .call(domNode.parentNode.childNodes, 0)
          .filter((childNode) => (
            childNode.nodeType === 1 && childNode.tagName === domNode.tagName
          ))

        // If there's more than one sibling, append the index
        if (childNodes.length > 1) {
          let index = childNodes.indexOf(domNode)
          xpath += `[${index + 1}]`
        }
      }

      // Make a recursive call to this nodes parents and prepend it to this xpath
      return this._getAbsoluteXPath(doc, domNode.parentNode) + xpath
    }
    catch (ign) {
      // If there's an unexpected exception, abort and don't get an XPath
      return null
    }
  }
}
