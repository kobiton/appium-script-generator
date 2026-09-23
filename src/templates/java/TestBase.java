package com.kobiton.scriptlessautomation;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.reflect.TypeToken;
import com.google.gson.stream.JsonReader;
import io.appium.java_client.AppiumClientConfig;
import io.appium.java_client.AppiumDriver;
import io.appium.java_client.HidesKeyboard;
import io.appium.java_client.InteractsWithApps;
import io.appium.java_client.Location;
import io.appium.java_client.Setting;
import io.appium.java_client.android.AndroidDriver;
import io.appium.java_client.android.nativekey.AndroidKey;
import io.appium.java_client.android.nativekey.KeyEvent;
import io.appium.java_client.ios.IOSDriver;
import io.appium.java_client.remote.MobilePlatform;
import io.appium.java_client.remote.SupportsContextSwitching;
import io.appium.java_client.remote.SupportsLocation;
import io.appium.java_client.remote.SupportsRotation;
import okhttp3.*;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.parser.Parser;
import org.jsoup.select.Elements;
import org.openqa.selenium.*;
import org.openqa.selenium.interactions.KeyInput;
import org.openqa.selenium.interactions.PointerInput;
import org.openqa.selenium.interactions.Sequence;
import org.openqa.selenium.remote.DesiredCapabilities;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.*;
import java.lang.reflect.Type;
import java.net.MalformedURLException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.*;
import java.util.stream.Collectors;

public class TestBase {
    public AppiumDriver driver;
    public ProxyServer proxy;
    public OtpService otpService = new OtpService();
    public DesiredCapabilities desiredCaps;
    public boolean isIos;
    public Point screenSize;
    public double retinaScale;
    public String deviceName, platformVersion;

    public static String NATIVE_CONTEXT = "NATIVE_APP";
    public static final String PLATFORM_NAME = "platformName";
    public static final String DEVICE_NAME = "deviceName";
    public static final String PLATFORM_VERSION = "platformVersion";

    enum PRESS_TYPES {HOME, BACK, POWER, APP_SWITCH, ENTER, DELETE}

    public Gson gson = new GsonBuilder().disableHtmlEscaping().create();
    public final OkHttpClient httpClient = Config.createHttpClientBuilder().build();

    private String currentContext;
    private String currentWindow;

    public void setup(DesiredCapabilities desiredCaps, double retinaScale) throws Exception {
        this.desiredCaps = desiredCaps;
        this.retinaScale = retinaScale;
        this.isIos = MobilePlatform.IOS.equalsIgnoreCase(getPlatformName(desiredCaps));
        this.deviceName = (String) desiredCaps.getCapability(DEVICE_NAME);
        this.platformVersion = (String) desiredCaps.getCapability(PLATFORM_VERSION);

        this.proxy = new ProxyServer();

        // Session creation can take minutes while a device is allocated and the app installed
        AppiumClientConfig clientConfig = AppiumClientConfig.defaultConfig()
            .baseUrl(getAppiumServerUrl())
            .readTimeout(Duration.ofSeconds(ProxyServer.socketTimeoutInSecond));
        if (isIos) {
            driver = new IOSDriver(clientConfig, desiredCaps);
        } else {
            driver = new AndroidDriver(clientConfig, desiredCaps);
        }
    }

    /**
     * Selenium 4 stores platformName as a Platform enum, so read it back as the recorded label
     */
    public static String getPlatformName(Capabilities capabilities) {
        Object platformName = capabilities.getCapability(PLATFORM_NAME);
        if (platformName instanceof Platform) {
            return ((Platform) platformName).is(Platform.IOS) ? MobilePlatform.IOS : MobilePlatform.ANDROID;
        }

        return platformName == null ? null : platformName.toString();
    }

    public void cleanup() {
        if (driver != null) {
            driver.quit();
        }

        if (proxy != null && proxy.isAlive()) {
            proxy.stop();
        }

        if (otpService != null) {
            otpService.cleanup();
        }
    }

    public String updateCurrentContext() {
        String previousContext = currentContext;
        currentContext = getContextDriver().getContext();
        if (!Objects.equals(previousContext, currentContext)) {
            System.out.println(String.format("Context is changed from %s to %s", previousContext, currentContext));
        }

        return previousContext;
    }

    public boolean isNativeContext() {
        return NATIVE_CONTEXT.equals(currentContext);
    }

    public void switchContext(String context) {
        if (context.equals(currentContext)) return;
        System.out.println(String.format("Switch to %s context", context));
        getContextDriver().context(context);
        currentContext = context;
    }

    public void switchToNativeContext() {
        switchContext(NATIVE_CONTEXT);
    }

    public void switchWindow(String window) {
        if (window.equals(currentWindow)) return;
        System.out.println(String.format("Switch to %s window", window));
        driver.switchTo().window(window);
        currentWindow = window;
        currentContext = null;
    }

