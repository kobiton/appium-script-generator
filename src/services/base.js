import get from 'lodash/get'
import isString from 'lodash/isString'

const LOCATOR_VAR_NAME_PREFIX = 'locator'

/**
 * Base class for Appium script generators.
 */
export class BaseAppiumScriptGenerator {
  async run() {}

  /**
   * Parses a value based on its type name.
   * @param {string} value - The value to parse.
   * @param {string} type - The type name of the value.
   * @returns {*} The parsed value.
   */
  _parseValue(value, type) {
    switch (type) {
      case 'int':
      case 'int32':
        return parseInt(value)
      case 'bool':
        return (value === 'true')
      default:
        return value
    }
  }

  /**
   * Filters out invalid selectors from an array of selectors.
   * @param {Array} selectors - The array of selectors to filter.
   * @returns {Array} An array of valid selectors.
   */
  _getValidSelectors(selectors) {
    let validSelectors
    const absoluteXpathSelector = selectors.find((selector) =>
      selector.type === 'xpath' && selector.value[0] === '/' && selector.value[1] !== '/')
    if (absoluteXpathSelector && selectors.length > 1) {
      validSelectors = selectors.filter((selector) =>
        !(selector.type === absoluteXpathSelector.type &&
          selector.value === absoluteXpathSelector.value))
    }
    else {
      validSelectors = [...selectors]
    }

    return validSelectors
  }

  /**
   * Generates a variable name based on the provided options and ensures that it is unique.
   * @param {Object} options - The options object.
   * @param {string} options.name - The name to use for the variable.
   * @param {string} options.fallbackName - The fallback name to use if the provided options.name
   * is empty.
   * @param {string} options.prefix - The prefix to add to the variable name.
   * @param {string} options.suffix - The suffix to add to the variable name.
   * @param {Array} options.varNames - A array of existing variable names to check against.
   * @returns {string} A unique variable name based on the provided options.
   */
  _getVarName({name, fallbackName, prefix, suffix, varNames}) {
    let varName = name

    varName = varName.replace(/[^\s-_A-Za-z0-9]/g, '')
    varName = varName.replace(/[-_]+/g, ' ')
    varName = varName.replace(/\s+/g, ' ').trim()
    varName = varName.replace(/[\s-_](.)/g, value => value[1].toUpperCase())
    varName = varName || fallbackName
    varName = prefix + varName.charAt(0).toUpperCase() + varName.slice(1) + suffix
    varName = varName.replace(/^\d+/, '')

    let nth = 1
    let tempVarName = varName
    while (varNames.has(tempVarName)) {
      tempVarName = varName + nth
      nth++
    }

    varName = tempVarName
    varNames.add(varName)
    return varName
  }

  /**
   * Generates a variable name for a locator based on the provided step and ensures that it
   * is unique.
   * @param {Object} step - The step object.
   * @param {Array} varNames - An array of existing variable names to check against.
   * @returns {string} A unique variable name for the locator based on the provided step.
   */
  _getLocatorVarName(step, varNames) {
    const {selectorConfigurations} = step

    let varName = ''
    const firstSelector = get(selectorConfigurations, '[0].selectors[0]')
    if (selectorConfigurations.length === 1 && firstSelector) {
      const selector = firstSelector
      switch (selector.type) {
        case 'accessibilityId':
          varName = selector.value
          break

        case 'id':
          varName = selector.value
          if (varName) {
            const startIndex = varName.indexOf(':id/')
            if (startIndex >= 0) {
              varName = varName.substring(startIndex + 4)
            }
          }
          break

        case 'name':
          varName = selector.value
          break

        case 'className':
          varName = selector.value
          varName = varName.split('.').pop()
          break

        case 'linkText':
          varName = selector.value && selector.value.length <= 20 ? selector.value : 'linkText'
          break

        case 'css': {
          let cssMatch = /(.+)#(.+)/.exec(selector.value)
          if (cssMatch) {
            varName = `${cssMatch[1]}_${cssMatch[2]}`
            break
          }

          cssMatch = /(.+).(.+)/.exec(selector.value)
          if (cssMatch) {
            varName = `${cssMatch[1]}_${cssMatch[2]}`
            break
          }

          break
        }

        case 'xpath': {
          const match = /\/\/(.+)\[@.+='(.+)']/.exec(selector.value)
          if (match) {
            let className = match[1]
            className = className.split('.').pop()

            varName = `${className}_${match[2]}`
          }
          else {
            varName = selector.value.split('/').pop()
            varName = varName.split('.').pop()
          }

          break
        }
      }
    }

    varName = this._getVarName({
      name: varName,
      fallbackName: String(step.id),
      prefix: LOCATOR_VAR_NAME_PREFIX,
      suffix: '',
      varNames
    })

    return varName
  }

  /**
   * Converts a value to a string and escapes special characters.
   * @param {*} value - The value to convert to a string.
   * @returns {string} The string representation of the value with special characters escaped.
   */
  _getString(value) {
    let str
    if (isString(value)) {
      str = value
        .replace(/\\/g, '\\\\')
        // eslint-disable-next-line no-useless-escape
        .replace(/"/g, '\\\"')
    }
    else {
      str = value
    }

    return `"${str}"`
  }
}
