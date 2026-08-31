/**
 * Ядро локализации — порт tweb `src/lib/langPack.ts`.
 *
 * Отличие от нашего прежнего словаря принципиальное: `i18n(key, args)` отдаёт не
 * строку, а УЗЕЛ (`span.i18n`), и узел этот живой — он записан в `weakMap`, и
 * применение нового языка (`applyLangPack`) перерисовывает его на месте, без
 * перемонтирования. Из того же следует и вторая вещь: аргументом подстановки
 * может быть УЗЕЛ (имя пира, ссылка), и он остаётся узлом — `superFormatter`
 * собирает результат списком кусков, а не склейкой строк.
 *
 * ── Откуда берутся строки (задача 5) ───────────────────────────────────────
 * Пакет приезжает С СЕРВЕРА, а его кэш, версию и разницу держит ВЛАДЕЛЕЦ —
 * менеджер воркера `core/managers/langPackManager.ts` (почему там, а не здесь,
 * разобрано в его докблоке). Здесь осталась вкладочная половина оригинала:
 * `getCacheLangPack`, `getCacheLangPackAndApply`, `loadLangPack`,
 * `loadLocalLangPack`, `getLangPackAndApply`, `applyLangPack` и
 * `checkLangPackForUpdates` (tweb :102-126, :169-247, :771-779).
 * Владелец за границей контекстов, поэтому КАЖДЫЙ прыжок к нему идёт через
 * `askOwner`: отказ воркера значит «пакета нет», а не «строк нет» — разбор у
 * самой функции.
 *
 * ГЛАВНОЕ ПРАВИЛО СЛИЯНИЯ, 1:1 с оригиналом (tweb :237-244): локальный
 * английский (`src/lang.ts`) ложится ПОД серверный пакет, и только затем
 * серверные строки — поверх. Убрать нижний слой нельзя: переведён у русского не
 * весь словарь, а у остальных четырёх — примерно половина, и без английского
 * снизу непереведённый ключ приехал бы на экран СИМВОЛИЧЕСКИМ ИМЕНЕМ (`format`
 * ниже на ненайденной строке отдаёт сам ключ). Серверный `base_lang_code` эту
 * схему не заменяет: подмешивания базы на сервере нет, а у tweb это поле не
 * читает вообще никто.
 *
 * ── Что из файла оригинала СЮДА НЕ ПОПАЛО ──────────────────────────────────
 *  • `saveLangPack`, `handleUpdateLangPack`, `handleUpdateLangPackTooLong` (tweb
 *    :249-256, :696-763) — переехали к владельцу пакета, в менеджер воркера:
 *    они пишут КЭШ и считают ВЕРСИЮ, а ни того, ни другого на вкладке нет.
 *  • `getStrings` (tweb :205-207, доспрос отдельных ключей) — вызывающего нет
 *    ПОКА ЧТО, и это не «мёртвый код оригинала»: у tweb метод живой, его зовёт
 *    `components/languageChangeButton.tsx:23`, чтобы взять подпись
 *    «Continue in Russian» НА ПРЕДЛОЖЕННОМ языке, не применяя его целиком.
 *    Кнопку экрана входа мы не портировали — ЗАДАЧА #117, и `getStrings`
 *    приедет вместе с ней (ручка `GET /langpack/{code}/strings` на бэкенде
 *    уже есть, задача 4).
 *  • `handleStateCleared` + подписки на `langpack_update`/`langpack_update_too_long`/
 *    `state_cleared` (tweb :765-769, :783-785): кадров langpack наш сервер не
 *    шлёт (см. докблок менеджера), а «состояние очищено» у нас событием не
 *    объявляется. Проверка обновлений заводится не кадром, а стартом —
 *    `catchUpLangPack` (зовут после первого кадра, `client/boot.ts`).
 *  • `polyfillPromise` / `./pluralPolyfill` (tweb :256-264): `Intl.PluralRules`
 *    есть во всех браузерах, которые мы собираем (target ES2020), — предмета нет.
 *  • `countriesList` и раздача имён стран в `strings` (tweb :81, :289-302):
 *    списка стран у нас нет вовсе — предмета нет.
 *  • RTL (`isRTL`/`setRTL`/`getIsRTL`, tweb :89, :95, :100): RTL-локалей в нашем
 *    списке языков нет (то же отступление уже записано в `components/icon.ts`).
 *  • Пересчёт реакций/индексов при смене языка (tweb :310-314): у нас нет ни
 *    `appReactionsManager.resetAvailableReactions`, ни индексов диалогов по имени.
 *  • Карта `langPack` «тип служебного действия → ключ» (tweb :21-67): её предмет
 *    у нас — `core/serviceMsg.ts`, который строит фразу сам; на символические
 *    ключи он переедет ЗАДАЧЕЙ 6 (кодмод).
 *  • `UNSUPPORTED_LANG_PACK_KEY` (tweb :76): ключей `Message.Unsupported.Mobile`
 *    /`.Desktop` в нашем `lang.ts` нет (есть один `Message.Unsupported`), а
 *    вызывающего у константы нет ни одного.
 *  • Сигнал `langCodeNormalized`/`setLangCodeNormalized` (tweb :96, :113):
 *    предмета нет. У оригинала на него завязан ПЕРЕВОД СООБЩЕНИЙ — сравнение
 *    языка собеседника с языком интерфейса (`usePeerTranslation.ts:64`,
 *    `stores/peerLanguage.ts:37`, `sidebarLeft/tabs/language.tsx:30`); перевода
 *    сообщений у нас нет. Само значение отсюда доступно
 *    (`getLastRequestedNormalizedLangCode`), не хватает только реактивности.
 *
 * ── ВЛАДЕЛЕЦ «ТЕКУЩЕГО ЯЗЫКА» — ЗДЕСЬ (задача 8) ───────────────────────────
 * Факт «какой язык сейчас» живёт в ОДНОМ месте: `lastRequestedLangCode` этого
 * файла. Между запусками его переживает не он сам, а ВЫБОР —
 * `localStorage('tg-lang')`, который пишет ровно один `getLangPackAndApply`
 * (разбор разницы «запрошенный ≠ выбранный» — у `setLangCode` ниже). До задачи 8 ответов было два: ядро выводило
 * язык из `lang_code` пакета, оказавшегося в кэше (`getCacheLangPackAndApply`),
 * а React-стор — из того же `tg-lang`, который писал сам. В приватном окне или
 * на чистом IndexedDB эти двое расходятся: ядро поднимается на `en`, стор — на
 * сохранённом `ru`. У tweb источник тоже один (кэш пакета), так что паритет
 * здесь не нарушен — нарушено было наше правило «один факт — один владелец».
 *
 * ПОЧЕМУ ВЛАДЕЛЕЦ ИМЕННО ЗДЕСЬ, а не в React-сторе, который вёл выбор до сих
 * пор, — две причины, и обе не про вкусы:
 *  • язык нужен ДО интерфейса и ПОСЛЕ него. `format()`/`i18n()` зовут из
 *    ванильного слоя и из модулей, у которых React в графе нет вовсе, а сам
 *    React из приложения уезжает (переезд на Solid); владелец, умирающий вместе
 *    с фреймворком, — не владелец;
 *  • у tweb владелец на этом же месте (`I18n`), и вкладка настроек языка ходит
 *    именно к нему (`sidebarLeft/tabs/language.tsx` → `I18n.getLangPackAndApply`).
 * Стор с этой задачи ЗЕРКАЛИТ ядро: его `lang` берётся отсюда, а меняют его
 * только `setLangCode` (память) и `getLangPackAndApply` (память + выбор).
 *
 * ПОЧЕМУ ХРАНИЛИЩЕ ОТДЕЛЬНОЕ, а не кэш пакета, как у оригинала: кэш лежит у
 * владельца пакета в ВОРКЕРЕ и читается асинхронно, а первый рендер интерфейса
 * синхронен — язык, узнанный после него, означал бы вспышку английского поверх
 * выбранного русского. Плата за отдельное хранилище названа прямо: выбор и
 * кэш теперь могут разъехаться (выбран `ru`, в кэше `en`), и разбирает это
 * `getCacheLangPackAndApply` — кэш применяется, только если он про выбранный
 * язык.
 *
 * Языка БРАУЗЕРА (`navigator.language`) здесь нет, и это не «мы его выкинули»:
 * умолчание владельца — `App.langPackCode` оригинала (`en`), а язык браузера у
 * tweb работает НЕ умолчанием, а ПРЕДЛОЖЕНИЕМ: `networkerFactory.ts:48` шлёт его
 * как `system_lang_code`, сервер отвечает `config.suggested_lang_code`, и
 * `components/languageChangeButton.tsx` рисует на экране входа кнопку «Continue
 * in Russian». Кнопки у нас нет — её порт это ЗАДАЧА #117, — поэтому
 * предложение применяется молча: `suggestBrowserLangCode` в конце этого файла
 * (задача 9 перенесла его сюда из `i18n/index.tsx` и переспросила «умеем ли
 * показать» у СЕРВЕРА, а не у списка чанков). Снять его нужно ВМЕСТЕ с приездом
 * кнопки, не раньше: без обеих половин русский браузер получил бы английский
 * интерфейс и английский же экран настроек как единственный путь к русскому.
 *
 * ── ЕДИНСТВЕННЫЙ ИСТОЧНИК СТРОК (задача 9) ─────────────────────────────────
 * `I18n.strings` — вся локализация приложения, второго словаря в проекте нет.
 * Наполняет карту ТОЛЬКО `applyLangPack`, и зовут его ровно два пути:
 * `getCacheLangPackAndApply` (холодный старт, его дёргает `client/boot.ts` до
 * первого кадра) и `getLangPackAndApply` (язык выбрали явно). Оба кладут
 * локальный английский ПОД серверный пакет — см. `applyServerLangPack`.
 *
 * Читают карту тоже одним способом: `format()`. На нём стоит и ванильный слой
 * (`i18n()`/`IntlElement` — подписи `button.ts`, `row.ts`, `buttonMenu.ts`,
 * `settingSection.ts`, `sliderTab.ts`, `toast.ts`, попапов; `IntlDateElement` —
 * метки времени `helpers/date.ts`), и React: его `t()` (`i18n/index.tsx`) —
 * тонкая обёртка над `format(key, true, args)`.
 *
 * До задачи 9 источников было ДВА: карту наполнял `i18n/index.tsx` чанками
 * словарей (`dict.*.ts`), а рядом жил старый словарь «ключ = английская строка»,
 * считавшийся из тех же чанков мостом `legacyDict`. Сервер при этом не спрашивал
 * никто: `getCacheLangPackAndApply` не звал ни один продуктовый файл. Снято
 * целиком — и мост, и чанки, и мост в ядро (`applyToCore`).
 */
