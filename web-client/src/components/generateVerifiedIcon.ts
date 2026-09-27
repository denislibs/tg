// Порт tweb `src/components/generateVerifiedIcon.ts` 1:1: значок официальной
// верификации — `span.verified-icon > svg.verified-icon-svg` с двумя `use` на
// пути спрайта `index.html` (`#verified-icon-check` под
// `#verified-icon-background`). Цвета — правилами `.verified-icon-*`
// (`styles/tweb/_bridge.scss`, выдержка tweb base.scss:1541-1554) и их
// переопределениями у места показа (`.profile-bot-verification`, _profile.scss).
export default function generateVerifiedIcon(): HTMLSpanElement {
  const span = document.createElement('span')
  span.classList.add('verified-icon')

  const size = 26 // 24
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttributeNS(null, 'viewBox', `0 0 ${size} ${size}`)
  svg.setAttributeNS(null, 'width', `${size}`)
  svg.setAttributeNS(null, 'height', `${size}`)
  svg.classList.add('verified-icon-svg')

  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  use.setAttributeNS(null, 'href', '#verified-icon-background')
  use.classList.add('verified-icon-background')

  const use2 = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  use2.setAttributeNS(null, 'href', '#verified-icon-check')
  use2.classList.add('verified-icon-check')

  svg.append(use2, use)

  span.append(svg)

  return span
}
