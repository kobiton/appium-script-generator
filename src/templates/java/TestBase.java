package com.kobiton.scriptlessautomation;

import com.google.common.collect.ImmutableMap;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.reflect.TypeToken;
import com.google.gson.stream.JsonReader;
import io.appium.java_client.AppiumDriver;
import io.appium.java_client.MobileElement;
import io.appium.java_client.Setting;
import io.appium.java_client.TouchAction;
import io.appium.java_client.android.AndroidDriver;
import io.appium.java_client.android.nativekey.AndroidKey;
import io.appium.java_client.android.nativekey.KeyEvent;
import io.appium.java_client.ios.IOSDriver;
import io.appium.java_client.remote.MobileCapabilityType;
import io.appium.java_client.remote.MobilePlatform;
import io.appium.java_client.touch.TapOptions;
import io.appium.java_client.touch.offset.ElementOption;
import io.appium.java_client.touch.offset.PointOption;
import okhttp3.*;
import org.apache.commons.io.FileUtils;
import org.apache.commons.io.IOUtils;
import org.apache.http.HttpHeaders;
import org.apache.http.client.utils.URIBuilder;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.parser.Parser;
import org.jsoup.select.Elements;
import org.openqa.selenium.*;
import org.openqa.selenium.interactions.KeyInput;
import org.openqa.selenium.interactions.Pause;
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
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;

public class TestBase {
    public AppiumDriver<MobileElement> driver;
    public ProxyServer proxy;
    public OtpService otpService = new OtpService();
    public DesiredCapabilities desiredCaps;
    public boolean isIos;
    public Point screenSize;
    public double retinaScale;
    public String deviceName, platformVersion;

    public static String IOS_XPATH_REDUNDANT_PREFIX = "/AppiumAUT";
    public static String NATIVE_CONTEXT = "NATIVE_APP";

    enum PRESS_TYPES {HOME, BACK, POWER, APP_SWITCH, ENTER, DELETE}

    public Gson gson = new GsonBuilder().disableHtmlEscaping().create();
    public final OkHttpClient httpClient = new OkHttpClient();

    private String currentContext;