import type { LangPackDifference, LangPackString } from '@layer'
import type { LangPackKey, LangPackValue } from '@/lang'
import Icon from '@components/icon'
import type { IconName } from '@core/tgico-icons'
import { setDirection } from '@helpers/dom/setInnerHTML'
import rootScope from '@lib/rootScope'
import deepEqual from '@helpers/object/deepEqual'
import safeAssign from '@helpers/object/safeAssign'
import capitalizeFirstLetter from '@helpers/string/capitalizeFirstLetter'
import { ANCHOR_ACTION_ATTRIBUTE, matchUrlProtocol, setBlankToAnchor, wrapUrl } from '@lib/richtext/url'
// Владелец языкового пакета — менеджер воркера; вкладка ходит к нему тем же
// путём, что и остальной ванильный слой (`core/mediaUrl.ts`, `core/mediaRead.ts`).
// Импорт статический, а ВЫЗОВ ленивый: модуль тянут словари (`i18n/dict.*.ts`) и
// тесты ядра, и поднимать из-за них SharedWorker нельзя.
import { startClient, type Managers } from '../client/bootstrap'

export type { LangPackKey }

/** Менеджер-владелец пакета (кэш, сеть, версия) — см. импорт `startClient`. */
const owner = () => startClient().managers.langPack

/**
 * ЕДИНСТВЕННАЯ форма обращения к владельцу — и она защищённая.
 *
 * У tweb запасной путь (`import('../lang')`) лежит в том же контексте, что и
 * загрузчик, и отказать между ними нечему. У нас между вкладкой и владельцем
 * ГРАНИЦА КОНТЕКСТОВ, и она — свой класс отказа, которого в оригинале нет:
 * чанк воркера не отдался после выкладки, `SharedWorker` недоступен (приватное
 * окно, sandbox-iframe), RPC-метод не зарегистрирован. Любое из этого роняет
 * `startClient()` или реджектит вызов, и без этой обёртки отказ ВЛАДЕЛЬЦА
 * съедал бы весь локальный английский тоже: `getCacheLangPackAndApply()`
 * реджектится целиком, вкладка поднимается БЕЗ СТРОК — на экране символические
 * ключи, — а `void checkLangPackForUpdates()` вдобавок даёт unhandled rejection.
 *
 * Поэтому отказ владельца здесь означает ровно то же, что отказ сети у самого
 * владельца: «пакета нет». `null` дальше по пути уже разобран —
 * `applyServerLangPack(null)` применяет локальный английский, и приложение
 * поднимается.
 */
async function askOwner<T>(ask: (o: Managers['langPack']) => Promise<T | null>): Promise<T | null> {
  try {
    return await ask(owner())
  } catch {
    return null
  }
}

