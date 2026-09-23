package com.kobiton.scriptlessautomation;

import io.appium.java_client.AppiumBy;
import io.appium.java_client.Location;
import org.testng.Reporter;
import org.openqa.selenium.By;
import org.openqa.selenium.Point;
import org.openqa.selenium.Rectangle;
import org.openqa.selenium.ScreenOrientation;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.remote.DesiredCapabilities;

public class TestApp extends TestBase {
    public void runTest() throws Exception {
        try {
            updateSettings();
            switchToNativeContext();
            setImplicitWaitInMiliSecond(Config.IMPLICIT_WAIT_IN_MS);
            {{testScript}}
        } catch (Exception e) {
            e.printStackTrace();
            saveDebugResource();
            throw e;
        } finally {
            cleanup();
        }
    }

    @Override
    public void setup(DesiredCapabilities desiredCaps, double retinaScale) throws Exception {
        super.setup(desiredCaps, retinaScale);
        Reporter.log(String.format("View session at: {{portalUrl}}/sessions/%s", getKobitonSessionId()));
    }
}