    private String switchToWebContextCore() throws Exception {
        switchToNativeContext();
        Document nativeDocument = loadXMLFromString(driver.getPageSource());
        List<String> nativeTexts = new ArrayList<>();
        Elements elements;
        if (nativeDocument.selectXpath(getWebviewXpathSelector()).isEmpty()) {
            elements = nativeDocument.selectXpath("//*");
        }
        else {
            elements = nativeDocument.selectXpath(getWebviewXpathSelector() + "//*");
        }

        for (Element element : elements) {
            if (!element.children().isEmpty()) continue;
            String text = "";
            if (isIos) {
                List<String> excludeTags = Arrays.asList("XCUIElementTypeImage", "XCUIElementTypeSwitch");
                if (excludeTags.contains(element.tagName())) continue;

                text = element.attr("value");
                if (text.isEmpty()) {
                    text = element.attr("label");
                }
            }
            else {
                text = element.attr("text");
                if (text.isEmpty() && "android.view.View".equals(element.tagName())) {
                    text = element.attr("content-desc");
                }
            }

            text = text.trim().toLowerCase();
            if (!text.isEmpty()) nativeTexts.add(text);
        }

        List<ContextInfo> webContextsInfo = collectWebContextsInfo(nativeTexts);
        if (webContextsInfo.isEmpty()) {
            throw new Exception("Cannot find any usable web contexts");
        }

        if (Config.DEVICE_SOURCE == Config.DEVICE_SOURCE_ENUMS.OTHER) {
            switchContext(webContextsInfo.get(0).context);
            Set<String> windows = driver.getWindowHandles();
            if (windows.size() > 1) {
                String currentWindow = driver.getWindowHandle();
                for (String window : windows) {
                    if (window.equals(currentWindow)) continue;
                    switchWindow(window);
                    List<ContextInfo> webContextsInfoFromWindow = collectWebContextsInfo(nativeTexts);
                    webContextsInfo.addAll(webContextsInfoFromWindow);
                }
            }
        }

        webContextsInfo = webContextsInfo.stream().filter(contextInfo -> !contextInfo.isHidden).collect(Collectors.toList());
        if (webContextsInfo.isEmpty()) {
            throw new Exception("Cannot find any usable web contexts");
        }

        ContextInfo bestContextInfo;
        webContextsInfo.sort((ContextInfo c1, ContextInfo c2) -> (int) (c2.matchTextsPercent - c1.matchTextsPercent));
        if (webContextsInfo.get(0).matchTextsPercent > 40) {
            bestContextInfo = webContextsInfo.get(0);
        } else {
            webContextsInfo.sort((ContextInfo c1, ContextInfo c2) -> (int) (c2.sourceLength - c1.sourceLength));
            bestContextInfo = webContextsInfo.get(0);
        }

        switchWindow(bestContextInfo.window);
        switchContext(bestContextInfo.context);
        System.out.println(String.format("Switched to %s web context in %s window successfully with confident %s%%", bestContextInfo.context, bestContextInfo.window, bestContextInfo.matchTextsPercent));
        return bestContextInfo.context;
    }

    private List<ContextInfo> collectWebContextsInfo(List<String> nativeTexts) {
        List<ContextInfo> contextInfos = new ArrayList<>();
        Set<String> contexts = getContextDriver().getContextHandles();
        boolean hasWebContext = contexts.stream().anyMatch(context -> !NATIVE_CONTEXT.equals(context));
        if (!hasWebContext) {
            System.out.println("No web context is available, contexts: " + String.join(", ", contexts));
        }

        for (String context : contexts) {
            if (!context.startsWith("WEBVIEW") && !context.equals("CHROMIUM")) continue;
            ContextInfo contextInfo = new ContextInfo(context);
            String source;
            try {
                switchContext(context);
                boolean isHiddenDocument = (boolean) driver.executeScript("return document.hidden");
                contextInfo.isHidden = isHiddenDocument;
                contextInfo.window = driver.getWindowHandle();
                contextInfos.add(contextInfo);
                if (isHiddenDocument) continue;
                source = driver.getPageSource();
            } catch (Exception ex) {
                System.out.println(String.format("Bad context %s, error \"%s\", skipping...", context, ex.getMessage()));
                continue;
            }

            if (source == null) continue;
            contextInfo.sourceLength = source.length();
            if (nativeTexts.isEmpty()) continue;

            Document htmlDoc = loadXMLFromString(source);
            String bodyString = htmlDoc.select("body").text().toLowerCase();
            long matchTexts = 0;
            for (String nativeText : nativeTexts) {
                if (bodyString.contains(nativeText)) matchTexts++;
            }

            contextInfo.matchTexts = matchTexts;
            contextInfo.matchTextsPercent = matchTexts * 100 / nativeTexts.size();
            if (contextInfo.matchTextsPercent >= 80) {
                break;
            }
        }

        return contextInfos;
    }

    public String switchToWebContext() throws Exception {
        // Some web page is very slow to load (up to 30s),
        // and there is no web context until it finish loading
        return Utils.retry(new Utils.Task<String>() {
            @Override
            String exec(int attempt) throws Exception {
                System.out.println(String.format("Finding a web context %s attempt", Utils.convertToOrdinal(attempt)));
                return switchToWebContextCore();
            }
        }, 4, 10000);
    }

    public Object executeScriptOnWebElement(WebElement element, String command) throws Exception {
        String script;
        try (InputStream inputStream = getResourceAsStream("execute-script-on-web-element.js")) {
            script = new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
        }

        return driver.executeScript(script, element, command);
    }

    public void scrollToWebElement(WebElement element) throws Exception {
        System.out.println(String.format("Scroll to web element %s", element.getTagName()));
        executeScriptOnWebElement(element, "scrollIntoView");
        sleep(1000);
    }

    public Rectangle getWebElementRect(WebElement element) throws Exception {
        String resultString = (String) executeScriptOnWebElement(element, "getBoundingClientRect");
        JsonObject resultJson = gson.fromJson(resultString, JsonObject.class);
        Rectangle rect = new Rectangle(
            (int) (resultJson.get("x").getAsLong() / retinaScale),
            (int) (resultJson.get("y").getAsLong() / retinaScale),
            (int) (resultJson.get("height").getAsLong() / retinaScale),
            (int) (resultJson.get("width").getAsLong() / retinaScale)
        );

        return rect;
    }