    public void setup(DesiredCapabilities desiredCaps, double retinaScale) throws Exception {
        this.desiredCaps = desiredCaps;
        this.retinaScale = retinaScale;
        this.isIos = MobilePlatform.IOS.equalsIgnoreCase(
            (String) desiredCaps.getCapability(MobileCapabilityType.PLATFORM_NAME));
        this.deviceName = (String) desiredCaps.getCapability(MobileCapabilityType.DEVICE_NAME);
        this.platformVersion = (String) desiredCaps.getCapability(MobileCapabilityType.PLATFORM_VERSION);

        if (Config.DEVICE_SOURCE == Config.DEVICE_SOURCE_ENUMS.KOBITON) {
            this.proxy = new ProxyServer();
        }

        URL appiumServerUrl = getAppiumServerUrl();
        if (isIos) {
            driver = new IOSDriver<>(appiumServerUrl, desiredCaps);
        } else {
            driver = new AndroidDriver<>(appiumServerUrl, desiredCaps);
        }
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

    public void switchContext(String context) {
        if (currentContext == context) return;
        System.out.println(String.format("Switch to %s context", context));
        driver.context(context);
        currentContext = context;
    }

    public void switchToNativeContext() {
        String currentContext = driver.getContext();
        if (NATIVE_CONTEXT.equals(currentContext)) {
            this.currentContext = NATIVE_CONTEXT;
            return;
        }

        switchContext(NATIVE_CONTEXT);
    }

    public String switchToWebContext() throws Exception {
        System.out.println("Finding a web context");
        List<ContextInfo> contextInfos = new ArrayList<>();

        switchToNativeContext();
        Document nativeDocument = loadXMLFromString(driver.getPageSource());
        String textNodeSelector = isIos ? "//XCUIElementTypeStaticText" : "//android.widget.TextView";
        List<String> nativeTexts = new ArrayList<>();
        for (Element textElement : nativeDocument.selectXpath(textNodeSelector)) {
            String textAttr = textElement.attr(isIos ? "value" : "text");
            textAttr = textAttr.trim().toLowerCase();
            if (!textAttr.isEmpty()) nativeTexts.add(textAttr);
        }

        Set<String> contexts = driver.getContextHandles();
        for (String context : contexts) {
            if (context.startsWith("WEBVIEW") || context.equals("CHROMIUM")) {
                String source = null;
                try {
                    switchContext(context);
                    source = driver.getPageSource();
                } catch (Exception ex) {
                    System.out.println(String.format("Bad context %s, error \"%s\", skipping...", context, ex.getMessage()));
                    continue;
                }

                if (source == null) continue;
                ContextInfo contextInfo = contextInfos.stream().filter(e -> e.context.equals(context)).findFirst().orElse(null);
                if (contextInfo == null) {
                    contextInfo = new ContextInfo(context);
                    contextInfos.add(contextInfo);
                }

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
        }

        if (!contextInfos.isEmpty()) {
            String bestWebContext;
            contextInfos.sort((ContextInfo c1, ContextInfo c2) -> (int) (c2.matchTextsPercent - c1.matchTextsPercent));
            if (contextInfos.get(0).matchTextsPercent > 40) {
                bestWebContext = contextInfos.get(0).context;
            } else {
                contextInfos.sort((ContextInfo c1, ContextInfo c2) -> (int) (c2.sourceLength - c1.sourceLength));
                bestWebContext = contextInfos.get(0).context;
            }

            switchContext(bestWebContext);
            System.out.println(String.format("Switched to %s web context successfully", bestWebContext));
            return bestWebContext;
        }

        throw new Exception("Cannot find any web context");
    }

    public Rectangle findWebElementRect(By... locators) throws Exception {
        MobileElement foundElement = Utils.retry(new Utils.Task<MobileElement>() {
            @Override
            MobileElement exec(int attempt) throws Exception {
                System.out.println(String.format("Finding web element rectangle attempt %s with locator: %s", Utils.convertToOrdinal(attempt), Utils.getLocatorText(locators)));
                switchToWebContext();
                return findVisibleWebElement(locators);
            }
        }, 3, 3000);

        scrollToWebElement(foundElement);
        Rectangle webRectVarName = getWebElementRect(foundElement);
        switchToNativeContext();
        return calculateNativeRect(webRectVarName);
    }

    public Rectangle findWebElementRectOnScrollable(By... locators) throws Exception {
        System.out.println(String.format("Finding web element rectangle on scrollable with locator: %s", Utils.getLocatorText(locators)));
        try {
            switchToWebContext();
        }
        catch (Exception ignored) {}
        MobileElement foundElement = findElementOnScrollable(locators);

        scrollToWebElement(foundElement);
        Rectangle webRectVarName = getWebElementRect(foundElement);
        switchToNativeContext();
        return calculateNativeRect(webRectVarName);
    }

    public Object executeScriptOnWebElement(MobileElement element, String command) throws Exception {
        String script = IOUtils.toString(getResourceAsStream("execute-script-on-web-element.js"), StandardCharsets.UTF_8);
        return driver.executeScript(script, element, command);
    }

    public void scrollToWebElement(MobileElement element) throws Exception {
        System.out.println(String.format("Scroll to web element %s", element.getTagName()));
        executeScriptOnWebElement(element, "scrollIntoView");
    }

    public Rectangle getWebElementRect(MobileElement element) throws Exception {
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
        Rectangle webviewRect = findWebview().getRect();

        MobileElement topToolbar = null;
        if (this.isIos) {
            try {
                topToolbar = findElementBy(null, 1000, By.xpath("//*[@name='TopBrowserBar' or @name='topBrowserBar' or @name='TopBrowserToolbar' or child::XCUIElementTypeButton[@name='URL']]"));
            } catch (Exception ignored) {
                Document nativeDocument = loadXMLFromString(driver.getPageSource());
                Element webviewElement = nativeDocument.selectXpath("//XCUIElementTypeWebView").first();
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
                        String topToolbarXpath = Utils.getXPath(firstChildElement).replace(IOS_XPATH_REDUNDANT_PREFIX, "");
                        topToolbar = findElementBy(By.xpath(topToolbarXpath));
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
            webElementRect.width);

        cropRect(nativeRect, webviewRect);
        return nativeRect;
    }

    private List<MobileElement> findElements(MobileElement rootElement, int timeoutInMiliSeconds, boolean multiple, By... locators) throws Exception {
        String locatorText = Utils.getLocatorText(locators);
        System.out.println(String.format("Find element by: %s", locatorText));
        String notFoundMessage = String.format("Cannot find element by: %s", locatorText);

        if (locators.length == 1) {
            setImplicitWaitInMiliSecond(timeoutInMiliSeconds);

            List<MobileElement> elements = null;
            if (rootElement == null) {
                elements = driver.findElements(locators[0]);
            } else {
                elements = rootElement.findElements(locators[0]);
            }

            setImplicitWaitInMiliSecond(Config.IMPLICIT_WAIT_IN_MS);

            if (multiple && elements != null && !elements.isEmpty())
                return elements;
            else if (!multiple && elements != null && elements.size() == 1)
                return elements;

            throw new Exception(notFoundMessage);
        } else {
            int waitInterval = 5;
            return Utils.retry(new Utils.Task<List<MobileElement>>() {
                @Override
                List<MobileElement> exec(int attempt) throws Exception {
                    setImplicitWaitInMiliSecond(0);
                    List<MobileElement> elements = null;
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

                    setImplicitWaitInMiliSecond(Config.IMPLICIT_WAIT_IN_MS);
                    throw new Exception(notFoundMessage);
                }
            }, timeoutInMiliSeconds / (waitInterval * 1000), waitInterval * 1000);
        }
    }

    public MobileElement findElementBy(MobileElement rootElement, int timeoutInMiliSeconds, By... locators) throws Exception {
        List<MobileElement> foundElements = findElements(rootElement, timeoutInMiliSeconds, false, locators);
        if (foundElements == null || foundElements.size() != 1) {
            throw new Exception(String.format("Cannot find element by: %s", Utils.getLocatorText(locators)));
        }

        return foundElements.get(0);
    }

    public MobileElement findElementBy(By... locators) throws Exception {
        return findElementBy(null, Config.IMPLICIT_WAIT_IN_MS, locators);
    }

    public MobileElement findElementBy(int timeoutInMiliSeconds, By... locators) throws Exception {
        return findElementBy(null, Math.max(Config.IMPLICIT_WAIT_IN_MS, timeoutInMiliSeconds), locators);
    }

    public List<MobileElement> findElementsBy(MobileElement rootElement, int timeoutInMiliSeconds, By... locators) throws Exception {
        List<MobileElement> foundElements = findElements(rootElement, timeoutInMiliSeconds, true, locators);
        if (foundElements == null || foundElements.isEmpty()) {
            throw new Exception(String.format("Cannot find elements by: %s", Utils.getLocatorText(locators)));
        }

        return foundElements;
    }

    public List<MobileElement> findElementsBy(By... locators) throws Exception {
        return findElementsBy(null, Config.IMPLICIT_WAIT_IN_MS, locators);
    }

    /**
     * Scroll to find best element on scrollable
     */
    public MobileElement findElementOnScrollable(By... locators) throws Exception {
        Type type = new TypeToken<Map<String, String>>() {
        }.getType();
        JsonReader reader = new JsonReader(new InputStreamReader(getResourceAsStream(getCurrentCommandId() + ".json")));
        Map<String, String> infoMap = gson.fromJson(reader, type);

        Document sourceElementDoc = loadXMLFromString(infoMap.get("touchedElementSource"));
        Element sourceElement = sourceElementDoc.child(0);
        Point screenSize = getScreenSize();
        String sourceElementXpath = infoMap.get("touchedElementXpath");

        MobileElement touchableElement = Utils.retry(new Utils.Task<MobileElement>() {
            private MobileElement scrollableElement;
            private List<String> potentialXpathList = new ArrayList<>();
            private String targetElementXpath;

            @Override
            MobileElement exec(int attempt) throws Exception {

                try {
                    MobileElement foundElement = findElementBy(locators);
                    Rectangle rect = foundElement.getRect();
                    if (rect.x < 0 || rect.y < 0) {
                        throw new Exception("Element is found but is not visible");
                    }

                    return foundElement;
                } catch (Exception e) {
                    // Might switch to the wrong web context on the first attempt; retry before scrolling down
                    if (!NATIVE_CONTEXT.equals(currentContext) && attempt == 1) {
                        throw new Exception();
                    }

                    potentialXpathList.clear();
                    Document source = loadXMLFromString(driver.getPageSource());
                    Elements elementsByTagName = source.selectXpath("//" + sourceElement.tagName());
                    for (Element element : elementsByTagName) {
                        boolean isEqual = compareNodes(sourceElement, element);
                        if (isEqual) {
                            potentialXpathList.add(Utils.getXPath(element));
                        }
                    }

                    if (!potentialXpathList.isEmpty()) {
                        for (String xpath : potentialXpathList) {
                            if (sourceElementXpath.toLowerCase().equals(xpath.toLowerCase())) {
                                targetElementXpath = xpath;
                                break;
                            }
                        }

                        if (targetElementXpath == null) {
                            targetElementXpath = potentialXpathList.get(0);
                        }
                    }

                    if (targetElementXpath == null) {
                        throw new Exception();
                    }

                    return findElementBy(By.xpath(targetElementXpath.replace(IOS_XPATH_REDUNDANT_PREFIX, "")));
                }
            }

            @Override
            public void handleException(Exception e, int attempt) throws Exception {
                System.out.println(String.format("Cannot find touchable element on scrollable, %s attempt", Utils.convertToOrdinal(attempt)));
                // Might switch to the wrong web context on the first attempt; retry before scrolling down
                if (!NATIVE_CONTEXT.equals(currentContext) && attempt == 1) {
                    switchToWebContext();
                    return;
                }

                if (scrollableElement == null) {
                    scrollableElement = findElementBy(By.xpath(infoMap.get("scrollableElementXpath")));
                    hideKeyboard();
                }

                if (attempt == 1) {
                    swipeToTop(scrollableElement.getCenter());
                } else {
                    Point center = scrollableElement.getCenter();
                    Rectangle rect = scrollableElement.getRect();
                    // Fix bug when scrollableElement is out of viewport
                    if (center.y > screenSize.y || rect.height < 0) {
                        center.y = screenSize.y / 2;
                    }

                    dragFromPoint(center, 0, -0.5);
                }
            }
        }, 5, 3000);

        if (touchableElement == null) {
            throw new Exception("Cannot find any element on scrollable parent");
        }

        return touchableElement;
    }

    public boolean isButtonElement(MobileElement element) throws Exception {
        return element.getTagName().contains("Button");
    }

    public MobileElement findVisibleWebElement(By... locators) throws Exception {
        String locatorText = Utils.getLocatorText(locators);
        System.out.println(String.format("Find visible web element by: %s", locatorText));

        List<MobileElement> foundElements = findElementsBy(locators);
        MobileElement foundVisibleElement = null;
        for (MobileElement element : foundElements) {
            String res = (String) executeScriptOnWebElement(element, "isElementVisible");
            boolean visible = "true".equals(res);
            if (visible) {
                foundVisibleElement = element;
                break;
            }
        }

        if (foundVisibleElement == null) {
            throw new Exception(String.format("Cannot find visible web element by: %s", locators));
        }

        return foundVisibleElement;
    }

    public MobileElement findWebview() {
        String className = this.isIos ? "XCUIElementTypeWebView" : "android.webkit.WebView";
        return driver.findElement(By.className(className));
    }

    /**
     * Touch at center of element (element need to be visible)
     */
    public TouchAction touchAtCenterOfElement(MobileElement element) {
        System.out.println(String.format("Touch at center of element %s", element.getTagName()));

        TouchAction action = new TouchAction(driver)
            .tap(TapOptions.tapOptions().withElement(ElementOption.element(element)));
        action.perform();

        return action;
    }

    /**
     * Handle event touch element
     */
    public void touchOnElement(MobileElement element, double relativePointX, double relativePointY) throws Exception {
        if (isButtonElement(element)) {
            clickElement(element);
        } else {
            touchAtRelativePointOfElement(element, relativePointX, relativePointY);
        }
    }

    /**
     * Click element (element need to be visible)
     */
    public void clickElement(MobileElement element) {
        System.out.println(String.format("Click on element with type: %s", element.getTagName()));
        element.click();
    }

    /**
     * Touch at relative point of element (element need to be visible)
     */
    public TouchAction touchAtRelativePointOfElement(MobileElement element, double relativePointX, double relativePointY) {
        System.out.println(String.format("Touch on element %s at relative point (%s %s)", element.getTagName(), relativePointX, relativePointY));

        return touchAtPoint(getAbsolutePoint(relativePointX, relativePointY, element.getRect()));
    }

    /**
     * Touch at a relative position
     */
    public TouchAction touchAtPoint(double relativePointX, double relativePointY) throws IOException {
        System.out.println(String.format("Touch at relative point (%s, %s)", relativePointX, relativePointY));

        Point absolutePoint = getAbsolutePoint(relativePointX, relativePointY);
        return touchAtPoint(absolutePoint);
    }

    /**
     * Touch at a Point
     */
    public TouchAction touchAtPoint(Point point) {
        System.out.println(String.format("Touch at point (%s, %s)", point.x, point.y));

        TouchAction action = new TouchAction(driver)
            .tap(TapOptions.tapOptions().withPosition(PointOption.point(point)));
        action.perform();

        return action;
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
    }

    /**
     * Quick swipe to top from a Point
     */
    public void swipeToTop(Point fromPoint) throws Exception {
        Point toPoint = new Point(fromPoint.x, getScreenSize().y - 10);
        System.out.println(String.format("Swipe to top from point (%s, %s) to point (%s, %s)", fromPoint.x, fromPoint.y, toPoint.x, toPoint.y));

        swipeByPoint(fromPoint, toPoint, 100);
    }

    /**
     * Drag from Point to Point (no accelerate)
     */
    public Sequence dragByPoint(Point fromPoint, Point toPoint) {
        PointerInput finger = new PointerInput(PointerInput.Kind.TOUCH, "finger");
        Sequence sequence = new Sequence(finger, 0);

        if (isIos) {
            sequence.addAction(finger.createPointerMove(Duration.ofMillis(0), PointerInput.Origin.viewport(), fromPoint.x, fromPoint.y));
            sequence.addAction(finger.createPointerDown(PointerInput.MouseButton.MIDDLE.asArg()));
            sequence.addAction(new Pause(finger, Duration.ofMillis(2000)));
            sequence.addAction(finger.createPointerMove(Duration.ofMillis(300), PointerInput.Origin.viewport(), toPoint.x, toPoint.y));
            sequence.addAction(finger.createPointerUp(PointerInput.MouseButton.MIDDLE.asArg()));
        } else {
            sequence.addAction(finger.createPointerMove(Duration.ofMillis(0), PointerInput.Origin.viewport(), fromPoint.x, fromPoint.y));
            sequence.addAction(finger.createPointerDown(PointerInput.MouseButton.MIDDLE.asArg()));
            sequence.addAction(finger.createPointerMove(Duration.ofMillis(300), PointerInput.Origin.viewport(), toPoint.x, toPoint.y));
            sequence.addAction(new Pause(finger, Duration.ofMillis(300)));
            sequence.addAction(finger.createPointerMove(Duration.ofMillis(300), PointerInput.Origin.pointer(), 0, 0));
            sequence.addAction(finger.createPointerUp(PointerInput.MouseButton.MIDDLE.asArg()));
        }

        System.out.println(String.format("Drag from point (%s, %s) to point (%s, %s)", fromPoint.x, fromPoint.y, toPoint.x, toPoint.y));
        driver.perform(Arrays.asList(sequence));

        return sequence;
    }

    public void sendKeys(String keys) throws Exception {
        System.out.println(String.format("Send keys: %s", keys));
        sleep(Config.SLEEP_TIME_BEFORE_SEND_KEYS_IN_MS);

        if (this.isIos) {
            char[] chars = keys.toCharArray();
            JsonObject requestJson = new JsonObject();
            requestJson.add("value", gson.toJsonTree(chars).getAsJsonArray());
            RequestBody requestBody = RequestBody.create(MediaType.parse("application/json"), requestJson.toString());

            Request.Builder sendKeysBuilder = new Request.Builder()
                .post(requestBody)
                .url(getAppiumServerUrl() + String.format("/session/%s/keys", driver.getSessionId()));

            try (Response response = httpClient.newCall(sendKeysBuilder.build()).execute()) {
                if (!Utils.isStatusCodeSuccess(response.code())) {
                    throw new Exception(response.body().string());
                }
            }
        } else {
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
                getAndroidDriver().getKeyboard().sendKeys(keys);
            }
        }
    }

    public void sendKeys(MobileElement element, String keys) {
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
                    IOSDriver<MobileElement> iosDriver = getIosDriver();
                    if (iosDriver.isDeviceLocked()) {
                        iosDriver.unlockDevice();
                    } else {
                        driver.executeScript("mobile: pressButton", ImmutableMap.of("name", "home"));
                    }
                } else {
                    pressAndroidKey(AndroidKey.HOME);
                }
                break;

            case BACK:
                pressAndroidKey(AndroidKey.BACK);
                break;

            case POWER:
                if (isIos) {
                    IOSDriver<MobileElement> iosDriver = getIosDriver();
                    if (iosDriver.isDeviceLocked()) {
                        iosDriver.unlockDevice();
                    } else {
                        iosDriver.lockDevice();
                    }
                } else {
                    pressAndroidKey(AndroidKey.POWER);
                }
                break;

            case APP_SWITCH:
                pressAndroidKey(AndroidKey.APP_SWITCH);
                break;

            case ENTER:
                if (isIos) {
                    sendKeys("\n");
                } else {
                    pressAndroidKey(AndroidKey.ENTER);
                }
                break;

            case DELETE:
                sendKeys("\b");
                break;

            default:
                throw new Exception(String.format("Don't support press %s key", type));

        }
    }

