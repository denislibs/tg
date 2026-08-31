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
// Практическое следствие, и оно неприятное: новый тест, который построит
// `SettingSection` или вкладку слайдера ВНЕ документа и забудет `import '@/i18n'`,
// получит в узле имя ключа и может зафиксировать его ожиданием — пин смолчит.
// Почему источник не снят в корне (общим импортом в сетапе) — разобрано и ЗАМЕРЕНО
// в `src/test/setup.ts`: такой импорт инстанцирует `@lib/langPack` раньше, чем тест
// регистрирует `vi.mock`, и ломает мокирование его зависимостей (5 падений в
// `lib/langPack.load.test.ts`). Цена выбора — эта дыра; она названа, а не забыта.
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
        + 'Причин две. (1) Принимающий его не переводит — либо переведите на месте '
        + '(`t(key)`), либо передайте готовый текст отдельным пропом, либо, если это '
        + 'подпись ванильного компонента, отдайте ей КЛЮЧ (`langKey`/`text: '
        + 'LangPackKey`) и дайте перевести самой. (2) Узел строит `i18n()` ядра, а '
        + 'ядро в этом тесте ПУСТО: строки в него кладёт создание хранилища языка '
        + '(`i18n/index.tsx`), в продукте это делает холодный старт, а в прогоне — '
        + 'только явный `import \'@/i18n\'` в самом тесте (почему не в общем сетапе — '
        + 'разобрано в `src/test/setup.ts`).',
      )
    }
  })
}