    public Rectangle calculateNativeRect(Rectangle webElementRect) throws Exception {
        double scale = Double.parseDouble(driver.executeScript("return window.visualViewport.scale").toString());
        executeScriptOnWebElement(null, "insertKobitonWebview");
        switchToNativeContext();

        try {
            WebElement kobitonWebview = this.isIos
                ? findSingleElementBy(By.xpath("//*[@label='__kobiton_webview__']"))
                : findSingleElementBy(By.xpath("//*[@text='__kobiton_webview__']"));
            Rectangle kobitonWebviewRect = kobitonWebview.getRect();
            Rectangle nativeRect = new Rectangle(
                    webElementRect.x + kobitonWebviewRect.x,
                    webElementRect.y + kobitonWebviewRect.y,
                    webElementRect.height,
                    webElementRect.width
            );
            return scaleRect(cropRect(nativeRect, kobitonWebviewRect), scale);
        }
        catch (Exception e) {
            if (this.isIos) throw e;

            System.out.println(e.getMessage());
            Document nativeDoc = loadXMLFromString(driver.getPageSource());
            int webviewTop = 0;
            Element toolbarElement = nativeDoc.selectXpath("//*[@resource-id='com.android.chrome:id/toolbar' or @resource-id='com.android.chrome:id/url_bar' or @resource-id='com.android.chrome:id/location_bar' or @resource-id='com.android.chrome:id/home_button' or @resource-id='com.android.chrome:id/tab_switcher_button' or @resource-id='com.android.chrome:id/menu_button']").first();
            if (toolbarElement != null) {
                Rectangle toolbarRect = getRectOfXmlElement(toolbarElement);
                webviewTop = toolbarRect.y + toolbarRect.height;
            }
            else {
                Elements chromeElements = nativeDoc.selectXpath("//*[@package='com.android.chrome']");
                for (Element element : chromeElements) {
                    Rectangle rect = getRectOfXmlElement(element);
                    if (rect.y > 0 && rect.height > 0) {
                        webviewTop = rect.y;
                        break;
                    }
                }

                if (webviewTop == 0) {
                    throw new Exception("Cannot calculate native rect for web element");
                }
            }

            Dimension windowSize = driver.manage().window().getSize();
            Rectangle webviewRect = new Rectangle(
                0,
                webviewTop,
                windowSize.height - webviewTop,
                windowSize.width
            );

            WebElement topToolbar = null;
            if (this.isIos) {
                try {
                    topToolbar = findSingleElementBy(By.xpath("//*[@name='TopBrowserBar' or @name='topBrowserBar' or @name='TopBrowserToolbar' or child::XCUIElementTypeButton[@name='URL']]"));
                } catch (Exception ignored) {
                    Document nativeDocument = loadXMLFromString(driver.getPageSource());
                    Element webviewElement = nativeDocument.selectXpath(getWebviewXpathSelector()).first();
                    if (webviewElement == null) {
                        throw new Exception("Cannot find webview element");
                    }

                    Element curElement = webviewElement.parent();
                    while (curElement != null) {
                        Element firstChildElement = curElement.child(0);
                        Rectangle firstChildRect = new Rectangle(
                                Integer.parseInt(firstChildElement.attr("x")),
                                Integer.parseInt(firstChildElement.attr("y")),
                                Integer.parseInt(firstChildElement.attr("height")),
                                Integer.parseInt(firstChildElement.attr("width"))
                        );

                        if (!webviewRect.equals(firstChildRect) && Utils.isRectangleInclude(webviewRect, firstChildRect)) {
                            String topToolbarXpath = Utils.getXPath(firstChildElement);
                            topToolbar = findSingleElementBy(By.xpath(topToolbarXpath));
                            break;
                        }

                        curElement = curElement.parent();
                    }
                }
            }

            int webViewTop = webviewRect.y;
            int deltaHeight = 0;
            if (topToolbar != null) {
                Rectangle topToolbarRect = topToolbar.getRect();
                webViewTop = topToolbarRect.y + topToolbarRect.height;
                deltaHeight = webViewTop - webviewRect.y;
            }

            webviewRect = new Rectangle(
                webviewRect.x,
                webViewTop,
                webviewRect.height - deltaHeight,
                webviewRect.width
            );

            Rectangle nativeRect = new Rectangle(
                webviewRect.x + webElementRect.x,
                webviewRect.y + webElementRect.y,
                webElementRect.height,
                webElementRect.width
            );

            return scaleRect(cropRect(nativeRect, webviewRect), scale);
        }
    }

    private WebElement findVisibleElementCore(int timeoutInMiliSeconds, By... locators) throws Exception {
        List<WebElement> foundElements = findElementsBy(null, timeoutInMiliSeconds, locators);
        WebElement foundVisibleElement = null;

        for (WebElement element : foundElements) {
            boolean visible;

            if (isNativeContext()) {
                Rectangle rect = element.getRect();
                visible = rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0;
            }
            else {
                String res = (String) executeScriptOnWebElement(element, "isElementVisible");
                visible = "true".equals(res);
            }

            if (visible) {
                foundVisibleElement = element;
                break;
            }
        }

        if (foundVisibleElement == null) {
            throw new Exception(String.format("Cannot find visible element by: %s", Utils.getLocatorText(locators)));
        }

        if (!isNativeContext()) {
            scrollToWebElement(foundVisibleElement);
        }

        return foundVisibleElement;
    }

    public WebElement findVisibleElement(int timeoutInMiliSeconds, By... locators) throws Exception{
        return Utils.retry(new Utils.Task<WebElement>() {
            @Override
            WebElement exec(int attempt) throws Exception {
                System.out.println(String.format("Finding visible element %s attempt with locator: %s", Utils.convertToOrdinal(attempt), Utils.getLocatorText(locators)));
                return findVisibleElementCore(timeoutInMiliSeconds, locators);
            }

            @Override
            public void handleException(Exception e, int attempt) throws Exception {
                // Prevent switching to the wrong web context by trying a different one
                if (!isNativeContext()) {
                    switchToWebContext();
                }
            }
        }, isNativeContext() ? 1 : 3, 3000);
    }

    private WebElement findSingleElementBy(By locator) throws Exception {
        System.out.println("Find element by: " + locator);

        try {
            return this.driver.findElement(locator);
        }
        catch (Exception ignored) {
            throw new Exception("Cannot find element by: " + locator);
        }
    }

