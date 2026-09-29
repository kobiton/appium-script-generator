import JavaAppiumScriptGenerator from '../../src/services/java'

const generator = new JavaAppiumScriptGenerator({})

const locatorCode = (selectorConfigurations) => generator
  ._getLocatorCode({step: {selectorConfigurations}, locatorVarName: 'locator'})
  .map((line) => line.content)

const scriptLines = (action, extra = {}) => {
  const step = {
    id: '1',
    context: 'NATIVE',
    actionJson: JSON.stringify(action),
    findingElementTimeout: 1000,
    ...extra
  }

  return generator._generateTestScriptLines({testSteps: [step]}).lines.map((line) => line.content)
}

describe('JavaAppiumScriptGenerator emitted code', () => {
  it.each([
    ['accessibilityId', 'AppiumBy.accessibilityId("v")'],
    ['id', 'AppiumBy.id("v")'],
    ['name', 'AppiumBy.name("v")'],
    ['className', 'AppiumBy.className("v")'],
    ['linkText', 'By.linkText("v")'],
    ['css', 'By.cssSelector("v")'],
    ['xpath', 'By.xpath("v")']
  ])('maps %s selectors to %s', (type, expected) => {
    expect(locatorCode([{selectors: [{type, value: 'v'}]}]))
      .toEqual([`By[] locator = new By[] {${expected}};`])
  })

  it('escapes double quotes in selector values', () => {
    expect(locatorCode([{selectors: [{type: 'name', value: 'say "hi"'}]}]))
      .toEqual(['By[] locator = new By[] {AppiumBy.name("say \\"hi\\"")};'])
  })

  it('emits one locator array per device', () => {
    const lines = locatorCode([
      {
        device: {deviceName: 'Pixel 8', platformVersion: '15'},
        selectors: [{type: 'id', value: 'a'}]
      },
      {selectors: [{type: 'xpath', value: '//b'}]}
    ])

    expect(lines).toEqual([
      'By[] locator;',
      'if ("Pixel 8".equals(deviceName) && "15".equals(platformVersion)) {',
      'locator = new By[] {AppiumBy.id("a")};',
      '}',
      'else {',
      'locator = new By[] {By.xpath("//b")};',
      '}'
    ])
  })

  it('never emits APIs removed from java-client 8+', () => {
    const selectorConfigurations = [{selectors: [{type: 'id', value: 'a'}]}]
    const lines = [
      ...scriptLines({command: 'touchOnElement', x: '0.5', y: '0.5'}, {selectorConfigurations}),
      ...scriptLines(
        {command: 'swipeFromElement', x1: 0, y1: 0, x2: 1, y2: 1},
        {selectorConfigurations}
      )
    ].join('\n')

    expect(lines).toContain('WebElement elementA = findVisibleElement(')
    expect(lines).not.toMatch(/MobileElement|MobileBy/)
  })

  it('defaults swipe duration to 800 ms', () => {
    expect(scriptLines({command: 'swipeByPoints', x1: 0.5, y1: 0.8, x2: 0.5, y2: 0.2}))
      .toContain('swipeByPoint(0.5, 0.8, 0.5, 0.2, 800);')
    expect(scriptLines({
      command: 'swipeByPoints', x1: 0.5, y1: 0.8, x2: 0.5, y2: 0.2, duration: 300
    }))
      .toContain('swipeByPoint(0.5, 0.8, 0.5, 0.2, 300);')
  })

  it('keeps decimal set-location coordinates', () => {
    expect(scriptLines({command: 'setLocation', lat: '10.7769', long: '106.7009'}))
      .toContain('setLocation(new Location(' +
        'Double.parseDouble("10.7769"), Double.parseDouble("106.7009"), 0.0));')
  })
})
