import {DEVICE_SOURCES} from './helper/constants'

export const Config = {
  API_USERNAME: '{{username}}',
  API_KEY: 'your_api_key',
  APPIUM_SERVER_URL: '{{appiumServerUrl}}',
  DEVICE_SOURCE: DEVICE_SOURCES.KOBITON,
  IMPLICIT_WAIT_IN_MS: 10000,
  DEVICE_WAITING_MAX_TRY_TIMES: 5,
  DEVICE_WAITING_INTERVAL_IN_MS: 30000,
  NEW_COMMAND_TIMEOUT_IN_MS: 15 * 60 * 1000,
  SEND_KEYS_DELAY_IN_MS: 1500,
  IDLE_DELAY_IN_MS: 3000,
  KOBITON_API_URL: '{{kobitonApiUrl}}',
  // Run with KOBITON_TRUST_ALL_CERTS=true to skip TLS cert validation — needed
  // for on-prem standalone deployments served over a self-signed certificate.
  TRUST_ALL_CERTS: ['1', 'true', 'yes'].includes((process.env.KOBITON_TRUST_ALL_CERTS || '').trim().toLowerCase()),

  getAppiumServerUrlWithAuth() {
    const url = new URL(this.APPIUM_SERVER_URL)
    return `${url.protocol}//${this.API_USERNAME}:${this.API_KEY}@${url.hostname}:${url.port}${url.pathname}`
  },

  getBasicAuthString() {
    const authen = `${this.API_USERNAME}:${this.API_KEY}`
    const encodedAuthen = Buffer.from(authen).toString('base64')

    return `Basic ${encodedAuthen}`
  },

  //{{desiredCaps}}
}
