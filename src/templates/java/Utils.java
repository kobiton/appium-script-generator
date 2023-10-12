package com.kobiton.scriptlessautomation;

import org.openqa.selenium.By;
import org.openqa.selenium.Rectangle;

import java.util.ArrayList;
import java.util.List;

public class Utils {
    public static <T> T retry(Task<T> task, int maxAttempts, int intervalInMs) throws Exception {
        for (int attempt = 1; attempt <= Math.max(maxAttempts, 1); attempt++) {
            try {
                return task.exec(attempt);
            } catch (Exception e) {
                task.handleException(e, attempt);
                if (attempt == maxAttempts) throw e;
            }

            if (intervalInMs > 0) Thread.sleep(intervalInMs);
        }

        return null;
    }

    public static String convertToOrdinal(int i) {
        String[] suffixes = new String[]{"th", "st", "nd", "rd", "th", "th", "th", "th", "th", "th"};
        switch (i % 100) {
            case 11:
            case 12:
            case 13:
                return i + "th";
            default:
                return i + suffixes[i % 10];
        }
    }

    public static boolean isStatusCodeSuccess(int statusCode) {
        return 200 <= statusCode && statusCode <= 299;
    }

    public static String getLocatorText(By... locators) {
        List<String> locatorStrings = new ArrayList<>();
        for (By locator : locators) {
            locatorStrings.add(locator.toString());
        }
        return String.join(", ", locatorStrings);
    }

    public static boolean isRectangleInclude(Rectangle rect1, Rectangle rect2) {
        return rect1.x <= rect2.x && 
            rect1.y <= rect2.y &&
            rect1.x + rect1.width >= rect2.x + rect2.width &&
            rect1.y + rect1.height >= rect2.y + rect2.height;
    }

    public abstract static class Task<T> {
        abstract T exec(int attempt) throws Exception;

        public void handleException(Exception e, int attempt) throws Exception {
            // Default impl: do nothing
        }
    }
}
