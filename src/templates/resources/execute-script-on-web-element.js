const element = arguments[0]
const command = arguments[1]

switch (command) {
  case "isElementVisible":
    const visible = !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
    return visible ? 'true': 'false'
  case "scrollIntoView":
    element.scrollIntoView({
      behavior: "auto",
      block: "center",
      inline: "center"
    })
    return true
  case "getBoundingClientRect":
    const {devicePixelRatio} = window
    const rect = element.getBoundingClientRect()

    const result = {
      x: Math.round(rect.x * devicePixelRatio),
      y: Math.round(rect.y * devicePixelRatio),
      width: Math.round(rect.width * devicePixelRatio),
      height: Math.round(rect.height * devicePixelRatio),
      windowInnerHeight: Math.round(window.innerHeight * devicePixelRatio)
    }

    return JSON.stringify(result)
  default:
    throw new Error(`Unsupported command: ${command}`)
}
