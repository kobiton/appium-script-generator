import BPromise from 'bluebird'
import canvas from 'canvas'
import axios from 'axios'
import path from 'path'
import get from 'lodash/get'
import flatten from 'lodash/flatten'
import isEmpty from 'lodash/isEmpty'
import {remote} from 'webdriverio'
import libxmljs from 'libxmljs'
import fs from 'fs'
import Utils from './utils'
import Proxy from './proxy'
import Rectangle from './rectangle'
import Point from './point'
import {Config} from '../config'
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

    this._proxy = new Proxy()
    await this._proxy.start()

    console.log(`Initialize Appium driver with desiredCaps: ${JSON.stringify(desiredCaps)}`)
    const url = new URL(this.getAppiumServerUrl())
    const options = {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname,
      port: url.port,
      user: Config.API_USERNAME,
      key: Config.API_KEY,
      desiredCapabilities: desiredCaps
    }

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
  }

  async switchToNativeContext() {
    const context = await this.getContext()
    if (NATIVE_CONTEXT === context) {
      this._currentContext = NATIVE_CONTEXT
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

  async switchToWebContextCore() {
    const contextInfos = []

    await this.switchToNativeContext()
    const source = await this._driver.getSource()
    const nativeDocument = this.loadXMLFromString(source)
    const nativeTexts = []
    let elements
    if (isEmpty(nativeDocument.find(this.getWebviewXpathSelector()))) {
      elements = nativeDocument.find('//*')
    }
    else {
      elements = nativeDocument.find(this.getWebviewXpathSelector() + '//*')
    }

    for (const element of elements) {
      if (element.childNodes().length !== 0) continue
      let textAttr
      if (this._isIos) {
        const excludeTags = ['XCUIElementTypeImage', 'XCUIElementTypeSwitch']
        if (excludeTags.includes(element.name())) continue

        textAttr = element.getAttribute('value')
        if (!textAttr || !textAttr.value()) {
          textAttr = element.getAttribute('label')
        }
      }
      else {
        textAttr = element.getAttribute('text')
        if ((!textAttr || !textAttr.value()) && element.name() === 'android.view.View') {
          textAttr = element.getAttribute('content-desc')
        }
      }

      let text = textAttr ? textAttr.value() : ''
      text = text.trim().toLowerCase()
      if (text) nativeTexts.push(text)
    }

    // Find the most webview is usable
    const contexts = await this.getContexts()
    const hasWebContext = contexts.some((context) => context !== NATIVE_CONTEXT)
    if (!hasWebContext) {
      throw new Error(`No web context is available, contexts: ${contexts.join(', ')}`)
    }

    for (const context of contexts) {
      if (!context.startsWith('WEBVIEW') && context !== 'CHROMIUM') continue
      let source = null
      try {
        await this.switchContext(context)
        const res = await this._driver.execute('return document.hidden')
        const isHiddenDocument = get(res, 'value')
        if (isHiddenDocument) continue
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
      const bodyElement = htmlDoc.get('//body')
      if (!bodyElement) continue

      let bodyString = Utils.getAllText(bodyElement)
      if (!bodyString) continue
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

    if (contextInfos.length !== 0) {
      contextInfos.sort((c1, c2) => c2.matchTextsPercent - c1.matchTextsPercent)

      let bestContextInfo
      if (contextInfos[0].matchTextsPercent > 40) {
        bestContextInfo = contextInfos[0]
      }
      else {
        contextInfos.sort((c1, c2) => c2.sourceLength - c1.sourceLength)
        bestContextInfo = contextInfos[0]
      }

      await this.switchContext(bestContextInfo.context)
      console.log(`Switched to ${bestContextInfo.context} web context successfully with confident ${bestContextInfo.matchTextsPercent}%`)
      return bestContextInfo.context
    }

    throw new Error('Cannot find any usable web contexts')
  }

  async switchToWebContext() {
    // Some web page is very slow to load (up to 30s),
    // and there is no web context until it finish loading
    return await Utils.retry(async (attempt) => {
      console.log(`Finding a web context attempt ${attempt}`)
      await this.switchToWebContextCore()
    }, null, 4, 10000)
  }

  async findWebElementRect(locators) {
    const webElement = await Utils.retry(async (attempt) => {
      console.log(`Finding web element rectangle attempt ${attempt} with locator: ${JSON.stringify(locators)}`)
      await this.switchToWebContext()
      return await this.findVisibleWebElement(locators)
    }, null, 3, 3000)

    await this.scrollToWebElement(webElement)
    const webElementRect = await this.getWebElementRect(webElement)
    return await this.calculateNativeRect(webElementRect)
  }

  async findWebElementRectOnScrollable(locators) {
    console.log(`Finding web element rectangle on scrollable with locator: ${JSON.stringify(locators)}`)
    const foundElement = await this.findElementOnScrollableInContext(true, locators)
    const webRect = await this.getWebElementRect(foundElement)
    return await this.calculateNativeRect(webRect)
  }

  async executeScriptOnWebElement(element, command) {
    const script = this.getResourceAsString('execute-script-on-web-element.js')
    const res = await this._driver.execute(script, element, command)
    return get(res, 'value')
  }

  async scrollToWebElement(element) {
    console.log(`Scroll to web element, ${JSON.stringify(element)}`)
    await this.executeScriptOnWebElement(element, 'scrollIntoView')
    await this.sleep(1000)
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
    try {
      await this.executeScriptOnWebElement(null, 'insertKobitonWebview')
      await this.switchToNativeContext()
      const kobitonWebview = this._isIos
        ? await this._findElement(null, "//*[@label='__kobiton_webview']")
        : await this._findElement(null, "//*[@text='__kobiton_webview']")
      const kobitonWebviewRect = await this.getRect(kobitonWebview)
      const nativeRect = new Rectangle({
        x: webElementRect.x + kobitonWebviewRect.x,
        y: webElementRect.y + kobitonWebviewRect.y,
        width: webElementRect.width,
        height: webElementRect.height,
      })

      const windowRectRes = await this.getWindowRect()
      const windowRect = new Rectangle({
        x: 0,
        y: 0,
        width: windowRectRes.width,
        height: windowRectRes.height,
      })
      this.cropRect(nativeRect, windowRect)
      return nativeRect
    }
    catch (err) {
      throw new Error(`Cannot calculate native rectangle for web element, error: ${err.message}`)
    }
  }

  async findElements(fromElement, timeout, multiple, locators) {
    console.log(`Find elements by locators: ${JSON.stringify(locators)}`)
    const notFoundMessage = `Cannot find elements by: ${JSON.stringify(locators)}`

    if (locators.length === 1) {
      await this.setImplicitWaitInMiliSecond(timeout)
      const elements = await this._findElements(null, locators[0])
      await this.setImplicitWaitInMiliSecond(Config.IMPLICIT_WAIT_IN_MS)

      if (multiple && !isEmpty(elements)) {
        return elements
      }
      else if (!multiple && elements.length === 1) {
        return elements
      }

      throw new Error(notFoundMessage)
    }
    else {
      const waitInterval = 5
      return await Utils.retry(async () => {
        await this.setImplicitWaitInMiliSecond(0)
        let elements
        for (const locator of locators) {
          try {
            elements = await this._findElements(null, locator)

            if (multiple && !isEmpty(elements)) {
              return elements
            }
            else if (!multiple && elements.length === 1) {
              return elements
            }
          }
          catch (ignored) {}
        }

        await this.setImplicitWaitInMiliSecond(Config.IMPLICIT_WAIT_IN_MS)
        throw new Error(notFoundMessage)
      }, null, timeout / (waitInterval * 1000), waitInterval * 1000)
    }
  }

  async findElementBy(timeout, locators) {
    const foundElements = await this.findElements(null, Math.max(Config.IMPLICIT_WAIT_IN_MS, timeout), false, locators)
    if (!foundElements || foundElements.length !== 1) {
      throw new Error(`Cannot find element by: ${JSON.stringify(locators)}`)
    }

    return foundElements[0]
  }

  async findElementsBy(timeout, locators) {
    return await this.findElements(null, Math.max(Config.IMPLICIT_WAIT_IN_MS, timeout), true, locators)
  }

  async findElementOnScrollableInContext(isWebContext, locators) {
    const infoMap = JSON.parse(this.getResourceAsString(`${this.getCurrentCommandId()}.json`))
    const screenSize = await this.getScreenSize()
    let scrollableElement = null
    let swipedToTop = false
    const touchableElement = await Utils.retry(async (attempt) => {
      if (isWebContext && attempt === 1) {
        await this.switchToWebContext()
      }

      let foundElement
      if (isWebContext) {
        foundElement = await this.findVisibleWebElement(locators)
        await this.scrollToWebElement(foundElement)
      }
      else {
        foundElement = await this.findElementBy(Config.IMPLICIT_WAIT_IN_MS, locators)
        const rect = await this.getRect(foundElement)
        const isVisible = (await this._driver.elementIdDisplayed(foundElement.ELEMENT)).value
        if (!isVisible || rect.x < 0 || rect.y < 0 || rect.width === 0 || rect.height === 0) {
          throw new Error("Element is found but is not visible")
        }
      }

      return foundElement
    }, async (err, attempt) => {
      console.log(`Cannot find touchable element on scrollable ${attempt} attempt, error: ${err.message}`)
      // Might switch to the wrong web context on the first attempt; retry before scrolling down
      if (isWebContext && attempt === 1) {
        // Wait a bit for web is fully loaded
        await this.sleep(10000)
        await this.switchToWebContext()
        return
      }

      if (scrollableElement === null) {
        scrollableElement = await this._findElement(null, infoMap['scrollableElementXpath'])
      }

      if (!swipedToTop) {
        await this.hideKeyboard()
        const scrollableRect = await this.getRect(scrollableElement)
        await this.swipeToTop(this.getCenterOfRect(scrollableRect))
        swipedToTop = true
      }
      else {
        const rect = await this.getRect(scrollableElement)
        const center = this.getCenterOfRect(rect)
        // Fix bug when scrollableElement is out of viewport
        if (center.y > screenSize.y || rect.height < 0) {
          center.y = screenSize.y / 2
        }

        const toPoint = new Point(center.x, Math.max(center.y - rect.height / 1.5, 0))
        await this.dragByPoint(center, toPoint)
      }
    }, 5, 3000)

    if (touchableElement === null) {
      throw new Error('Cannot find any element on scrollable parent')
    }

    return touchableElement
  }

  async findElementOnScrollable(locators) {
    return await this.findElementOnScrollableInContext(false, locators)
  }

  async findVisibleWebElement(locators) {
    console.log(`Finding visible web element with locators ${JSON.stringify(locators)}`)
    const foundElements = await this.findElementsBy(Config.IMPLICIT_WAIT_IN_MS, locators)

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

  getWebviewXpathSelector() {
    return this._isIos ? '(//XCUIElementTypeWebView)[1]' : '(//android.webkit.WebView)[1]'
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
  async touchOnElement(element, relativePointX, relativePointY) {
    if (await this.isButtonElement(element)) {
      await this.clickElement(element)
    }
    else {
      await this.touchAtRelativePointOfElement(element, relativePointX, relativePointY)
    }
  }

  /**
   * Click element (element need to be visible)
   */
  async clickElement(element) {
    console.log('Click on element')
    return this._driver.elementIdClick(element.ELEMENT)
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
  }

  async swipeToTop(fromPoint) {
    const toPoint = new Point(fromPoint.x, (await this.getScreenSize()).y - 10)
    console.log(`Swipe to top from point (${fromPoint.x}, ${fromPoint.y}) to point (${toPoint.x}, ${toPoint.y})`)
    await this.swipeByPoint(fromPoint, toPoint, 100)
  }

  async dragByPoint(fromPoint, toPoint) {
    const steps = 20
    const duration = 5000
    const stepDuration = duration / steps
    const xStep = (toPoint.x - fromPoint.x) / steps
    const yStep = (toPoint.y - fromPoint.y) / steps

    const actions = [
      {
        type: 'pointer',
        id: 'finger',
        parameters: { pointerType: 'touch' },
        actions: [
          {type: 'pointerMove', duration: 0, origin: 'viewport', x: fromPoint.x, y: fromPoint.y},
          {type: 'pointerDown', button: 0}
        ]
      }
    ]

    for (let i = 1; i <= steps; i++) {
      const nextX = fromPoint.x + Math.round(xStep * i)
      const nextY = fromPoint.y + Math.round(yStep * i)
      actions[0].actions.push({
        type: 'pointerMove',
        duration: stepDuration,
        origin: 'viewport',
        x: nextX,
        y: nextY
      })
    }

    actions[0].actions.push({type: 'pointerUp', button: 0})

    console.log(`Drag from point (${fromPoint.x}, ${fromPoint.y}) to point (${toPoint.x}, ${toPoint.y})`)
    await this._driver.actions(actions)
  }

  async dragFromPoint(fromPoint, relativeOffsetX, relativeOffsetY) {
    const screenSize = await this.getScreenSize()
    let toX = fromPoint.x + relativeOffsetX * screenSize.x
    let toY = fromPoint.y + relativeOffsetY * screenSize.y
    toX = Math.max(toX, 0)
    toY = Math.max(toY, 0)
    const toPoint = new Point(toX, toY)
    return await this.dragByPoint(fromPoint, toPoint)
  }

  async sendKeys(keys) {
    console.log(`Send keys: ${keys}`)
    await this.sleep(Config.SLEEP_TIME_BEFORE_SEND_KEYS_IN_MS)

    const chars = [...keys]
    const actions = flatten(chars.map((char) => [
      {type: 'keyDown', value: char},
      {type: 'keyUp', value: char}
    ]))

    await this._driver.actions([{type: 'key', id: 'keyboard', actions}])
  }

  async clearTextField(maxChars) {
    console.log(`Clear text field, maximum ${maxChars} characters`)
    await this.pressMultiple(PRESS_TYPES.DELETE, maxChars)
  }

  async press(type) {
    console.log(`Press on ${type} key`)

    switch (type) {
      case PRESS_TYPES.HOME:
        if (this._isIos) {
          let needPressHome = true
          try {
            // isLocked() and unlock() could failed on some devices
            const isLocked = (await this._driver.isLocked()).value
            if (isLocked === true) {
              await this._driver.unlock()
              needPressHome = false
            }
          }
          catch (err) {
            console.log(`Cannot check device locked or unlock device, error: ${err.message}`)
          }

          if (needPressHome) {
            await this._driver.execute('mobile: pressButton', {name: 'home'})
          }
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
        this._isIos ? await this.sendKeys('\n') : await this._driver.pressKeycode('66')
        break

      case PRESS_TYPES.DELETE:
        if (Config.DEVICE_SOURCE === DEVICE_SOURCES.KOBITON) {
          await this.sendKeys('\b')
        }
        else {
          await this.sendKeys(this._isIos ? '\b' : '\ue003')
        }
        break

      default:
        throw new Error(`Don't support press ${type} key`)
    }
  }

  async pressMultiple(type, count) {
    console.log(`Press on ${type} key ${count} times`)
    switch (type) {
      case PRESS_TYPES.DELETE:
        if (Config.DEVICE_SOURCE === DEVICE_SOURCES.KOBITON) {
          await this.sendKeys('\b'.repeat(count))
        }
        else {
          await this.sendKeys((this._isIos ? '\b' : '\ue003').repeat(count))
        }
        break

      default:
        for (let i = 0; i < count; ++i) {
          await this.press(type)
        }
    }
  }

  async hideKeyboard() {
    try {
      const isKeyboardShown = (await this._driver.isKeyboardShown()).value
      if (!isKeyboardShown) return

      console.log('Keyboard is shown, hiding it')
      await axios.post(
        `${this._proxy.getServerUrl()}/wd/hub/session/${this._driver.requestHandler.sessionID}/appium/device/hide_keyboard`
      )
    }
    catch (ignored) {}
  }

  async setImplicitWaitInMiliSecond(ms) {
    return await this._driver.timeouts({type: 'implicit', ms})
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

    return response.data.value
  }

  async getWindowRect() {
    const response = await axios.get(
      `${this._proxy.getServerUrl()}/wd/hub/session/${this._driver.requestHandler.sessionID}/window/rect`,
    )

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
      const rootElement = await this._findElement(null, '//XCUIElementTypeApplication | //XCUIElementTypeOther')
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
    const rectInJson = (await this._driver.elementIdRect(element.ELEMENT)).value
    return new Rectangle(rectInJson)
  }

  async getSize(element) {
    return (await this._driver.elementIdSize(element.ELEMENT)).value
  }

  async isButtonElement(element) {
    const tagName = (await this._driver.elementIdName(element.ELEMENT)).value
    return tagName && tagName.includes('Button')
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
    return libxmljs.parseXml(xmlString)
  }

  loadHtmlFromString(htmlString) {
    return libxmljs.parseHtml(htmlString)
  }

  getResourceAsString(resourceName) {
    const resourcePath = path.join(__dirname, '../..', 'resources', resourceName)
    return fs.readFileSync(resourcePath, 'utf8')
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

  getAppiumServerUrl() {
    if (Config.DEVICE_SOURCE === DEVICE_SOURCES.KOBITON) {
      return this._proxy.getServerUrl()
    } else {
      return Config.getAppiumServerUrlWithAuth()
    }
  }

  async getAvailableDevice(capabilities) {
    const deviceListUri = `${Config.KOBITON_API_URL}/v1/devices`
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
    if (Config.DEVICE_SOURCE !== DEVICE_SOURCES.KOBITON) {
      return null
    }

    let tryTime = 1
    let device = null
    const deviceName = get(capabilities, MOBILE_CAPABILITY_TYPES.DEVICE_NAME)
    const deviceGroup = get(capabilities, MOBILE_CAPABILITY_TYPES.DEVICE_GROUP)
    const platformVersion = get(capabilities, MOBILE_CAPABILITY_TYPES.PLATFORM_VERSION)
    const platformName = get(capabilities, MOBILE_CAPABILITY_TYPES.PLATFORM_NAME)

    while (tryTime <= Config.DEVICE_WAITING_MAX_TRY_TIMES) {
      console.log(`Is device with capabilities: (deviceName: ${deviceName}, deviceGroup: ${deviceGroup}, platformName: ${platformName}, platformVersion: ${platformVersion}) online? Retrying at ${Utils.convertToOrdinal(tryTime)} time`)

      device = await this.getAvailableDevice(capabilities)
      if (device !== null) {
        console.log(`Found an online device with capabilities: (deviceName: ${device.deviceName}, deviceGroup: ${deviceGroup}, platformName: ${device.platformName}, platformVersion: ${device.platformVersion})`)
        break
      }

      tryTime++
      await this.sleep(Config.DEVICE_WAITING_INTERVAL_IN_MS)
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
      `${Config.KOBITON_API_URL}/v1/app/versions/${appVersionId}/downloadUrl`,
      config
    )

    const {url} = JSON.stringify(body)
    return url
  }

  cropRect(rect, boundRect) {
    if (rect.x < boundRect.x) {
      rect.x = boundRect.x
    } else if (rect.x > boundRect.x + boundRect.width) {
      rect.x = boundRect.x + boundRect.width
    }

    if (rect.y < boundRect.y) {
      rect.y = boundRect.y
    } else if (rect.y > boundRect.y + boundRect.height) {
      rect.y = boundRect.y + boundRect.height
    }

    if (rect.x + rect.width > boundRect.x + boundRect.width) {
      rect.width = boundRect.x + boundRect.width - rect.x
    }

    if (rect.y + rect.height > boundRect.y + boundRect.height) {
      rect.height = boundRect.y + boundRect.height - rect.y
    }
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
      fs.mkdirSync(debugDir, {recursive: true})

      if (!source) {
        source = await this._driver.getSource()
      }

      fs.writeFileSync(path.join(debugDir, 'source.xml'), source, 'utf8')

      if (!screenshot) {
        screenshot = (await this._driver.screenshot()).value
      }

      fs.writeFileSync(path.join(debugDir, 'screenshot.png'), screenshot, {encoding: 'base64'})
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
    console.log(`Current command: ${currentCommandId}`)
    if (this._proxy != null) {
      this._proxy.currentCommandId = currentCommandId
    }
  }

  async _findElements(fromElement, locator) {
    let result
    if (fromElement) {
      result = await fromElement.$$(locator)
    }
    else {
      result = await this._driver.elements(locator)
    }

    result = result.value
    if (isEmpty(result)) {
      throw new Error(`Cannot find elements with with locator: ${locator}`)
    }

    return result
  }

  async _findElement(fromElement, locator) {
    let result
    if (fromElement) {
      result = await fromElement.$(locator)
    }
    else {
      result = await this._driver.element(locator)
    }

    result = result.value
    if (isEmpty(result)) {
      throw new Error(`Cannot find element with with locator: ${locator}`)
    }

    return result
  }
}
