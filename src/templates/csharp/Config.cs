using System;
using System.Buffers.Text;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using OpenQA.Selenium.Appium;

namespace AppiumTest
{
    public class Config
    {
        public enum DeviceSourceEnums { Kobiton, Other }

        public const string ApiUsername = "{{username}}";
        public const string ApiKey = "{{your_api_key}}";
        public const string AppiumServerUrl = {{appiumServerUrl}};
        public const DeviceSourceEnums DeviceSource = DeviceSourceEnums.Kobiton;
        public const int ImplicitWaitInMs = 10000;
        public const int DeviceWaitingMaxTryTimes = 5;
        public const int DeviceWaitingInternalInMs = 30000;
        public const int SendKeysDelayInMs = 1500;
        public const int IdleDelayInMs = 3000;
        public const string KobitonApiUrl = "{{KobitonApiUrl}}";
        // Run with KOBITON_TRUST_ALL_CERTS=true to skip TLS cert validation — needed
        // for on-prem standalone deployments served over a self-signed certificate.
        public static readonly bool TrustAllCerts = new[] { "1", "true", "yes" }
            .Contains((Environment.GetEnvironmentVariable("KOBITON_TRUST_ALL_CERTS") ?? "").Trim().ToLower());
        {{kobitonCredential}}

        public static string GetAppiumServerUrlWithAuth()
        {
            var uri = new Uri(AppiumServerUrl);
            return $"{uri.Scheme}://{ApiUsername}:{ApiKey}@{uri.Host}:{uri.Port}{uri.PathAndQuery}";
        }

        public static string GetBasicAuthString()
        {
            string authString = ApiUsername + ":" + ApiKey;
            byte[] authEncBytes = System.Text.Encoding.UTF8.GetBytes(authString);
            string authEncString = Convert.ToBase64String(authEncBytes);
            return "Basic " + authEncString;
        }

        // Returns an HttpClient that trusts any TLS certificate when TrustAllCerts
        // is enabled; otherwise a default client that validates certificates
        // normally. Used by the proxy and all Kobiton REST clients.
        public static HttpClient CreateHttpClient()
        {
            if (!TrustAllCerts)
            {
                return new HttpClient();
            }

            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback = (message, cert, chain, errors) => true
            };
            return new HttpClient(handler);
        }

        {{desiredCaps}}
    }
}
