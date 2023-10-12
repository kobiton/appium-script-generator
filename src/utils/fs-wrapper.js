import BPromise from 'bluebird'
import path from 'path'
import del from 'del'

const fs = BPromise.promisifyAll(require('fs'))

/**
 * Creates directory recursively with given directory path.
 * @param  {String} dirPath - the directory path.
 * @param  {Object} opts - the options.
 *                    wipeOut (bool): flag to force cleaning up the folder. Default is False
 */
export async function createDir(dirPath, opts = {}) {
  const defaultOpts = {wipeOut: false, ...opts}
  const create = async (dirPath) => {
    try {
      await fs.mkdirAsync(dirPath)
    }
    catch (err) {
      switch (err.code) {
        case 'ENOENT':
          // Parent dir doesn't exist, recursively creates parent dirs
          await create(path.dirname(dirPath))
          await create(dirPath)
          break
        case 'EEXIST':
          break
        default:
          throw err
      }
    }
  }

  if (defaultOpts.wipeOut) {
    await removeDir(dirPath)
  }

  await create(dirPath)
}

/*
 * Removes a specific directory.
 * @param  {String|Array} dirPath - the pattern of removal dir path.
 * @param  {Object} opts - the options.
 */
export function removeDir(dirPath, opts = {}) {
  const defaultOpts = {force: true, ...opts}
  return del(dirPath, defaultOpts)
}

/**
 * Gets file content.
 * @param  {String} filePath - the path of read file.
 * @return {String} the file content or Null if file unavailable.
 */
export async function readFile(filePath, ...options) {
  try {
    return await fs.readFileAsync(filePath, ...options)
  }
  catch (err) {
    if (err.code === 'ENOENT') {
      return null
    }
    throw err
  }
}

/**
 * Creates new file.
 * @param  {String} filePath - the path of written file.
 * @param  {String} content  - the file content.
 * @param  {Object} opts     - the options.
 */
export function writeFile(filePath, content, opts = {}) {
  return fs.writeFileAsync(filePath, content, opts)
}
