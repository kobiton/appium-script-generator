import BPromise from 'bluebird'

const fs = BPromise.promisifyAll(require('fs'))

class Utils {
  async retry(task, maxAttempts, intervalInMs) {
    maxAttempts = Math.max(maxAttempts, 1)

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await task(attempt)
      }
      catch (e) {
        if (attempt === maxAttempts) {
          throw e
        }
      }

      if (intervalInMs > 0) {
        await BPromise.delay(intervalInMs)
      }
    }

    return null
  }

  convertToOrdinal(i) {
    const suffixes = ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th']

    switch (i % 100) {
      case 11:
      case 12:
      case 13:
        return i + 'th'
      default:
        return i + suffixes[i % 10]
    }
  }

  getLocatorText(locators) {
    return ''
  }

  /**
   * Gets file content.
   * @param  {String} filePath - the path of read file.
   * @return {String} the file content or Null if file unavailable.
  */
  async readFile(filePath, ...options) {
    try {
      return fs.readFileAsync(filePath, ...options)
    }
    catch (err) {
      if (err.code === 'ENOENT') {
        return null
      }
      throw err
    }
  }

  isStatusCodeSuccess(statusCode) {
    return 200 <= statusCode && statusCode <= 299
  }
}

export default new Utils()