    public void pressMultiple(PRESS_TYPES type, int count) throws Exception {
        System.out.println(String.format("Press on %s key %s times", type, count));
        switch (type) {
            case DELETE:
                sendKeys(new String(new char[count]).replace("\0", "\b"));
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

    public void hideKeyboard() {
        try {
            if (this.isIos) {
                if (!getIosDriver().isKeyboardShown()) return;
            } else {
                if (!getAndroidDriver().isKeyboardShown()) return;
            }

            System.out.println("Keyboard is shown, hide it");
            driver.hideKeyboard();
        } catch (Exception ignored) {
        }
    }

    public void setImplicitWaitInMiliSecond(int value) {
        driver.manage().timeouts().implicitlyWait(value, TimeUnit.MILLISECONDS);
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
            MobileElement rootElement = driver.findElement(By.xpath("//XCUIElementTypeApplication | //XCUIElementTypeOther"));
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

    public void sleep(int durationInMs) throws InterruptedException {
        System.out.println(String.format("Sleep for %d ms", durationInMs));
        Thread.sleep(durationInMs);
    }

    protected Document loadXMLFromString(String xml) {
        return Jsoup.parse(xml, Parser.xmlParser());
    }

    protected InputStream getResourceAsStream(String path) {
        return getClass().getClassLoader().getResourceAsStream(path);
    }

    protected boolean compareNodes(Element expected, Element actual) {
        if (!expected.tagName().equals(actual.tagName())) {
            return false;
        }

        String[] compareAttrs = new String[]{"label", "text", "visible", "class", "name", "type", "resource-id", "content-desc", "accessibility-id"};

        for (String attrName : compareAttrs) {
            String v1 = null;
            String v2 = null;
            try {
                v1 = expected.attr(attrName);
                v2 = actual.attr(attrName);
            } catch (Exception ignored) {
            }

            if (v1 != null && v2 != null && !v1.isEmpty() && !v2.isEmpty() && !v1.equals(v2)) {
                return false;
            }
        }

        if (expected.children().size() != actual.children().size()) {
            return false;
        }

        for (int i = 0; i < expected.children().size(); i++) {
            Element expectedChild = expected.child(i);
            Element actualChild = actual.child(i);
            boolean isEqual = compareNodes(expectedChild, actualChild);
            if (!isEqual) {
                return false;
            }
        }

        return true;
    }

    public Point getCenterOfRect(Rectangle rect) {
        Point center = new Point(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return center;
    }

    public IOSDriver<MobileElement> getIosDriver() {
        return (IOSDriver<MobileElement>) driver;
    }

    public AndroidDriver<MobileElement> getAndroidDriver() {
        return (AndroidDriver<MobileElement>) driver;
    }

    public URL getAppiumServerUrl() throws MalformedURLException {
        if (proxy != null) {
            return new URL(proxy.getServerUrl());
        } else {
            return new URL(Config.APPIUM_SERVER_URL);
        }
    }

    public Device getAvailableDevice(DesiredCapabilities capabilities) throws Exception {
        URIBuilder deviceListUriBuilder = new URIBuilder(Config.KOBITON_API_URL + "/v1/devices");
        deviceListUriBuilder.addParameter("isOnline", "true");
        deviceListUriBuilder.addParameter("isBooked", "false");
        deviceListUriBuilder.addParameter("deviceName", (String) capabilities.getCapability(MobileCapabilityType.DEVICE_NAME));
        deviceListUriBuilder.addParameter("platformVersion", (String) capabilities.getCapability(MobileCapabilityType.PLATFORM_VERSION));
        deviceListUriBuilder.addParameter("platformName", (String) capabilities.getCapability(MobileCapabilityType.PLATFORM_NAME));
        deviceListUriBuilder.addParameter("deviceGroup", (String) capabilities.getCapability("deviceGroup"));

        Request.Builder deviceListBuilder = new Request.Builder()
            .url(deviceListUriBuilder.build().toURL())
            .header(HttpHeaders.AUTHORIZATION, Config.getBasicAuthString())
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
        String deviceName = (String) capabilities.getCapability(MobileCapabilityType.DEVICE_NAME);
        String deviceGroup = (String) capabilities.getCapability("deviceGroup");
        String platformVersion = (String) capabilities.getCapability(MobileCapabilityType.PLATFORM_VERSION);
        String platformName = (String) capabilities.getCapability(MobileCapabilityType.PLATFORM_NAME);
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
        OkHttpClient client = new OkHttpClient();
        Request request = new Request.Builder()
            .url(String.format("%s/v1/app/versions/%s/downloadUrl", Config.KOBITON_API_URL, appVersionId))
            .addHeader(HttpHeaders.CONTENT_TYPE, "application/json")
            .addHeader(HttpHeaders.AUTHORIZATION, Config.getBasicAuthString())
            .build();

        try (Response response = client.newCall(request).execute()) {
            String body = response.body().string();
            JsonObject object = gson.fromJson(body, JsonObject.class);
            appUrl = object.get("url").getAsString();
        }

        return appUrl;
    }

    public void cropRect(Rectangle rect, Rectangle boundRect) {
        if (rect.x < boundRect.x) {
            rect.x = boundRect.x;
        } else if (rect.x > boundRect.x + boundRect.width) {
            rect.x = boundRect.x + boundRect.width;
        }

        if (rect.y < boundRect.y) {
            rect.y = boundRect.y;
        } else if (rect.y > boundRect.y + boundRect.height) {
            rect.y = boundRect.y + boundRect.height;
        }

        if (rect.x + rect.width > boundRect.x + boundRect.width) {
            rect.width = boundRect.x + boundRect.width - rect.x;
        }

        if (rect.y + rect.height > boundRect.y + boundRect.height) {
            rect.height = boundRect.y + boundRect.height - rect.y;
        }
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
            FileUtils.writeStringToFile(new File(debugDir, "source.xml"), source, StandardCharsets.UTF_8);

            File screenshotFile = ((TakesScreenshot) driver).getScreenshotAs(OutputType.FILE);
            FileUtils.copyFile(screenshotFile, new File(debugDir, "screenshot.png"));
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
        public String context;
        public long sourceLength, matchTexts, matchTextsPercent;

        public ContextInfo(String context) {
            this.context = context;
        }
    }
}
