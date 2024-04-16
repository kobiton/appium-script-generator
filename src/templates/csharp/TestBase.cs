
using Newtonsoft.Json;
using OpenQA.Selenium.Appium.Android;
using OpenQA.Selenium.Appium.Enums;
using OpenQA.Selenium.Appium.iOS;
using OpenQA.Selenium.Appium.MultiTouch;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium;
using System.Drawing;

using Castle.Core.Internal;
using System.Text;
using HtmlAgilityPack;
using Newtonsoft.Json.Linq;
using System.Text.RegularExpressions;
using System.Net;
using OpenQA.Selenium.Interactions;

namespace AppiumTest
{
    public class TestBase
    {
        public enum PressTypes { Home, Back, Power, AppSwitch, Enter, Delete }

        public AppiumDriver<AppiumWebElement> driver;
        public AppiumOptions options;
        public ProxyServer proxy;
        public bool isIos;
        public Point screenSize;
        public double retinaScale;
        public string deviceName, platformVersion;
        public HttpClient httpClient = new HttpClient();
        private string currentContext;

        public static string IosXpathRedundantPrefix = "/AppiumAUT";
        public static string NativeContext = "NATIVE_APP";
        private const int SleepAfterAction = 200;

        public virtual void Setup(AppiumOptions desiredCaps, double retinaScale)
        {
            this.options = desiredCaps;
            this.retinaScale = retinaScale;
            this.isIos = MobilePlatform.IOS.Equals(desiredCaps.ToCapabilities().GetCapability(MobileCapabilityType.PlatformName).ToString());
            this.deviceName= desiredCaps.ToCapabilities().GetCapability(MobileCapabilityType.DeviceName).ToString();
            this.platformVersion = desiredCaps.ToCapabilities().GetCapability(MobileCapabilityType.PlatformVersion).ToString();

            if (Config.DeviceSource == Config.DeviceSourceEnums.Kobiton)
            {
                proxy = new ProxyServer();
                proxy.StartProxy();
            }

            Uri appiumServerUrl = GetAppiumServerUrl();
            if (isIos)
            {
                driver = new IOSDriver<AppiumWebElement>(appiumServerUrl, desiredCaps);
            }
            else
            {
                driver = new AndroidDriver<AppiumWebElement>(appiumServerUrl, desiredCaps);
            }
        }

        public async void Cleanup()
        {
            if (driver != null)
            {
                driver.Quit();
            }

            if (proxy != null)
            {
                proxy.StopProxy();
            }
        }

        public void SwitchContext(string context)
        {
            if (currentContext == context) return;
            Console.WriteLine($"Switch to {context} context");
            driver.Context = context;
            currentContext = context;
        }

        public void SwitchToNativeContext()
        {
            string currentContext = driver.Context;
            if (NativeContext.Equals(currentContext))
            {
                return;
            }

            SwitchContext(NativeContext);
        }

