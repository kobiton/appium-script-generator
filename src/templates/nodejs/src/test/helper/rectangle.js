export default class Rectangle {
  constructor({x, y, width, height, scale = null}) {
    this._x = x
    this._y = y
    this._width = width
    this._height = height

    if (scale) {
      this._scale = scale
      this._x = Math.floor(this._x * scale)
      this._y = Math.floor(this._y * scale)
      this._width = Math.floor(this._width * scale)
      this._height = Math.floor(this._height * scale)
    }
  }

  get x() {
    return this._x
  }

  get y() {
    return this._y
  }

  get width() {
    return this._width
  }

  get height() {
    return this._height
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
