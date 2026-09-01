// ── ОБЩИЙ ПИН: символический ключ не доезжает до DOM текстом ────────────────────
//
// Скан исходников (`i18n/noLegacyKeys.test.ts`) сторожит обратное — что в `t()` не
// осталось английской строки. Он не видит ГЛАВНОГО дефекта этой волны: ключ передали
// туда, где принимающий его НЕ ПЕРЕВОДИТ (`PopupButton.text`, `Row` с
// `translate={false}`, превью из `core/`), и пользователь читает «UnpinMessage».
// Типы этого тоже не видят: тип у ключа правильный, место — нет.
//
// Поэтому проверка стоит на ВЫДАЧЕ и работает на каждом компонентном тесте разом:
// после теста обходим DOM и падаем, если текстовый узел ЦЕЛИКОМ равен известному
// ключу. Сравнение точное и только для ключей, чей английский текст с именем НЕ
// совпадает: у `t('Add')` результат «Add» — отличить утечку от перевода нечем, и
// такой случай безвреден (текст всё равно верный).
//
// ── ЧЕГО ЭТОТ ПИН НЕ ВИДИТ, НАЗВАНО ЯВНО ───────────────────────────────────────
// Наблюдение идёт за `document.body` и только за ним, поэтому узел, СОБРАННЫЙ ВНЕ
// ДОКУМЕНТА, пину невидим — а таких у нас много: дерево вкладки слайдера, попап до
// `show()`, любой компонент, который тест строит и проверяет, не вставляя. Расширить
// наблюдение нечем: `MutationObserver` вешается на КОНКРЕТНЫЙ корень, а оторванных
// поддеревьев в прогоне сколько угодно и заранее они неизвестны.
//
// Практическое следствие: узел, построенный вне документа, пин не увидит, и тест
// может зафиксировать имя ключа ожиданием.
//
// ВТОРОЙ ИСТОЧНИК ЭТОЙ ДЫРЫ ЗАДАЧА 9 СНЯЛА. Раньше ядро наполнялось побочным
// эффектом импорта `@/i18n`, то есть только если модуль стора случайно оказывался в
// графе теста, — и совет «поставьте `import '@/i18n'`» стоял прямо в сообщении ниже.
// Теперь строки в ядро кладёт общий сетап (`src/test/setup.ts`, `beforeAll` с
// динамическим импортом `test/lang.ts`), и имя ключа в узле означает ровно одно:
// принимающий его НЕ ПЕРЕВОДИТ.
import { afterEach, beforeEach } from 'vitest'

import lang from '../lang'

const KEYS_WITH_OWN_TEXT = new Set(
  Object.entries(lang as Record<string, unknown>)
    .filter(([key, value]) => typeof value === 'string' && value !== key)
    .map(([key]) => key),
)

/**
 * Утечки СОБИРАЮТСЯ ПО ХОДУ теста, а не читаются из DOM после него: у большинства
 * тестов свой `afterEach(cleanup)`, и он срабатывает РАНЬШЕ общего (обратный порядок
 * регистрации) — к моменту проверки тело документа уже пустое, и пин молчал бы всегда.
 */
export function installDomKeyLeakPin(): void {
  const leaked = new Set<string>()
  let observer: MutationObserver | undefined

  const collect = (node: Node) => {
    if (node.nodeType === 3) {
      const text = node.nodeValue?.trim() ?? ''
      if (text && KEYS_WITH_OWN_TEXT.has(text)) leaked.add(text)
      return
    }
    if (node.nodeType !== 1 || typeof document === 'undefined') return
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    for (let text = walker.nextNode(); text; text = walker.nextNode()) collect(text)
  }

  beforeEach(() => {
    leaked.clear()
    if (typeof document === 'undefined' || !document.body || typeof MutationObserver === 'undefined') return
    observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach(collect)
        if (record.type === 'characterData' && record.target) collect(record.target)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  })

  afterEach(() => {
    observer?.disconnect()
    observer = undefined
    if (leaked.size) {
      throw new Error(
        `символический ключ доехал до DOM текстом: ${[...leaked].join(', ')}. `
        + 'Принимающий его НЕ ПЕРЕВОДИТ — либо переведите на месте (`t(key)`), либо '
        + 'передайте готовый текст отдельным пропом, либо, если это подпись '
        + 'ванильного компонента, отдайте ей КЛЮЧ (`langKey`/`text: LangPackKey`) и '
        + 'дайте перевести самой. Пустое ядро причиной больше не бывает: строки в '
        + 'него кладёт общий сетап прогона (`src/test/setup.ts`).',
      )
    }
  })
}
