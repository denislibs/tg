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
 * `checkLangPackForUpdates` (tweb :104-127, :169-247, :771-779).
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
 *    ни у нас, ни у самого tweb; заводить мёртвый метод незачем.
 *  • `handleStateCleared` + подписки на `langpack_update`/`langpack_update_too_long`/
 *    `state_cleared` (tweb :765-769, :783-785): кадров langpack наш сервер не
 *    шлёт (см. докблок менеджера), а «состояние очищено» у нас событием не
 *    объявляется. Проверка обновлений заводится не кадром, а стартом —
 *    `getCacheLangPackAndApply`.
 *  • `polyfillPromise` / `./pluralPolyfill` (tweb :256-264): `Intl.PluralRules`
 *    есть во всех браузерах, которые мы собираем (target ES2020), — предмета нет.
 *  • `countriesList` и раздача имён стран в `strings` (tweb :81, :289-302):
 *    списка стран у нас нет вовсе — предмета нет.
 *  • RTL (`isRTL`/`setRTL`/`getIsRTL`, tweb :89, :95, :100): RTL-локалей в нашем
 *    списке языков нет (то же отступление уже записано в `components/icon.ts`).
 *  • События шины `language_change` / `language_apply` (tweb :307, :318):
 *    в нашем каталоге `rootScope` таких событий нет, и подписчиков им дала бы
 *    только React-сторона — это ЗАДАЧА 8 (живая смена языка). Ванильные узлы
 *    здесь обновляются напрямую через `weakMap`, как в оригинале, и события для
 *    этого не нужны.
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
 * ── Потребители на сегодня ─────────────────────────────────────────────────
 * Загрузка ЕСТЬ, а интерфейс всё ещё берёт строки старым `t()`: его снимает
 * ЗАДАЧА 9 («useT внутри ходит в I18n.strings»), она же заводит вызов
 * `getCacheLangPackAndApply` на старте вкладки и связывает выбранный
 * пользователем язык с `getLangPackAndApply`.
 *
 * Почему этот вызов не поставлен здесь и сейчас — НЕ ради экономии запроса
 * (запрос ровно один — чтение IDB и `/difference`, тот же самый, что приедет
 * задачей 9): включённый старт завёл бы ВТОРОЙ ИСТОЧНИК «текущего языка».
 * `getCacheLangPackAndApply` выводит язык из `lang_code` пакета, оказавшегося в
 * кэше, а React берёт его из `localStorage(tg-lang)` (`useI18nStore`), и в
 * приватном окне или при чистом IndexedDB эти двое разъезжаются: `I18n`
 * поднялся бы на `en`, стор — на сохранённом `ru`. Сводит их в один источник
 * задача 8, включает старт задача 9.
 * ЦЕНА ЭТОГО РЕШЕНИЯ, названная честно: у всей подсистемы загрузки сегодня нет
 * НИ ОДНОГО производственного вызывающего, поэтому живой проверки по DoD п.10
 * для неё не существует — только тесты. Именно это укрытие и спрятало от
 * первого захода отказ владельца через границу контекстов (`askOwner` ниже):
 * на стенде он бы вылез первым же запуском без воркера.
 * `IntlDateElement` заведён потому, что на него смотрит `helpers/date.ts`
 * (`formatDateAccordingToTodayNew` сейчас строит `i18nSpan` руками) — он станет
 * его вызывающим ЗАДАЧЕЙ 7, когда `i18nSpan` уйдёт. `setTimeFormat` ждёт того же
 * момента: настройка 12/24 у нас есть (`settings.tsx:15,103`, значения
 * `12h`/`24h`), живой переключатель — `settings/GeneralSettings.tsx:137-144`, но
 * СЮДА она ниоткуда не приходит. До тех пор арифметику 12-часовой ветки
 * (`(hours % 12) || 12`, выбор am/pm) держат тесты ядра — на полночь и полдень
 * в том числе.
 */
import type { LangPackDifference, LangPackString } from '@layer'
import type { LangPackKey, LangPackValue } from '@/lang'
import Icon from '@components/icon'
import type { IconName } from '@core/tgico-icons'
import { setDirection } from '@helpers/dom/setInnerHTML'
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

namespace I18n {
  export const strings: Map<LangPackKey, LangPackString> = new Map()

