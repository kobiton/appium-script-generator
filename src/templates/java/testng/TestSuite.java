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

    {{testCases}}
}
