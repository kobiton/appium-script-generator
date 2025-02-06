package com.kobiton.scriptlessautomation;

import org.openqa.selenium.remote.DesiredCapabilities;
import org.testng.annotations.BeforeTest;
import org.testng.annotations.Test;
import org.testng.Assert;

public class TestSuite {
    @BeforeTest
    public void beforeTest() {
        Assert.assertNotEquals(
            Config.API_KEY,
            "your_api_key",
            "Please update value for the API_KEY constant first. See more at README.md file."
        );
    }

    @Test
    public void testOnPixel4XLAndroid13() throws Exception {
        TestApp testApp = new TestApp();
        DesiredCapabilities capabilities = Config.getPixel4XLAndroid13DesiredCapabilities();
        testApp.findOnlineDevice(capabilities);
        testApp.setup(capabilities, 1);
        testApp.runTest();
    }


}
