from urllib.parse import urlparse
import base64
import os

import requests
from urllib3.exceptions import InsecureRequestWarning

from constants import DeviceSource


class Config:
    API_USERNAME = '{{username}}'
    API_KEY = '{{your_api_key}}'
    APPIUM_SERVER_URL = '{{appiumServerUrl}}'
    DEVICE_SOURCE = DeviceSource.{{deviceSource}}
    IMPLICIT_WAIT_IN_MS = 10000
    DEVICE_WAITING_MAX_TRY_TIMES = 5
    DEVICE_WAITING_INTERVAL_IN_MS = 30000
    SEND_KEYS_DELAY_IN_MS = 1500
    IDLE_DELAY_IN_MS = 3000
    KOBITON_API_URL = '{{kobitonApiUrl}}'
    # Run with KOBITON_TRUST_ALL_CERTS=true to skip TLS cert validation — needed
    # for on-prem standalone deployments served over a self-signed certificate.
    TRUST_ALL_CERTS = os.getenv('KOBITON_TRUST_ALL_CERTS', '').strip().lower() in ('1', 'true', 'yes')
    {{kobitonCredential}}

    #{{desiredCaps}}

    @classmethod
    def get_appium_server_url_with_auth(cls):
        parsed = urlparse(cls.APPIUM_SERVER_URL)
        port_part = f":{parsed.port}" if parsed.port else ""
        return f"{parsed.scheme}://{cls.API_USERNAME}:{cls.API_KEY}@{parsed.hostname}{port_part}{parsed.path}"

    @classmethod
    def get_basic_auth_string(cls):
        credentials = f"{cls.API_USERNAME}:{cls.API_KEY}"
        encoded = base64.b64encode(credentials.encode()).decode()
        return f"Basic {encoded}"


# Suppress the per-request InsecureRequestWarning emitted when TRUST_ALL_CERTS
# disables verification across the proxy and the Kobiton REST calls.
if Config.TRUST_ALL_CERTS:
    requests.packages.urllib3.disable_warnings(InsecureRequestWarning)
