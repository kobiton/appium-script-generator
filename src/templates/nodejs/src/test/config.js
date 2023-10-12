import {DEVICE_SOURCES} from './helper/constants'

// Please update the correct value for KOBITON_API_KEY before testing
const KOBITON_API_KEY = 'your_kobiton_api_key'
const KOBITON_USERNAME = '{{username}}'

class Config {
  constructor() {
    this.kobitonUsername = KOBITON_USERNAME
    this.kobitonApiKey = KOBITON_API_KEY
    this.appiumServerUrl = //{{appiumServerUrl}}
    this.kobitonApiUrl = //{{kobitonApiUrl}}
    this.deviceSource = DEVICE_SOURCES.KOBITON
    this.implicitWaitInMs = 30000 // 30s
    this.explicitWaitInMs = 30000 // 30s
    this.newCommandTimeoutInMs = 15 * 60 * 1000 // 15m
    this.sleepBeforeSendingKeysInMs = 3000 // 3s
    this.deviceWaitingMaxTryTimes = 5
    this.deviceWaitingIntervalInMs = 30000 // 30s
  }

  getBasicAuthString() {
    const authen = `${KOBITON_USERNAME}:${KOBITON_API_KEY}`
    const encodedAuthen = Buffer.from(authen).toString('base64')

    return `Basic ${encodedAuthen}`
  }

  //{{desiredCaps}}
}

export default new Config()
