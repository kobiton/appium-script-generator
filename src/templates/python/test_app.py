from test_base import TestBase
from config import Config
from appium.webdriver.common.appiumby import AppiumBy
from selenium.webdriver.common.by import By


class TestApp(TestBase):
    def run(self):
        self.update_settings()
        self.switch_to_native_context()
        self.set_implicit_wait(Config.IMPLICIT_WAIT_IN_MS)
        {{testScript}}
