import httpProxy from 'http-proxy'
import http from 'http'
import net from 'net'
import Config from '../config'

export default class Proxy {
  constructor() {
    this._currentCommandId = 0
    this._proxy = null
    this._listeningPort = 0
  }

  set currentCommandId(value) {
    this._currentCommandId = value
  }

  async start() {
    this._proxy = httpProxy.createProxyServer({
      proxyTimeout: Config.newCommandTimeoutInMs,
      timeout: Config.newCommandTimeoutInMs
    })

    const server = http.createServer((req, res) => {
      const url = new URL(`${this.getServerUrl()}${req.url}`)
      url.searchParams.set('baseCommandId', this._currentCommandId)
      req.url = url.toString().replace(this.getServerUrl(), '')
      this._proxy.web(req, res, {
        target: Config.appiumServerUrl,
        secure: false,
        changeOrigin: true
      })
    })

    this._listeningPort = this._findAvailablePort()
    server.listen(this._listeningPort)
  }

  stop() {
    this._proxy.close()
  }

  getServerUrl() {
    return `http://localhost:${this._listeningPort}`
  }

  get listeningPort() {
    return this._listeningPort
  }

  _findAvailablePort() {
    const netServer = net.createServer()
    netServer.listen(0)
    const port = netServer.address().port
    netServer.close()
    return port
  }
}
