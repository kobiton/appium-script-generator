from test_base import TestBase
from config import Config
from constants import PressType, Orientation
from appium.webdriver.common.appiumby import AppiumBy
from selenium.webdriver.common.by import By


class TestApp(TestBase):
    # Not a pytest collection target — TestApp is a helper that wraps TestBase,
    # invoked from test_suite.py. The leading "Test" matches Java's class name
    # for parity; this flag prevents pytest from trying to instantiate it.
    __test__ = False

    def setup(self, desired_caps, retina_scale=1):
        super().setup(desired_caps, retina_scale)
        session_id = self.get_kobiton_session_id()
        if session_id:
            print(f"View session at: {{portalUrl}}/sessions/{session_id}")

    def run(self):
        try:
            self.update_settings()
            self.switch_to_native_context()
            self.set_implicit_wait(Config.IMPLICIT_WAIT_IN_MS)
            {{testScript}}
        except Exception:
            import traceback
            traceback.print_exc()
            self.save_debug_resource()
            raise
