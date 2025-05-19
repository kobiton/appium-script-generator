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

        {{desiredCaps}}
    }
}
