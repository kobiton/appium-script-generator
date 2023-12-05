import {LANGUAGES} from '../services/constant'

/**
 * Represents a line of text with an optional indent offset.
 */
export class Line {
  /**
   * Creates a new Line instance.
   * @param {string} content - The content of the line.
   * @param {number} [indentOffset=0] - The number of spaces to indent the line by.
   */
  constructor(content, indentOffset = 0) {
    this._content = content
    this._indentOffset = indentOffset
  }

  /**
   * Gets the content of the line.
   * @returns {string} The content of the line.
   */
  get content() {
    return this._content
  }

  /**
   * Gets the indent offset of the line.
   * @returns {number} The number of spaces to indent the line by.
   */
  get indentOffset() {
    return this._indentOffset
  }
}

/**
 * Builds code from an array of lines.
 *
 * @param {Object} options - The options for building the code.
 * @param {string} options.language - The programming language to use for the code.
 * @param {Array} options.lines - The array of lines to build the code from.
 * @param {number} [options.initialIndent=0] - The initial indentation level for the code.
 * @returns {string} The built code.
 */
export function buildCode({language, lines, initialIndent = 0}) {
  let code = ''
  let currentIndent = initialIndent
  let isFirstLine = true

  let space = ''
  switch (language) {
    case LANGUAGES.JAVA:
      space = '    '
      break
    case LANGUAGES.NODEJS:
      space = '  '
      break
    case LANGUAGES.CSHARP:
      space = '    '
      break
  }

  for (const line of lines) {
    const lineContent = line.content
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')

    currentIndent += line.indentOffset
    if (isFirstLine) {
      code += lineContent + '\n'
      isFirstLine = false
    }
    else {
      code += space.repeat(currentIndent) + lineContent + '\n'
    }
  }

  return code
}