    private List<WebElement> findElements(WebElement rootElement, int timeoutInMiliSeconds, boolean multiple, By... locators) throws Exception {
        String locatorText = Utils.getLocatorText(locators);
        System.out.println(String.format("Find element by: %s", locatorText));
        String notFoundMessage = String.format("Cannot find element by: %s", locatorText);

        if (locators.length == 1) {
            setImplicitWaitInMiliSecond(timeoutInMiliSeconds);

            List<WebElement> elements = null;
            try {
                if (rootElement == null) {
                    elements = driver.findElements(locators[0]);
                } else {
                    elements = rootElement.findElements(locators[0]);
                }
            } finally {
                setImplicitWaitInMiliSecond(Config.IMPLICIT_WAIT_IN_MS);
            }

            if (multiple && elements != null && !elements.isEmpty())
                return elements;
            else if (!multiple && elements != null && elements.size() == 1)
                return elements;

            throw new Exception(notFoundMessage);
        } else {
            int waitInterval = 5;
            return Utils.retry(new Utils.Task<List<WebElement>>() {
                @Override
                List<WebElement> exec(int attempt) throws Exception {
                    setImplicitWaitInMiliSecond(0);
                    try {
                        List<WebElement> elements = null;
                        for (By locator : locators) {
                            try {
                                if (rootElement == null) {
                                    elements = driver.findElements(locator);
                                } else {
                                    elements = rootElement.findElements(locator);
                                }

                                if (multiple && elements != null && !elements.isEmpty())
                                    return elements;
                                else if (!multiple && elements != null && elements.size() == 1)
                                    return elements;
                            } catch (Exception ignored) {
                            }
                        }
                    } finally {
                        setImplicitWaitInMiliSecond(Config.IMPLICIT_WAIT_IN_MS);
                    }

                    throw new Exception(notFoundMessage);
                }
            }, timeoutInMiliSeconds / (waitInterval * 1000), waitInterval * 1000);
        }
    }

    public WebElement findElementBy(WebElement rootElement, int timeoutInMiliSeconds, By... locators) throws Exception {
        List<WebElement> foundElements = findElements(rootElement, timeoutInMiliSeconds, true, locators);
        // flex correct could switch context on the fly
        if (isFlexCorrectEnabled()) {
            updateCurrentContext();
        }

        return foundElements.get(0);
    }

    public WebElement findElementBy(By... locators) throws Exception {
        return findElementBy(null, Config.IMPLICIT_WAIT_IN_MS, locators);
    }

    public WebElement findElementBy(int timeoutInMiliSeconds, By... locators) throws Exception {
        return findElementBy(null, Math.max(Config.IMPLICIT_WAIT_IN_MS, timeoutInMiliSeconds), locators);
    }

    public List<WebElement> findElementsBy(WebElement rootElement, int timeoutInMiliSeconds, By... locators) throws Exception {
        List<WebElement> foundElements = findElements(rootElement, timeoutInMiliSeconds, true, locators);
        // flex correct could switch context on the fly
        if (isFlexCorrectEnabled()) {
            updateCurrentContext();
        }

        return foundElements;
    }

    public List<WebElement> findElementsBy(By... locators) throws Exception {
        return findElementsBy(null, Config.IMPLICIT_WAIT_IN_MS, locators);
    }

    /**
     * Scroll to find best element on scrollable
     */
    public WebElement findVisibleElementOnScrollable(int timeoutInMiliSeconds, By... locators) throws Exception {
        Type type = new TypeToken<Map<String, String>>() {
        }.getType();
        JsonReader reader = new JsonReader(new InputStreamReader(getResourceAsStream(getCurrentCommandId() + ".json")));
        Map<String, String> infoMap = gson.fromJson(reader, type);
        Point screenSize = getScreenSize();

        WebElement touchableElement = Utils.retry(new Utils.Task<WebElement>() {
            private WebElement scrollableElement;
            private boolean swipedToTop = false;

            @Override
            WebElement exec(int attempt) throws Exception {
                System.out.println(String.format("Finding visible element on scrollable %s attempt with locator: %s", Utils.convertToOrdinal(attempt), Utils.getLocatorText(locators)));
                return findVisibleElementCore(timeoutInMiliSeconds, locators);
            }

            @Override
            public void handleException(Exception e, int attempt) throws Exception {
                System.out.println(String.format("Cannot find visible element on scrollable %s attempt, error: %s", Utils.convertToOrdinal(attempt), e.getMessage()));
                // Might switch to the wrong web context on the first attempt; retry before scrolling down
                if (!isNativeContext() && attempt == 1) {
                    // Wait a bit for web is fully loaded
                    sleep(10000);
                    switchToWebContext();
                    return;
                }

                if (scrollableElement == null) {
                    scrollableElement = findElementBy(By.xpath(infoMap.get("scrollableElementXpath")));
                }

                if (!swipedToTop) {
                    hideKeyboard();
                    swipeToTop(getCenterOfElement(scrollableElement));
                    swipedToTop = true;
                } else {
                    Point center = getCenterOfElement(scrollableElement);
                    Rectangle rect = scrollableElement.getRect();
                    // Fix bug when scrollableElement is out of viewport
                    if (center.y > screenSize.y || rect.height < 0) {
                        center = new Point(center.x, screenSize.y / 2);
                    }

                    Point toPoint = new Point(center.x, Math.max((int) (center.y - rect.height / 1.5), 0));
                    dragByPoint(center, toPoint);
                }
            }
        }, 5, 3000);

        if (touchableElement == null) {
            throw new Exception("Cannot find any visible element on scrollable");
        }

        return touchableElement;
    }

    public boolean isButtonElement(WebElement element) throws Exception {
        String tagName = element.getTagName();
        return tagName != null && tagName.contains("Button");
    }

    public WebElement findWebview() throws Exception {
        return findSingleElementBy(By.xpath(getWebviewXpathSelector()));
    }

    public String getWebviewXpathSelector() {
        return this.isIos ? "(//XCUIElementTypeWebView)[1]" : "(//android.webkit.WebView)[1]";
    }

    /**
     * Touch at center of element (element need to be visible)
     */
    public void touchAtCenterOfElement(WebElement element) {
        System.out.println(String.format("Touch at center of element %s", element.getTagName()));
        Point center = getCenterOfElement(element);
        touchAtPoint(center);
    }

    /**
     * Handle event touch element
     */
    public void touchOnElement(WebElement element, double relativePointX, double relativePointY) throws Exception {
        if (isButtonElement(element)) {
            clickElement(element);
        } else {
            touchAtRelativePointOfElement(element, relativePointX, relativePointY);
        }
    }

    /**
     * Click element (element need to be visible)
     */
    public void clickElement(WebElement element) {
        System.out.println(String.format("Click on element with type: %s", element.getTagName()));
        element.click();
    }

