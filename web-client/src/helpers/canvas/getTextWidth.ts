// Порт tweb `src/helpers/canvas/getTextWidth.ts` — измерение ширины строки
// канвасом (используется `MiddleEllipsisElement`, чтобы резать имя файла по
// РЕАЛЬНОЙ ширине, а не по числу символов).
//
// Адаптация (поведение в браузере не менялось): в tweb контекст берётся без
// проверки (`canvas.getContext('2d', {alpha: false})` при выключенном
// strictNullChecks). У нас strict, а в тестовой среде (happy-dom) `getContext`
// возвращает `null` — см. `src/test/setup.ts`. Поэтому промах контекста даёт 0:
// нулевая ширина текста никогда не превысит ширину элемента, и элемент просто
// остаётся с полным текстом, вместо того чтобы падать.
import isRTL from '@helpers/string/isRTL'

let context: CanvasRenderingContext2D | null | undefined

export default function getTextWidth(text: string, font: string): number {
  if(context === undefined) {
    const canvas = document.createElement('canvas')
    context = canvas.getContext('2d', { alpha: false })
  }

  if(!context) {
    return 0
  }

  if(context.font !== font) {
    context.font = font
  }

  context.direction = isRTL(text) ? 'rtl' : 'ltr'

  return context.measureText(text).width
}
