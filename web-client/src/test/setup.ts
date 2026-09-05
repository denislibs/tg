// Общий сетап прогона.
//
// `lottie-web` невозможно вычислить под happy-dom: библиотека на СВОЁМ модульном
// инициализаторе создаёт канву и пишет в 2D-контекст, а happy-dom отдаёт на
// `getContext('2d')` → `null`. Получается `TypeError: Cannot set properties of
// null (setting 'fillStyle')` — незаловленное отклонение, которое не валит тест,
// но засоряет прогон и, как предупреждает сам vitest, «might cause false positive
// tests»: ошибка прилетает к случайному файлу, который в этот момент держит
// воркер, а не к тому, кто её породил. Отсюда и репутация «плавающей».
//
// Ловится это не импортом, а рантаймом: плеер грузится лениво
// (`components/lottie.ts::loadLottie`, ~521 kB отдельным чанком), и любой тест,
// который добирается до реального рендера анимации — уточки пустого состояния
// селектора, стикера, обезьянки пароля, — вычисляет модуль и падает. До сих пор
// с этим боролись поштучно: `PeerSelector.test.tsx` и `StickersHelper.suggest.
// test.ts` глушат каждый по-своему, и то же самое всплыло третьим файлом
// (`InputSearch.test.tsx` тянет `MemberPicker` → `PeerSelector` → уточка).
//
// Заглушка стоит на самом модуле, а не на канве: подменять `getContext` глобально
// значило бы менять поведение тестов, которые сознательно живут с `null`
// (`ChatBackground.test.tsx` — комментарий там прямо про это). Настоящего
// поведения `lottie-web` не проверяет ни один тест, поэтому терять здесь нечего.
//
// ── ПОЧЕМУ ЯЗЫК НАПОЛНЯЕТСЯ В `beforeAll`, А НЕ ИМПОРТОМ СВЕРХУ ───────────────
//
// В продукте ядро локализации (`lib/langPack.ts`) наполняет холодный старт:
// `client/boot.ts` дожидается `I18n.getCacheLangPackAndApply()` до первого кадра.
// В прогоне старта нет, а подписи ванильного слоя строит `i18n()` в момент создания
// узла — на пустом ядре тест читал бы имя ключа.
//
// ИМПОРТ СВЕРХУ ЭТУ РОЛЬ НЕ ИСПОЛНЯЕТ, и это ПРОВЕРЕНО (задача 7), а не отвергнуто
// по догадке:
//  • цена времени причиной НЕ является. Замер по подвыборке `src/core` (208 файлов,
//    3-5 прогонов): медиана ~14.1 → ~15.5 с, то есть +2…10 %;
//  • причина — ЛОМАЕТСЯ `vi.mock`. Сетап выполняется ДО модуля теста, поэтому импорт
//    отсюда инстанцирует `@lib/langPack` раньше, чем тест успевает зарегистрировать
//    моки, и внутри уже созданного `langPack` навсегда остаются НАСТОЯЩИЕ
//    зависимости: `lib/langPack.load.test.ts` давал 5 падений, а замоканный
//    `owner.cachedPack` не вызывался ни разу.
//
// `beforeAll` этой беды не имеет: хуки сетапа выполняются ПОСЛЕ загрузки модульного
// графа теста, то есть после его `vi.mock`. Динамический импорт внутри хука — то же
// самое требование, только к самому импорту.
//
// До задачи 9 роль исполнял ПОБОЧНЫЙ ЭФФЕКТ импорта `@/i18n` (стор наполнял ядро на
// создании), и работал он через раз — только если модуль стора случайно оказывался в
// графе теста. Тесты, что строят узлы `i18n()`, ставили этот импорт поштучно; теперь
// наполнение объявлено один раз здесь, и поштучные импорты сняты.
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, vi } from 'vitest'

import { installDomKeyLeakPin } from './domKeyLeak'

vi.mock('lottie-web', () => {
  const anim = {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
    goToAndStop: vi.fn(),
    goToAndPlay: vi.fn(),
    setSpeed: vi.fn(),
    setDirection: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  const lottie = {
    loadAnimation: vi.fn(() => anim),
    setQuality: vi.fn(),
    destroy: vi.fn(),
    registerAnimation: vi.fn(),
  }
  return { default: lottie, ...lottie }
})

// Пин на утечку ключа в DOM — общий для всех компонентных тестов (см. `domKeyLeak.ts`).
installDomKeyLeakPin()

// Ассеты `public/assets/tgs/*.json` (обезьянки/уточки, Этап 0 плана «один
// движок lottie») грузятся теперь настоящим `fetch`, а не бандл-`import()`
// (`components/lottie.ts::loadTgsAsset`) — под happy-dom нет раздачи `public/`,
// и любой тест, домонтировавший такой узел, ронял прогон необработанным
// `NetworkError`. `lottie-web` здесь всё равно замокан (см. выше), содержимое
// JSON тестам не важно — подставляем пустышку только для этого пути, всё
// остальное идёт настоящим fetch.
//
// Заглушка СВЕРЯЕТСЯ С ДИСКОМ (round 1 ревью этапа 0): раньше она отвечала
// 200 на ЛЮБОЕ имя под `/assets/tgs/`, и опечатка в имени ассета в одном из
// четырёх мостовых потребителей `components/lottie.ts::loadTgsAsset` молча
// резолвилась бы успехом в их собственных компонентных тестах — регрессию
// ловил только общесьютовый скан `tgsAssets.test.ts`, а при изолированном
// прогоне файла она проходила бы незамеченной. Список читается с диска один
// раз при старте сетапа (`public/assets/tgs/`, та же директория, что
// заполнил Этап 0 `git mv`), несуществующее имя получает честный 404 —
// `res.json()` на нём падает, как и должно быть у настоящей опечатки
// (пин — `setup.test.ts`).
const TGS_DIR = resolve(__dirname, '../../public/assets/tgs')
const existingTgsNames = new Set(
  readdirSync(TGS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length)),
)

const realFetch = globalThis.fetch?.bind(globalThis)
if (realFetch) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? new URL(input, location.href) : new URL(input.url, location.href)
    if (url.origin === location.origin && url.pathname.startsWith('/assets/tgs/')) {
      const name = url.pathname.slice('/assets/tgs/'.length).replace(/\.json$/, '')
      if (existingTgsNames.has(name)) {
        return Promise.resolve(new Response(JSON.stringify({ v: '5.5.2', layers: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    }
    return realFetch(input, init)
  }) as typeof fetch
}

// Английские строки в ядро — ОДИН РАЗ НА ФАЙЛ ПРОГОНА (разбор — в шапке файла).
// Язык, отличный от английского, тест применяет сам: `applyLang` из `./lang`.
beforeAll(async () => {
  await import('./lang')
})
