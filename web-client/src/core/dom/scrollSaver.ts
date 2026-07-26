// src/core/dom/scrollSaver.ts
// Focused port of tweb's ScrollSaver (_save/_restore, scrollHeightMinusTop path).
// reverse=true anchors to the bottom: prepending older content above the viewport
// keeps the currently-visible messages in place.
export default class ScrollSaver {
  private scrollHeightMinusTop = 0

  constructor(private container: HTMLElement, private reverse = true) {}

  save(): void {
    const { scrollTop, scrollHeight } = this.container
    this.scrollHeightMinusTop = this.reverse ? scrollHeight - scrollTop : scrollTop
  }

  restore(): void {
    const { scrollHeight } = this.container
    const newTop = this.reverse ? scrollHeight - this.scrollHeightMinusTop : this.scrollHeightMinusTop
    this.container.scrollTop = newTop
  }
}