/** tweb :72-73 — аргументом подстановки может быть узел, и он останется узлом. */
export type FormatterArgument = string | number | Node | FormatterArgument[]
export type FormatterArguments = FormatterArgument[]

/** Часовой цикл, как его называет `Intl` (tweb `State['settings']['timeFormat']`). */
export type TimeFormat = 'h12' | 'h23'

/** tweb берёт код первого языка из `App.langPackCode`; конфига langpack у нас нет,
 *  а «язык по умолчанию» — тот же английский, и он же язык локального источника
 *  (`src/lang.ts`), который ложится под любой серверный пакет. */
const DEFAULT_LANG_CODE = 'en'

/**
 * Где лежит ВЫБОР ЯЗЫКА между запусками (задача 8).
 *
 * Ключ прежний, `tg-lang`: до этой задачи его писал React-стор (`i18n/index.tsx`),
 * и смена имени сбросила бы язык каждому, кто уже выбирал. Переехало не значение,
 * а ВЛАДЕЛЕЦ — разбор в шапке файла.
 */
const LANG_CODE_KEY = 'tg-lang'

/**
 * Годен ли код языка платформе. Проверка не по регулярке, а ПОПЫТКОЙ: годным
 * код делает ровно то, что `Intl` его принимает, и любая своя форма («две-три
 * буквы, дальше дефисы») либо запретит настоящий тег, либо пропустит `ru-1234`,
 * на котором `Intl` бросает.
 *
 * Проверяется прочитанное ИЗ ХРАНИЛИЩА: писать туда мог кто угодно, а бросок
 * случился бы на старте вкладки, до всякого экрана.
 */
function isUsableLangCode(langCode: string): boolean {
  try {
    new Intl.PluralRules(langCode)
    return true
  } catch {
    return false
  }
}

/** Отказ хранилища — не отказ языка: в приватном окне и в sandbox-iframe
 *  `localStorage` бросает на самом обращении, и приложение обязано подняться. */
function readStoredLangCode(): string | undefined {
  try {
    const stored = localStorage.getItem(LANG_CODE_KEY)
    return stored && isUsableLangCode(stored) ? stored : undefined
  } catch {
    return undefined
  }
}

function storeLangCode(langCode: string) {
  try {
    localStorage.setItem(LANG_CODE_KEY, langCode)
  } catch { /* хранилища нет — выбор живёт до конца сессии */ }
}

namespace I18n {
  export const strings: Map<LangPackKey, LangPackString> = new Map()

  // ЕДИНСТВЕННЫЙ факт «какой язык сейчас» на всё приложение (задача 8). Читается
  // синхронно на импорте — иначе первый же рендер интерфейса пошёл бы на языке
  // по умолчанию и мигнул бы английским поверх выбранного русского.
  const storedLangCode = readStoredLangCode()
  let lastRequestedLangCode: string = storedLangCode ?? DEFAULT_LANG_CODE
  let lastRequestedNormalizedLangCode: string = lastRequestedLangCode.split('-')[0]

  /**
   * Был ли язык ВЫБРАН — то есть лежит ли выбор в хранилище.
   *
   * Отличать «выбрано `en`» от «ничего не выбрано, поэтому `en`» обязан кто-то
   * один, и это владелец. Спрашивает `suggestBrowserLangCode` в конце файла:
   * предложение браузера применяется только поверх ВТОРОГО случая, иначе оно
   * перебивало бы выбор пользователя на каждом запуске.
   *
   * Отсюда же требование к записи выбора: писать хранилище имеет право ТОЛЬКО
   * выбор (`getLangPackAndApply`), и никогда — старт. Финальное ревью нашло
   * обратное: `setLangCode` писал при любом применении, включая автоматический
   * `getLangPackAndApply('en')` холодного старта, и первый же запуск объявлял
   * умолчание выбором — со второго запуска предложение по языку браузера не
   * срабатывало НИКОГДА.
   */
  export function hasStoredLangCode() { return storedLangCode !== undefined }

  // tweb объявляет `pluralRules` пустым и заполняет в `applyLangPack` — у него
  // применение гарантированно проходит на старте (его зовёт загрузчик). У нас
  // применение тоже придёт, но `format()` могут позвать и до него, поэтому
  // правила заведены сразу — и на ВЫБРАННОМ языке, а не на языке по умолчанию:
  // формы числа русского и английского разные, и один такой ранний вызов
  // напечатал бы «5 сообщения».
  let pluralRules: Intl.PluralRules = new Intl.PluralRules(lastRequestedNormalizedLangCode)

  let lastAppliedLangCode: string | undefined
  // ОТСТУПЛЕНИЕ, как и `pluralRules` выше: у tweb поле стартует `undefined` и
  // заполняется из настроек при старте приложения. У нас настройку приносит
  // подписка на хранилище настроек (`settings.tsx`, задача 7), но `IntlDateElement`
  // читает поле и до неё — поэтому умолчание стоит здесь. `h23` — то же, что
  // выбрано умолчанием в `settings.tsx` (`24h`).
  let timeFormat: TimeFormat = 'h23'

  export function getLastRequestedLangCode() { return lastRequestedLangCode }
  export function getLastRequestedNormalizedLangCode() { return lastRequestedNormalizedLangCode }
  export function getLastAppliedLangCode() { return lastAppliedLangCode }
  export function getTimeFormat() { return timeFormat }

  /**
   * tweb :102-106 — «язык теперь такой», В ПАМЯТИ. 1:1 с оригиналом: хранилища
   * эта функция не касается.
   *
   * ЗАПРОШЕННЫЙ язык и ВЫБРАННЫЙ — разные факты, и путать их нельзя. Запрошенный
   * меняется на каждом применении, в том числе автоматическом (старт поднимает
   * пакет выбранного языка, догон применяет серверный). Выбранный меняется
   * только когда язык ВЫБРАЛИ — руками на экране языка, кнопкой предложения или
   * в соседней вкладке, — и пишет его один `getLangPackAndApply` ниже.
   *
   * До финального ревью писала обе половины эта функция, и цена была ровно
   * такая: холодный старт первого запуска (`getLangPackAndApply('en')`)
   * записывал умолчание как выбор, `hasStoredLangCode` со следующего запуска
   * отвечал «выбирали», и предложение по языку браузера умирало навсегда. Хуже
   * всего это выглядело офлайн: русский браузер, первый заход без сети —
   * приложение поднималось английским и запирало себя в нём.
   *
   * У оригинала этого разделения нет, потому что нет и второго хранилища: выбор
   * там — это САМ КЭШ ПАКЕТА (`saveLangPack` пишет пакет, а старт выводит язык
   * из его `lang_code`), и пишется он только там, где пакет приехал. У нас кэш
   * лежит за границей контекстов и читается асинхронно, а «текущий язык» нужен
   * СИНХРОННО на первом рендере — отсюда отдельный `tg-lang`.
   *
   * Экспорт — ради прогона (`test/lang.ts`, `lib/langPack.test.ts`): он подаёт
   * язык из ФАЙЛОВ, минуя сервер. Продуктовых вызывающих вне файла нет.
   */
  export function setLangCode(langCode: string) {
    lastRequestedLangCode = langCode
    lastRequestedNormalizedLangCode = langCode.split('-')[0]
  }

