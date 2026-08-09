// Общий SVG-спрайт — как в tweb index.html:46 (`<svg><defs id="svg-defs">…`),
// который лежит скрытым в начале body и на который ссылаются `<use href="#…">`.
// Пока нужен один путь — `#check` для чекбокса (_checkbox.scss стилизует
// именно `use`: stroke-dasharray-анимация галочки).
export default function SvgDefs() {
  return (
    <svg style={{ position: 'absolute', top: '-10000px' }} aria-hidden>
      <defs id="svg-defs">
        {/* tweb index.html:59 — 1:1 */}
        <path id="check" fill="none" d="M 4.7071 12.2929 l 5 5 c 0.3905 0.3905 1.0237 0.3905 1.4142 0 l 11 -11" />
      </defs>
    </svg>
  )
}