    /**
     * Touch at relative point of element (element need to be visible)
     */
    public void touchAtRelativePointOfElement(WebElement element, double relativePointX, double relativePointY) throws Exception {
        System.out.println(String.format("Touch on element %s at relative point (%s %s)", element.getTagName(), relativePointX, relativePointY));
        Rectangle nativeRect;
        if (isNativeContext()) {
            nativeRect = element.getRect();
        }
        else {
            Rectangle webRect = getWebElementRect(element);
            nativeRect = calculateNativeRect(webRect);
        }

        touchAtPoint(getAbsolutePoint(relativePointX, relativePointY, nativeRect));
    }

    /**
     * Touch at a relative position
     */
    public void touchAtPoint(double relativePointX, double relativePointY) throws IOException {
        System.out.println(String.format("Touch at relative point (%s, %s)", relativePointX, relativePointY));

        Point absolutePoint = getAbsolutePoint(relativePointX, relativePointY);
        touchAtPoint(absolutePoint);
    }

    /**
     * Touch at a Point
     */
    public void touchAtPoint(Point point) {
        System.out.println(String.format("Touch at point (%s, %s)", point.x, point.y));

        PointerInput finger = new PointerInput(PointerInput.Kind.TOUCH, "finger");
        Sequence touchSequence = new Sequence(finger, 0);
        touchSequence.addAction(finger.createPointerMove(Duration.ofMillis(0), PointerInput.Origin.viewport(), point.x, point.y));
        touchSequence.addAction(finger.createPointerDown(PointerInput.MouseButton.LEFT.asArg()));
        touchSequence.addAction(finger.createPointerUp(PointerInput.MouseButton.LEFT.asArg()));
        driver.perform(Arrays.asList(touchSequence));
    }

    public void swipeOnElement(WebElement element, double relativePointX1, double relativePointY1, double relativePointX2, double relativePointY2, int durationInMs) throws Exception {
        System.out.println(String.format("Swipe on element %s from relative point (%s %s) to relative point (%s %s)", element.getTagName(), relativePointX1, relativePointY1, relativePointX2, relativePointY2));
        Rectangle nativeRect;
        if (isNativeContext()) {
            nativeRect = element.getRect();
        }
        else {
            Rectangle webRect = getWebElementRect(element);
            nativeRect = calculateNativeRect(webRect);
        }

        Point fromPoint = getAbsolutePoint(relativePointX1, relativePointY1, nativeRect);
        Point toPoint = getAbsolutePoint(relativePointX2, relativePointY2, nativeRect);
        swipeByPoint(fromPoint, toPoint, durationInMs);
    }

    /**
     * Swipe from center of element (with accelerate)
     */
    public void swipeFromPoint(Point fromPoint, double relativeOffsetX, double relativeOffsetY, int durationInMs) throws IOException {
        double toX = fromPoint.x + relativeOffsetX * getScreenSize().x;
        double toY = fromPoint.y + relativeOffsetY * getScreenSize().y;
        toX = Math.max(toX, 0);
        toY = Math.max(toY, 0);
        Point toPoint = new Point((int) toX, (int) toY);

        swipeByPoint(fromPoint, toPoint, durationInMs);
    }

    /**
     * Drag from center element (no accelerate)
     */
    public Sequence dragFromPoint(Point fromPoint, double relativeOffsetX, double relativeOffsetY) throws IOException {
        double toX = fromPoint.x + relativeOffsetX * getScreenSize().x;
        double toY = fromPoint.y + relativeOffsetY * getScreenSize().y;
        toX = Math.max(toX, 0);
        toY = Math.max(toY, 0);
        Point toPoint = new Point((int) toX, (int) toY);

        return dragByPoint(fromPoint, toPoint);
    }

    /**
     * Swipe from relative position to relative position (with accelerate)
     */
    public void swipeByPoint(double fromRelativePointX, double fromRelativePointY, double toRelativePointX, double toRelativePointY, int durationInMs) throws IOException {
        System.out.println(String.format("Swipe from relative point (%s, %s) to relative point (%s, %s) with duration %s", fromRelativePointX, fromRelativePointY, toRelativePointX, toRelativePointY, durationInMs));

        Point fromPoint = getAbsolutePoint(fromRelativePointX, fromRelativePointY);
        Point toPoint = getAbsolutePoint(toRelativePointX, toRelativePointY);

        swipeByPoint(fromPoint, toPoint, durationInMs);
    }

    /**
     * Swipe from Point to Point (with accelerate)
     */
    public void swipeByPoint(Point fromPoint, Point toPoint, int durationInMs) {
        System.out.println(String.format("Swipe from point (%s, %s) to point (%s, %s) with duration %s", fromPoint.x, fromPoint.y, toPoint.x, toPoint.y, durationInMs));

        PointerInput finger = new PointerInput(PointerInput.Kind.TOUCH, "finger");
        Sequence sequence = new Sequence(finger, 0);

        sequence.addAction(finger.createPointerMove(Duration.ofMillis(0), PointerInput.Origin.viewport(), fromPoint.x, fromPoint.y));
        sequence.addAction(finger.createPointerDown(PointerInput.MouseButton.LEFT.asArg()));
        sequence.addAction(finger.createPointerMove(Duration.ofMillis(durationInMs), PointerInput.Origin.viewport(), toPoint.x, toPoint.y));
        sequence.addAction(finger.createPointerUp(PointerInput.MouseButton.LEFT.asArg()));

        driver.perform(Arrays.asList(sequence));
        // perform() returns as soon as the gesture is dispatched, but the swipe animation
        // is still running on screen. Wait for its full duration so the next action sees a stable screen.
        sleep(durationInMs);
    }

    /**
     * Quick swipe to top from a Point
     */
    public void swipeToTop(Point fromPoint) throws Exception {
        Point toPoint = new Point(fromPoint.x, getScreenSize().y - 10);
        System.out.println(String.format("Swipe to top from point (%s, %s) to point (%s, %s)", fromPoint.x, fromPoint.y, toPoint.x, toPoint.y));

        swipeByPoint(fromPoint, toPoint, 100);
        // A fast swipe triggers scroll inertia that keeps the content moving after the gesture ends.
        // Wait for the screen to settle before interacting again.
        sleep(Config.IDLE_DELAY_IN_MS);
    }