  /** tweb :112 — второго применения на тот же старт не заводим. */
  let cacheLangPackPromise: Promise<LangPackDifference> | undefined

  /**
   * tweb :169-190 — ПУТЬ ПЕРВОГО ЗАПУСКА: строки, вшитые в бандл.
   *
   * Отличий от оригинала два, и оба про предмет, а не про поведение. Первое:
   * `langSign.ts` (словарь экрана входа) и `countries.ts` у нас не заведены —
   * весь английский источник это один `src/lang.ts`. Второе: оригинал собирает
   * здесь ЦЕЛЫЙ `langPackDifference` (со своими `App.langPackVersion`/
   * `localVersion`), потому что этот пакет у него может уехать в кэш как есть
   * (:120-121); у нас локальные строки в кэш не едут никогда — они всегда лишь
   * НИЖНИЙ СЛОЙ слияния, — поэтому отсюда возвращается ровно то, чем этот слой
   * и является: список строк.
   *
   * Импорт динамический, как у оригинала: словарь на 1288 ключей не должен
   * попадать в чанк к тому, кто взял отсюда только `formatLocalStrings`.
   */
  export function loadLocalLangPack(): Promise<LangPackString[]> {
    return import('../lang').then((lang) => formatLocalStrings(lang.default))
  }

  /** tweb :110-115 — пакет из КЭША, без сети. Параметра `dontLoadLocal`
   *  оригинала нет: локальный источник у нас подмешивается всегда (см.
   *  `applyServerLangPack`), выбирать между ним и кэшем не нужно. */
  export function getCacheLangPack(): Promise<LangPackDifference | null> {
    return askOwner((o) => o.cachedPack())
  }

  /** tweb :192-203 — серверный пакет языка. Сеть, кэш и запись держит владелец;
   *  `lang_pack` (`web`/`webk`) первым аргументом у нас предмета не имеет —
   *  разбор в докблоке `core/managers/langPackManager.ts`. */
  export function loadLangPack(langCode: string): Promise<LangPackDifference | null> {
    return askOwner((o) => o.getPack(langCode))
  }

  /**
   * tweb :237-246 — СЛИЯНИЕ И ПРИМЕНЕНИЕ: локальный английский вниз, серверные
   * строки поверх.
   *
   * `null` вместо пакета — это не отказ, а «сервера не было»: применяется один
   * локальный английский, и приложение поднимается офлайн. Версия у такого
   * пакета 0 — то же, что «пакета нет» на языке владельца (`checkForUpdates`
   * ходит за разницей только от кэша, которого в этом случае и не появилось).
   */
  export async function applyServerLangPack(
    serverPack: LangPackDifference | null,
    langCode: string,
  ): Promise<LangPackDifference> {
    const strings = await loadLocalLangPack()
    if (serverPack) strings.push(...serverPack.strings)

    const langPack: LangPackDifference = {
      _: 'langPackDifference',
      lang_code: langCode,
      from_version: serverPack?.from_version ?? 0,
      version: serverPack?.version ?? 0,
      strings,
    }

    applyLangPack(langPack)
    return langPack
  }

  /**
   * tweb :115-126 — холодный старт: применить то, что уже лежит НА ДИСКЕ.
   *
   * В СЕТЬ ЭТА ФУНКЦИЯ НЕ ХОДИТ НИ ОДНОЙ ВЕТКОЙ, и это главное её свойство:
   * её ждёт `client/boot.ts` до первого кадра. У оригинала так же — у него
   * здесь только кэш (`commonStateStorage`) либо вшитый `lang.ts`, а сетевой
   * добор стоит ПОСЛЕ `await` (`index.ts:512-517`), см. `catchUpLangPack`.
   *
   * Ревью финального раунда воспроизвело цену обратного: на промахе кэша
   * (первый заход, приватное окно, очистка данных) эта функция уходила за
   * пакетом в сеть, а `RestClient.request` не знает ни таймаута, ни
   * `AbortSignal`. При ВИСЯЩЕЙ сети (не отказе) промис не разрешался вовсе —
   * пользователь ждал первого кадра до таймаута браузера. Строки при этом были
   * ни при чём: под пакетом всегда лежит локальный английский, так что ждать
   * было НЕЧЕГО.
   *
   * РАСХОЖДЕНИЕ С ОРИГИНАЛОМ, И ОНО ЖЕ — ПРЕДМЕТ ЗАДАЧИ 8. У tweb эта функция
   * ВЫВОДИТ язык: `setLangCode(langPack.lang_code)` — какой пакет оказался в
   * кэше, тот язык и текущий. Здесь язык уже известен (см. `setLangCode`), и
   * выводить его второй раз нельзя: в приватном окне или на чистом IndexedDB
   * кэш пуст либо остался от прежнего языка, и вкладка поднялась бы на одном
   * языке, а интерфейс считал бы выбранным другой.
   *
   * Поэтому кэш здесь — ОТВЕТ НА ВОПРОС, а не источник вопроса: пакет
   * применяется, только если он про ВЫБРАННЫЙ язык. Не про него (пусто, чужой
   * язык) — поднимаемся на локальном английском, ровно как оригинал на первом
   * запуске, а серверный пакет догоняет после первого кадра.
   */
  export function getCacheLangPackAndApply(): Promise<LangPackDifference> {
    return cacheLangPackPromise ||= getCacheLangPack()
      .then((pack) => {
        const langCode = lastRequestedLangCode
        return applyServerLangPack(pack?.lang_code === langCode ? pack : null, langCode)
      })
      .finally(() => { cacheLangPackPromise = undefined })
  }

  /** Пакет с сервера (или из кэша владельца, если он про этот же язык) и
   *  применение — БЕЗ объявления выбора. Это путь СТАРТА: язык уже свой,
   *  объявлять нечего, а запись в `tg-lang` здесь означала бы, что умолчание
   *  первого запуска стало выбором (см. `setLangCode`). */
  export function loadLangPackAndApply(langCode: string): Promise<LangPackDifference> {
    return loadLangPack(langCode).then((pack) => applyServerLangPack(pack, langCode))
  }