        public string SwitchToWebContext()
        {
            for (int tryTime = 1; tryTime <= 3; tryTime++) {
                Console.WriteLine($"Find a web context, {Utils.ConvertToOrdinal(tryTime)} time");
                List<ContextInfo> contextInfos = new List<ContextInfo>();

                SwitchToNativeContext();
                HtmlDocument nativeDocument = new HtmlDocument();
                nativeDocument = LoadXMLFromString(driver.PageSource);
                string textNodeSelector = isIos ? "//XCUIElementTypeStaticText" : "//android.widget.TextView";
                List<string> nativeTexts = new List<string>();
                var textNodes = nativeDocument.DocumentNode.SelectNodes(textNodeSelector);

                if(textNodes != null)
                {
                    foreach (HtmlNode element in nativeDocument.DocumentNode.SelectNodes(textNodeSelector))
                    {
                        if (element.NodeType != HtmlNodeType.Element) continue;
                        string textAttr = element.Attributes[isIos ? "value" : "text"].Value;
                        if (textAttr == null)
                            textAttr = "";
                        textAttr = textAttr.Trim().ToLower();
                        if (!string.IsNullOrEmpty(textAttr))
                            nativeTexts.Add(textAttr);
                    }
                }

                HashSet<string> contexts = new HashSet<string>(driver.Contexts);
                foreach (string context in contexts)
                {
                    if (context.StartsWith("WEBVIEW") || context.Equals("CHROMIUM"))
                    {
                        string source = null;
                        try
                        {
                            SwitchContext(context);
                            source = driver.PageSource;
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"Bad context {context}, error \"{ex.Message}\", skipping...");
                            continue;
                        }

                        if (source == null) continue;
                        ContextInfo contextInfo = contextInfos.FirstOrDefault(e => e.context.Equals(context));
                        if (contextInfo == null)
                        {
                            contextInfo = new ContextInfo(context);
                            contextInfos.Add(contextInfo);
                        }

                        contextInfo.sourceLength = source.Length;
                        if (nativeTexts.IsNullOrEmpty()) continue;

                        HtmlDocument htmlDoc = LoadXMLFromString(source);
                        HtmlNode bodyElements = htmlDoc.DocumentNode.SelectSingleNode("/html/body");
                        if (bodyElements == null) continue;

                        HtmlNode bodyElement = bodyElements.FirstChild;

                        string bodyString = bodyElement.InnerText.ToLower();
                        long matchTexts = 0;
                        foreach (string nativeText in nativeTexts)
                        {
                            if (bodyString.Contains(nativeText)) matchTexts++;
                        }

                        contextInfo.matchTexts = matchTexts;
                        contextInfo.matchTextsPercent = matchTexts * 100 / nativeTexts.Count();
                        if (contextInfo.matchTextsPercent >= 80)
                        {
                            break;
                        }
                    }
                }

                if (!contextInfos.IsNullOrEmpty())
                {
                    string bestWebContext;
                    contextInfos.Sort((ContextInfo c1, ContextInfo c2) => (int)(c2.matchTextsPercent - c1.matchTextsPercent));
                    if (contextInfos[0].matchTextsPercent > 40)
                    {
                        bestWebContext = contextInfos[0].context;
                    }
                    else
                    {
                        contextInfos.Sort((ContextInfo c1, ContextInfo c2) => (int)(c2.sourceLength - c1.sourceLength));
                        bestWebContext = contextInfos[0].context;
                    }

                    SwitchContext(bestWebContext);
                    SetImplicitWaitInMiliSecond(Config.ImplicitWaitInMs);
                    Console.WriteLine($"Switched to {bestWebContext} web context successfully");
                    return bestWebContext;
                }

                Thread.Sleep(10000);
            }

            throw new Exception("Cannot find any web context");
        }

        protected HtmlDocument LoadXMLFromString(string xml)
        {
            HtmlDocument htmlDocument = new HtmlDocument();
            htmlDocument.LoadHtml(xml);
            return htmlDocument;
        }

        public Rectangle FindWebElementRect(bool isOnKeyboard, params By[] locatorVarName)
        {
            Console.WriteLine($"Finding webview element rectangle with locator {locatorVarName}");
            if (!isOnKeyboard) {
                HideKeyboard();
            }

            SwitchToWebContext();
            AppiumWebElement elementVarName = FindVisibleWebElement(locatorVarName);
            ScrollToWebElement(elementVarName);

            Rectangle webRectVarName = GetWebElementRect(elementVarName);
            SwitchToNativeContext();
            return CalculateNativeRect(webRectVarName);
        }

        public Object ExecuteScriptOnWebElement(AppiumWebElement element, string command)
        {
            string script = File.ReadAllText("../../../test/resources/execute-script-on-web-element.js", Encoding.UTF8);
            return driver.ExecuteScript(script, element, command);
        }

        public void ScrollToWebElement(AppiumWebElement element)
        {
            Console.WriteLine($"Scroll to web element {element.TagName}");
            ExecuteScriptOnWebElement(element, "scrollIntoView");
        }

        public Rectangle GetWebElementRect(AppiumWebElement element)
        {
            string resultString = (string) ExecuteScriptOnWebElement(element, "getBoundingClientRect");
            dynamic resultJson = JsonConvert.DeserializeObject(resultString);
            Rectangle rect = new Rectangle(
                (int)(Convert.ToInt64(resultJson.x) / retinaScale),
                (int)(Convert.ToInt64(resultJson.y) / retinaScale),
                (int)(Convert.ToInt64(resultJson.width) / retinaScale),
                (int)(Convert.ToInt64(resultJson.height) / retinaScale)
            );

            return rect;
        }