    /**
     * Drag from Point to Point (no accelerate)
     */
    public Sequence dragByPoint(Point fromPoint, Point toPoint) {
        PointerInput finger = new PointerInput(PointerInput.Kind.TOUCH, "finger");
        Sequence sequence = new Sequence(finger, 0);

        int steps = 20;
        int duration = 5000;
        int stepDuration = duration / steps;
        double xStep = (toPoint.x - fromPoint.x) / (double) steps;
        double yStep = (toPoint.y - fromPoint.y) / (double) steps;

        sequence.addAction(finger.createPointerMove(Duration.ofMillis(0), PointerInput.Origin.viewport(), fromPoint.x, fromPoint.y));
        sequence.addAction(finger.createPointerDown(PointerInput.MouseButton.LEFT.asArg()));
        for (int i = 1; i <= steps; i++) {
            int nextX = fromPoint.x + (int) (xStep * i);
            int nextY = fromPoint.y + (int) (yStep * i);
            sequence.addAction(finger.createPointerMove(Duration.ofMillis(stepDuration), PointerInput.Origin.viewport(), nextX, nextY));
        }

        sequence.addAction(finger.createPointerUp(PointerInput.MouseButton.LEFT.asArg()));

        System.out.println(String.format("Drag from point (%s, %s) to point (%s, %s)", fromPoint.x, fromPoint.y, toPoint.x, toPoint.y));
        driver.perform(Arrays.asList(sequence));
        // perform() returns once the gesture is dispatched; the drag animation still runs on screen.
        // Wait for its full duration so the next action sees a stable screen.
        sleep(duration);
        return sequence;
    }

    public void sendKeys(String keys) throws Exception {
        sleep(Config.SEND_KEYS_DELAY_IN_MS);
        System.out.println(String.format("Send keys: %s", keys));
        try {
            KeyInput keyInput = new KeyInput("keyboard");
            Sequence sequence = new Sequence(keyInput, 0);
            for (int index = 0; index < keys.length(); index++) {
                int codePoint = Character.codePointAt(keys, index);
                sequence.addAction(keyInput.createKeyDown(codePoint));
                sequence.addAction(keyInput.createKeyUp(codePoint));
            }

            driver.perform(Arrays.asList(sequence));
        } catch (Exception ignored) {
            driver.switchTo().activeElement().sendKeys(keys);
        }

        sleep(Config.SEND_KEYS_DELAY_IN_MS);
    }

    public void sendKeys(WebElement element, String keys) {
        System.out.println(String.format("Send keys '%s' on element %s", keys, element.getTagName()));

        element.sendKeys(keys);
    }

    public void clearTextField(int maxChars) throws Exception {
        System.out.println(String.format("Clear text field, maximum %d characters", maxChars));
        pressMultiple(PRESS_TYPES.DELETE, maxChars);
    }

    public void press(PRESS_TYPES type) throws Exception {
        System.out.println(String.format("Press on %s key", type));

        switch (type) {
            case HOME:
                if (isIos) {
                    boolean needPressHome = true;
                    try {
                        IOSDriver iosDriver = getIosDriver();
                        // isDeviceLocked() and unlockDevice() could failed on some devices
                        if (iosDriver.isDeviceLocked()) {
                            iosDriver.unlockDevice();
                            needPressHome = false;
                        }
                    }
                    catch (Exception ex) {
                        System.out.println(String.format("Cannot check device locked or unlock device, error: %s", ex.getMessage()));
                    }

                    if (needPressHome) {
                        driver.executeScript("mobile: pressButton", Map.of("name", "home"));
                    }
                } else {
                    pressAndroidKey(AndroidKey.HOME);
                }

                sleep(Config.IDLE_DELAY_IN_MS);
                break;

            case BACK:
                pressAndroidKey(AndroidKey.BACK);
                sleep(Config.IDLE_DELAY_IN_MS);
                break;

            case POWER:
                if (isIos) {
                    IOSDriver iosDriver = getIosDriver();
                    if (iosDriver.isDeviceLocked()) {
                        iosDriver.unlockDevice();
                    } else {
                        iosDriver.lockDevice();
                    }
                } else {
                    pressAndroidKey(AndroidKey.POWER);
                }

                sleep(Config.IDLE_DELAY_IN_MS);
                break;

            case APP_SWITCH:
                pressAndroidKey(AndroidKey.APP_SWITCH);
                sleep(Config.IDLE_DELAY_IN_MS);
                break;

            case ENTER:
                if (isIos) {
                    sendKeys("\n");
                } else {
                    pressAndroidKey(AndroidKey.ENTER);
                }

                sleep(Config.IDLE_DELAY_IN_MS);
                break;

            case DELETE:
                if (Config.DEVICE_SOURCE == Config.DEVICE_SOURCE_ENUMS.KOBITON) {
                    sendKeys("\b");
                }
                else {
                    sendKeys(this.isIos ? "\b" : Keys.BACK_SPACE.toString());
                }
                break;

            default:
                throw new Exception(String.format("Don't support press %s key", type));

        }
    }

    public void pressMultiple(PRESS_TYPES type, int count) throws Exception {
        System.out.println(String.format("Press on %s key %s times", type, count));
        switch (type) {
            case DELETE:
                if (Config.DEVICE_SOURCE == Config.DEVICE_SOURCE_ENUMS.KOBITON) {
                    sendKeys(new String(new char[count]).replace("\0", "\b"));
                }
                else {
                    sendKeys(new String(new char[count]).replace("\0", this.isIos ? "\b" : Keys.BACK_SPACE.toString()));
                }
                break;
            default:
                for (int i = 0; i < count; i++) {
                    press(type);
                }
        }
    }

    public void pressAndroidKey(AndroidKey key) {
        getAndroidDriver().pressKey(new KeyEvent(key));
    }

    public void activateApp(String appPackage) {
        System.out.println(String.format("Activate app %s", appPackage));
        ((InteractsWithApps) driver).activateApp(appPackage);
        sleep(Config.IDLE_DELAY_IN_MS);
    }