  /** tweb :233-251 — язык ВЫБРАЛИ явно (экран языка, предложение браузера,
   *  соседняя вкладка). Единственная строка, которая пишет выбор: у оригинала
   *  на этом же месте стоит `saveLangPack`, и другого хранилища выбора у него
   *  нет. */
  export function getLangPackAndApply(langCode: string): Promise<LangPackDifference> {
    setLangCode(langCode)
    storeLangCode(langCode)
    return loadLangPackAndApply(langCode)
  }

  // tweb :130-147
  function updateAmPm() {
    if (timeFormat === 'h12') {
      try {
        const dateTimeFormat = getDateTimeFormat({ hour: 'numeric', minute: 'numeric', hour12: true })
        const date = new Date()
        date.setHours(0)
        const amText = dateTimeFormat.format(date)
        amPmCache.am = amText.split(/\s/)[1]
        date.setHours(12)
        const pmText = dateTimeFormat.format(date)
        amPmCache.pm = pmText.split(/\s/)[1]
      } catch (err) {
        console.error('cannot get am/pm', err)
        amPmCache.am = 'AM'
        amPmCache.pm = 'PM'
      }
    }
  }

  // tweb :149-166. Терм `!!timeFormat` оригинала здесь снят как мёртвый: у tweb
  // это защита от лишней перерисовки на ПЕРВОЙ установке (поле стартует
  // `undefined`), а у нас поле инициализировано — терм всегда истинен. Оставленный,
  // он молча менял бы смысл: первая же установка обходила бы все `.i18n`, чего у
  // оригинала на первой установке не бывает.
  export function setTimeFormat(format: TimeFormat, haveToUpdate = timeFormat !== format) {
    timeFormat = format

    updateAmPm()

    if (haveToUpdate) {
      cachedDateTimeFormats.clear()
      const elements = Array.from(document.querySelectorAll('.i18n')) as HTMLElement[]
      elements.forEach((element) => {
        const instance = weakMap.get(element)

        if (instance instanceof IntlDateElement) {
          instance.update()
        }
      })
    }
  }

  /** tweb :211-232 — плоский объектный словарь (`lang.ts`) в конструкторы схемы.
   *  Значение-строка это `langPackString`, значение-объект — формы числа. */
  export function formatLocalStrings(strings: Record<string, LangPackValue>, pushTo: LangPackString[] = []) {
    for (const i in strings) {
      const v = strings[i]
      if (typeof (v) === 'string') {
        pushTo.push({
          _: 'langPackString',
          key: i,
          value: v,
        })
      } else {
        pushTo.push({
          // Слоты форм в `lang.ts` объявлены необязательными (у английского нет
          // few/many), а конструктор схемы требует `other_value`. Проверить это
          // типом нельзя — словарь пишут руками; ловит тест словаря (задача 3).
          _: 'langPackStringPluralized',
          key: i,
          ...v,
        } as LangPackString.langPackStringPluralized)
      }
    }

    return pushTo
  }

  /** tweb :273-320 — применение языка: правила числа, строки, перерисовка живых узлов. */
  export function applyLangPack(langPack: LangPackDifference) {
    const currentLangCode = lastRequestedLangCode
    if (langPack.lang_code !== currentLangCode) {
      return
    }

    // В оригинале правила числа создаются ДВАЖДЫ (:279-290): сначала по
    // нормализованному коду, затем сразу же поверх — по полному, из пакета.
    // Первое присваивание мёртвое, здесь его нет; поведение то же.
    try {
      pluralRules = new Intl.PluralRules(langPack.lang_code)
    } catch (err) {
      console.error('pluralRules error', err)
      pluralRules = new Intl.PluralRules(langPack.lang_code.split('-', 1)[0])
    }

    strings.clear()

    for (const string of langPack.strings) {
      strings.set(string.key as LangPackKey, string)
    }

    if (lastAppliedLangCode !== currentLangCode) {
      lastAppliedLangCode = currentLangCode
      cachedDateTimeFormats.clear()
      updateAmPm()
      // tweb :325 — ЯЗЫК СМЕНИЛСЯ (а не «пакет переприменился»), поэтому событие
      // широковещательное: соседние вкладки узнают о выборе только отсюда.
      // Условие то же, что у оригинала, — внутри ветки «применённый язык другой»:
      // фоновое обновление строк того же языка соседей не касается.
      rootScope.dispatchEvent('language_change', currentLangCode)
    }

    const elements = Array.from(document.querySelectorAll('.i18n')) as HTMLElement[]
    elements.forEach((element) => {
      const instance = weakMap.get(element)

      if (instance) {
        instance.update()
      }
    })

    // tweb :337 — «строки сменились». МЕСТНОЕ (`dispatchEventSingle`, мимо порта):
    // соседняя вкладка своих строк этим вызовом не меняла. Живые узлы `.i18n`
    // обойдены строкой выше, а React о смене узнаёт только отсюда — его зеркало
    // (`i18n/index.tsx`) на это событие и подписано.
    rootScope.dispatchEventSingle('language_apply')
  }

  // tweb :322-329
  function pushNextArgument(
    out: ReturnType<typeof superFormatter>,
    args: FormatterArguments,
    indexHolder: { i: number },
    i?: number,
  ) {
    const arg = args[i === undefined ? indexHolder.i++ : i]
    if (Array.isArray(arg)) {
      out.push(...arg as ReturnType<typeof superFormatter>)
    } else {
      out.push(arg)
    }
  }

  // tweb :331-338. Второй элемент карты у оригинала (звезда) закомментирован — его нет и здесь.
  const IconMap: Record<string, IconName> = {
    '>': 'next',
    '<': 'previous',
  }

  const iconsNoWhitespace = '><'
  const iconsKeys = Object.keys(IconMap)

