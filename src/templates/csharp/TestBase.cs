﻿using Newtonsoft.Json;
using OpenQA.Selenium.Appium.Android;
using OpenQA.Selenium.Appium.Enums;
using OpenQA.Selenium.Appium.iOS;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium;
using System.Drawing;
using Castle.Core.Internal;
using System.Text;
using HtmlAgilityPack;
using System.Text.RegularExpressions;
using System.Net;
using System.Xml;
using OpenQA.Selenium.Interactions;

namespace AppiumTest
{
    public class TestBase
    {
        public enum PressTypes
        {
            Home,
            Back,
            Power,
            AppSwitch,
            Enter,
            Delete
        }

        public AppiumDriver<AppiumWebElement>? driver;
        public AppiumOptions? options;
        public ProxyServer? proxy;
        public bool isIos;
        public Point? screenSize;
        public double retinaScale;
        public string deviceName, platformVersion;
        public HttpClient httpClient = new HttpClient();
        private string? currentContext;
        private string currentWindow;

        public static string IosXpathRedundantPrefix = "/AppiumAUT";
        public static string NativeContext = "NATIVE_APP";
        private const int SleepAfterAction = 200;

        public virtual void Setup(AppiumOptions desiredCaps, double retinaScale)
        {
            this.options = desiredCaps;
            this.retinaScale = retinaScale;
            this.isIos = MobilePlatform.IOS.Equals(desiredCaps.ToCapabilities()
                .GetCapability(MobileCapabilityType.PlatformName).ToString());
            this.deviceName = desiredCaps.ToCapabilities().GetCapability(MobileCapabilityType.DeviceName).ToString();
            this.platformVersion = desiredCaps.ToCapabilities().GetCapability(MobileCapabilityType.PlatformVersion)
                .ToString();

            proxy = new ProxyServer();
            proxy.StartProxy();

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

        public string UpdateCurrentContext()
        {
            var previousContext = currentContext;
            currentContext = driver.Context;
            if (currentContext != previousContext)
            {
                Log($"Context is changed from {previousContext} to {currentContext}");
            }

            return previousContext;
        }

        public bool IsNativeContext()
        {
            return currentContext == NativeContext;
        }

        public void SwitchContext(string context)
        {
            if (currentContext == context) return;
            Log($"Switch to {context} context");
            driver.Context = context;
            currentContext = context;
        }

        public void SwitchWindow(string window)
        {
            if (currentWindow == window) return;
            Log($"Switch to {window} window");
            driver.SwitchTo().Window(window);
            currentWindow = window;
            currentContext = null;
        }

        public void SwitchToNativeContext()
        {
            SwitchContext(NativeContext);
        }

        private string SwitchToWebContextCore()
        {
            SwitchToNativeContext();
            XmlDocument nativeDocument = LoadXMLFromString(driver.PageSource);
            List<string> nativeTexts = new List<string>();
            XmlNodeList? nodes;
            if (nativeDocument.SelectNodes(GetWebviewXpathSelector()).IsNullOrEmpty())
            {
                nodes = nativeDocument.SelectNodes("//*");
            }
            else
            {
                nodes = nativeDocument.SelectNodes(GetWebviewXpathSelector() + "//*");
            }

            if (nodes != null)
            {
                foreach (XmlNode element in nodes)
                {
                    if (element.NodeType != XmlNodeType.Element) continue;
                    if (element.ChildNodes.Count != 0) continue;
                    XmlAttribute? textAttr;
                    if (isIos)
                    {
                        var excludeTags = new List<string> { "XCUIElementTypeImage", "XCUIElementTypeSwitch" };
                        if (excludeTags.Contains(element.Name)) continue;

                        textAttr = element.Attributes?["value"];
                        if (textAttr == null || string.IsNullOrEmpty(textAttr.Value))
                        {
                            textAttr = element.Attributes?["label"];
                        }
                    }
                    else
                    {
                        textAttr = element.Attributes?["text"];
                        if ((textAttr == null || string.IsNullOrEmpty(textAttr.Value)) &&
                            "android.view.View".Equals(element.Name))
                        {
                            textAttr = element.Attributes?["content-desc"];
                        }
                    }

                    var text = textAttr != null ? textAttr.Value : "";
                    text = text.Trim().ToLower();
                    if (!string.IsNullOrEmpty(text))
                        nativeTexts.Add(text);
                }
            }

            var webContextsInfo = CollectWebContextsInfo(nativeTexts);
            if (webContextsInfo.IsNullOrEmpty())
            {
                throw new Exception("Cannot find any usable web contexts");
            }

            if (Config.DeviceSource == Config.DeviceSourceEnums.Other)
            {
                SwitchContext(webContextsInfo[0].context);
                var windows = driver.WindowHandles;
                if (windows.Count > 1)
                {
                    var currentWindowHandle = driver.CurrentWindowHandle;
                    foreach (var window in windows)
                    {
                        if (window == currentWindowHandle) continue;
                        SwitchWindow(window);
                        var webContextsInfoFromWindow = CollectWebContextsInfo(nativeTexts);
                        webContextsInfo.AddRange(webContextsInfoFromWindow);
                    }
                }
            }

            webContextsInfo = webContextsInfo.Where(contextInfo => !contextInfo.isHidden).ToList();
            if (webContextsInfo.IsNullOrEmpty())
            {
                throw new Exception("Cannot find any usable web contexts");
            }

            ContextInfo bestContextInfo;
            webContextsInfo.Sort((ContextInfo c1, ContextInfo c2) =>
                (int)(c2.matchTextsPercent - c1.matchTextsPercent));
            if (webContextsInfo[0].matchTextsPercent > 40)
            {
                bestContextInfo = webContextsInfo[0];
            }
            else
            {
                webContextsInfo.Sort((ContextInfo c1, ContextInfo c2) => (int)(c2.sourceLength - c1.sourceLength));
                bestContextInfo = webContextsInfo[0];
            }

            SwitchWindow(bestContextInfo.window);
            SwitchContext(bestContextInfo.context);
            Log($"Switched to {bestContextInfo.context} web context in {bestContextInfo.window} window successfully with confident {bestContextInfo.matchTextsPercent}%");
            return bestContextInfo.context;
        }

        private List<ContextInfo> CollectWebContextsInfo(List<string> nativeTexts)
        {
            List<ContextInfo> contextInfos = new List<ContextInfo>();
            var contexts = driver.Contexts;
            var hasWebContext = contexts.Any(context => !context.Equals(NativeContext));
            if (!hasWebContext)
            {
                Log("No web context is available, contexts: " + string.Join(", ", contexts));
            }

            foreach (var context in contexts)
            {
                if (!context.StartsWith("WEBVIEW") && !context.Equals("CHROMIUM")) continue;
                var contextInfo = new ContextInfo(context);
                string source;
                try
                {
                    SwitchContext(context);
                    var isHiddenDocument = (bool) driver.ExecuteScript("return document.hidden");
                    contextInfo.isHidden = isHiddenDocument;
                    contextInfo.window = driver.CurrentWindowHandle;
                    contextInfos.Add(contextInfo);
                    if (isHiddenDocument) continue;
                    source = driver.PageSource;
                }
                catch (Exception ex)
                {
                    Log($"Bad context {context}, error \"{ex.Message}\", skipping...");
                    continue;
                }

                if (source == null) continue;
                contextInfo.sourceLength = source.Length;
                if (nativeTexts.IsNullOrEmpty()) continue;

                HtmlDocument htmlDoc = LoadHTMLFromString(source);
                HtmlNode? bodyElement = htmlDoc.DocumentNode.SelectSingleNode("//body");
                if (bodyElement == null) continue;

                string bodyString = Utils.GetAllText(bodyElement).ToLower();

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

            return contextInfos;
        }

        public string SwitchToWebContext()
        {
            return Utils.Retry<string>((attempt) =>
            {
                Log($"Finding a web context {Utils.ConvertToOrdinal(attempt)} attempt");
                return SwitchToWebContextCore();
            }, null, 4, 10000);
        }

        protected XmlDocument LoadXMLFromString(string xml)
        {
            XmlDocument xmlDoc = new XmlDocument();
            xmlDoc.LoadXml(xml);
            return xmlDoc;
        }

        protected HtmlDocument LoadHTMLFromString(string html)
        {
            HtmlDocument htmlDoc = new HtmlDocument();
            htmlDoc.LoadHtml(html);
            return htmlDoc;
        }

        public Object ExecuteScriptOnWebElement(AppiumWebElement element, string command)
        {
            string script = File.ReadAllText("../../../test/resources/execute-script-on-web-element.js", Encoding.UTF8);
            return driver.ExecuteScript(script, element, command);
        }

        public void ScrollToWebElement(AppiumWebElement element)
        {
            Log($"Scroll to web element {GetTagOfElement(element)}");
            ExecuteScriptOnWebElement(element, "scrollIntoView");
            sleep(1000);
        }

        public Rectangle GetWebElementRect(AppiumWebElement element)
        {
            string resultString = (string)ExecuteScriptOnWebElement(element, "getBoundingClientRect");
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
            var scale = Convert.ToDouble(driver.ExecuteScript("return window.visualViewport.scale"));
            ExecuteScriptOnWebElement(null, "insertKobitonWebview");
            SwitchToNativeContext();

            try
            {
                var kobitonWebview = isIos
                    ? FindSingleElementBy(By.XPath("//*[@label='__kobiton_webview__']"))
                    : FindSingleElementBy(By.XPath("//*[@text='__kobiton_webview__']"));
                var kobitonWebviewRect = kobitonWebview.Rect;
                var nativeRect = new Rectangle(
                    webElementRect.X + kobitonWebviewRect.X,
                    webElementRect.Y + kobitonWebviewRect.Y,
                    webElementRect.Width,
                    webElementRect.Height
                );

                CropRect(ref nativeRect, kobitonWebviewRect);
                ScaleRect(ref nativeRect, scale);
                return nativeRect;
            }
            catch (Exception ex)
            {
                if (isIos) throw;

                Log(ex.Message);
                var nativeDoc = LoadXMLFromString(driver.PageSource);
                var webviewTop = 0;
                var toolbarElement = nativeDoc.SelectSingleNode(
                    "//*[@resource-id='com.android.chrome:id/toolbar' or @resource-id='com.android.chrome:id/url_bar' or @resource-id='com.android.chrome:id/location_bar' or @resource-id='com.android.chrome:id/home_button' or @resource-id='com.android.chrome:id/tab_switcher_button' or @resource-id='com.android.chrome:id/menu_button']");
                if (toolbarElement != null)
                {
                    var toolbarRect = getRectOfXmlElement(toolbarElement);
                    webviewTop = toolbarRect.Y + toolbarRect.Height;
                }
                else
                {
                    var chromeElements = nativeDoc.SelectNodes("//*[@package='com.android.chrome']");
                    if (!chromeElements.IsNullOrEmpty())
                    {
                        foreach (XmlNode element in chromeElements)
                        {
                            var rect = getRectOfXmlElement(element);
                            if (rect.Y > 0 && rect.Height > 0)
                            {
                                webviewTop = rect.Y;
                                break;
                            }
                        }

                        if (webviewTop == 0)
                        {
                            throw new Exception("Cannot calculate native rect for web element");
                        }
                    }

                }

                var windowSize = driver.Manage().Window.Size;
                var webviewRect = new Rectangle(
                    0,
                    webviewTop,
                    windowSize.Width,
                    windowSize.Height - webviewTop
                );

                AppiumWebElement topToolbar = null;
                if (isIos)
                {
                    try
                    {
                        topToolbar =
                            FindSingleElementBy(By.XPath("//*[@name='TopBrowserBar' or @name='topBrowserBar' or @name='TopBrowserToolbar' or child::XCUIElementTypeButton[@name='URL']]"));
                    }
                    catch (Exception ignored)
                    {
                        XmlDocument nativeDocument = LoadXMLFromString(driver.PageSource);
                        XmlNode webviewNode = nativeDocument.SelectSingleNode(GetWebviewXpathSelector());
                        if (webviewNode == null)
                        {
                            throw new Exception("Cannot find webview element");
                        }

                        XmlNode curElement = webviewNode.ParentNode;

                        while (curElement != null)
                        {
                            XmlNode firstChildElement = curElement.SelectSingleNode("./*");

                            Rectangle firstChildRect = new Rectangle(
                                int.Parse(firstChildElement.Attributes["x"].Value),
                                int.Parse(firstChildElement.Attributes["y"].Value),
                                int.Parse(firstChildElement.Attributes["width"].Value),
                                int.Parse(firstChildElement.Attributes["height"].Value)
                            );

                            if (!webviewRect.Equals(firstChildRect) &&
                                Utils.IsRectangleInclude(webviewRect, firstChildRect))
                            {
                                string topToolbarXpath = Utils.GetXPath(firstChildElement).Replace(IosXpathRedundantPrefix, "");
                                topToolbar = FindSingleElementBy(By.XPath(topToolbarXpath));
                                break;
                            }

                            curElement = curElement.ParentNode;
                        }
                    }
                }

                int webViewTop = webviewRect.Y;
                int deltaHeight = 0;
                if (topToolbar != null)
                {
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
                    webViewTop,
                    webviewRect.Width,
                    webviewRect.Height - deltaHeight
                );

                Rectangle nativeRect = new Rectangle(
                    webviewRect.X + webElementRect.X,
                    webviewRect.Y + webElementRect.Y,
                    webElementRect.Width,
                    webElementRect.Height
                );

                CropRect(ref nativeRect, webviewRect);
                ScaleRect(ref nativeRect, scale);
                return nativeRect;
            }
        }

        private AppiumWebElement FindVisibleElementCore(int timeoutInMiliSeconds, params By[] locators)
        {
            List<AppiumWebElement> foundElements = FindElementsBy(null, timeoutInMiliSeconds, locators);
            AppiumWebElement visibleElement = null;

            foreach (AppiumWebElement element in foundElements)
            {
                bool visible;

                if (IsNativeContext())
                {
                    var rect = element.Rect;
                    visible = rect.X >=0 && rect.Y >= 0 && rect.Width > 0 && rect.Height > 0;
                }
                else
                {
                    string res = (string)ExecuteScriptOnWebElement(element, "isElementVisible");
                    visible = "true".Equals(res);
                }

                if (visible)
                {
                    visibleElement = element;
                    break;
                }
            }

            if (visibleElement == null)
                throw new Exception($"Cannot find visible element by: {Utils.GetLocatorText(locators)}");

            if (!IsNativeContext())
            {
                ScrollToWebElement(visibleElement);
            }

            return visibleElement;
        }

        public AppiumWebElement FindVisibleElement(int timeoutInMiliSeconds, params By[] locators)
        {
            return Utils.Retry((attempt) =>
            {
                Log($"Finding visible element {Utils.ConvertToOrdinal(attempt)} attempt with locator: {Utils.GetLocatorText(locators)}");
                return FindVisibleElementCore(timeoutInMiliSeconds, locators);
            }, (_, _) =>
            {
                // Prevent switching to the wrong web context by trying a different one
                if (!IsNativeContext())
                {
                    SwitchToWebContext();
                }

                return 0;
            }, IsNativeContext() ? 1 : 3, 3000);
        }

        private AppiumWebElement FindSingleElementBy(By locator)
        {
            Log("Find element by: " + locator);

            try
            {
                return driver.FindElement(locator);
            }
            catch (Exception ignored)
            {
                throw new Exception("Cannot find element by: " + locator);
            }
        }

        private List<AppiumWebElement> FindElements(AppiumWebElement? rootElement, int timeoutInMiliSeconds,
            bool multiple, params By[] locators)
        {
            string locatorText = Utils.GetLocatorText(locators);
            Log($"Find element by: {locatorText}");
            string notFoundMessage = $"Cannot find element by: {locatorText}";

            if (locators.Length == 1)
            {
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
            }
            else
            {
                int waitInterval = 5;

                return Utils.Retry((attempt) =>
                {
                    SetImplicitWaitInMiliSecond(0);
                    List<AppiumWebElement> elements = null;
                    foreach (By locator in locators)
                    {
                        try
                        {
                            if (rootElement == null)
                            {
                                elements = driver.FindElements(locator).ToList();
                            }
                            else
                            {
                                elements = rootElement.FindElements(locator).ToList();
                            }

                            if (multiple && elements != null && !elements.IsNullOrEmpty())
                                return elements;
                            else if (!multiple && elements != null && elements.Count() == 1)
                                return elements;
                        }
                        catch (Exception ignored)
                        {
                        }
                    }

                    SetImplicitWaitInMiliSecond(Config.ImplicitWaitInMs);
                    throw new Exception(notFoundMessage);
                }, null, timeoutInMiliSeconds / (waitInterval * 1000), waitInterval * 1000);
            }
        }

        public AppiumWebElement FindElementBy(AppiumWebElement? rootElement, int timeoutInMiliSeconds,
            params By[] locators)
        {
            List<AppiumWebElement> foundElements = FindElements(rootElement, timeoutInMiliSeconds, true, locators);
            // flex correct could switch context on the fly
            if (IsFlexCorrectEnabled())
            {
                UpdateCurrentContext();
            }

            return foundElements.ElementAt(0);
        }

        public AppiumWebElement FindElementBy(params By[] locators)
        {
            var foundElements = FindElementBy(null, Config.ImplicitWaitInMs, locators);
            // flex correct could switch context on the fly
            if (IsFlexCorrectEnabled())
            {
                UpdateCurrentContext();
            }

            return foundElements;
        }

        public AppiumWebElement FindElementBy(int timeoutInMiliSeconds, params By[] locators)
        {
            return FindElementBy(null, Math.Max(Config.ImplicitWaitInMs, timeoutInMiliSeconds), locators);
        }

        public List<AppiumWebElement> FindElementsBy(AppiumWebElement? rootElement, int timeoutInMiliSeconds,
            params By[] locators)
        {
            List<AppiumWebElement> foundElements = FindElements(rootElement, timeoutInMiliSeconds, true, locators);
            return foundElements;
        }

        public List<AppiumWebElement> FindElementsBy(params By[] locators)
        {
            return FindElementsBy(null, Config.ImplicitWaitInMs, locators);
        }

        /**
         * Scroll to find best element on scrollable
         */
        public AppiumWebElement FindVisibleElementOnScrollable(int timeoutInMiliSeconds, params By[] locators)
        {
            var infoJsonString = File.ReadAllText($"../../../test/resources/{GetCurrentCommandId()}.json", Encoding.UTF8);
            dynamic infoObject = JsonConvert.DeserializeObject(infoJsonString);
            AppiumWebElement? scrollableElement = null;
            var swipedToTop = false;
            var screenSize = GetScreenSize();

            var touchableElement = Utils.Retry<AppiumWebElement>(
                (attempt) =>
                {
                    Log($"Finding visible element on scrollable {Utils.ConvertToOrdinal(attempt)} attempt  with locator: {Utils.GetLocatorText(locators)}");
                    return FindVisibleElementCore(timeoutInMiliSeconds, locators);
                },
                (exception, attempt) =>
                {
                    Log($"Cannot find visible element {Utils.ConvertToOrdinal(attempt)} attempt, error: {exception.Message}");
                    // Might switch to the wrong web context on the first attempt; retry before scrolling down
                    if (!IsNativeContext() && attempt == 1) {
                        // Wait a bit for web is fully loaded
                        sleep(10000);
                        SwitchToWebContext();
                        return 0;
                    }

                    if (scrollableElement == null)
                    {
                        scrollableElement = FindElementBy(By.XPath((string) infoObject.scrollableElementXpath));
                    }

                    if (!swipedToTop)
                    {
                        HideKeyboard();
                        SwipeToTop(Utils.GetCenterOfElement(scrollableElement));
                        swipedToTop = true;
                    }
                    else
                    {
                        var center = Utils.GetCenterOfElement(scrollableElement);
                        var rect = scrollableElement.Rect;
                        // Fix bug when scrollableElement is out of viewport
                        if (center.Y > screenSize.Y || rect.Height < 0)
                        {
                            center.Y = screenSize.Y / 2;
                        }

                        var toPoint = new Point(center.X, Math.Max((int) (center.Y - rect.Height / 1.5), 0));
                        DragByPoint(center, toPoint);
                    }

                    return 0;
                }, 5, 3000);

            if (touchableElement == null)
            {
                throw new Exception("Cannot find any visible element on scrollable");
            }

            return touchableElement;
        }

        public bool IsButtonElement(AppiumWebElement element)
        {
            var tagName = GetTagOfElement(element);
            return tagName != null && tagName.Contains("Button");
        }

        public AppiumWebElement FindWebview()
        {
            return FindSingleElementBy(By.XPath(GetWebviewXpathSelector()));
        }

        public String GetWebviewXpathSelector()
        {
            return isIos ? "(//XCUIElementTypeWebView)[1]" : "(//android.webkit.WebView)[1]";
        }

        /**
         * Touch at center of element (element need to be visible)
         */
        public void TouchAtCenterOfElement(AppiumWebElement element)
        {
            Log($"Touch at center of element {GetTagOfElement(element)}");
            var center = GetCenterOfRect(element.Rect);
            TouchAtPoint(center);
        }

        /**
         * Handle event touch element
         */
        public void TouchOnElement(AppiumWebElement element, double relativePointX, double relativePointY)
        {
            if (IsButtonElement(element))
            {
                ClickElement(element);
            }
            else
            {
                TouchAtRelativePointOfElement(element, relativePointX, relativePointY);
            }
        }

        /**
         * Click element (element need to be visible)
         */
        public void ClickElement(AppiumWebElement element)
        {
            Log($"Click on element with type: {GetTagOfElement(element)}");
            element.Click();
        }

        /**
         * Touch at relative point of element (element need to be visible)
         */
        public void TouchAtRelativePointOfElement(AppiumWebElement element, double relativePointX,
            double relativePointY)
        {
            Log($"Touch on element {GetTagOfElement(element)} at relative point ({relativePointX} {relativePointY})");

            Rectangle nativeRect;
            if (IsNativeContext())
            {
                nativeRect = element.Rect;
            }
            else
            {
                var webRect = GetWebElementRect(element);
                nativeRect = CalculateNativeRect(webRect);
            }

            TouchAtPoint(GetAbsolutePoint(relativePointX, relativePointY, nativeRect));
        }

        /**
         * Touch at a relative position
         */
        public void TouchAtPoint(double relativePointX, double relativePointY)
        {
            Log($"Touch at relative point ({relativePointX}, {relativePointY})");

            Point absolutePoint = GetAbsolutePoint(relativePointX, relativePointY);
            TouchAtPoint(absolutePoint);
        }

        /**
         * Touch at a Point
         */
        public void TouchAtPoint(Point point)
        {
            Log($"Touch at point ({point.X}, {point.Y})");

            var finger = new PointerInputDevice(PointerKind.Touch, "finger");
            var sequence = new ActionSequence(finger, 0);
            sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, point.X, point.Y, TimeSpan.Zero));
            sequence.AddAction(finger.CreatePointerDown(MouseButton.Left));
            sequence.AddAction(finger.CreatePointerUp(MouseButton.Left));
            driver.PerformActions(new List<ActionSequence> { sequence });
        }

