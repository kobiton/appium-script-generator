import time
import base64
import requests
from appium import webdriver
from appium.options.android import UiAutomator2Options
from appium.webdriver.common.appiumby import AppiumBy
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from config import Config
from constants import DEVICE_SOURCES, PRESS_TYPES
from proxy_server import ProxyServer

NATIVE_CONTEXT = 'NATIVE_APP'

PLATFORM_NAMES = {
    'IOS': 'IOS',
    'ANDROID': 'ANDROID'
}

MOBILE_CAPABILITY_TYPES = {
    'PLATFORM_NAME': 'platformName',
    'DEVICE_NAME': 'deviceName',
    'PLATFORM_VERSION': 'platformVersion',
    'DEVICE_GROUP': 'deviceGroup'
}


class TestBase:
    def __init__(self):
        self._driver = None
        self._proxy = None
        self._is_ios = False
        self._screen_size = None
        self._desired_caps = None
        self._retina_scale = None
        self._device_name = None
        self._platform_version = None
        self._current_context = None

    def setup(self, desired_caps, retina_scale=1):
        self._desired_caps = desired_caps
        self._retina_scale = retina_scale

        platform_name = desired_caps.get(MOBILE_CAPABILITY_TYPES['PLATFORM_NAME'], '')
        self._is_ios = platform_name.upper() == PLATFORM_NAMES['IOS']
        self._device_name = desired_caps.get(MOBILE_CAPABILITY_TYPES['DEVICE_NAME'], '')
        self._platform_version = desired_caps.get(MOBILE_CAPABILITY_TYPES['PLATFORM_VERSION'], '')

        self._proxy = ProxyServer()
        self._proxy.start()

        print(f"Initialize Appium driver with desiredCaps: {desired_caps}")
        server_url = self._proxy.get_server_url() + '/wd/hub'
        options = UiAutomator2Options().load_capabilities(desired_caps)
        self._driver = webdriver.Remote(server_url, options=options)

    def cleanup(self):
        if self._driver:
            try:
                self._driver.quit()
            except Exception:
                pass
        if self._proxy:
            self._proxy.stop()

    def set_current_command_id(self, command_id):
        if self._proxy:
            self._proxy.current_command_id = command_id

    def get_appium_server_url(self):
        return Config.APPIUM_SERVER_URL

    def update_settings(self):
        self._driver.update_settings({'waitForIdleTimeout': 0})

    def set_implicit_wait(self, ms):
        self._driver.implicitly_wait(ms / 1000)

    def switch_to_native_context(self):
        if self._current_context == NATIVE_CONTEXT:
            return
        print(f"Switch to {NATIVE_CONTEXT} context")
        self._driver.switch_to.context(NATIVE_CONTEXT)
        self._current_context = NATIVE_CONTEXT

    def switch_to_web_context(self):
        contexts = self._driver.contexts
        web_context = next((c for c in contexts if c != NATIVE_CONTEXT), None)
        if web_context and self._current_context != web_context:
            print(f"Switch to {web_context} context")
            self._driver.switch_to.context(web_context)
            self._current_context = web_context

    def find_visible_element(self, timeout_ms, locators):
        wait = WebDriverWait(self._driver, timeout_ms / 1000)
        last_exception = None
        for locator in locators:
            try:
                return wait.until(EC.visibility_of_element_located(locator))
            except Exception as e:
                last_exception = e
        raise last_exception

    def find_visible_element_on_scrollable(self, timeout_ms, locator):
        return self.find_visible_element(timeout_ms, locator)

    def touch_on_element(self, element, x, y):
        self._driver.execute_script('mobile: tap', {'element': element, 'x': x, 'y': y})

    def touch_at_relative_point(self, x, y):
        size = self._driver.get_window_size()
        abs_x = int(size['width'] * x)
        abs_y = int(size['height'] * y)
        self._driver.execute_script('mobile: tap', {'x': abs_x, 'y': abs_y})

    def swipe(self, x1, y1, x2, y2, duration=800):
        size = self._driver.get_window_size()
        self._driver.swipe(
            int(size['width'] * x1), int(size['height'] * y1),
            int(size['width'] * x2), int(size['height'] * y2),
            duration
        )

    def hide_keyboard(self):
        try:
            self._driver.hide_keyboard()
        except Exception:
            pass

    def press_button_multiple(self, button_type, count):
        for _ in range(count):
            self.press_button(button_type)

    def press_button(self, button_type):
        if self._is_ios:
            key_map = {
                PRESS_TYPES['HOME']: 'home',
                PRESS_TYPES['POWER']: 'power'
            }
            key = key_map.get(button_type)
            if key:
                self._driver.execute_script('mobile: pressButton', {'name': key})
        else:
            key_map = {
                PRESS_TYPES['HOME']: 3,
                PRESS_TYPES['BACK']: 4,
                PRESS_TYPES['APP_SWITCH']: 187,
                PRESS_TYPES['ENTER']: 66,
                PRESS_TYPES['DELETE']: 67,
                PRESS_TYPES['POWER']: 26
            }
            key = key_map.get(button_type)
            if key:
                self._driver.press_keycode(key)

    def activate_app(self, app_package):
        self._driver.activate_app(app_package)

    def send_keys(self, element, text):
        element.clear()
        element.send_keys(text)
        time.sleep(Config.SEND_KEYS_DELAY_IN_MS / 1000)

    def send_keys_to_active_element(self, text):
        time.sleep(Config.SEND_KEYS_DELAY_IN_MS / 1000)
        self._driver.switch_to.active_element.send_keys(text)
        time.sleep(Config.SEND_KEYS_DELAY_IN_MS / 1000)

    def swipe_on_element(self, element, x1, y1, x2, y2, duration=800):
        location = element.location
        size = element.size
        start_x = int(location['x'] + size['width'] * x1)
        start_y = int(location['y'] + size['height'] * y1)
        end_x = int(location['x'] + size['width'] * x2)
        end_y = int(location['y'] + size['height'] * y2)
        self._driver.swipe(start_x, start_y, end_x, end_y, duration)

    def rotate_screen(self, orientation):
        self._driver.orientation = orientation.upper()

    def set_location(self, lat, lng, altitude=0):
        self._driver.set_location(lat, lng, altitude)

    def idle(self):
        time.sleep(Config.IDLE_DELAY_IN_MS / 1000)

    def find_online_device(self, capabilities):
        if Config.DEVICE_SOURCE != DEVICE_SOURCES['KOBITON']:
            return
        headers = {
            'Authorization': Config.get_basic_auth_string(),
            'Content-Type': 'application/json'
        }
        for attempt in range(Config.DEVICE_WAITING_MAX_TRY_TIMES):
            try:
                response = requests.get(
                    f"{Config.KOBITON_API_URL}/v1/devices",
                    headers=headers,
                    params={
                        'platformName': capabilities.get('platformName'),
                        'deviceName': capabilities.get('deviceName'),
                        'platformVersion': capabilities.get('platformVersion'),
                        'isOnline': True,
                        'isBooked': False
                    }
                )
                if response.status_code == 200:
                    data = response.json() or {}
                    device_keys = ('deviceListData', 'privateDevices', 'favoriteDevices',
                                   'cloudDevices', 'itaTrialCloudDevices', 'virtualDevices')
                    if any(data.get(k) for k in device_keys):
                        return
            except Exception as e:
                print(f"Error checking device availability: {e}")
            print(f"Device not available, retrying ({attempt + 1}/{Config.DEVICE_WAITING_MAX_TRY_TIMES})...")
            time.sleep(Config.DEVICE_WAITING_INTERVAL_IN_MS / 1000)

    def save_debug_resource(self):
        try:
            screenshot = self._driver.get_screenshot_as_base64()
            with open('debug_screenshot.png', 'wb') as f:
                f.write(base64.b64decode(screenshot))
            print("Debug screenshot saved to debug_screenshot.png")
        except Exception as e:
            print(f"Could not save debug resource: {e}")
