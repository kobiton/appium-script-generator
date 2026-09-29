package com.kobiton.scriptlessautomation;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import org.openqa.selenium.Capabilities;
import org.openqa.selenium.remote.NewSessionPayload;

/**
 * Runs every capabilities method of the generated Config through the same W3C
 * validation the Selenium client applies when it creates a session.
 */
public class SessionCapabilitiesCheck {
    public static void main(String[] args) throws Exception {
        int validated = 0;
        for (Method method : Config.class.getDeclaredMethods()) {
            if (!Modifier.isStatic(method.getModifiers()) || !Capabilities.class.isAssignableFrom(method.getReturnType())) {
                continue;
            }

            Capabilities capabilities = (Capabilities) (method.getParameterCount() == 0
                ? method.invoke(null)
                : method.invoke(null, "https://example.com/app.apk"));
            try (NewSessionPayload payload = NewSessionPayload.create(TestBase.toSessionCapabilities(capabilities))) {
                validated++;
            }
        }

        if (validated == 0) {
            throw new IllegalStateException("No capabilities method found in Config");
        }

        System.out.println("Validated W3C session capabilities of " + validated + " device(s)");
    }
}
