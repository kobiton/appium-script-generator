using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using Newtonsoft.Json;
using System.Collections.Generic;
using PhoneNumbers;
using System.Net;

namespace AppiumTest
{

    public class OtpService
    {
        private static readonly HttpClient httpClient = new HttpClient();

        public const int FindPhoneNumberMaxAttempts = 12;
        public const int FindPhoneNumberInternalInMs = 10000;
        public const int FindEmailAddressMaxAttempts = 12;
        public const int FindEmailAddressIntervalInMs = 10000;
        public const int FindOtpCodeMaxAttempts = 12;
        public const int FindOtpCodeIntervalInMs = 10000;

        public string countryCode = "1";
        public string rawPhoneNumber;
        public string phoneNumber;
        public PhoneNumberUtil phoneNumberUtil = PhoneNumberUtil.GetInstance();

        public string emailAddress;
        public bool isCleanup = false;
        public string otpCode;

        public string FindOtpPhoneNumber(string countryCode)
        {
            Console.WriteLine("Finding an available phone number for OTP...");

            UriBuilder uriBuilder = new(Config.KobitonApiUrl + "/v1/otp/phone-numbers/available");
            uriBuilder.Query = $"countryCode={countryCode}";

            HttpRequestMessage requestBuilder = new HttpRequestMessage(HttpMethod.Get, uriBuilder.Uri);
            requestBuilder.Headers.Authorization = new AuthenticationHeaderValue(Config.GetBasicAuthString());
            
            rawPhoneNumber = Utils.Retry((attempt) =>
            {
                HttpResponseMessage response = httpClient.SendAsync(requestBuilder).GetAwaiter().GetResult();
                string responseBody = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                int responseCode = (int)response.StatusCode;
                if (responseCode != 200)
                {
                    throw new Exception(responseBody);
                }

                rawPhoneNumber = responseBody;
                PhoneNumber parsedPhoneNumber = phoneNumberUtil.ParseAndKeepRawInput(rawPhoneNumber, countryCode);
                phoneNumber = parsedPhoneNumber.NationalNumber.ToString();

                Console.WriteLine($"Found an available phone number {rawPhoneNumber} to receive OTP code");
                return rawPhoneNumber;
            }, FindPhoneNumberMaxAttempts, FindPhoneNumberInternalInMs);

            if (string.IsNullOrEmpty(rawPhoneNumber))
            {
                throw new Exception("No available phone number to receive OTP code");
            }

            return rawPhoneNumber;
        }

        public string FindOtpEmailAddress()
        {
            Console.WriteLine("Finding an email address for OTP...");

            UriBuilder uriBuilder = new(Config.KobitonApiUrl + "/v1/otp/email-address/available");

            HttpRequestMessage requestBuilder = new HttpRequestMessage(HttpMethod.Get, uriBuilder.Uri);
            requestBuilder.Headers.Authorization = new AuthenticationHeaderValue(Config.GetBasicAuthString());

            emailAddress = Utils.Retry((attempt) =>
            {
                HttpResponseMessage response = httpClient.SendAsync(requestBuilder).GetAwaiter().GetResult();
                string responseBody = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                int responseCode = (int)response.StatusCode;
                if (responseCode != 200)
                {
                    throw new Exception(responseBody);
                }


                Console.WriteLine($"Found an available email address {responseBody} to receive OTP code");
                return responseBody;
            }, FindEmailAddressMaxAttempts, FindEmailAddressIntervalInMs);

            if (string.IsNullOrEmpty(emailAddress))
            {
                throw new Exception("No available email address to receive OTP code");
            }

            return emailAddress;
        }

        public string FindOtpCode(string rawPhoneNumber, string emailAddress)
        {
            if (string.IsNullOrEmpty(rawPhoneNumber) && string.IsNullOrEmpty(emailAddress))
            {
                throw new Exception("Please find an available phone number or email address first");
            }

            string otpCode;

            if (!string.IsNullOrEmpty(rawPhoneNumber))
            {
                Console.WriteLine($"Find OTP code sent to phone number {rawPhoneNumber}");
                otpCode = FindOtpCodeForPhoneNumber(rawPhoneNumber);
            }
            else
            {
                Console.WriteLine($"Find OTP code sent to email address {emailAddress}");
                otpCode = FindOtpCodeForEmailAddress(emailAddress);
            }

            if (string.IsNullOrEmpty(otpCode))
            {
                if (!string.IsNullOrEmpty(rawPhoneNumber))
                {
                    throw new Exception($"Cannot find any OTP code sent to phone number {rawPhoneNumber}");
                }
                else
                {
                    throw new Exception($"Cannot find any OTP code sent to email address {emailAddress}");
                }
            }

            return otpCode;
        }

