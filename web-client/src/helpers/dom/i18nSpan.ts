// Замена tweb `i18n(key, args)` (`lib/langPack.ts:644`) на время, пока langPack
// не портирован: `i18n()` возвращает `span.i18n` с готовым переведённым
// текстом — тот же узел строит и эта функция, только из уже переведённой
// строки (перевод достаёт вызывающий через `useI18nStore.getState().t`, у
// разных вызывающих ключ приходит из разных мест).
//
// Раньше эта функция была продублирована дословно в `components/button.ts` и
// `components/buttonMenu.ts` — здесь она одна, оба места на неё переведены.
export default function i18nSpan(text: string) {
  const span = document.createElement('span')
  span.classList.add('i18n')
  span.textContent = text
  return span
}