    public void rotateScreen(ScreenOrientation orientation) {
        System.out.println(String.format("Rotate screen to %s", orientation));
        ((SupportsRotation) driver).rotate(orientation);
        sleep(Config.IDLE_DELAY_IN_MS);
    }

    public void setLocation(Location location) {
        System.out.println(String.format("Set location to %s", location));
        ((SupportsLocation) driver).setLocation(location);
        sleep(Config.IDLE_DELAY_IN_MS);
    }

    public void hideKeyboard() {
        try {
            if (this.isIos) {
                if (!getIosDriver().isKeyboardShown()) return;
            } else {
                if (!getAndroidDriver().isKeyboardShown()) return;
            }

            System.out.println("Keyboard is shown, hide it");
            ((HidesKeyboard) driver).hideKeyboard();
        } catch (Exception ignored) {
        }
    }

    public void setImplicitWaitInMiliSecond(int value) {
        driver.manage().timeouts().implicitlyWait(Duration.ofMillis(value));
    }

    public void updateSettings() {
        if (this.isIos) {
            getIosDriver().setSetting(Setting.IGNORE_UNIMPORTANT_VIEWS, true);
        } else {
            getAndroidDriver().setSetting(Setting.IGNORE_UNIMPORTANT_VIEWS, true);
        }
    }

    public Point getScreenSize() throws IOException {
        if (screenSize == null) {
            byte[] screenshotBytes = ((TakesScreenshot) driver).getScreenshotAs(OutputType.BYTES);
            ByteArrayInputStream inputStream = new ByteArrayInputStream(screenshotBytes);
            BufferedImage image = ImageIO.read(inputStream);
            int width = image.getWidth();
            int height = image.getHeight();
            screenSize = new Point(width, height);
        }

        return screenSize;
    }

    public Point getAppOffset() {
        if (!isIos) return new Point(0, 0);

        try {
            WebElement rootElement = findSingleElementBy(By.xpath("//XCUIElementTypeApplication | //XCUIElementTypeOther"));
            Dimension rootElementSize = rootElement.getSize();
            Point screenSize = getScreenSize();
            double screenWidthScaled = screenSize.x / retinaScale;
            double screenHeightScaled = screenSize.y / retinaScale;

            int offsetX = 0;
            int offsetY = 0;
            if (screenWidthScaled > rootElementSize.width) {
                offsetX = (int) ((screenWidthScaled - rootElementSize.width) / 2);
            }

            if (screenHeightScaled > rootElementSize.height) {
                offsetY = (int) ((screenHeightScaled - rootElementSize.height) / 2);
            }

            return new Point(offsetX, offsetY);
        } catch (Exception e) {
            e.printStackTrace();
            return new Point(0, 0);
        }
    }

    public Point getAbsolutePoint(double relativePointX, double relativePointY) throws IOException {
        Point screenSize = getScreenSize();

        if (retinaScale > 1) {
            return new Point((int) Math.round(relativePointX * screenSize.x / retinaScale), (int) Math.round(relativePointY * screenSize.y / retinaScale));
        } else {
            return new Point((int) Math.round(relativePointX * screenSize.x), (int) Math.round(relativePointY * screenSize.y));
        }
    }

    public Point getAbsolutePoint(double relativePointX, double relativePointY, Rectangle rect) {
        Point appOffset = getAppOffset();
        double x = rect.x + rect.width * relativePointX + appOffset.x;
        double y = rect.y + rect.height * relativePointY + appOffset.y;
        return new Point((int) x, (int) y);
    }