        public void Cleanup()
        {
            if (string.IsNullOrEmpty(rawPhoneNumber) && string.IsNullOrEmpty(emailAddress))
            {
                return;
            }

            if (!string.IsNullOrEmpty(rawPhoneNumber))
            {
                Console.WriteLine($"Cleanup OTP service for phone number {rawPhoneNumber}");
                UnbookPhoneNumber(rawPhoneNumber);
            }
            else
            {
                Console.WriteLine($"Cleanup OTP service for email address {emailAddress}");
                UnbookEmailAddress(emailAddress);
            }
        }

        private string FindOtpCodeForPhoneNumber(string rawPhoneNumber)
        {
            UriBuilder uriBuilder = new(Config.KobitonApiUrl + $"/v1/otp/phone-numbers/{rawPhoneNumber}/otp-code");

            HttpRequestMessage requestBuilder = new HttpRequestMessage(HttpMethod.Get, uriBuilder.Uri);
            requestBuilder.Headers.Authorization = new AuthenticationHeaderValue(Config.GetBasicAuthString());

            otpCode = Utils.Retry((attempt) =>
            {
                HttpResponseMessage response = httpClient.SendAsync(requestBuilder).GetAwaiter().GetResult();
                string responseBody = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                int responseCode = (int)response.StatusCode;
                if (responseCode != 200)
                {
                    throw new Exception(responseBody);
                }


                dynamic jsonObjOtp = JsonConvert.DeserializeObject(responseBody);
                string otpCode = jsonObjOtp.otpCode.ToString();
                return otpCode;
            }, FindOtpCodeMaxAttempts, FindOtpCodeIntervalInMs);

            if (string.IsNullOrEmpty(otpCode))
            {
                throw new Exception($"Cannot find OTP code");
            }

            return otpCode;
        }

        private string FindOtpCodeForEmailAddress(string emailAddress)
        {
            UriBuilder uriBuilder = new(Config.KobitonApiUrl + "/v1/otp/email-address/otp-code");
            uriBuilder.Query = $"emailAddress={emailAddress}";

            HttpRequestMessage requestBuilder = new HttpRequestMessage(HttpMethod.Get, uriBuilder.Uri);
            requestBuilder.Headers.Authorization = new AuthenticationHeaderValue(Config.GetBasicAuthString());

            otpCode = Utils.Retry((attempt) =>
            {
                HttpResponseMessage response = httpClient.SendAsync(requestBuilder).GetAwaiter().GetResult();
                string responseBody = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                int responseCode = (int)response.StatusCode;
                if (responseCode != 200)
                {
                    throw new Exception(responseBody);
                }

                dynamic jsonObjOtp = JsonConvert.DeserializeObject(responseBody);
                string otpCode = jsonObjOtp.otpCode.ToString();
                return otpCode;
            }, FindOtpCodeMaxAttempts, FindOtpCodeIntervalInMs);

            if (string.IsNullOrEmpty(otpCode))
            {
                throw new Exception($"Cannot find OTP code");
            }

            return otpCode;

        }

        private void UnbookPhoneNumber(string rawPhoneNumber)
        {
            var uri = new UriBuilder(Config.KobitonApiUrl + $"/v1/otp/phone-numbers/{rawPhoneNumber}/unbook");

            var request = new HttpRequestMessage
            {
                Method = HttpMethod.Post,
                RequestUri = uri.Uri,
                Headers =
                {
                    {HttpRequestHeader.Authorization.ToString(), Config.GetBasicAuthString()}
                }
            };

            httpClient.SendAsync(request).Wait();
        }

        private void UnbookEmailAddress(string emailAddress)
        {
            var uri = new UriBuilder(Config.KobitonApiUrl + "/v1/otp/email-address/unbook");
            var query = new Dictionary<string, string>
            {
                {"emailAddress", emailAddress}
            };
            uri.Query = new FormUrlEncodedContent(query).ReadAsStringAsync().Result;

            var request = new HttpRequestMessage
            {
                Method = HttpMethod.Post,
                RequestUri = uri.Uri,
                Headers =
                {
                    {HttpRequestHeader.Authorization.ToString(), Config.GetBasicAuthString()}
                }
            };

            httpClient.SendAsync(request).Wait();
        }
    }
}