        public Rectangle CalculateNativeRect(Rectangle webElementRect)
        {
            AppiumWebElement appiumWebElement = FindWebview();
            Rectangle webviewRect = new Rectangle(
                appiumWebElement.Location.X,
                appiumWebElement.Location.Y,
                appiumWebElement.Size.Width,
                appiumWebElement.Size.Height
            );

            AppiumWebElement topToolbar = null;
            if (this.isIos) {
                try
                {
                    topToolbar = FindElementBy(By.XPath("//*[@name='TopBrowserBar' or @name='topBrowserBar' or @name='TopBrowserToolbar' or child::XCUIElementTypeButton[@name='URL']]"));
                }
                catch (Exception ignored)
                {
                    HtmlDocument nativeDocument = LoadXMLFromString(driver.PageSource);
                    HtmlNode webviewNode = nativeDocument.DocumentNode.SelectSingleNode("//XCUIElementTypeWebView");
                    HtmlNode curElement = webviewNode.ParentNode;

                    while (curElement != null)
                    {
                        HtmlNode firstChildElement = curElement.SelectSingleNode("//XCUIElementTypeWebView");

                        Rectangle firstChildRect = new Rectangle(
                            int.Parse(firstChildElement.Attributes["x"].Value),
                            int.Parse(firstChildElement.Attributes["y"].Value),
                            int.Parse(firstChildElement.Attributes["width"].Value),
                            int.Parse(firstChildElement.Attributes["height"].Value)
                        );

                        if (!webviewRect.Equals(firstChildRect) && Utils.IsRectangleInclude(webviewRect, firstChildRect))
                        {
                            string topToolbarXpath = firstChildElement.XPath.Replace(IosXpathRedundantPrefix, "");
                            topToolbar = FindElementBy(By.XPath(topToolbarXpath));
                            break;
                        }

                        curElement = curElement.ParentNode;
                    }
                }
            }

            int deltaHeight = 0;
            if (topToolbar != null) {
                int webViewTop = webviewRect.Y;
                Rectangle topToolbarRect = new Rectangle(
                    topToolbar.Location.X,
                    topToolbar.Location.Y,
                    topToolbar.Size.Width,
                    topToolbar.Size.Height
                );
                webViewTop = topToolbarRect.Y + topToolbarRect.Height;
                deltaHeight = webViewTop - webviewRect.Y;
            }

            webviewRect = new Rectangle(
                webviewRect.X,
                webviewRect.Y,
                webviewRect.Width,
                webviewRect.Height - deltaHeight
            );

            Rectangle nativeRect = new Rectangle(
                webviewRect.X + webElementRect.X,
                webviewRect.Y + webElementRect.Y,
                webElementRect.Width,
                webElementRect.Height
            );
            return nativeRect;
        }

        private List<AppiumWebElement> FindElements(AppiumWebElement rootElement, int timeoutInMiliSeconds, bool multiple, params By[] locators)
        {
            string locatorText = Utils.GetLocatorText(locators);
            Console.WriteLine($"Find element by: {locatorText}");
            string notFoundMessage = $"Cannot find element by: {locatorText}";

            if (locators.Length == 1) {
                SetImplicitWaitInMiliSecond(timeoutInMiliSeconds);

                List<AppiumWebElement> elements = null;
                if (rootElement == null)
                {
                    elements = driver.FindElements(locators[0]).ToList();
                }
                else
                {
                    elements = rootElement.FindElements(locators[0]).ToList();
                }

                SetImplicitWaitInMiliSecond(Config.ImplicitWaitInMs);

                if (multiple && elements != null && !elements.IsNullOrEmpty())
                    return elements;
                else if (!multiple && elements != null && elements.Count == 1)
                    return elements;

                throw new Exception(notFoundMessage);
            } else {
                int waitInterval = 5;

                return Utils.Retry((attempt) =>
                {
                    SetImplicitWaitInMiliSecond(0);
                    List<AppiumWebElement> elements = null;
                    foreach (By locator in locators)
                    {
                        if (rootElement == null)
                        {
                            elements = driver.FindElements(locators[0]).ToList();
                        }
                        else
                        {
                            elements = rootElement.FindElements(locators[0]).ToList();
                        }

                        if (multiple && elements != null && !elements.IsNullOrEmpty())
                                return elements;
                        else if (!multiple && elements != null && elements.Count() == 1)
                            return elements;
                    }

                    SetImplicitWaitInMiliSecond(Config.ImplicitWaitInMs);
                    throw new Exception(notFoundMessage);

                }, timeoutInMiliSeconds / (waitInterval * 1000), waitInterval * 1000);
            }
        }



        public AppiumWebElement FindElementBy(AppiumWebElement rootElement, int timeoutInMiliSeconds, params By[] locators)
        {
            List<AppiumWebElement> foundElements = FindElements(rootElement, timeoutInMiliSeconds, false, locators);
                if (foundElements == null || foundElements.Count != 1) {
                throw new Exception($"Cannot find element by: {Utils.GetLocatorText(locators)}");
            }

            return foundElements.ElementAt(0);
        }

