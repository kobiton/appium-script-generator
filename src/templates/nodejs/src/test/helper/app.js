import TestBase from './base'
import Point from './point'
import Rectangle from './rectangle'
import Config from '../config'
import {PRESS_TYPES} from './constants'

export default class TestApp extends TestBase {
  async run() {
    await this.updateSettings()
    await this.switchToNativeContext()
    await this.setImplicitWaitInMiliSecond(Config.implicitWaitInMs)
    {{testScript}}
  }
}
