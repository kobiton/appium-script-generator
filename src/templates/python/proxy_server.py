import socket
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import urlopen, Request
from config import Config


class ProxyHandler(BaseHTTPRequestHandler):
    current_command_id = 0

    def do_request(self, method, body=None):
        target_url = Config.get_appium_server_url_with_auth().replace('/wd/hub', '')
        url = f"{target_url}{self.path}"

        if self.current_command_id:
            separator = '&' if '?' in url else '?'
            url = f"{url}{separator}baseCommandId={self.current_command_id}"

        headers = {key: val for key, val in self.headers.items()}
        req = Request(url, data=body, headers=headers, method=method)

        try:
            with urlopen(req) as response:
                self.send_response(response.status)
                for key, val in response.headers.items():
                    self.send_header(key, val)
                self.end_headers()
                self.wfile.write(response.read())
        except Exception as e:
            self.send_error(502, str(e))

    def do_GET(self):
        self.do_request('GET')

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else None
        self.do_request('POST', body)

    def do_DELETE(self):
        self.do_request('DELETE')

    def log_message(self, format, *args):
        pass


class ProxyServer:
    def __init__(self):
        self.current_command_id = 0
        self._server = None
        self._port = 0
        self._thread = None

    def start(self):
        self._port = self._find_available_port()
        self._server = HTTPServer(('localhost', self._port), ProxyHandler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self):
        if self._server:
            self._server.shutdown()

    def get_server_url(self):
        return f"http://localhost:{self._port}"

    @property
    def listening_port(self):
        return self._port

    def _find_available_port(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('', 0))
            return s.getsockname()[1]
