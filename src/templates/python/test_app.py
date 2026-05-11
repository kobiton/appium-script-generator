from test_base import TestBase
from config import Config
from appium.webdriver.common.appiumby import AppiumBy
from selenium.webdriver.common.by import By


class TestApp(TestBase):
    def setup(self, desired_caps, retina_scale=1):
        super().setup(desired_caps, retina_scale)
        session_id = self._proxy.get_kobiton_session_id()
        if session_id:
            print(f"View session at: https://portal.kobiton.com/sessions/{session_id}")

    def run(self):
        self.update_settings()
        self.switch_to_native_context()
        self.set_implicit_wait(Config.IMPLICIT_WAIT_IN_MS)
        {{testScript}}
