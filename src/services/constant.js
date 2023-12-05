import keyMirror from 'keymirror'

// Defines a SUPPORTED_ACTIONS enum, with keys and values are the same.
export const SUPPORTED_ACTIONS = keyMirror({
  PRESS_BUTTON: null,
  ROTATE_SCREEN: null,
  TOUCH: null,
  CLIPBOARD: null,
  TYPE_KEYBOARD: null,
  SWIPE: null,
  DRAG: null,
  SIMULATE_GEO_LOCATION: null
})

// Defines a TEXT_TYPES enum, with keys and values are the same.
export const TEXT_TYPES = keyMirror({
  NORMAL: null,
  PHONE_NUMBER: null,
  EMAIL_ADDRESS: null,
  OTP_CODE: null
})

// Defines a PRESS_TYPES enum, with keys and values are the same.
export const PRESS_TYPES = keyMirror({
  HOME: null,
  BACK: null,
  POWER: null,
  APP_SWITCH: null,
  ENTER: null,
  DELETE: null
})

// Defines an UI_ELEMENT_SELECTOR_STATUS enum, with keys and values are the same.
export const UI_ELEMENT_SELECTOR_STATUS = keyMirror({
  SUCCESS: null,
  NO_ACTIONS: null,
  NO_UNIQUE_SELECTOR: null,
  INVALID_PRIME_ACTION: null,
  INVALID_REVISIT_ACTION: null,
  BLOCKER_ENCOUNTERED: null,
  PREVIOUS_BLOCKER_ENCOUNTERED: null,
  UNEXPECTED_ERROR: null,
  IGNORED: null,
  NO_ELEMENT: null
})

// An array of launcher app IDs for various mobile devices.
export const LAUNCHER_APP_IDS = [
  'com.apple.springboard', // iOS
  'com.sec.android.app.launcher', // Samsung
  'com.google.android.googlequicksearchbox', // Nexus
  'com.google.android.apps.nexuslauncher', // Pixel
  'com.sonymobile.home' // Sony
]

// Defines a DYNAMIC_DATA_STEPS enum, with keys and values are the same.
export const DYNAMIC_DATA_STEPS = keyMirror({
  NONE: null,
  EDITING: null,
  SUBMITTED: null
})

// Defines a SOFT_KEY_TYPES enum, with keys and values are the same.
export const SOFT_KEY_TYPES = keyMirror({
  NONE: null,
  CHARACTER: null, // A, b, c, 1, 2, 3, @, #,...
  FUNCTIONAL: null // DELETE, ENTER, CHANGE_2_UPPERCASE_KEYBOARD, CHANGE_2_NUMBER_KEYBOARD,...
})

// The integer values for device orientations are defined and used by native SDKs (iOS & Android).
export const DEVICE_ORIENTATIONS = {
  PORTRAIT: 0,
  PORTRAIT_UPSIDE_DOWN: 2,
  LANDSCAPE_LEFT: 1,
  LANDSCAPE_RIGHT: 3
}

// Defines a DEVICE_SOURCES enum, with keys and values are the same.
export const DEVICE_SOURCES = keyMirror({
  KOBITON: null,
  SAUCE_LABS: null
})

// Defines a PLATFORMS enum, with keys and values are the same.
export const PLATFORMS = keyMirror({
  ANDROID: null,
  IOS: null
})

// Defines an application CONTEXTS enum, with keys and values are the same.
export const CONTEXTS = keyMirror({
  NATIVE: null,
  WEB: null
})

export const LANGUAGES = {
  JAVA: 'java',
  NODEJS: 'nodejs',
  CSHARP: 'csharp'
}

export const FRAMEWORK_NAMES = {
  JUNIT: 'junit',
  TESTNG: 'testng',
  MOCHA: 'mocha',
  NUNIT: 'nunit'
}

export const MOBILE_BROWSER_PACKAGE_NAMES = {
  safari: 'com.apple.mobilesafari',
  chrome: 'com.android.chrome'
}
