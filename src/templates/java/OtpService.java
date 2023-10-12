package com.kobiton.scriptlessautomation;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.i18n.phonenumbers.PhoneNumberUtil;
import com.google.i18n.phonenumbers.Phonenumber;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.apache.http.HttpHeaders;
import org.apache.http.client.utils.URIBuilder;

public class OtpService {
    public static final int FIND_PHONE_NUMBER_MAX_ATTEMPTS = 12;
    public static final int FIND_PHONE_NUMBER_INTERVAL_IN_MS = 10000;
    public static final int FIND_EMAIL_ADDRESS_MAX_ATTEMPTS = 12;
    public static final int FIND_EMAIL_ADDRESS_INTERVAL_IN_MS = 10000;
    public static final int FIND_OTP_CODE_MAX_ATTEMPTS = 12;
    public static final int FIND_OTP_CODE_INTERVAL_IN_MS = 10000;

    private final OkHttpClient httpClient = new OkHttpClient();

    public String countryCode = "1";
    public String rawPhoneNumber;
    public String phoneNumber;
    public PhoneNumberUtil phoneNumberUtil = PhoneNumberUtil.getInstance();
    public Gson gson = new GsonBuilder().disableHtmlEscaping().create();

    public String emailAddress;

    public boolean isCleanup = false;
    public String otpCode;

    public String findOtpPhoneNumber(String countryCode) throws Exception {
        System.out.println("Finding an available phone number for OTP...");

        this.countryCode = countryCode;
        URIBuilder uriBuilder = new URIBuilder(Config.KOBITON_API_URL + "/v1/otp/phone-numbers/available");
        uriBuilder.addParameter("countryCode", countryCode);

        Request.Builder requestBuilder = new Request.Builder()
                .url(uriBuilder.build().toURL())
                .header(HttpHeaders.AUTHORIZATION, Config.getBasicAuthString())
                .get();

        rawPhoneNumber = Utils.retry(new Utils.Task<String>() {
            private int responseCode;

            @Override
            String exec(int attempt) throws Exception {
                try (Response response = httpClient.newCall(requestBuilder.build()).execute()) {
                    responseCode = response.code();
                    String responseBody = response.body().string();
                    if (responseCode != 200) {
                        throw new Exception(responseBody);
                    }

                    isCleanup = false;
                    rawPhoneNumber = responseBody;
                    Phonenumber.PhoneNumber parsedPhoneNumber = phoneNumberUtil.parseAndKeepRawInput(rawPhoneNumber, countryCode);
                    phoneNumber = String.valueOf(parsedPhoneNumber.getNationalNumber());

                    System.out.println(String.format("Found an available phone number %s to receive OTP code", rawPhoneNumber));
                    return rawPhoneNumber;
                }
            }

            @Override
            public void handleException(Exception e, int attempt) throws Exception {
                if (responseCode == 401 || responseCode == 403) {
                    throw e;
                }

                System.out.println(e.getMessage());
            }
        }, FIND_PHONE_NUMBER_MAX_ATTEMPTS, FIND_PHONE_NUMBER_INTERVAL_IN_MS);

        if (rawPhoneNumber == null || rawPhoneNumber.isEmpty()) {
            throw new Exception("No available phone number to receive OTP code");
        }

        return rawPhoneNumber;
    }

    public String getRandomPhoneNumber(int numberLength) {
        long min = (long) Math.pow(10, numberLength - 1);
        long max = (long) Math.pow(10, numberLength) - 1;
        long randomNumber = min + (long) (Math.random() * ((max - min) + 1));
        return String.valueOf(randomNumber);
    }