  /**
   * tweb :358-458 — разбор микроразметки словаря в СПИСОК КУСКОВ.
   *
   *   `**жирный**` → `<b>`, `__курсив__` → `<i>`, `\n` → `<br>`,
   *   `[текст](url)` → `<a>` (без url — берётся узел-аргумент),
   *   ` > ` / ` < ` → `span.tgico.inline-icon`,
   *   `%s`/`%d`/`un1` → очередной аргумент, `%1$s` → аргумент по НОМЕРУ.
   *
   * Куски возвращаются списком именно затем, чтобы узел-аргумент доехал узлом:
   * склейка в строку превратила бы его в `[object HTMLElement]`.
   */
  export function superFormatter(
    input: string,
    args?: FormatterArguments,
    indexHolder?: { i: number },
  ): Exclude<FormatterArgument, FormatterArgument[]>[] {
    if (!indexHolder) { // стартовый индекс для аргументов без порядка
      indexHolder = { i: 0 }
      const indexes = input.match(/(%|un)\d+/g)
      if (indexes?.length) {
        indexHolder.i = Math.max(...indexes.map((str) => +str.replace(/\D/g, '')))
      }
    }

    const out: ReturnType<typeof superFormatter> = []
    const regExp = new RegExp(`(\\*\\*|__)(.+?)\\1|(\\n)|(\\[.+?\\]\\(.*?\\))|(?:^|\\s)(${iconsKeys.join('|')})(?:$|\\s)|un\\d|%\\d\\$.|%\\S`, 'g')

    let lastIndex = 0
    input.replace(regExp, (
      match: string,
      p1: string | undefined,
      p2: string | undefined,
      p3: string | undefined,
      p4: string | undefined,
      p5: string | undefined,
      offset: number,
      string: string,
    ) => {
      if (offset > lastIndex) {
        out.push(string.slice(lastIndex, offset))
      }

      if (p1) {
        const element = document.createElement(p1 === '**' ? 'b' : 'i')
        element.append(...superFormatter(p2!, args, indexHolder) as (string | Node)[])
        out.push(element)
      } else if (p3) {
        out.push(document.createElement('br'))
      } else if (p4) {
        const idx = p4.lastIndexOf(']')
        const text = p4.slice(1, idx)

        const url = p4.slice(idx + 2, p4.length - 1)
        let a: HTMLAnchorElement | string
        if (url && matchUrlProtocol(url)) {
          const anchor = document.createElement('a')
          const wrappedUrl = wrapUrl(url)
          anchor.href = wrappedUrl.url
          // tweb пишет сюда инлайновый `onclick` (:407); у нас имя обработчика
          // едет атрибутом-данными — как в `richtext/wrapRichText.ts:379`.
          //
          // ЗАДАЧА 7, разобрано. Прежняя редакция звала это ДОЛГОМ: инлайновый
          // `onclick` оригинала работает где угодно, а наш делегат
          // `data-anchor-action` живёт ВНУТРИ ленты (`chat/bubbles.ts`), значит
          // строка со ссылкой в попапе или сайдбаре получила бы мёртвый клик.
          // ПОДНИМАТЬ ДЕЛЕГАТ НЕЧЕМ И НЕЗАЧЕМ, и вот замеры:
          //  • ни в `src/lang.ts`, ни в одном из пяти словарей НЕТ НИ ОДНОЙ строки
          //    с разметкой `[текст](url)` — эта ветка `superFormatter` для наших
          //    данных недостижима вовсе. Держит пин `i18n/noAnchorMarkup.test.ts`:
          //    он краснеет ровно в тот момент, когда такая строка появится;
          //  • у самого действия нет исполнителя: `openInternalLink`
          //    (`BubblesNavigation`) — необязательная точка расширения, и её не
          //    передаёт НИ ОДИН производственный вызывающий (только тесты ленты).
          // Поднятый сейчас делегат был бы инфраструктурой без потребителя с обеих
          // сторон — ровно то, что этот репозиторий сносит как мёртвый код.
          if (wrappedUrl.action) anchor.setAttribute(ANCHOR_ACTION_ATTRIBUTE, wrappedUrl.action)
          setBlankToAnchor(anchor)
          a = anchor
        } else {
          a = args![indexHolder.i++] as HTMLAnchorElement | string

          if (a instanceof DocumentFragment) { // сразу после wrapRichText
            a = (a as DocumentFragment).firstChild as HTMLAnchorElement
          }

          if (typeof (a) !== 'string') {
            a.textContent = '' // сбросить содержимое
          }
        }

        const formatted = superFormatter(text, args, indexHolder)
        if (typeof (a) === 'string') {
          out.push(...formatted)
        } else {
          a.append(...formatted as (string | Node)[])
          out.push(a)
        }
      } else if (p5) {
        const noWhitespace = iconsNoWhitespace.includes(p5)
        if (!noWhitespace && !match.startsWith(p5)) out.push(match[0])
        out.push(Icon(IconMap[p5], 'inline-icon'))
        if (!noWhitespace && match.startsWith(p5)) out.push(match[match.length - 1])
      } else if (args) {
        const index = match.replace(/\D/g, '')
        pushNextArgument(
          out,
          args,
          indexHolder,
          !index || Number.isNaN(+index) ? undefined : Math.min(args.length - 1, +index - 1),
        )
      }

      lastIndex = offset + match.length
      return ''
    })

    if (lastIndex !== input.length) {
      out.push(input.slice(lastIndex))
    }

    return out
  }

  /** tweb :460-486 — строка по ключу: форма числа выбирается ЗДЕСЬ, по `Intl.PluralRules`. */
  export function format<T extends boolean>(
    key: LangPackKey,
    plain?: T,
    args?: FormatterArguments,
  ): T extends true ? string : ReturnType<typeof superFormatter> {
    const str = strings.get(key)
    let input: string
    if (str) {
      if (str._ === 'langPackStringPluralized' && args?.length) {
        let v = args[0] as number | string
        if (typeof (v) === 'string') v = +v.replace(/\D/g, '')
        const s = pluralRules.select(v)
        input = (str as unknown as Record<string, string>)[s + '_value'] || str.other_value
      } else if (str._ === 'langPackString') {
        input = str.value
      } else {
        input = key
      }
    } else {
      input = key
    }

    const result = superFormatter(input, args)
    if (plain) { // строкой — для `placeholder`/`title`, где узлов быть не может
      return result.map((item) => item instanceof HTMLBRElement ? '\n' : (item instanceof Node ? item.textContent : item)).join('') as never
    } else {
      return result as never
    }
  }

  export const weakMap: WeakMap<HTMLElement, IntlElementBase<IntlElementBaseOptions>> = new WeakMap()

  export type IntlElementBaseOptions = {
    element?: HTMLElement,
    property?: 'innerText' | 'innerHTML' | 'placeholder' | 'textContent',
  }

  // tweb :516-534
  abstract class IntlElementBase<Options extends IntlElementBaseOptions> {
    public element: HTMLElement
    public property: IntlElementBaseOptions['property']

    constructor(options?: Options) {
      this.element = options?.element || document.createElement('span')
      this.element.classList.add('i18n')

      this.property = options?.property

      weakMap.set(this.element, this)
    }

    abstract update(options?: Options): void
  }

  export type IntlElementOptions = IntlElementBaseOptions & {
    key?: LangPackKey,
    args?: FormatterArguments
  }

  // tweb :536-588
  export class IntlElement extends IntlElementBase<IntlElementOptions> {
    public key: IntlElementOptions['key']
    public args: IntlElementOptions['args']

    constructor(options: IntlElementOptions = {}) {
      super({ ...options, property: options.property ?? 'innerHTML' })

      if (options?.key) {
        this.update(options)
      }
    }