        public void SwipeOnElement(AppiumWebElement element, double relativePointX1, double relativePointY1, double relativePointX2, double relativePointY2, int durationInMs)
        {
            Log($"Swipe on element ${GetTagOfElement(element)} from relative point ({relativePointX1} {relativePointY1}) to relative point ({relativePointX2} {relativePointY2})");
            Rectangle nativeRect;
            if (IsNativeContext())
            {
                nativeRect = element.Rect;
            }
            else
            {
                var webRect = GetWebElementRect(element);
                nativeRect = CalculateNativeRect(webRect);
            }

            var fromPoint = GetAbsolutePoint(relativePointX1, relativePointY1, nativeRect);
            var toPoint = GetAbsolutePoint(relativePointX2, relativePointY2, nativeRect);
            SwipeByPoint(fromPoint, toPoint, durationInMs);
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
        public void SwipeByPoint(double fromRelativePointX, double fromRelativePointY, double toRelativePointX,
            double toRelativePointY, int durationInMs)
        {
            Log($"Swipe from relative point ({fromRelativePointX}, {fromRelativePointY}) to relative point ({toRelativePointX}, {toRelativePointY}) with duration {durationInMs}");

            Point fromPoint = GetAbsolutePoint(fromRelativePointX, fromRelativePointY);
            Point toPoint = GetAbsolutePoint(toRelativePointX, toRelativePointY);

            SwipeByPoint(fromPoint, toPoint, durationInMs);
        }

        /**
         * Swipe from Point to Point (with accelerate)
         */
        public void SwipeByPoint(Point fromPoint, Point toPoint, int durationInMs)
        {
            Log($"Swipe from point ({fromPoint.X}, {fromPoint.Y}) to point ({toPoint.X}, {toPoint.Y}) with duration {durationInMs}");

            PointerInputDevice finger = new PointerInputDevice(PointerKind.Touch, "finger");
            ActionSequence sequence = new ActionSequence(finger, 0);
            sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, fromPoint.X, fromPoint.Y,
                TimeSpan.FromMilliseconds(0)));
            sequence.AddAction(finger.CreatePointerDown(MouseButton.Left));
            sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, toPoint.X, toPoint.Y,
                TimeSpan.FromMilliseconds(durationInMs)));
            sequence.AddAction(finger.CreatePointerUp(MouseButton.Left));

            driver.PerformActions(new List<ActionSequence> { sequence });
        }

        /**
         * Quick swipe to top from a Point
         */
        public void SwipeToTop(Point fromPoint)
        {
            Point toPoint = new Point(fromPoint.X, GetScreenSize().Y - 10);
            Log($"Swipe to top from point ({fromPoint.X}, {fromPoint.Y}) to point ({toPoint.X}, {toPoint.Y})");

            SwipeByPoint(fromPoint, toPoint, 100);
        }

        /**
         * Drag from Point to Point (no accelerate)
         */
        public void DragByPoint(Point fromPoint, Point toPoint)
        {
            var pointer = new PointerInputDevice(PointerKind.Touch);
            var sequence = new ActionSequence(pointer, 0);

            int steps = 20;
            int duration = 5000;
            int stepDuration = duration / steps;
            double xStep = (toPoint.X - fromPoint.X) / (double)steps;
            double yStep = (toPoint.Y - fromPoint.Y) / (double)steps;

            sequence.AddAction(pointer.CreatePointerMove(CoordinateOrigin.Viewport, fromPoint.X, fromPoint.Y, TimeSpan.Zero));
            sequence.AddAction(pointer.CreatePointerDown(MouseButton.Left));

            for (int i = 1; i <= steps; i++)
            {
                int nextX = fromPoint.X + (int)(xStep * i);
                int nextY = fromPoint.Y + (int)(yStep * i);
                sequence.AddAction(pointer.CreatePointerMove(CoordinateOrigin.Viewport, nextX, nextY, TimeSpan.FromMilliseconds(stepDuration)));
            }

            sequence.AddAction(pointer.CreatePointerUp(MouseButton.Left));

            Log($"Drag from point ({fromPoint.X}, {fromPoint.Y}) to point ({toPoint.X}, {toPoint.Y})");
            driver.PerformActions(new[] {sequence});
        }

        public void SendKeys(string keys)
        {
            sleep(Config.SendKeysDelayInMs);
            Log($"Send keys: {keys}");
            try
            {
                KeyInputDevice keyInput = new KeyInputDevice("keyboard");
                ActionSequence sequence = new ActionSequence(keyInput, 0);
                for (int index = 0; index < keys.Length; index++)
                {
                    var charAt = keys[index];
                    sequence.AddAction(keyInput.CreateKeyDown(charAt));
                    sequence.AddAction(keyInput.CreateKeyUp(charAt));
                }

                driver.PerformActions(new List<ActionSequence> { sequence });
            }
            catch (Exception ignored)
            {
                if (isIos)
                {
                    GetIosDriver().Keyboard.SendKeys(keys);
                }
                else
                {
                    GetAndroidDriver().Keyboard.SendKeys(keys);
                }
            }

            sleep(Config.SendKeysDelayInMs);
        }

        public void SendKeys(AppiumWebElement element, string keys)
        {
            Log($"Send keys '{keys}' on element {GetTagOfElement(element)}");

            element.SendKeys(keys);
        }

        public void ClearTextField(int maxChars)
        {
            Log($"Clear text field, maximum {maxChars} characters");
            PressMultiple(PressTypes.Delete, maxChars);
        }

        public void Press(PressTypes type)
        {
            Log($"Press on {type} key");

            switch (type)
            {
                case PressTypes.Home:
                    if (isIos)
                    {
                        var needPressHome = true;
                        try
                        {
                            IOSDriver<AppiumWebElement> iosDriver = GetIosDriver();
                            // IsLocked() and Unlock() could failed on some devices
                            if (iosDriver.IsLocked())
                            {
                                iosDriver.Unlock();
                                needPressHome = false;
                            }
                        }
                        catch (Exception ex)
                        {
                            Log($"Cannot check device locked or unlock device, error: {ex.Message}");
                        }

                        if (needPressHome)
                        {
                            var scriptArgs = new Dictionary<string, object>
                            {
                                { "name", "home" }
                            };

                            driver.ExecuteScript("mobile: pressButton", scriptArgs);
                        }
                    }
                    else
                    {
                        PressAndroidKey(AndroidKeyCode.Home);
                    }

                    sleep(Config.IdleDelayInMs);
                    break;

                case PressTypes.Back:
                    PressAndroidKey(AndroidKeyCode.Back);
                    sleep(Config.IdleDelayInMs);
                    break;

                case PressTypes.Power:
                    if (isIos)
                    {
                        IOSDriver<AppiumWebElement> iosDriver = GetIosDriver();
                        if (iosDriver.IsLocked())
                        {
                            iosDriver.Unlock();
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

                    sleep(Config.IdleDelayInMs);
                    break;

                case PressTypes.AppSwitch:
                    PressAndroidKey(AndroidKeyCode.Keycode_APP_SWITCH);
                    sleep(Config.IdleDelayInMs);
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

                    sleep(Config.IdleDelayInMs);
                    break;

                case PressTypes.Delete:
                    if (Config.DeviceSource == Config.DeviceSourceEnums.Kobiton)
                    {
                        SendKeys("\b");
                    }
                    else
                    {
                        SendKeys(isIos ? "\b" : Keys.Backspace.ToString());
                    }
                    break;

                default:
                    throw new Exception($"Don't support press {type} key");
            }
        }

        public void PressMultiple(PressTypes type, int count)
        {
            Log($"Press on {type} key {count} times");

            switch (type)
            {
                case PressTypes.Delete:
                    if (Config.DeviceSource == Config.DeviceSourceEnums.Kobiton)
                    {
                        SendKeys(new string('\b', count));
                    }
                    else
                    {
                        SendKeys(new string(isIos ? '\b' : Keys.Backspace[0], count));
                    }
                    break;
                default:
                    for (int i = 0; i < count; i++)
                    {
                        Press(type);
                    }
                    break;
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

        public void ActivateApp(string appPackage)
        {
            Log($"Activate app {appPackage}");
            driver.ActivateApp(appPackage);
            sleep(Config.IdleDelayInMs);
        }

        public void RotateScreen(ScreenOrientation orientation)
        {
            Log($"Rotate screen to {orientation}");
            driver.Orientation = orientation;
            sleep(Config.IdleDelayInMs);
        }

        public void SetLocation(Location location)
        {
            Log($"Set location to Latitude: {location.Latitude}, Longitude: {location.Longitude}, Altitude: {location.Altitude}");
            driver.Location = location;
            sleep(Config.IdleDelayInMs);
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

                Log("Keyboard is shown, hide it");
                driver.HideKeyboard();
            }
            catch (Exception ignored)
            {
                Log(ignored.Message);
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
            if (screenSize == null)
            {
                byte[] screenshotBytes = ((ITakesScreenshot) driver).GetScreenshot().AsByteArray;
                var image = SkiaSharp.SKBitmap.Decode(new MemoryStream(screenshotBytes));
                screenSize = new Point(image.Width, image.Height);
            }

            return (Point) screenSize;
        }

        public Point GetAppOffset()
        {
            if (!isIos) return new Point(0, 0);

            try
            {
                AppiumWebElement rootElement =
                    FindSingleElementBy(By.XPath("//XCUIElementTypeApplication | //XCUIElementTypeOther"));
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

            if (retinaScale > 1)
            {
                return new Point((int)Math.Round(relativePointX * screenSize.X / retinaScale),
                    (int)Math.Round(relativePointY * screenSize.Y / retinaScale));
            }
            else
            {
                return new Point((int)Math.Round(relativePointX * screenSize.X),
                    (int)Math.Round(relativePointY * screenSize.Y));
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
            Log($"Sleep for {durationInMs} ms");
            Thread.Sleep(durationInMs);
        }

        protected bool compareNodes(XmlNode? expected, XmlNode? actual)
        {
            if (expected == null || actual == null) return false;

            if (!expected.Name.Equals(actual.Name)) return false;

            var compareAttrs = new string[]
            {
                "label", "text", "visible", "class", "name", "type", "resource-id", "content-desc", "accessibility-id"
            };

            foreach (var attrName in compareAttrs)
            {
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
                XmlNode? expectedChild = expected.ChildNodes[i];
                XmlNode? actualChild = actual.ChildNodes[i];

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

        public bool IsFlexCorrectEnabled()
        {
            var flexCorrect = options.ToCapabilities().GetCapability("kobiton:flexCorrect");
            return Config.DeviceSource == Config.DeviceSourceEnums.Kobiton &&
                   flexCorrect is bool b && b;
        }

        public Rectangle getRectOfXmlElement(XmlNode element)
        {
            var bounds = element.Attributes?["bounds"]?.Value;
            var parts = bounds.Split(',', '[', ']');

            var x = int.Parse(parts[1].Trim());
            int y = int.Parse(parts[2].Trim());
            int width = int.Parse(parts[4].Trim()) - x;
            int height = int.Parse(parts[5].Trim()) - y;

            return new Rectangle(x, y, width, height);
        }

        public string? GetTagOfElement(AppiumWebElement element)
        {
            try
            {
                return element.TagName;
            }
            catch (Exception ignored)
            {
                return null;
            }
        }

        public Uri GetAppiumServerUrl()
        {
            if (Config.DeviceSource == Config.DeviceSourceEnums.Kobiton)
            {
                return new Uri(this.proxy.GetServerUrl());
            }
            else
            {
                return new Uri(Config.GetAppiumServerUrlWithAuth());
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
            Log($"Current command: {currentCommandId}");
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

        public void CropRect(ref Rectangle rect, Rectangle boundRect)
        {
            if (rect.X < boundRect.X)
            {
                rect.X = boundRect.X;
            }
            else if (rect.X > boundRect.X + boundRect.Width)
            {
                rect.X = boundRect.X + boundRect.Width;
            }

            if (rect.Y < boundRect.Y)
            {
                rect.Y = boundRect.Y;
            }
            else if (rect.Y > boundRect.Y + boundRect.Height)
            {
                rect.Y = boundRect.Y + boundRect.Height;
            }

            if (rect.X + rect.Width > boundRect.X + boundRect.Width)
            {
                rect.Width = boundRect.X + boundRect.Width - rect.X;
            }

            if (rect.Y + rect.Height > boundRect.Y + boundRect.Height)
            {
                rect.Height = boundRect.Y + boundRect.Height - rect.Y;
            }
        }

        public void ScaleRect(ref Rectangle rect, double scale)
        {
            rect.X = (int) (rect.X * scale);
            rect.Y = (int) (rect.Y * scale);
            rect.Width = (int) (rect.Width * scale);
            rect.Height = (int) (rect.Height * scale);
        }

        public void Log(string? str)
        {
            TestContext.Progress.WriteLine(str);
        }

        public void SaveDebugResource()
        {
            try
            {
                string rootDir = Environment.CurrentDirectory;
                string debugDirName = $"{deviceName} {platformVersion}";
                debugDirName = Regex.Replace(debugDirName, "[^a-zA-Z0-9]", "_");
                string debugDirPath = Path.Combine(rootDir, "debug", debugDirName);

                Log($"Save source & screenshot for debugging at {debugDirPath}");
                Directory.CreateDirectory(debugDirPath);

                string source = driver.PageSource;
                File.WriteAllText(Path.Combine(debugDirPath, "source.xml"), source, Encoding.UTF8);

                ITakesScreenshot takesScreenshot = (ITakesScreenshot)driver;
                Screenshot screenshot = takesScreenshot.GetScreenshot();
                screenshot.SaveAsFile(Path.Combine(debugDirPath, "screenshot.png"), ScreenshotImageFormat.Png);
            }
            catch (Exception e)
            {
                Log(e.StackTrace);
            }
        }

        public async Task<Device> GetAvailableDevice(AppiumOptions capabilities)
        {
            var deviceListUriBuilder = new UriBuilder(Config.KobitonApiUrl + "/v1/devices");
            var query = new Dictionary<string, string>
            {
                { "isOnline", "true" },
                { "isBooked", "false" },
                {
                    "deviceName",
                    capabilities.ToCapabilities().GetCapability(MobileCapabilityType.DeviceName).ToString()
                },
                {
                    "platformVersion",
                    capabilities.ToCapabilities().GetCapability(MobileCapabilityType.PlatformVersion).ToString()
                },
                {
                    "platformName",
                    capabilities.ToCapabilities().GetCapability(MobileCapabilityType.PlatformName).ToString()
                },
                { "deviceGroup", capabilities.ToCapabilities().GetCapability("deviceGroup").ToString() }
            };
            deviceListUriBuilder.Query = new FormUrlEncodedContent(query).ReadAsStringAsync().Result;

            using (var httpClient = new HttpClient())
            {
                httpClient.DefaultRequestHeaders.Add(HttpRequestHeader.Authorization.ToString(),
                    Config.GetBasicAuthString());

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
            if (Config.DeviceSource != Config.DeviceSourceEnums.Kobiton)
            {
                return null;
            }

            int tryTime = 1;
            Device device = null;
            string deviceName = (string)capabilities.ToCapabilities().GetCapability(MobileCapabilityType.DeviceName);
            string deviceGroup = (string)capabilities.ToCapabilities().GetCapability("deviceGroup");
            string platformVersion =
                (string)capabilities.ToCapabilities().GetCapability(MobileCapabilityType.PlatformVersion);
            string platformName =
                (string)capabilities.ToCapabilities().GetCapability(MobileCapabilityType.PlatformName);
            while (tryTime <= Config.DeviceWaitingMaxTryTimes)
            {
                Log($"Is device with capabilities: (deviceName: {deviceName}, deviceGroup: {deviceGroup}, platformName: {platformName}, platformVersion: {platformVersion}) online? Retrying at {Utils.ConvertToOrdinal(tryTime)} time");
                device = GetAvailableDevice(capabilities).Result;
                if (device != null)
                {
                    Log($"Device is found with capabilities: (deviceName: {deviceName}, deviceGroup: {deviceGroup}, platformName: {platformName}, platformVersion: {platformVersion})");
                    break;
                }

                tryTime++;
                sleep(Config.DeviceWaitingInternalInMs);
            }

            if (device == null)
            {
                throw new Exception(
                    $"Cannot find any online devices with capabilites: (deviceName: {deviceName}, deviceGroup: {deviceGroup}, platformName: {platformName}, platformVersion: {platformVersion})");
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
            public string context, window;
            public bool isHidden;
            public long sourceLength, matchTexts, matchTextsPercent;

            public ContextInfo(string context)
            {
                this.context = context;
            }
        }
    }
}
