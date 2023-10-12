import keyMirror from 'keymirror'
import xmlParser from './xml-parser'
import get from 'lodash/get'
import set from 'lodash/set'
import toLower from 'lodash/toLower'
import isString from 'lodash/isString'

// Defines an ELEMENT_TYPES enum, with keys and values are the same.
export const ELEMENT_TYPES = keyMirror({
  SCROLLABLE: null,
  WEB_VIEW: null
})

const SCROLLABLE_CLASS_NAMES_ANDROID = [
  'android.widget.ListView',
  'android.widget.GridView',
  'android.widget.Spinner',
  'android.widget.ScrollView',
  'android.widget.HorizontalScrollView',
  'android.webkit.WebView',
  'android.support.v7.widget.RecyclerView',
  'androidx.recyclerview.widget.RecyclerView',
  'android.support.v4.view.ViewPager',
  'androidx.viewpager.widget.ViewPager'
]

const SCROLLABLE_CLASS_NAMES_IOS = [
  'XCUIElementTypeCollectionView',
  'XCUIElementTypeScrollView',
  'XCUIElementTypeTable',
  'XCUIElementTypeWebView'
]

const WEB_VIEW_CLASS_NAMES_ANDROID = [
  'android.webkit.WebView'
]

const WEB_VIEW_CLASS_NAMES_IOS = [
  'XCUIElementTypeWebView'
]

/**
 * Checks whether the specified DOM element is of the specified type.
 * @param {DOMElement} domElement - The DOM element to check.
 * @param {string} type - The type of element to check for.
 * @param {boolean} isAndroid - Whether the element is on an Android device or not.
 * @returns {boolean} True if the element is of the specified type, false otherwise.
 */
export function isElementType(domElement, type, isAndroid) {
  return isAndroid
    ? _checkAndroidElementType(domElement, type)
    : _checkIosElementType(domElement, type)
}

/**
 * Checks whether the specified DOM element is of the specified type on an Android device.
 * @param {DOMElement} domElement - The DOM element to check.
 * @param {string} type - The type of element to check for.
 * @returns {boolean} True if the element is of the specified type, false otherwise.
 */
function _checkAndroidElementType(domElement, type) {
  const tagName = domElement.tagName

  switch (type) {
    case ELEMENT_TYPES.SCROLLABLE:
      return SCROLLABLE_CLASS_NAMES_ANDROID.includes(tagName) ||
        _getBoolAttr(domElement, 'scrollable')
    case ELEMENT_TYPES.WEB_VIEW:
      return WEB_VIEW_CLASS_NAMES_ANDROID.includes(tagName)
  }

  return false
}

/**
 * Checks whether the specified DOM element is of the specified type on an iOS device.
 * @param {DOMElement} domElement - The DOM element to check.
 * @param {string} type - The type of element to check for.
 * @returns {boolean} True if the element is of the specified type, false otherwise.
 */
function _checkIosElementType(domElement, type) {
  const tagName = domElement.tagName
  const visible = _getBoolAttr(domElement, 'visible')

  switch (type) {
    case ELEMENT_TYPES.SCROLLABLE:
      return visible && SCROLLABLE_CLASS_NAMES_IOS.includes(tagName)
    case ELEMENT_TYPES.WEB_VIEW:
      return WEB_VIEW_CLASS_NAMES_IOS.includes(tagName)
  }

  return false
}

/**
 * Finds the parent element of the specified DOM element that matches the specified element type.
 * @param {DOMElement} domElement - The DOM element to start searching from.
 * @param {string} elementType - The type of element to search for.
 * @param {string} platformName - The name of the platform (e.g. "android", "ios").
 * @returns {DOMElement|null} The parent element that matches the specified element type,
 * or null if not found.
 */
export function findParentElement(domElement, elementType, platformName) {
  let parentNode = domElement.parentNode
  let foundElement = null
  while (parentNode && parentNode.tagName && parentNode.nodeType === 1) {
    if (isElementType(parentNode, elementType, platformName)) {
      foundElement = parentNode
      break
    }

    parentNode = parentNode.parentNode
  }

  return foundElement
}

/**
 * Gets an XPath selector for the specified XML element based on its tag name.
 * @param {Element} xmlElement - The XML element to get the selector for.
 * @param {Document} xmlDom - The XML document containing the element.
 * @returns {string} An XPath selector for the element.
 */
export function getXpathSelectorByTagName(xmlElement, xmlDom) {
  const xmlElementXpath = xmlParser.getAbsoluteXPath(xmlDom, xmlElement)
  const elementsByTagName = xmlDom.getElementsByTagName(xmlElement.tagName)
  const parentElement =
    findParentElementOfAll(Array.from(elementsByTagName), xmlDom, ['x', 'y', 'width', 'height'])

  let nth = 1
  for (let i = 0; i < elementsByTagName.length; i++) {
    const element = elementsByTagName[i]
    const elementXpath = xmlParser.getAbsoluteXPath(xmlDom, element)
    if (xmlElementXpath === elementXpath) {
      if (parentElement) {
        return `//${xmlElement.tagName}`
      }
      else {
        return `//${xmlElement.tagName}[${nth}]`
      }
    }

    nth++
  }
}

/**
 * Finds the parent element that contains all of the specified child elements.
 * @param {Element[]} elements - An array of child elements to search for.
 * @param {Document} xmlDom - The XML document containing the elements.
 * @param {string[]} matchAttrs - An array of attribute names to match when comparing elements.
 * @returns {Element|null} The parent element that contains all of the specified child elements,
 * or null if not found.
 */
export function findParentElementOfAll(elements, xmlDom, matchAttrs = []) {
  for (const element of elements) {
    set(element, 'attributes.xpath', xmlParser.getAbsoluteXPath(xmlDom, element))
  }

  return elements.find((element) => {
    const elementXpath = get(element, 'attributes.xpath')
    if (!elementXpath) return false

    return elements.every((item) => {
      if (elementXpath === get(item, 'attributes.xpath')) return true

      for (const attr of matchAttrs) {
        const elementAttrValue = element.getAttribute(attr)
        if (elementAttrValue && elementAttrValue !== item.getAttribute(attr)) return false
      }

      return xmlParser.hasParentalRelation({parent: element, child: item})
    })
  })
}

/**
 * Gets the boolean value of the specified attribute on the specified DOM element.
 * @param {DOMElement} domElement - The DOM element to get the attribute value from.
 * @param {string} attrName - The name of the attribute to get the value of.
 * @returns {boolean|null} The boolean value of the attribute, or null if the attribute
 * is not present.
 */
function _getBoolAttr(domElement, attrName) {
  let attrValue = domElement.getAttribute(attrName)
  if (isString(attrValue)) {
    attrValue = toLower(attrValue) === 'true'
  }

  return attrValue
}