    public update(options?: IntlElementOptions) {
      safeAssign(this, options)

      if (!this.key) {
        this.element.replaceChildren()
        return
      }

      if (this.property === 'innerHTML') {
        this.element.replaceChildren(...format(this.key, false, this.args) as (string | Node)[])
        if (this.args?.length) {
          this.element.normalize()
        }
      } else {
        const v = (this.element as unknown as Record<string, unknown>)[this.property!]
        const formatted = format(this.key, true, this.args)

        // * hasOwnProperty здесь не работает
        if (v === undefined) this.element.dataset[this.property!] = formatted
        else (this.element as unknown as Record<string, string>)[this.property!] = formatted
      }
    }

    /** tweb :572-579. Контракт производительности: тот же ключ с теми же
     *  аргументами узел НЕ перестраивает. */
    public compareAndUpdateBool(options: IntlElementOptions): boolean {
      if (this.key === options.key && deepEqual(this.args, options.args)) {
        return false
      }

      this.update(options)
      return true
    }

    // tweb :581-587. Параметр у оригинала помечен необязательным, хотя тут же
    // разыменовывается (`strictNullChecks` там выключен) — здесь он обязателен.
    public compareAndUpdate(options: IntlElementOptions) {
      if (this.key === options.key && deepEqual(this.args, options.args)) {
        return
      }

      return this.update(options)
    }
  }

  // tweb :590-600
  const cachedDateTimeFormats: Map<string, Intl.DateTimeFormat> = new Map()
  export function getDateTimeFormat(options: Intl.DateTimeFormatOptions = {}) {
    const json = JSON.stringify(options)
    let dateTimeFormat = cachedDateTimeFormats.get(json)
    if (!dateTimeFormat) {
      dateTimeFormat = new Intl.DateTimeFormat(lastRequestedNormalizedLangCode + '-u-hc-' + timeFormat, options)
      cachedDateTimeFormats.set(json, dateTimeFormat)
    }

    return dateTimeFormat
  }

  export const amPmCache = { am: 'AM', pm: 'PM' }
  export type IntlDateElementOptions = IntlElementBaseOptions & {
    date?: Date,
    options: Intl.DateTimeFormatOptions
  }

  // tweb :607-641
  export class IntlDateElement extends IntlElementBase<IntlDateElementOptions> {
    public date: IntlDateElementOptions['date']
    public options: IntlDateElementOptions['options']

    constructor(options: IntlDateElementOptions) {
      super({ ...options, property: options.property ?? 'textContent' })
      setDirection(this.element)
      // Строки нет у оригинала: там поле ставит только `safeAssign` внутри `update`,
      // а `update` зовётся не всегда (лишь когда дата передана). Под нашим
      // `strictPropertyInitialization` это не компилируется, и присваивание вынесено
      // сюда. Поведение то же: `update` перезапишет поле тем же значением.
      this.options = options.options

      if (options?.date) {
        this.update(options)
      }
    }

    public update(options?: IntlDateElementOptions) {
      safeAssign(this, options)

      // `!` вместо ветвления: `update()` без даты зовёт только `setTimeFormat`,
      // и там дата уже стоит с конструктора (в tweb то же, но без strict).
      const date = this.date!

      let text: string
      if (this.options.hour && this.options.minute && Object.keys(this.options).length === 2) {
        // Часы и минуты собираются РУКАМИ, мимо `Intl`: только так уважается
        // пользовательская настройка 12/24 часа, у `Intl` её взять неоткуда.
        const hours = date.getHours()
        text = ('0' + (timeFormat === 'h12' ? (hours % 12) || 12 : hours)).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2)

        if (timeFormat === 'h12') {
          text += ' ' + (hours < 12 ? amPmCache.am : amPmCache.pm)
        }
      } else {
        const dateTimeFormat = getDateTimeFormat(this.options)
        text = capitalizeFirstLetter(dateTimeFormat.format(date))
      }

      ;(this.element as unknown as Record<string, string>)[this.property!] = text
    }
  }

  // tweb :644-655
  export function i18n(key: LangPackKey, args?: FormatterArguments) {
    return new IntlElement({ key, args }).element
  }

  export function i18n_(options: IntlElementOptions) {
    return new IntlElement(options).element
  }

  export function _i18n(
    element: HTMLElement,
    key: LangPackKey,
    args?: FormatterArguments,
    property?: IntlElementOptions['property'],
  ) {
    return new IntlElement({ element, key, args, property }).element
  }
}

export { I18n }
export default I18n

const i18n = I18n.i18n
export { i18n }

const i18n_ = I18n.i18n_
export { i18n_ }

const _i18n = I18n._i18n
export { _i18n }

/**
 * tweb :771-779 — фоновая проверка обновлений языка.
 *
 * Вся арифметика (спросить разницу от версии кэша, отклонить чужой язык и
 * откат назад, сходить за всем пакетом на дыре в версиях) живёт у ВЛАДЕЛЬЦА —
 * `core/managers/langPackManager.ts::checkForUpdates`; здесь остаётся то, чего
 * владелец сделать не может, — применить обновлённый пакет к `I18n.strings` и
 * к живым `.i18n`-узлам вкладки.
 *
 * `null` от владельца означает «применять нечего» (нет кэша, нет сети, версия
 * не выросла, ЯЗЫК УЖЕ НЕ ТОТ) — и тогда здесь не происходит НИЧЕГО: узлы не
 * трогаются, уже применённый язык не перетирается. Отказ самого владельца
 * (границы контекстов у tweb нет — см. `askOwner`) даёт тот же `null`: эту
 * функцию зовут через `void` из `getCacheLangPackAndApply`, и реджект здесь
 * стал бы unhandled rejection на старте вкладки.
 *
 * Запрошенный язык сверяется ДВАЖДЫ — 1:1 с оригиналом (tweb :698-706), и
 * защищает это один случай: ЯЗЫК ПЕРЕКЛЮЧИЛИ, ПОКА ЛЕТЕЛА РАЗНИЦА. Обе сверки
 * оригинала стоят там, где у нас лежит защищаемое: обе — у ВЛАДЕЛЬЦА, потому
 * что у tweb они спасают ЗАПИСЬ В ХРАНИЛИЩЕ (`saveLangPack` ниже по тому же
 * методу), а хранилище теперь его.
 *
 * Сверка ЗДЕСЬ добавляет к ним ровно одно, и не экран: узлы и `I18n.strings`
 * от чужого языка защищает сам `applyLangPack` (тот же вопрос, порт tweb
 * :275-277) — он на несовпадении не делает ничего. Но без этой строки наружу
 * уезжал бы пакет, который НЕ ПРИМЕНЁН, и вызывающий не отличил бы его от
 * применённого; заодно не строится впустую нижний слой из 1288 строк.
 */
export async function checkLangPackForUpdates(): Promise<LangPackDifference | undefined> {
  const langCode = I18n.getLastRequestedLangCode()
  const pack = await askOwner((o) => o.checkForUpdates(langCode))
  if (!pack || pack.lang_code !== I18n.getLastRequestedLangCode()) return
  return I18n.applyServerLangPack(pack, pack.lang_code)
}

