/**
 * Порт tweb `src/components/generateDelimiter.ts:1-5` (812502980) — дословно.
 *
 * Градиентная полоса над секцией вместо линии: `Section fakeGradientDelimiter`
 * (`section.solid.tsx`) и императивный `settingSection.ts`. Стиль — tweb
 * `scss/base.scss:1391-1406`, у нас в `styles/index.scss`.
 */
export const generateDelimiter = () => {
  const delimiter = document.createElement('div')
  delimiter.classList.add('gradient-delimiter')
  return delimiter
}
