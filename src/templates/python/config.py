from urllib.parse import urlparse
import base64
from constants import DEVICE_SOURCES


class Config:
    API_USERNAME = '{{username}}'
    API_KEY = 'your_api_key'
    APPIUM_SERVER_URL = '{{appiumServerUrl}}'
    DEVICE_SOURCE = DEVICE_SOURCES['KOBITON']
    IMPLICIT_WAIT_IN_MS = 10000
    DEVICE_WAITING_MAX_TRY_TIMES = 5
    DEVICE_WAITING_INTERVAL_IN_MS = 30000
    NEW_COMMAND_TIMEOUT_IN_MS = 15 * 60 * 1000
    SEND_KEYS_DELAY_IN_MS = 1500
    IDLE_DELAY_IN_MS = 3000
    KOBITON_API_URL = '{{kobitonApiUrl}}'

    #{{desiredCaps}}

    @classmethod
    def get_appium_server_url_with_auth(cls):
        parsed = urlparse(cls.APPIUM_SERVER_URL)
        return f"{parsed.scheme}://{cls.API_USERNAME}:{cls.API_KEY}@{parsed.hostname}:{parsed.port}{parsed.path}"

    @classmethod
    def get_basic_auth_string(cls):
        credentials = f"{cls.API_USERNAME}:{cls.API_KEY}"
        encoded = base64.b64encode(credentials.encode()).decode()
        return f"Basic {encoded}"