/**
 * ДОГОН ПАКЕТА ПОСЛЕ ПЕРВОГО КАДРА — порт tweb `index.ts:512-517`.
 *
 * Разделение обязанностей здесь ровно оригинальное: диск поднимает язык ДО
 * кадра (`getCacheLangPackAndApply`), сеть догоняет ПОСЛЕ и первый кадр не
 * держит — вызывающий (`client/boot.ts`) зовёт это через `void`.
 *
 * Ветки две, как и у оригинала, и различает их то же самое: есть ли под нами
 * СЕРВЕРНЫЙ пакет. Версия 0 значит «нет» — кэш был пуст или от другого языка
 * (`applyServerLangPack`), и спрашивать разницу не от чего: владелец на
 * отсутствующий кэш честно отвечает «применять нечего»
 * (`core/managers/langPackManager.ts::checkForUpdates`, первая сверка). Тогда
 * идём за ВСЕМ пакетом. Есть — спрашиваем только разницу.
 *
 * Наше расхождение с оригиналом здесь по ИСТОЧНИКУ, а не по действию: у tweb
 * проверку обновлений заводит ещё и серверный кадр `updateLangPack*`
 * (:777-779), которого наш сервер не шлёт, поэтому единственный повод спросить
 * разницу — старт.
 */
export function catchUpLangPack(applied: LangPackDifference): Promise<unknown> {
  return applied.version === 0
    ? I18n.loadLangPackAndApply(applied.lang_code)
    : checkLangPackForUpdates()
}

/**
 * ПРЕДЛОЖЕНИЕ ЯЗЫКА ПО БРАУЗЕРУ — половина механизма tweb, ЗАДАЧА #117.
 *
 * У оригинала язык браузера не умолчание, а предложение: `networkerFactory.ts:48`
 * шлёт его как `system_lang_code`, сервер отвечает `config.suggested_lang_code`, и
 * `components/languageChangeButton.tsx` рисует на экране входа кнопку «Continue in
 * Russian» — интерфейс английский, но переход в один клик. Кнопку мы не
 * портировали, поэтому предложение применяется МОЛЧА; снимется вместе с её портом.
 *
 * ── Что здесь изменила задача 9 ────────────────────────────────────────────
 * Раньше предложение проверялось по СПИСКУ ЧАНКОВ словарей (`i18n/dict.ts`), и
 * это работало ровно потому, что чанк и был источником строк. Теперь строки у
 * сервера, и единственный честный вопрос «умеем ли мы показать этот язык» —
 * ЕСТЬ ЛИ ОН У СЕРВЕРА (`langpack.getLanguages`, тот же список, что рисует экран
 * выбора языка). Иначе русский браузер получил бы `lang_code: 'it'`, пустой ответ
 * сервера и английский текст под итальянской галочкой на экране языка.
 *
 * ВЫЗОВ НЕ БЛОКИРУЕТ СТАРТ, и это не оптимизация. Список приезжает по сети; на
 * пути холодного старта отказ сети означал бы ожидание таймаута перед первым
 * кадром. Поэтому старт идёт на своём языке, а предложение (первый запуск, сети
 * нет) просто не случается — интерфейс остаётся английским, ровно как у tweb до
 * ответа конфига. Догнавшее предложение видно без перезагрузки: узлы `.i18n`
 * перерисовывает `applyLangPack`, React — его зеркало.
 *
 * Предложение СЛАБЕЕ ВЫБОРА дважды: если язык выбирали когда-либо (`hasStoredLangCode`)
 * — не спрашиваем вовсе; если выбрали ПОКА ЛЕТЕЛ СПИСОК — не применяем (сверка
 * `before`). Вторая сверка не теоретическая: `hasStoredLangCode` отвечает по
 * снимку хранилища, снятому на импорте модуля, и после выбора в этой же сессии
 * он остаётся прежним.
 */
export async function suggestBrowserLangCode(): Promise<void> {
  if (I18n.hasStoredLangCode()) return
  const before = I18n.getLastRequestedLangCode()
  const suggested = typeof navigator !== 'undefined' ? navigator.language?.split('-')[0] : undefined
  if (!suggested || suggested === before) return

  const languages = await askOwner((o) => o.getLanguages())
  if (!languages?.some((language) => language.lang_code === suggested)) return
  if (I18n.getLastRequestedLangCode() !== before) return
  await I18n.getLangPackAndApply(suggested)
}

// tweb :670-682
export function joinElementsWith<T>(
  elements: T[],
  joiner: T | string | ((isLast: boolean) => T),
): T[] {
  const arr = elements.slice(0, 1) as T[]
  for (let i = 1; i < elements.length; ++i) {
    const isLast = (elements.length - 1) === i
    arr.push(typeof (joiner) === 'function' ? (joiner as (isLast: boolean) => T)(isLast) : joiner as T)
    arr.push(elements[i])
  }

  return arr
}

// tweb :685-694 — перечисление через локализованные разделители: «а, б и в».
//
// ОТСТУПЛЕНИЕ ОТ ОРИГИНАЛА, ТОЛЬКО В ТИПЕ. У tweb `plain`-перегрузка принимает
// `(Node | string)[]`, а тело делает `joined.join('')` — узел в этом режиме дал бы
// `[object Object]`. У самого tweb дефект латентный (единственный `plain`-вызывающий
// передаёт строки). ПОВЕДЕНИЕ ЗДЕСЬ НЕ ТРОНУТО: сужен вход первой перегрузки, и
// написать этот вызов стало нельзя. Третья перегрузка (`plain: boolean`, для
// вызывающего с динамическим флагом) оставлена как у оригинала — сузить её значило
// бы запретить узлы и в НЕ-plain режиме, ради которого она и существует.
export function join(elements: string[], useLast: boolean, plain: true): string
export function join(elements: (Node | string)[], useLast?: boolean, plain?: false): (string | Node)[]
export function join(elements: (Node | string)[], useLast: boolean, plain: boolean): string | (string | Node)[]
export function join(elements: (Node | string)[], useLast = true, plain?: boolean): string | (string | Node)[] {
  const joined = joinElementsWith(elements, (isLast) => {
    const langPackKey: LangPackKey = isLast && useLast ? 'AutoDownloadSettings.LastDelimeter' : 'AutoDownloadSettings.Delimeter'
    return plain ? I18n.format(langPackKey, true) : i18n(langPackKey)
  })

  // Сужение под первую перегрузку: в `plain`-режиме элементы — строки (`format(…, true)`
  // отдаёт строку, вход перегрузки — `string[]`). Без него линтер справедливо видит
  // здесь возможную склейку узла в `[object Object]`.
  return plain ? (joined as string[]).join('') : joined
}