  // tweb объявляет `pluralRules` пустым и заполняет в `applyLangPack` — у него
  // применение гарантированно проходит на старте (его зовёт загрузчик). У нас
  // загрузчик есть, но на старте вкладки его пока никто не зовёт (задача 9),
  // поэтому правила заведены сразу на языке по умолчанию: иначе `format()` до
  // первого применения падал бы на `undefined`.
  let pluralRules: Intl.PluralRules = new Intl.PluralRules(DEFAULT_LANG_CODE)

  let lastRequestedLangCode: string = DEFAULT_LANG_CODE
  let lastRequestedNormalizedLangCode: string = DEFAULT_LANG_CODE
  let lastAppliedLangCode: string | undefined
  // ОТСТУПЛЕНИЕ, как и `pluralRules` выше: у tweb поле стартует `undefined` и
  // заполняется из настроек при старте приложения. У нас настройка сюда пока
  // ниоткуда не приходит (`settings.tsx` знает её, но связи нет — задача 7), а
  // `IntlDateElement` читает поле сразу, поэтому умолчание стоит здесь. `h23` —
  // то же, что выбрано умолчанием в `settings.tsx:103` (`24h`).
  let timeFormat: TimeFormat = 'h23'

  export function getLastRequestedLangCode() { return lastRequestedLangCode }
  export function getLastRequestedNormalizedLangCode() { return lastRequestedNormalizedLangCode }
  export function getLastAppliedLangCode() { return lastAppliedLangCode }
  export function getTimeFormat() { return timeFormat }

  /** tweb :104-108. Там функция приватная — её зовут только загрузчики того же
   *  файла; здесь они её тоже зовут, а ЭКСПОРТ держит будущий вызыватель, а не
   *  тест: «текущий язык» сегодня выводится из `lang_code` пакета, который
   *  оказался в кэше, и параллельно живёт в React-сторе `useI18nStore` — свести
   *  два источника в один (ЗАДАЧА 8, «второй источник текущего языка обязан
   *  исчезнуть»; включает её ЗАДАЧА 9) без внешнего «поставить код языка»
   *  нельзя. До тех пор экспортом пользуется ещё и тест словарей
   *  (`i18n/dict.test.ts`), применяющий язык из ФАЙЛОВ, минуя сервер и
   *  владельца пакета, — но форму продукта диктует не он. */
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
   * tweb :117-127 — холодный старт: применить то, что уже лежит на диске.
   *
   * В сеть этот путь НЕ ХОДИТ (как и у оригинала): язык поднимается мгновенно,
   * а свежесть догоняет фоновая проверка. Её вызов — наше расхождение по
   * ИСТОЧНИКУ: у tweb проверку заводит серверный кадр `updateLangPack*`
   * (:783-784), которого наш сервер не шлёт, поэтому единственный повод
   * спросить разницу — старт.
   */
  export function getCacheLangPackAndApply(): Promise<LangPackDifference> {
    return cacheLangPackPromise ||= getCacheLangPack()
      .then((pack) => {
        if (pack) setLangCode(pack.lang_code)
        return applyServerLangPack(pack, lastRequestedLangCode)
      })
      .then((pack) => {
        void checkLangPackForUpdates()
        return pack
      })
      .finally(() => { cacheLangPackPromise = undefined })
  }

  /** tweb :230-247 — язык выбран явно: пакет с сервера (или из кэша владельца,
   *  если он про этот же язык) и применение. */
  export function getLangPackAndApply(langCode: string): Promise<LangPackDifference> {
    setLangCode(langCode)
    return loadLangPack(langCode).then((pack) => applyServerLangPack(pack, langCode))
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
    }

    const elements = Array.from(document.querySelectorAll('.i18n')) as HTMLElement[]
    elements.forEach((element) => {
      const instance = weakMap.get(element)

      if (instance) {
        instance.update()
      }
    })
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
          // ДОЛГ, ЗАДАЧА 7. Инлайновый `onclick` оригинала работает где угодно, а
          // наш делегат `data-anchor-action` один и живёт ВНУТРИ ленты
          // (`components/chat/bubbles.ts:2519`). Пока вызывающих у `i18n()` нет,
          // это незаметно; как только строка со ссылкой встанет в попап или
          // сайдбар, клик по ней будет мёртвым — делегат придётся поднять выше.
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