        public AppiumWebElement FindElementBy(params By[] locators)
        {
            return FindElementBy(null, Config.ImplicitWaitInMs, locators);
        }

        public AppiumWebElement FindElementBy(int timeoutInMiliSeconds, params By[] locators)
        {
                return FindElementBy(null, Math.Max(Config.ImplicitWaitInMs, timeoutInMiliSeconds), locators);
        }

        public List<AppiumWebElement> FindElementsBy(AppiumWebElement rootElement, int timeoutInMiliSeconds, params By[] locators)
        {
            List<AppiumWebElement> foundElements = FindElements(rootElement, timeoutInMiliSeconds, true, locators);
                if (foundElements == null || foundElements.IsNullOrEmpty()) {
                throw new Exception($"Cannot find elements by: {Utils.GetLocatorText(locators)}");
            }

            return foundElements;
        }

        public List<AppiumWebElement> FindElementsBy(params By[] locators)
        {
            return FindElementsBy(null, Config.ImplicitWaitInMs, locators);
        }

        public bool IsButtonElement(AppiumWebElement element)
        {
            try
            {
                string tagName = element.GetAttribute("tagName");
                return !string.IsNullOrEmpty(tagName) && tagName.Trim().ToLower() == "button";
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error when retrieving tag name: " + ex.Message);
                return false;
            }
        }

        public AppiumWebElement FindVisibleWebElement(params By[] locators)
        {
            string locatorText = Utils.GetLocatorText(locators);
            Console.WriteLine($"Find visible web element by: {locatorText}");

            List<AppiumWebElement> foundElements = FindElementsBy(locators);
            AppiumWebElement visibleElement = null;
            foreach (AppiumWebElement element in foundElements) {
                string res = (string)ExecuteScriptOnWebElement(element, "isElementVisible");
                bool visible = "true".Equals(res);
                if (visible)
                {
                    visibleElement = element;
                    break;
                }
            }

            if (visibleElement != null)
                return visibleElement;
            else
                throw new Exception($"Cannot find visible web element by: {locatorText}");
        }

        public AppiumWebElement FindWebview()
        {
            string className = this.isIos ? "XCUIElementTypeWebView" : "android.webkit.WebView";
            return driver.FindElement(By.ClassName(className));
        }

        /**
         * Touch at center of element (element need to be visible)
         */
        public TouchAction TouchAtCenterOfElement(AppiumWebElement element)
        {
            Console.WriteLine($"Touch at center of element {element.TagName}");

            TouchAction action = new TouchAction(driver);
            action.Tap(element);
            action.Perform();
            return action;
        }

        /**
         * Handle event touch element
         */
        public void TouchOnElementByType(AppiumWebElement element, double relativePointX, double relativePointY)
        {
            if (IsButtonElement(element)) {
                ClickElement(element);
            } else {
                TouchAtRelativePointOfElement(element, relativePointX, relativePointY);
            }
        }

        /**
         * Click element (element need to be visible)
         */
        public void ClickElement(AppiumWebElement element)
        {
            Console.WriteLine($"Click on element with type: {element.TagName}");
            element.Click();
        }

        /**
         * Touch at relative point of element (element need to be visible)
         */
        public TouchAction TouchAtRelativePointOfElement(AppiumWebElement element, double relativePointX, double relativePointY)
        {
            Console.WriteLine($"Touch on element {element.TagName} at relative point ({relativePointX} {relativePointY})");
            Rectangle topToolbarRect = new Rectangle(
                element.Location.X,
                element.Location.Y,
                element.Size.Width,
                element.Size.Height
            );
            return TouchAtPoint(GetAbsolutePoint(relativePointX, relativePointY, topToolbarRect));
        }

        /**
         * Touch at a relative position
         */
        public TouchAction TouchAtPoint(double relativePointX, double relativePointY)
        {
            Console.WriteLine($"Touch at relative point ({relativePointX}, {relativePointY})");

            Point absolutePoint = GetAbsolutePoint(relativePointX, relativePointY);
            return TouchAtPoint(absolutePoint);
        }

        /**
         * Touch at a Point
         */
        public TouchAction TouchAtPoint(Point point)
        {
            Console.WriteLine($"Touch at point ({point.X}, {point.Y})");

            TouchAction action = new TouchAction(driver);
            action.Tap(point.X, point.Y);
            action.Perform();

            return action;
        }