    public String findOtpEmailAddress() throws Exception {
        System.out.println("Finding an email address for OTP...");

        URIBuilder uriBuilder = new URIBuilder(Config.KOBITON_API_URL + "/v1/otp/email-address/available");

        Request.Builder requestBuilder = new Request.Builder()
                .url(uriBuilder.build().toURL())
                .header(HttpHeaders.AUTHORIZATION, Config.getBasicAuthString())
                .get();

        emailAddress = Utils.retry(new Utils.Task<String>() {
            private int responseCode;

            @Override
            String exec(int attempt) throws Exception {
                try (Response response = httpClient.newCall(requestBuilder.build()).execute()) {
                    responseCode = response.code();
                    String responseBody = response.body().string();
                    if (responseCode != 200) {
                        throw new Exception(responseBody);
                    }

                    isCleanup = false;

                    System.out.println(String.format("Found an available email address %s to receive OTP code", responseBody));
                    return responseBody;
                }
            }

            @Override
            public void handleException(Exception e, int attempt) throws Exception {
                if (responseCode == 401 || responseCode == 403) {
                    throw e;
                }

                System.out.println(e.getMessage());
            }
        }, FIND_EMAIL_ADDRESS_MAX_ATTEMPTS, FIND_EMAIL_ADDRESS_INTERVAL_IN_MS);

        if (emailAddress == null || emailAddress.isEmpty()) {
            throw new Exception("No available email address to receive OTP code");
        }

        return emailAddress;
    }

    public String findOtpCode() throws Exception {
        if (rawPhoneNumber == null && emailAddress == null) {
            throw new Exception("Please find an available phone number or email address first");
        }

        URIBuilder uriBuilder;
        if (rawPhoneNumber != null) {
            System.out.println(String.format("Find OTP code sent to phone number %s", rawPhoneNumber));
            uriBuilder = new URIBuilder(Config.KOBITON_API_URL + String.format("/v1/otp/phone-numbers/%s/otp-code", rawPhoneNumber));
        } else {
            System.out.println(String.format("Find OTP code sent to email address %s", emailAddress));
            uriBuilder = new URIBuilder(Config.KOBITON_API_URL + "/v1/otp/email-address/otp-code");
            uriBuilder.addParameter("emailAddress", emailAddress);
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(uriBuilder.build().toURL())
                .header(HttpHeaders.AUTHORIZATION, Config.getBasicAuthString())
                .get();

        otpCode = Utils.retry(new Utils.Task<String>() {
            private int responseCode;
            @Override
            String exec(int attempt) throws Exception {
                try (Response response = httpClient.newCall(requestBuilder.build()).execute()) {
                    responseCode = response.code();
                    String responseBody = response.body().string();
                    if (responseCode != 200) throw new Exception(responseBody);

                    JsonObject jsonObjOtp = gson.fromJson(responseBody, JsonObject.class);
                    otpCode = jsonObjOtp.get("otpCode").getAsString();
                    if (otpCode == null || otpCode.isEmpty()) {
                        throw new Exception(String.format("Cannot find OTP code after %s attempt", Utils.convertToOrdinal(attempt)));
                    }

                    cleanup();
                    return otpCode;
                }
            }

            @Override
            public void handleException(Exception e, int attempt) throws Exception {
                if (responseCode == 401 || responseCode == 403) {
                    throw e;
                }

                System.out.println(e.getMessage());
            }
        }, FIND_OTP_CODE_MAX_ATTEMPTS, FIND_OTP_CODE_INTERVAL_IN_MS);

        if (otpCode == null || otpCode.isEmpty()) {
            if (rawPhoneNumber != null) {
                throw new Exception(String.format("Cannot find any OTP code sent to phone number %s", rawPhoneNumber));
            } else {
                throw new Exception(String.format("Cannot find any OTP code sent to email address %s", emailAddress));
            }
        }

        return otpCode;
    }

    public void cleanup() {
        if (isCleanup || (rawPhoneNumber == null && emailAddress == null)) {
            return;
        }

        if (rawPhoneNumber != null) {
            System.out.println(String.format("Cleanup OTP service for phone number %s", rawPhoneNumber));
        } else {
            System.out.println(String.format("Cleanup OTP service for email address %s", emailAddress));
        }

        try {
            URIBuilder uriBuilder;
            if (rawPhoneNumber != null) {
                uriBuilder = new URIBuilder(Config.KOBITON_API_URL + String.format("/v1/otp/phone-numbers/%s/unbook", rawPhoneNumber));
            } else {
                uriBuilder = new URIBuilder(Config.KOBITON_API_URL + "/v1/otp/email-address/unbook");
                uriBuilder.addParameter("emailAddress", emailAddress);
            }

            Request.Builder requestBuilder = new Request.Builder()
                    .url(uriBuilder.build().toURL())
                    .header(HttpHeaders.AUTHORIZATION, Config.getBasicAuthString())
                    .post(RequestBody.create(null, new byte[0]));



            try (Response response = httpClient.newCall(requestBuilder.build()).execute()) {
                isCleanup = true;
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
