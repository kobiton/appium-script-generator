import BPromise from 'bluebird'

class Utils {
  async retry(task, onError, maxAttempts, intervalInMs) {
    maxAttempts = Math.round(Math.max(maxAttempts, 1))

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await task(attempt)
      }
      catch (e) {
        onError && await onError(e, attempt)
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

  getAllText(element) {
    const texts = []
    const stack = [element]
    while (stack.length > 0) {
      const current = stack.pop()
      if (current.type() === 'text') {
        const text = current.text().trim()
        if (text) texts.push(text)
      }
      const children = current.childNodes()
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i])
      }
    }

    return texts.join(' ')
  }

  isStatusCodeSuccess(statusCode) {
    return 200 <= statusCode && statusCode <= 299
  }
}

export default new Utils()
