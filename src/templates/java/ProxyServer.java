package com.kobiton.scriptlessautomation;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import fi.iki.elonen.NanoHTTPD;
import okhttp3.*;
import org.apache.http.HttpHeaders;
import org.apache.http.client.utils.URIBuilder;
import org.openqa.selenium.remote.ErrorCodes;
import org.springframework.util.SocketUtils;

import java.io.IOException;
import java.util.HashMap;
import java.util.concurrent.TimeUnit;

public class ProxyServer extends NanoHTTPD {
    public long currentCommandId;
    public long kobitonSessionId;
    public Gson gson = new GsonBuilder().disableHtmlEscaping().create();

    private final String authString = Config.getBasicAuthString();
    private final int socketTimeoutInSecond = 15 * 60;
    private boolean forceW3C = false;

    private final OkHttpClient httpClient = new OkHttpClient.Builder()
            .connectTimeout(socketTimeoutInSecond, TimeUnit.SECONDS)
            .writeTimeout(socketTimeoutInSecond, TimeUnit.SECONDS)
            .readTimeout(socketTimeoutInSecond, TimeUnit.SECONDS)
            .build();

    public ProxyServer() throws IOException {
        super(SocketUtils.findAvailableTcpPort());
        start(socketTimeoutInSecond * 1000, false);
    }

    @Override
    public Response serve(IHTTPSession session) {
        try {
            Request request = buildAppiumRequest(session);

            try (okhttp3.Response response = httpClient.newCall(request).execute()) {
                int statusCode = response.code();
                ResponseStatus status = new ResponseStatus(statusCode, response.message());
                String contentType = response.header(HttpHeaders.CONTENT_TYPE, "application/json");
                String bodyString = response.body().string();

                try {
                    if ("/session".equals(session.getUri()) && session.getMethod() == NanoHTTPD.Method.POST && Utils.isStatusCodeSuccess(statusCode)) {
                        JsonObject bodyJson = gson.fromJson(bodyString, JsonObject.class);
                        kobitonSessionId = bodyJson.get("value").getAsJsonObject().get("kobitonSessionId").getAsLong();

                        // JSON Wire format, convert response body to W3C format
                        if (bodyJson.has("status") && bodyJson.has("sessionId")) {
                            forceW3C = true;
                            JsonObject desiredCapsJson = bodyJson.get("value").getAsJsonObject();

                            JsonObject w3cValueJson = new JsonObject();
                            w3cValueJson.add("capabilities", desiredCapsJson);
                            w3cValueJson.addProperty("sessionId", bodyJson.get("sessionId").getAsString());

                            JsonObject w3cBodyJson = new JsonObject();
                            w3cBodyJson.add("value", w3cValueJson);
                            bodyString = w3cBodyJson.toString();
                        }
                    }

                    // Convert JSON Wire error response to W3C format
                    if (!Utils.isStatusCodeSuccess(statusCode) && forceW3C) {
                        JsonObject bodyJson = gson.fromJson(bodyString, JsonObject.class);
                        int appiumErrorCode = bodyJson.get("status").getAsInt();
                        ErrorCodes errorCodes = new ErrorCodes();
                        String error = errorCodes.toState(appiumErrorCode);
                        JsonObject valueJson = bodyJson.getAsJsonObject("value");
                        valueJson.addProperty("error", error);
                        bodyString = bodyJson.toString();
                    }
                } catch (Exception ignored) {
                }

                return newFixedLengthResponse(status, contentType, bodyString);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        return super.serve(session);
    }

    public okhttp3.Request buildAppiumRequest(IHTTPSession session) throws Exception {
        Method method = session.getMethod();
        HashMap<String, String> requestBodyMap = new HashMap<>();
        session.parseBody(requestBodyMap);

        String requestBodyString = null;
        if (method == NanoHTTPD.Method.POST) {
            requestBodyString = requestBodyMap.get("postData");
        } else if (method == NanoHTTPD.Method.PUT) {
            requestBodyString = requestBodyMap.get("putData");
        } else if (method == NanoHTTPD.Method.PATCH) {
            requestBodyString = requestBodyMap.get("patchData");
        }

        RequestBody requestBody = null;
        if (requestBodyString != null) {
            requestBody = RequestBody.create(MediaType.parse("application/json"), requestBodyString);
        }

        String uri = session.getUri();
        if (uri.startsWith("/wd/hub")) {
            uri = uri.replace("/wd/hub", "");
        }

        URIBuilder uriBuilder = new URIBuilder(Config.APPIUM_SERVER_URL + uri);
        if (Config.DEVICE_SOURCE == Config.DEVICE_SOURCE_ENUMS.KOBITON && currentCommandId > 0) {
            uriBuilder.addParameter("baseCommandId", String.valueOf(currentCommandId));
        }

        Request.Builder requestBuilder = new Request.Builder()
                .header(HttpHeaders.AUTHORIZATION, authString)
                .method(method.toString(), requestBody)
                .url(uriBuilder.build().toURL());

        return requestBuilder.build();
    }

    public String getServerUrl() {
        return "http://localhost:" + getListeningPort();
    }

    public static class ResponseStatus implements NanoHTTPD.Response.IStatus {
        public int requestStatus;
        public String description;

        public ResponseStatus(int requestStatus, String description) {
            this.requestStatus = requestStatus;
            this.description = description;
        }

        @Override
        public String getDescription() {
            return "" + requestStatus + " " + description;
        }

        @Override
        public int getRequestStatus() {
            return requestStatus;
        }
    }
}
