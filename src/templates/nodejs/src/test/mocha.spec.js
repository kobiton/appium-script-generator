import {assert} from 'chai'
import Config from './config'
import TestApp from './helper/app'

describe('Scriptless Automation Test Case', () => {
  beforeEach(() => {
    assert(
      Config.kobitonApiKey !== 'your_kobiton_api_key',
      'Please update value for the KOBITON_API_KEY constant first. See more at README.md file.'
    )
  })

  {{testCases}}
})