    public void sleep(int durationInMs) {
        System.out.println(String.format("Sleep for %d ms", durationInMs));
        try {
            Thread.sleep(durationInMs);
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
    }

    protected Document loadXMLFromString(String xml) {
        return Jsoup.parse(xml, Parser.xmlParser());
    }

    protected InputStream getResourceAsStream(String path) {
        return getClass().getClassLoader().getResourceAsStream(path);
    }

    public Point getCenterOfElement(WebElement element) {
        Rectangle rect = element.getRect();
        return new Point(rect.x + rect.width / 2, rect.y + rect.height / 2);
    }

    public Point getCenterOfRect(Rectangle rect) {
        Point center = new Point(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return center;
    }

    public boolean isFlexCorrectEnabled() {
        return Config.DEVICE_SOURCE == Config.DEVICE_SOURCE_ENUMS.KOBITON &&
            Boolean.TRUE.equals(this.desiredCaps.getCapability("kobiton:flexCorrect"));
    }

    public Rectangle getRectOfXmlElement(Element element) {
        String bounds = element.attr("bounds");
        String[] parts = bounds.split("[,\\[\\]]");

        int x = Integer.parseInt(parts[1].trim());
        int y = Integer.parseInt(parts[2].trim());
        int width = Integer.parseInt(parts[4].trim()) - x;
        int height = Integer.parseInt(parts[5].trim()) - y;

        return new Rectangle(x, y, height, width);
    }

    public SupportsContextSwitching getContextDriver() {
        return (SupportsContextSwitching) driver;
    }

    public IOSDriver getIosDriver() {
        return (IOSDriver) driver;
    }

    public AndroidDriver getAndroidDriver() {
        return (AndroidDriver) driver;
    }

    public URL getAppiumServerUrl() throws MalformedURLException {
        if (Config.DEVICE_SOURCE == Config.DEVICE_SOURCE_ENUMS.KOBITON) {
            return new URL(proxy.getServerUrl());
        } else {
            return new URL(Config.getAppiumServerUrlWithAuth());
        }
    }

    public Device getAvailableDevice(DesiredCapabilities capabilities) throws Exception {
        HttpUrl deviceListUrl = HttpUrl.get(Config.KOBITON_API_URL + "/v1/devices").newBuilder()
            .addQueryParameter("isOnline", "true")
            .addQueryParameter("isBooked", "false")
            .addQueryParameter("deviceName", (String) capabilities.getCapability(DEVICE_NAME))
            .addQueryParameter("platformVersion", (String) capabilities.getCapability(PLATFORM_VERSION))
            .addQueryParameter("platformName", getPlatformName(capabilities))
            .addQueryParameter("deviceGroup", (String) capabilities.getCapability("deviceGroup"))
            .build();

        Request.Builder deviceListBuilder = new Request.Builder()
            .url(deviceListUrl)
            .header("Authorization", Config.getBasicAuthString())
            .get();

        try (Response response = httpClient.newCall(deviceListBuilder.build()).execute()) {
            if (!Utils.isStatusCodeSuccess(response.code())) {
                throw new Exception(response.body().string());
            }

            DeviceListResponse deviceListResponse = gson.fromJson(response.body().string(), DeviceListResponse.class);

            List<Device> deviceList = new ArrayList<>();
            deviceList.addAll(deviceListResponse.cloudDevices);
            deviceList.addAll(deviceListResponse.privateDevices);

            if (deviceList.isEmpty()) {
                return null;
            } else {
                return deviceList.get(0);
            }
        }
    }

    public Device findOnlineDevice(DesiredCapabilities capabilities) throws Exception {
        if (Config.DEVICE_SOURCE != Config.DEVICE_SOURCE_ENUMS.KOBITON) {
            return null;
        }

        int tryTime = 1;
        Device device = null;
        String deviceName = (String) capabilities.getCapability(DEVICE_NAME);
        String deviceGroup = (String) capabilities.getCapability("deviceGroup");
        String platformVersion = (String) capabilities.getCapability(PLATFORM_VERSION);
        String platformName = getPlatformName(capabilities);
        while (tryTime <= Config.DEVICE_WAITING_MAX_TRY_TIMES) {
            System.out.println(String.format("Is device with capabilities: (deviceName: %s, deviceGroup: %s, platformName: %s, platformVersion: %s) online? Retrying at %s time",
                deviceName,
                deviceGroup,
                platformName,
                platformVersion,
                Utils.convertToOrdinal(tryTime)));
            device = getAvailableDevice(capabilities);
            if (device != null) {
                System.out.println(String.format("Device is found with capabilities: (deviceName: %s, deviceGroup: %s, platformName: %s, platformVersion: %s)",
                    device.deviceName,
                    deviceGroup,
                    device.platformName,
                    device.platformVersion
                ));
                break;
            }
            tryTime++;
            sleep(Config.DEVICE_WAITING_INTERVAL_IN_MS);
        }

        if (device == null) {
            throw new Exception(String.format("Cannot find any online devices with capabilites: (deviceName: %s, deviceGroup: %s,platformName: %s, platformVersion: %s)",
                deviceName,
                deviceGroup,
                platformName,
                platformVersion
            ));
        }
        return device;
    }

    public String getAppUrl(int appVersionId) throws Exception {
        String appUrl = "";
        OkHttpClient client = Config.createHttpClientBuilder().build();
        Request request = new Request.Builder()
            .url(String.format("%s/v1/app/versions/%s/downloadUrl", Config.KOBITON_API_URL, appVersionId))
            .addHeader("Content-Type", "application/json")
            .addHeader("Authorization", Config.getBasicAuthString())
            .build();

        try (Response response = client.newCall(request).execute()) {
            String body = response.body().string();
            JsonObject object = gson.fromJson(body, JsonObject.class);
            appUrl = object.get("url").getAsString();
        }

        return appUrl;
    }

    public Rectangle cropRect(Rectangle rect, Rectangle boundRect) {
        int x = rect.x, y = rect.y, width = rect.width, height = rect.height;
        if (x < boundRect.x) {
            x = boundRect.x;
        } else if (x > boundRect.x + boundRect.width) {
            x = boundRect.x + boundRect.width;
        }

        if (y < boundRect.y) {
            y = boundRect.y;
        } else if (y > boundRect.y + boundRect.height) {
            y = boundRect.y + boundRect.height;
        }

        if (x + width > boundRect.x + boundRect.width) {
            width = boundRect.x + boundRect.width - x;
        }

        if (y + height > boundRect.y + boundRect.height) {
            height = boundRect.y + boundRect.height - y;
        }

        return new Rectangle(x, y, height, width);
    }

    public Rectangle scaleRect(Rectangle rect, double scale) {
        return new Rectangle(
            (int) (rect.x * scale),
            (int) (rect.y * scale),
            (int) (rect.height * scale),
            (int) (rect.width * scale)
        );
    }

    public void saveDebugResource() {
        try {
            String rootDir = System.getProperty("user.dir");
            String debugDirName = String.format("%s %s", deviceName, platformVersion);
            debugDirName = debugDirName.replaceAll("[^a-zA-Z0-9]", "_");
            File debugDir = new File(rootDir, "debug/" + debugDirName);

            System.out.println(String.format("Save source & screenshot for debugging at %s", debugDir.getAbsolutePath()));
            debugDir.mkdirs();

            String source = driver.getPageSource();
            Files.writeString(new File(debugDir, "source.xml").toPath(), source, StandardCharsets.UTF_8);

            File screenshotFile = ((TakesScreenshot) driver).getScreenshotAs(OutputType.FILE);
            Files.copy(screenshotFile.toPath(), new File(debugDir, "screenshot.png").toPath(), StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public long getCurrentCommandId() {
        return this.proxy != null ? this.proxy.currentCommandId : 0;
    }

    public long getKobitonSessionId() {
        return this.proxy != null ? this.proxy.kobitonSessionId : 0;
    }

    public void setCurrentCommandId(long currentCommandId) {
        System.out.println(String.format("Current command: %s", currentCommandId));
        if (this.proxy != null) {
            this.proxy.currentCommandId = currentCommandId;
        }
    }

    public static class Device {
        public long id;
        public boolean isBooked, isOnline, isFavorite, isCloud;
        public String deviceName, platformName, platformVersion, udid;
    }

    public static class DeviceListResponse {
        public List<Device> privateDevices;
        public List<Device> favoriteDevices;
        public List<Device> cloudDevices;
    }

    public static class GenericLocator {
        public String type, value;

        public GenericLocator(String type, String value) {
            this.type = type;
            this.value = value;
        }
    }

    public static class ContextInfo {
        public String context, window;
        public boolean isHidden;
        public long sourceLength, matchTexts, matchTextsPercent;

        public ContextInfo(String context) {
            this.context = context;
        }
    }
}
