export default class Rectangle {
  constructor({x, y, width, height, scale = null}) {
    this.x = x
    this.y = y
    this.width = width
    this.height = height

    if (scale) {
      this.scale = scale
      this.x = Math.floor(this.x * scale)
      this.y = Math.floor(this.y * scale)
      this.width = Math.floor(this.width * scale)
      this.height = Math.floor(this.height * scale)
    }
  }

  equals(rect) {
    return this.x === rect.x && this.y === rect.y &&
      this.width === rect.width && this.height === rect.height
  }

  includes(rect) {
    return this.x <= rect.x && this.y <= rect.y &&
      this.x + this.width >= rect.x + rect.width &&
      this.y + this.height >= rect.y + rect.height
  }
}
