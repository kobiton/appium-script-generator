import xPath from 'xpath'
import {DOMParser} from '@xmldom/xmldom'
import get from 'lodash/get'
import isString from 'lodash/isString'

/**
 * A utility class for parsing and manipulating XML documents.
 */
class XMLParser {
  /**
   * Parses the specified XML string into an XML document.
   * @param {string} xmlString - The XML string to parse.
   * @returns {Document} The parsed XML document.
   */
  parse(xmlString) {
    const formattedXmlString = this._formatXmlSource(xmlString)
    const xmlDOM = (new DOMParser()).parseFromString(formattedXmlString, 'text/xml')
    return xmlDOM
  }

  /**
   * Gets the first element in the specified XML document that matches the specified XPath selector.
   * @param {string} xpath - The XPath selector to search for.
   * @param {Document} xmlDOM - The XML document to search in.
   * @returns {DOMElement|null} The first element that matches the XPath selector,
   * or null if not found.
   */
  getElementByXPath(xpath, xmlDOM) {
    const elements = this.getElementsByXPath(xpath, xmlDOM)

    if (elements && elements.length === 1) {
      const element = elements[0]
      return element
    }

    return null
  }

  /**
   * Gets the first element in the specified XML document that has the specified attribute
   * with the specified value.
   * @param {string} attrName - The name of the attribute to search for.
   * @param {string} attrValue - The value of the attribute to search for.
   * @param {Document} xmlDOM - The XML document to search in.
   * @returns {Element|null} The first element that has the specified attribute with the
   * specified value, or null if not found.
   */
  getElementByAttribute(attrName, attrValue, xmlDOM) {
    return attrName &&
      attrValue && this.getElementByXPath(`//*[@${attrName}='${attrValue}']`, xmlDOM)
  }

  /**
   * Gets all elements in the specified XML document that match the specified XPath selector.
   * @param {string} xpath - The XPath selector to search for.
   * @param {Document} xmlDOM - The XML document to search in.
   * @returns {Element[]} An array of elements that match the XPath selector.
   */
  getElementsByXPath(xpath, xmlDOM) {
    try {
      return xPath.select(xpath, xmlDOM)
    }
    catch (err) {
      return []
    }
  }

  /**
   * Gets the absolute XPath selector for the specified DOM node in the specified XML document.
   * @param {Document} doc - The XML document containing the DOM node.
   * @param {Node} domNode - The DOM node to get the XPath selector for.
   * @returns {string|null} The absolute XPath selector for the DOM node, or null if not found.
   */
  getAbsoluteXPath(doc, domNode) {
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
          const index = childNodes.indexOf(domNode)
          xpath += `[${index + 1}]`
        }
      }

      // Make a recursive call to this nodes parents and prepend it to this xpath
      return this.getAbsoluteXPath(doc, domNode.parentNode) + xpath
    }
    catch (ign) {
      // If there's an unexpected exception, abort and don't get an XPath
      return null
    }
  }

  /**
   * Checks if the specified parent and child elements have a parental relation.
   * @param {Object} options - The options object.
   * @param {Element} options.parent - The parent element.
   * @param {Element} options.child - The child element.
   * @returns {boolean} True if the parent and child elements have a parental relation,
   * false otherwise.
   */
  hasParentalRelation({parent, child}) {
    const parentXpath = get(parent, 'attributes.xpath')
    const childXpath = get(child, 'attributes.xpath')
    return this.checkParentalRelationByElementXpath({
      parentXpath, childXpath
    })
  }

  /**
   * Checks if the specified parent and child elements have a parental relation based
   * on their XPath selectors.
   * @param {Object} options - The options object.
   * @param {string} options.parentXpath - The XPath selector for the parent element.
   * @param {string} options.childXpath - The XPath selector for the child element.
   * @returns {boolean} True if the parent and child elements have a parental relation,
   * false otherwise.
   */
  checkParentalRelationByElementXpath({parentXpath, childXpath}) {
    if (!parentXpath || !childXpath || !isString(parentXpath) || !isString(childXpath)) {
      return false
    }

    const formattedParentXpath = parentXpath.replace(/\[1\]/g, '')
    const formattedChildXpath = childXpath.replace(/\[1\]/g, '')

    return formattedChildXpath !== formattedParentXpath &&
      formattedChildXpath.startsWith(`${formattedParentXpath}/`)
  }

  /**
   * Gets the value of the specified attribute on the specified element.
   * @param {Element} element - The element to get the attribute value from.
   * @param {string} attrName - The name of the attribute to get the value of.
   * @returns {string|null} The value of the attribute, or null if the attribute is not present.
   */
  getElementAttr(element, attrName) {
    const attr = element.attributes.getNamedItem(attrName)
    return attr && attr.value
  }

  /**
   * Gets the inner text of the specified element.
   * @param {Element} element - The element to get the inner text of.
   * @returns {string|null} The inner text of the element, or null if not found.
   */
  getElementInnerText(element) {
    const firstChild = element.childNodes[0]
    return firstChild && firstChild.nodeValue
  }

  /**
   * Formats the specified XML source string to remove any whitespace between '>' and '<'.
   * @param {string} source - The XML source string to format.
   * @returns {string} The formatted XML source string.
   */
  _formatXmlSource(source) {
    return source.replace(/>(\s)*</g, '>\n<')
  }
}

export default new XMLParser()
