using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using System.Drawing;

namespace AppiumTest
{
    public class Tests : TestBase
    {
        [SetUp]
        public void BeforeAll() {
            Assert.That(
                Config.KobitonApiKey, Is.Not.EqualTo("your_kobiton_api_key"),
                "Please update value for the KobitonApiKey constant first. See more at README.md file."
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
                throw;
            }
        }

        public override void Setup(AppiumOptions desiredCaps, double retinaScale)
        {
            base.Setup(desiredCaps, retinaScale);
            Console.WriteLine($"View session at: {{portalUrl}}/sessions/{GetKobitonSessionId()}");
        }

        [TearDown]
        public void TearDown() {
            base.Cleanup();
        }
    }
}