        /**
         * Swipe from center of element (with accelerate)
         */
        public void SwipeFromPoint(Point fromPoint, double relativeOffsetX, double relativeOffsetY, int durationInMs)
        {
            double toX = fromPoint.X + relativeOffsetX * GetScreenSize().X;
            double toY = fromPoint.Y + relativeOffsetY * GetScreenSize().Y;
            toX = Math.Max(toX, 0);
            toY = Math.Max(toY, 0);
            Point toPoint = new Point((int)toX, (int)toY);

            SwipeByPoint(fromPoint, toPoint, durationInMs);
        }

        /**
         * Drag from center element (no accelerate)
         */
        public void DragFromPoint(Point fromPoint, double relativeOffsetX, double relativeOffsetY)
        {
            double toX = fromPoint.X + relativeOffsetX * GetScreenSize().X;
            double toY = fromPoint.Y + relativeOffsetY * GetScreenSize().Y;
            toX = Math.Max(toX, 0);
            toY = Math.Max(toY, 0);
            Point toPoint = new Point((int)toX, (int)toY);
            DragByPoint(fromPoint, toPoint);
        }

        /**
         * Swipe from relative position to relative position (with accelerate)
         */
        public void SwipeByPoint(double fromRelativePointX, double fromRelativePointY, double toRelativePointX, double toRelativePointY, int durationInMs)
        {
            Console.Write($"Swipe from relative point ({fromRelativePointX}, {fromRelativePointY}) to relative point ({toRelativePointX}, {toRelativePointY}) with duration {durationInMs}");

            Point fromPoint = GetAbsolutePoint(fromRelativePointX, fromRelativePointY);
            Point toPoint = GetAbsolutePoint(toRelativePointX, toRelativePointY);

            SwipeByPoint(fromPoint, toPoint, durationInMs);
        }

