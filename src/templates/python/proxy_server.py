import socket
import threading
import sys
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
import requests
from config import Config
from constants import DEVICE_SOURCES

# 15-minute timeout (matching Java)
SOCKET_TIMEOUT_SECONDS = 15 * 60


class ProxyHandler(BaseHTTPRequestHandler):
    server_instance = None

    def do_request(self, method, body=None):
        force_w3c = False

        base_url = Config.get_appium_server_url_with_auth()
        print(f"[PROXY] Base URL from config: {base_url}", file=sys.stderr, flush=True)

        # Strip /wd/hub from self.path if present
        path = self.path
        if path.startswith('/wd/hub'):
            path = path[len('/wd/hub'):]

        print(f"[PROXY] Incoming path: {self.path}", file=sys.stderr, flush=True)
        print(f"[PROXY] Stripped path: {path}", file=sys.stderr, flush=True)

        url = f"{base_url.rstrip('/')}{path}"
        print(f"[PROXY] Final URL being called: {url}", file=sys.stderr, flush=True)

        # Get current_command_id from server instance
        current_command_id = self.server_instance.current_command_id if self.server_instance else 0
        if Config.DEVICE_SOURCE == DEVICE_SOURCES['KOBITON'] and current_command_id > 0:
            separator = '&' if '?' in url else '?'
            url = f"{url}{separator}baseCommandId={current_command_id}"
            print(f"[PROXY] URL with baseCommandId: {url}", file=sys.stderr, flush=True)

        headers = {key: val for key, val in self.headers.items()}
        # Remove Host header to avoid conflicts
        headers.pop('Host', None)

        # Add Authorization header (matching Java approach)
        headers['Authorization'] = Config.get_basic_auth_string()

        # Log the Authorization header
        auth_header = headers.get('Authorization', 'NOT SET')
        masked_auth = "Basic ***" if auth_header.startswith("Basic ") else (auth_header if auth_header == "NOT SET" else "***")
        print(f"[PROXY] Authorization header: {masked_auth}", file=sys.stderr, flush=True)
        print(f"[PROXY] All request headers: {headers}", file=sys.stderr, flush=True)

        try:
            print(f"[PROXY] Making {method} request to: {url}", file=sys.stderr, flush=True)

            # Make the request using requests library with timeout (matching Java 15 min timeout)
            if method == 'GET':
                response = requests.get(url, headers=headers, verify=False, timeout=SOCKET_TIMEOUT_SECONDS)
            elif method == 'POST':
                response = requests.post(url, data=body, headers=headers, verify=False, timeout=SOCKET_TIMEOUT_SECONDS)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, verify=False, timeout=SOCKET_TIMEOUT_SECONDS)
            else:
                response = requests.request(method, url, data=body, headers=headers, verify=False, timeout=SOCKET_TIMEOUT_SECONDS)

            print(f"[PROXY] Response status code: {response.status_code} ({response.reason})", file=sys.stderr, flush=True)
            print(f"[PROXY] Response headers: {dict(response.headers)}", file=sys.stderr, flush=True)
            if len(response.content) < 500:
                print(f"[PROXY] Response body: {response.content}", file=sys.stderr, flush=True)

            # Process response
            response_body = response.content

            try:
                # Handle /session POST response - extract kobitonSessionId and convert format if needed
                if path == "/session" and method == "POST":
                    response_json = json.loads(response.content.decode('utf-8'))

                    # Extract kobitonSessionId if present
                    if "value" in response_json and isinstance(response_json["value"], dict):
                        if "kobitonSessionId" in response_json["value"]:
                            kobiton_session_id = response_json["value"]["kobitonSessionId"]
                            with self.server_instance._session_id_lock:
                                self.server_instance.kobiton_session_id = kobiton_session_id
                            print(f"[PROXY] Extracted kobitonSessionId: {kobiton_session_id}", file=sys.stderr, flush=True)

                    # JSON Wire format conversion to W3C format
                    # Check if response is in JSON Wire format (has 'status' and 'sessionId' at top level)
                    if 200 <= response.status_code <= 299 and "status" in response_json and "sessionId" in response_json:
                        print(f"[PROXY] Converting JSON Wire format to W3C format", file=sys.stderr, flush=True)
                        force_w3c = True
                        desired_caps = response_json.get("value", {})

                        w3c_value = {
                            "capabilities": desired_caps,
                            "sessionId": response_json["sessionId"]
                        }

                        w3c_response = {
                            "value": w3c_value
                        }

                        response_body = json.dumps(w3c_response).encode('utf-8')
                        print(f"[PROXY] Converted response body: {response_body}", file=sys.stderr, flush=True)

                # Handle error responses - convert JSON Wire error format to W3C if needed
                if response.status_code >= 400 and force_w3c:
                    try:
                        error_json = json.loads(response.content.decode('utf-8'))

                        # Check if this is a JSON Wire error format with 'status' field
                        if "status" in error_json and "value" in error_json:
                            print(f"[PROXY] Converting JSON Wire error format to W3C format", file=sys.stderr, flush=True)

                            appium_status = error_json.get("status", 0)
                            error_message = error_json.get("value", {}).get("message", "Unknown error")

                            # Map Appium error codes to W3C error types
                            error_code_map = {
                                0: "success",
                                1: "invalid_session_id",
                                2: "no_such_element",
                                3: "no_such_frame",
                                4: "unknown_command",
                                5: "stale_element_reference",
                                6: "element_not_visible",
                                7: "invalid_element_state",
                                8: "unknown_error",
                                9: "element_not_selectable",
                                10: "javascript_error",
                                11: "xpath_lookup_error",
                                12: "timeout",
                                13: "no_such_window",
                                14: "invalid_cookie_domain",
                                15: "unable_to_set_cookie",
                                16: "unexpected_alert_open",
                                17: "no_alert_open",
                                18: "script_timeout",
                                19: "invalid_element_coordinates",
                                20: "ime_not_available",
                                21: "ime_engine_activation_failed",
                                22: "invalid_selector",
                                23: "session_not_created",
                                24: "move_target_out_of_bounds",
                                25: "invalid_xpath_selector",
                                26: "invalid_xpath_selector_return_typo",
                                27: "element_not_interactable",
                                28: "invalid_argument",
                                29: "invalid_coordinates",
                                30: "invalid_session_id",
                                31: "javascript_error"
                            }

                            error_type = error_code_map.get(appium_status, "unknown_error")

                            w3c_error = {
                                "value": {
                                    "error": error_type,
                                    "message": error_message
                                }
                            }

                            response_body = json.dumps(w3c_error).encode('utf-8')
                            print(f"[PROXY] Converted error response body: {response_body}", file=sys.stderr, flush=True)
                    except (json.JSONDecodeError, KeyError) as e:
                        print(f"[PROXY] Could not convert error response format: {e}", file=sys.stderr, flush=True)
                        # Use original response body if conversion fails
                        pass

            except (json.JSONDecodeError, KeyError) as e:
                print(f"[PROXY] Could not parse/convert response body: {e}", file=sys.stderr, flush=True)
                # Use original response body if parsing fails
                response_body = response.content

            try:
                # Send response back with status code, headers and body
                self.send_response(response.status_code)

                # Strip Content-Length header since response_body may have been modified
                # The HTTP server will calculate the correct length
                response_headers = {key: val for key, val in response.headers.items()
                                  if key.lower() != 'content-length'}

                for key, val in response_headers.items():
                    self.send_header(key, val)
                self.end_headers()
                self.wfile.write(response_body)
            except Exception as send_error:
                print(f"[PROXY] Error sending response: {type(send_error).__name__}: {str(send_error)}", file=sys.stderr, flush=True)
                try:
                    self.send_error(502, "Failed to send response")
                except Exception:
                    pass
        except Exception as e:
            print(f"[PROXY] Error forwarding {method} request to {url}: {type(e).__name__}: {str(e)}", file=sys.stderr, flush=True)
            import traceback
            traceback.print_exc(file=sys.stderr)
            self.send_error(502, str(e))

    def do_GET(self):
        self.do_request('GET')

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else None
        self.do_request('POST', body)

    def do_PUT(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else None
        self.do_request('PUT', body)

    def do_PATCH(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else None
        self.do_request('PATCH', body)

    def do_DELETE(self):
        self.do_request('DELETE')

    def log_message(self, format, *args):
        print(f"[PROXY] {format % args}", file=sys.stderr, flush=True)


class ProxyServer:
    def __init__(self):
        self.current_command_id = 0
        self.kobiton_session_id = None
        self._session_id_lock = threading.Lock()
        self._server = None
        self._port = 0
        self._thread = None

    def start(self):
        self._port = self._find_available_port()
        self._server = HTTPServer(('localhost', self._port), ProxyHandler)
        ProxyHandler.server_instance = self
        print(f"[PROXY] Proxy server started on port {self._port}", file=sys.stderr, flush=True)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self):
        if self._server:
            print(f"[PROXY] Stopping proxy server", file=sys.stderr, flush=True)
            self._server.shutdown()

    def get_server_url(self):
        return f"http://localhost:{self._port}"

    def get_kobiton_session_id(self):
        with self._session_id_lock:
            return self.kobiton_session_id if self.kobiton_session_id else 0

    @property
    def listening_port(self):
        return self._port

    def _find_available_port(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('', 0))
            return s.getsockname()[1]
