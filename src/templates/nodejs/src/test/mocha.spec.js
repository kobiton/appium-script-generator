import {assert} from 'chai'
import {Config} from './config'
import TestApp from './helper/app'

describe('Scriptless Automation Test Case', () => {
  beforeEach(() => {
    assert(
      Config.API_KEY !== 'your_api_key',
      'Please update value for the API_KEY constant first. See more at README.md file.'
    )
  })

  {{testCases}}
})
