import {FRAMEWORK_NAMES, LANGUAGES} from './constant'
import JavaAppiumScriptGenerator from './java'
import NodejsAppiumScriptGenerator from './nodejs'
import CSharpAppiumScriptGenerator from './csharp'

export class AppiumScriptGenerator {
  constructor({debugNamespace = 'script-generator'}) {
    this._ns = debugNamespace
  }

  /**
   * Runs the script generator with the specified options.
   * @param {Object} opts - The options object.
   * @param {Object} opts.requestScript - The request script object.
   * @param {Array} opts.devices - The array of devices.
   * @returns {Object} An object containing the output file path.
   * @throws {Error} If the specified language is not supported.
   */
  async run(opts = {}) {
    const {requestScript, devices} = opts
    let {language, testingFramework} = requestScript
    language = this._standardizeString(language)
    testingFramework = this._standardizeString(testingFramework)

    // Updated values after standardized
    requestScript.language = language
    requestScript.testingFramework = testingFramework

    this._validate({devices, language, testingFramework})

    let generator
    switch (language) {
      case LANGUAGES.JAVA:
        generator = new JavaAppiumScriptGenerator({
          debugNamespace: this._ns
        })
        break

      case LANGUAGES.NODEJS:
        generator = new NodejsAppiumScriptGenerator({
          debugNamespace: this._ns
        })
        break

      case LANGUAGES.CSHARP:
        generator = new CSharpAppiumScriptGenerator({
          debugNamespace: this._ns
        })
        break

      default:
        throw new Error(`Don't support ${language} yet`)
    }

    return generator.run(opts)
  }

  /**
   * Validates the specified options.
   * @param {Object} options - The options object to validate.
   * @param {Array} options.devices - The array of devices.
   * @param {string} options.language - The language to use.
   * @param {string} options.testingFramework - The testing framework to use.
   * @throws {Error} If there are no devices to generate, or if the specified language
   * or testing framework is not supported.
   */
  _validate({devices, language, testingFramework}) {
    if (!devices || devices.length <= 0) {
      throw new Error('There are no devices to generate')
    }

    if (!this._isExisting(LANGUAGES, language)) {
      throw new Error(`Don't support ${language} yet`)
    }

    if (!this._isExisting(FRAMEWORK_NAMES, testingFramework)) {
      throw new Error(`Don't support ${testingFramework} yet`)
    }
  }

  /**
   * Checks if a value exists in an object or not by comparing it to the object's values
   * after standardizing them.
   * @param {Object} object - The object to search in.
   * @param {string} value - The value to search for.
   * @returns {boolean} `true` if the value exists in the object, `false` otherwise.
   * @throws {Error} If the `value` parameter is empty.
   */
  _isExisting(object, value) {
    const formatedValue = value && (value.trim()).toLowerCase()
    if (!formatedValue) throw new Error('`value` is not empty')

    const exist = Object.keys(object).find(key => object[key] === formatedValue)
    return !!exist
  }

  /**
   * Standardizes a string by trimming and converting it to lowercase.
   * @param {string} value - The string to standardize.
   * @returns {string} The standardized string.
   */
  _standardizeString(value) {
    return value && (value.trim()).toLowerCase()
  }
}
