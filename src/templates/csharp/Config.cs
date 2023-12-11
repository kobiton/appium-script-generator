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
        public enum DeviceSourceEnums { Kobiton, SauceLabs }

        public const string {{USER_NAME}} = "{{username}}";
        public const string {{API_KEY}} = "{{your_api_key}}";
        public const string AppiumServerUrl = {{appiumServerUrl}};
        public const DeviceSourceEnums DeviceSource = DeviceSourceEnums.Kobiton;
        public const int ImplicitWaitInMs = 30000;
        public const int DeviceWaitingMaxTryTimes = 5;
        public const int DeviceWaitingInternalInMs = 30000;
        public const int VisibilityTimeoutInMs = 60000;
        public const int SleepTimeBeforeSendKeysInMs = 3000;
        public const string KobitonApiUrl = "{{KobitonApiUrl}}";
        {{kobitonCredential}}
        public const string AppVersion = "{{app_version}}";

        public static string GetBasicAuthString()
        {
            string authString = KobitonUserName + ":" + KobitonApiKey;
            byte[] authEncBytes = System.Text.Encoding.UTF8.GetBytes(authString);
            string authEncString = Convert.ToBase64String(authEncBytes);
            return "Basic " + authEncString;
        }

        {{desiredCaps}}
    }
}