        /**
         * Swipe from Point to Point (with accelerate)
         */
        public void SwipeByPoint(Point fromPoint, Point toPoint, int durationInMs)
        {
            Console.WriteLine($"Swipe from point ({fromPoint.X}, {fromPoint.Y}) to point ({toPoint.X}, {toPoint.Y}) with duration {durationInMs}");

            PointerInputDevice finger = new PointerInputDevice(PointerKind.Touch, "finger");
            ActionSequence sequence = new ActionSequence(finger, 0);
            sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, fromPoint.X, fromPoint.Y, TimeSpan.FromMilliseconds(0)));
            sequence.AddAction(finger.CreatePointerDown(MouseButton.Left));
            sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, toPoint.X, toPoint.Y, TimeSpan.FromMilliseconds(durationInMs)));
            sequence.AddAction(finger.CreatePointerUp(MouseButton.Left));

            driver.PerformActions(new List<ActionSequence> {sequence});
        }

        /**
         * Quick swipe to top from a Point
         */
        public void SwipeToTop(Point fromPoint)
        {
            Point toPoint = new Point(fromPoint.X, GetScreenSize().Y - 10);
            Console.WriteLine($"Swipe to top from point ({fromPoint.X}, {fromPoint.Y}) to point ({toPoint.X}, {toPoint.Y})");

            SwipeByPoint(fromPoint, toPoint, 100);
        }

        /**
         * Drag from Point to Point (no accelerate)
         */
        public void DragByPoint(Point fromPoint, Point toPoint)
        {
            Console.WriteLine($"Drag from point ({fromPoint.X}, {fromPoint.Y}) to point ({toPoint.X}, {toPoint.Y})");

            TouchAction swipe = new TouchAction(driver);
            swipe.Press(fromPoint.X, fromPoint.Y).Wait(300).MoveTo(toPoint.X, toPoint.Y).Release();
            swipe.Perform();
        }

        public void SendKeys(string keys)
        {
            sleep(Config.SleepTimeBeforeSendKeysInMs);

            Console.WriteLine($"Send keys: {keys}");

            if (this.isIos) {
                var uri = new UriBuilder($"{GetAppiumServerUrl()}session/{driver.SessionId}/keys");
                var query = new Dictionary<string, string>
                {
                    {"value", keys}
                };
                uri.Query = new FormUrlEncodedContent(query).ReadAsStringAsync().Result;
                var request = new HttpRequestMessage{
                    Method = HttpMethod.Post,
                    RequestUri = uri.Uri,
                    Headers = {
                        {
                            HttpRequestHeader.Authorization.ToString(), Config.GetBasicAuthString()
                        }
                    }
                };
                httpClient.SendAsync(request).Wait();
           } else
           {
                Actions action = new Actions(driver);

                foreach (char c in keys)
                {
                    string key = c.ToString();
                    action.SendKeys(key);
                }

                action.Perform();
                sleep(SleepAfterAction);
            }
        }

        public void SendKeys(AppiumWebElement element, string keys)
        {
            Console.WriteLine($"Send keys '{keys}' on element {element.TagName}");

            element.SendKeys(keys);
        }

        public void ClearTextField(int maxChars)
        {
            Console.WriteLine($"Clear text field, maximum {maxChars} characters");
            for (int i = 0; i < maxChars; i++) {
                Press(PressTypes.Delete);
            }
        }

        public void Press(PressTypes type)
        {
            Console.WriteLine($"Press on {type} key");

            switch (type) {
                case PressTypes.Home:
                if (isIos)
                {
                    IOSDriver<AppiumWebElement> iosDriver = GetIosDriver();
                    if (iosDriver.IsLocked())
                    {
                        iosDriver.Unlock();
                    }
                    else
                    {
                            driver.ExecuteScript("mobile: pressButton");//, ImmutableMap.of("name", "home"));
                    }
                }
                else
                {
                    PressAndroidKey(AndroidKeyCode.Home);
                }
                break;

            case PressTypes.Back:
                PressAndroidKey(AndroidKeyCode.Back);
                break;

            case PressTypes.Power:
                if (isIos)
                {
                    IOSDriver<AppiumWebElement> iosDriver = GetIosDriver();
                    if (iosDriver.IsLocked())
                    {
                        iosDriver.Lock();
                    }
                    else
                    {
                        iosDriver.Lock();
                    }
                }
                else
                {
                    PressAndroidKey(AndroidKeyCode.Keycode_POWER);
                }
                break;

            case PressTypes.AppSwitch:
                PressAndroidKey(AndroidKeyCode.Keycode_APP_SWITCH);
                break;

            case PressTypes.Enter:
                if (isIos)
                {
                    SendKeys("\n");
                }
                else
                {
                    PressAndroidKey(AndroidKeyCode.Enter);
                }
                break;

            case PressTypes.Delete:
                if (isIos)
                {
                    SendKeys("\b");
                }
                else
                {
                    PressAndroidKey(AndroidKeyCode.Del);
                }
                break;

            default:
                throw new Exception($"Don't support press {type} key");

            }
        }

        public IOSDriver<AppiumWebElement> GetIosDriver()
        {
            return (IOSDriver<AppiumWebElement>)driver;
        }

        public AndroidDriver<AppiumWebElement> GetAndroidDriver()
        {
            return (AndroidDriver<AppiumWebElement>)driver;
        }

        public void PressAndroidKey(int key)
        {
            GetAndroidDriver().PressKeyCode(key);
        }

        public void HideKeyboard()
        {
            try
            {
                if (this.isIos)
                {
                    if (!GetIosDriver().IsKeyboardShown()) return;
                }
                else
                {
                    if (!GetAndroidDriver().IsKeyboardShown()) return;
                }

                Console.WriteLine("Keyboard is shown, hide it");
                driver.HideKeyboard();
            }
            catch (Exception ignored)
            {
            }
        }

        public void SetImplicitWaitInMiliSecond(int value)
        {
            driver.Manage().Timeouts().ImplicitWait = TimeSpan.FromMilliseconds(value);
        }

        public void UpdateSettings()
        {
            if (!this.isIos)
            {
                GetAndroidDriver().IgnoreUnimportantViews(true);
            }
        }

        public Point GetScreenSize()
        {
            if (screenSize == null) {
                byte[] screenshotBytes = ((ITakesScreenshot)driver).GetScreenshot().AsByteArray;
                MemoryStream inputStream = new MemoryStream(screenshotBytes);
                Bitmap image = new Bitmap(inputStream);
                int width = image.Width;
                int height = image.Height;
                screenSize = new Point(width, height);
            }

            return screenSize;
        }

        public Point GetAppOffset()
        {
            if (!isIos) return new Point(0, 0);

            try
            {
                AppiumWebElement rootElement = driver.FindElement(By.XPath("//XCUIElementTypeApplication | //XCUIElementTypeOther"));
                Size rootElementSize = rootElement.Size;
                Point screenSize = GetScreenSize();
                double screenWidthScaled = screenSize.X / retinaScale;
                double screenHeightScaled = screenSize.Y / retinaScale;

                int offsetX = 0;
                int offsetY = 0;
                if (screenWidthScaled > rootElementSize.Width)
                {
                    offsetX = (int)((screenWidthScaled - rootElementSize.Width) / 2);
                }

                if (screenHeightScaled > rootElementSize.Height)
                {
                    offsetY = (int)((screenHeightScaled - rootElementSize.Height) / 2);
                }

                return new Point(offsetX, offsetY);
            }
            catch (Exception e)
            {
                return new Point(0, 0);
            }
        }

        public Point GetAbsolutePoint(double relativePointX, double relativePointY)
        {
            Point screenSize = GetScreenSize();

            if (retinaScale > 1) {
                return new Point((int)Math.Round(relativePointX * screenSize.X / retinaScale), (int)Math.Round(relativePointY * screenSize.Y / retinaScale));
            } else {
                return new Point((int)Math.Round(relativePointX * screenSize.X), (int)Math.Round(relativePointY * screenSize.Y));
            }
        }

        public Point GetAbsolutePoint(double relativePointX, double relativePointY, Rectangle rect)
        {
            Point appOffset = GetAppOffset();
            double x = rect.X + rect.Width * relativePointX + appOffset.X;
            double y = rect.Y + rect.Height * relativePointY + appOffset.Y;
            return new Point((int)x, (int)y);
        }

        public void sleep(int durationInMs)
        {
            Console.WriteLine($"Sleep for {durationInMs} ms");
            Thread.Sleep(durationInMs);
        }

        protected bool compareNodes(HtmlNode expected, HtmlNode actual)
        {
            if (!expected.Name.Equals(actual.Name))
            {
                return false;
            }

            string[] compareAttrs = new string[] { "label", "text", "visible", "class", "name", "type", "resource-id", "content-desc", "accessibility-id" };

            foreach (string attrName in compareAttrs) {
                string v1 = null;
                string v2 = null;
                try
                {
                    v1 = expected.Attributes[attrName].Value;
                    v2 = actual.Attributes[attrName].Value;
                }
                catch (Exception ignored)
                {
                }

                if (v1 != null && v2 != null && !v1.IsNullOrEmpty() && !v2.IsNullOrEmpty() && !v1.Equals(v2))
                {
                    return false;
                }
            }

            if (expected.ChildNodes.Count != actual.ChildNodes.Count)
            {
                return false;
            }

            for (int i = 0; i < expected.ChildNodes.Count; i++)
            {
                HtmlNode expectedChild = expected.ChildNodes.ElementAt(i);
                HtmlNode actualChild = actual.ChildNodes.ElementAt(i);

                bool isEqual = compareNodes(expectedChild, actualChild);
                if (!isEqual)
                {
                    return false;
                }
            }

            return true;
        }

        public Point GetCenterOfRect(Rectangle rect)
        {
            Point center = new Point(rect.X + rect.Width / 2, rect.Y + rect.Height / 2);
            return center;
        }

        public Uri GetAppiumServerUrl()
        {
            if (proxy != null) {
                return new Uri(this.proxy.GetServerUrl());
            }
            else
            {
                return new Uri($"{Config.AppiumServerUrl}/");
            }
        }

        public long GetCurrentCommandId()
        {
            return this.proxy != null ? this.proxy.currentCommandId : 0;
        }

        public long GetKobitonSessionId()
        {
            return this.proxy != null ? this.proxy.kobitonSessionId : 0;
        }

        public void SetCurrentCommandId(long currentCommandId)
        {
            if (this.proxy != null)
            {
                this.proxy.currentCommandId = currentCommandId;
            }
        }

        public string GetAppUrl(int appVersionId)
        {
            string appUrl = string.Empty;
            using (HttpClient client = new HttpClient())
            {
                client.DefaultRequestHeaders.Add("Content-Type", "application/json");
                client.DefaultRequestHeaders.Add("Authorization", Config.GetBasicAuthString());

                string url = string.Format("{0}/v1/app/versions/{1}/downloadUrl", Config.KobitonApiUrl, appVersionId);

                using (HttpResponseMessage response = client.GetAsync(url).Result)
                {
                    if (response.IsSuccessStatusCode)
                    {
                        using (HttpContent content = response.Content)
                        {
                            string result = content.ReadAsStringAsync().Result;
                            dynamic jsonObject = JsonConvert.DeserializeObject(result);
                            appUrl = jsonObject.url;
                        }
                    }
                }
            }

            return appUrl;
        }

        public void SaveDebugResource()
        {
            try
            {
                string rootDir = Environment.CurrentDirectory;
                string debugDirName = $"{deviceName} {platformVersion}";
                debugDirName = Regex.Replace(debugDirName, "[^a-zA-Z0-9]", "_");
                string debugDirPath = Path.Combine(rootDir, "debug", debugDirName);

                Console.WriteLine($"Save source & screenshot for debugging at {debugDirPath}");
                Directory.CreateDirectory(debugDirPath);

                string source = driver.PageSource;
                File.WriteAllText(Path.Combine(debugDirPath, "source.xml"), source, Encoding.UTF8);

                ITakesScreenshot takesScreenshot = (ITakesScreenshot)driver;
                Screenshot screenshot = takesScreenshot.GetScreenshot();
                screenshot.SaveAsFile(Path.Combine(debugDirPath, "screenshot.png"), ScreenshotImageFormat.Png);
            }
            catch (Exception e)
            {
                Console.WriteLine(e.StackTrace);
            }
        }

        public async Task<Device> GetAvailableDevice(AppiumOptions capabilities)
        {
            var deviceListUriBuilder = new UriBuilder(Config.KobitonApiUrl + "/v1/devices");
            var query = new Dictionary<string, string>
            {
                { "isOnline", "true" },
                { "isBooked", "false" },
                { "deviceName", capabilities.ToCapabilities().GetCapability(MobileCapabilityType.DeviceName).ToString() },
                { "platformVersion", capabilities.ToCapabilities().GetCapability(MobileCapabilityType.PlatformVersion).ToString() },
                { "platformName", capabilities.ToCapabilities().GetCapability(MobileCapabilityType.PlatformName).ToString() },
                { "deviceGroup", capabilities.ToCapabilities().GetCapability("deviceGroup").ToString() }
            };
            deviceListUriBuilder.Query = new FormUrlEncodedContent(query).ReadAsStringAsync().Result;

            using (var httpClient = new HttpClient())
            {
                httpClient.DefaultRequestHeaders.Add(HttpRequestHeader.Authorization.ToString(), Config.GetBasicAuthString());

                var response = await httpClient.GetAsync(deviceListUriBuilder.Uri);

                if (!response.IsSuccessStatusCode)
                {
                    throw new Exception(await response.Content.ReadAsStringAsync());
                }

                var responseContent = await response.Content.ReadAsStringAsync();

                var deviceListResponse = JsonConvert.DeserializeObject<DeviceListResponse>(responseContent);

                var deviceList = new List<Device>();
                deviceList.AddRange(deviceListResponse.cloudDevices);
                deviceList.AddRange(deviceListResponse.privateDevices);

                if (deviceList.Count == 0)
                {
                    return null;
                }

                return deviceList[0];
            }
        }

        public Device FindOnlineDevice(AppiumOptions capabilities)
        {
            if (Config.DeviceSource != Config.DeviceSourceEnums.Kobiton) {
                return null;
            }

            int tryTime = 1;
            Device device = null;
            string deviceName = (string) capabilities.ToCapabilities().GetCapability(MobileCapabilityType.DeviceName);
            string deviceGroup = (string) capabilities.ToCapabilities().GetCapability("deviceGroup");
            string platformVersion = (string) capabilities.ToCapabilities().GetCapability(MobileCapabilityType.PlatformVersion);
            string platformName = (string) capabilities.ToCapabilities().GetCapability(MobileCapabilityType.PlatformName);
            while (tryTime <= Config.DeviceWaitingMaxTryTimes) {
                Console.WriteLine($"Is device with capabilities: (deviceName: {deviceName}, deviceGroup: {deviceGroup}, platformName: {platformName}, platformVersion: {platformVersion}) online? Retrying at {Utils.ConvertToOrdinal(tryTime)} time");
                device = GetAvailableDevice(capabilities).Result;
                if (device != null)
                {
                    Console.WriteLine($"Device is found with capabilities: (deviceName: {deviceName}, deviceGroup: {deviceGroup}, platformName: {platformName}, platformVersion: {platformVersion})");
                    break;
                }
                tryTime++;
                sleep(Config.DeviceWaitingInternalInMs);
            }

            if (device == null) {
                throw new Exception($"Cannot find any online devices with capabilites: (deviceName: {deviceName}, deviceGroup: {deviceGroup}, platformName: {platformName}, platformVersion: {platformVersion})");
            }
            return device;
        }


        public class Device
        {
            public long id;
            public bool isBooked, isOnline, isFavorite, isCloud;
            public string deviceName, platformName, platformVersion, udid;
        }

        public class DeviceListResponse
        {
            public List<Device> privateDevices;
            public List<Device> favoriteDevices;
            public List<Device> cloudDevices;
        }

        public class GenericLocator
        {
            public string type, value;

            public GenericLocator(string type, string value)
            {
                this.type = type;
                this.value = value;
            }
        }

        public class ContextInfo
        {
            public string context;
            public long sourceLength, matchTexts, matchTextsPercent;

            public ContextInfo(string context)
            {
                this.context = context;
            }
        }
    }
}
