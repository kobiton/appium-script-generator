// @flow
import fs from 'fs'
import archiver from 'archiver'
import BPromise from 'bluebird'

/**
 * Compresses streams, buffers or directories using zip or tar.
 * @param {Array[{source: Stream|Buffer|String, name: String}]} inputs.
 * @param {String} outFilePath the output file
 * @param {Object} opts: {format: 'zip'|tar'}
 */
export default function (inputs, outFilePath, opts = {}) {
  return new BPromise((resolve, reject) => {
    const output = fs.createWriteStream(outFilePath)
    const archive = archiver(opts.format || 'zip')

    output.on('close', resolve)
    archive.on('error', reject)

    archive.pipe(output)

    for (const input of inputs) {
      if (input.type === 'dir') {
        archive.directory(input.source, input.name)
      }
      else {
        archive.append(input.source, {name: input.name})
      }
    }

    archive.finalize()
  })
}
