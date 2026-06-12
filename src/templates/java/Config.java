package com.kobiton.scriptlessautomation;

import okhttp3.OkHttpClient;
import org.apache.commons.codec.binary.Base64;
import org.openqa.selenium.remote.DesiredCapabilities;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.net.MalformedURLException;
import java.net.URL;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Arrays;

public class Config {
    enum DEVICE_SOURCE_ENUMS {KOBITON, OTHER}

    public static final String API_USERNAME = "{{username}}";
    public static final String API_KEY = "{{your_api_key}}";
    public static final String APPIUM_SERVER_URL = {{appiumServerUrl}};
    public static final DEVICE_SOURCE_ENUMS DEVICE_SOURCE = DEVICE_SOURCE_ENUMS.{{deviceSource}};
    public static final int IMPLICIT_WAIT_IN_MS = 10000;
    public static final int DEVICE_WAITING_MAX_TRY_TIMES = 5;
    public static final int DEVICE_WAITING_INTERVAL_IN_MS = 30000;
    public static final int SEND_KEYS_DELAY_IN_MS = 1500;
    public static final int IDLE_DELAY_IN_MS = 3000;
    public static final String KOBITON_API_URL = "{{kobiton_api_url}}";
    // Run with KOBITON_TRUST_ALL_CERTS=true to skip TLS cert validation — needed
    // for on-prem standalone deployments served over a self-signed certificate.
    public static final boolean TRUST_ALL_CERTS = Arrays.asList("1", "true", "yes")
            .contains(String.valueOf(System.getenv("KOBITON_TRUST_ALL_CERTS")).trim().toLowerCase());
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

    // Returns an OkHttpClient builder that trusts any TLS certificate when
    // TRUST_ALL_CERTS is enabled; otherwise a default builder that validates
    // certificates normally. Used by the proxy and all Kobiton REST clients.
    public static OkHttpClient.Builder createHttpClientBuilder() {
        OkHttpClient.Builder builder = new OkHttpClient.Builder();
        if (!TRUST_ALL_CERTS) {
            return builder;
        }

        try {
            TrustManager[] trustAllCerts = new TrustManager[]{
                new X509TrustManager() {
                    public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                    public void checkServerTrusted(X509Certificate[] chain, String authType) {}
                    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                }
            };
            SSLContext sslContext = SSLContext.getInstance("TLS");
            sslContext.init(null, trustAllCerts, new SecureRandom());
            builder.sslSocketFactory(sslContext.getSocketFactory(), (X509TrustManager) trustAllCerts[0]);
            builder.hostnameVerifier((hostname, session) -> true);
        } catch (Exception e) {
            throw new RuntimeException("Failed to build trust-all SSL context", e);
        }

        return builder;
    }

    {{desiredCaps}}
}
