using System;
using OpenQA.Selenium;
using OpenQA.Selenium.Remote;

using NUnit.Framework;
using System.Threading;
using System.Collections.Generic;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Appium.Android;
using OpenQA.Selenium.Appium.iOS;
using OpenQA.Selenium.Support.UI;
using System.Drawing;

namespace AppiumTest
{
    public class Tests : TestBase
    {
        [SetUp]
        public void BeforeAll() {
            Assert.AreNotEqual(
                "Please update value for the KobitonApiKey constant first. See more at README.md file.",
                "your_kobiton_api_key",
                Config.KobitonApiKey
            );
        }

        {{testCases}}
        public void RunTest()
        {
            try
            {
                UpdateSettings();
                SwitchToNativeContext();
                SetImplicitWaitInMiliSecond(Config.ImplicitWaitInMs);
                {{testScript}}
            }
            catch (Exception e)
            {
                Console.WriteLine(e.StackTrace);
                SaveDebugResource();
                throw e;
            }
            finally
            {
                Cleanup();
            }
        }

        public override void Setup(AppiumOptions desiredCaps, double retinaScale)
        {
            base.Setup(desiredCaps, retinaScale);
        }

        [TearDown]
        public void TearDown() {
            base.Cleanup();
        }
    }
}