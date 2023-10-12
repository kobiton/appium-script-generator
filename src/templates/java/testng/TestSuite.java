package com.kobiton.scriptlessautomation;

import org.openqa.selenium.remote.DesiredCapabilities;
import org.testng.annotations.BeforeTest;
import org.testng.annotations.Test;
import org.testng.Assert;

public class TestSuite {
    @BeforeTest
    public void beforeTest() {
        Assert.assertNotEquals(
            Config.KOBITON_API_KEY,
            "your_kobiton_api_key",
            "Please update value for the KOBITON_API_KEY constant first. See more at README.md file."
        );
    }

    {{testCases}}
}
