package com.kobiton.scriptlessautomation;

import io.appium.java_client.MobileBy;
import io.appium.java_client.MobileElement;
import io.appium.java_client.remote.MobileCapabilityType;
import org.testng.Reporter;
import org.openqa.selenium.By;
import org.openqa.selenium.Point;
import org.openqa.selenium.Rectangle;
import org.openqa.selenium.ScreenOrientation;
import org.openqa.selenium.remote.DesiredCapabilities;
import org.openqa.selenium.html5.Location;

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
