package com.kobiton.scriptlessautomation;

import io.appium.java_client.MobileBy;
import io.appium.java_client.MobileElement;
import io.appium.java_client.remote.MobileCapabilityType;
import org.junit.Before;
import org.junit.After;
import org.junit.Test;
import org.junit.Assert;
import org.openqa.selenium.By;
import org.openqa.selenium.Point;
import org.openqa.selenium.Rectangle;
import org.openqa.selenium.ScreenOrientation;
import org.openqa.selenium.remote.DesiredCapabilities;
import org.openqa.selenium.html5.Location;

public class TestApp extends TestBase {
    @Before
    public void beforeTest() throws Exception {
        Assert.assertNotEquals(
            "Please update value for the KOBITON_API_KEY constant first. See more at README.md file.",
            "your_kobiton_api_key",
            Config.KOBITON_API_KEY
        );
    }

    {{testCases}}
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
        }
    }

    @After
    public void tearDown() {
        cleanup();
    }
}
