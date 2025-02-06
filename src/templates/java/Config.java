package com.kobiton.scriptlessautomation;

import org.apache.commons.codec.binary.Base64;
import org.openqa.selenium.remote.DesiredCapabilities;

import java.net.MalformedURLException;
import java.net.URL;

public class Config {
    enum DEVICE_SOURCE_ENUMS {KOBITON, OTHER}

    public static final String API_USERNAME = "{{username}}";
    public static final String API_KEY = "{{your_api_key}}";
    public static final String APPIUM_SERVER_URL = {{appiumServerUrl}};
    public static final DEVICE_SOURCE_ENUMS DEVICE_SOURCE = DEVICE_SOURCE_ENUMS.{{deviceSource}};
    public static final int IMPLICIT_WAIT_IN_MS = 10000;
    public static final int DEVICE_WAITING_MAX_TRY_TIMES = 5;
    public static final int DEVICE_WAITING_INTERVAL_IN_MS = 30000;
    public static final int SLEEP_TIME_BEFORE_SEND_KEYS_IN_MS = 3000;
    public static final String KOBITON_API_URL = "{{kobiton_api_url}}";
    {{kobitonCredential}}

    public static String getAppiumServerUrlWithAuth() throws MalformedURLException {
        URL url = new URL(Config.APPIUM_SERVER_URL);
        int port = url.getPort() == -1 ? url.getDefaultPort() : url.getPort();
        return String.format("%s://%s:%s@%s:%s%s", url.getProtocol(), API_USERNAME, API_KEY, url.getHost(), port, url.getFile());
    }

    public static String getBasicAuthString() {
        String authString = API_USERNAME + ":" + API_KEY;
        byte[] authEncBytes = Base64.encodeBase64(authString.getBytes());
        String authEncString = new String(authEncBytes);
        return "Basic " + authEncString;
    }

    {{desiredCaps}}
}
