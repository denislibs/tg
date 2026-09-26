// Порт tweb src/helpers/dom/clearfix.ts (812502980) 1:1 — распорка за
// плавающим временем бабла (bubbles.ts:9029, стиль base.scss:2328-2331).
export default function clearfix() {
  const element = document.createElement('span')
  element.classList.add('clearfix')
  return element
}
