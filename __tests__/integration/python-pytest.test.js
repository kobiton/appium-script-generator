import path from 'path'
import fs from 'fs'
import os from 'os'
import {execFileSync} from 'child_process'
import PythonAppiumScriptGenerator from '../../src/services/python'
import {removeDir} from '../../src/utils/fs-wrapper'

const INPUT_FILE = path.resolve(__dirname, '../resource/python-pytest-input.json')
const VALIDATOR = path.resolve(__dirname, '../helpers/validate-python-output.py')

describe('PythonAppiumScriptGenerator', () => {
  it('generates a valid Python pytest script from a 2-device session fixture', async () => {
    const input = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'))
    const workingDir = path.join(os.tmpdir(), `python-pytest-test-${Date.now()}`)

    const generator = new PythonAppiumScriptGenerator({})
    const {outputFile} = await generator.run({...input, workingDir})

    expect(outputFile).toBeTruthy()
    expect(fs.existsSync(outputFile)).toBe(true)

    try {
      execFileSync('python3', [VALIDATOR, outputFile], {
        encoding: 'utf8',
        stdio: 'pipe'
      })
    }
    catch (err) {
      throw new Error(
        `Python validation failed:\n${(err.stdout || '').trim()}\n${(err.stderr || '').trim()}`
      )
    }
    finally {
      await removeDir(workingDir)
    }
  }, 30000)
})
