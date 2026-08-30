import type { LangPackDifference, LangPackString } from '@layer'
import type { RestClient } from '../net/restClient'

/**
 * Языковой пакет: загрузка с сервера, кэш и версия — порт tweb
 * `lib/langPack.ts` (`getCacheLangPack`, `loadLangPack`, `saveLangPack`,
 * `handleUpdateLangPack`, `handleUpdateLangPackTooLong`,
 * `checkLangPackForUpdates`) + `appManagers/appLangPackManager.ts`.
 *
 * ── ГДЕ ЭТО ЖИВЁТ И ПОЧЕМУ ЗДЕСЬ ────────────────────────────────────────────
 * У tweb пакет лежит на ВКЛАДКЕ: кэш — `commonStateStorage` (:114, :253), а
 * версию и разницу считают модульные функции рядом с `I18n` (:696-781). Вкладок
 * при этом столько же, сколько у нас, и загрузчик у каждой свой.
 *
 * У нас факт «текущий языковой пакет и его версия» отдан ОДНОМУ владельцу —
 * воркеру (`web-client/CLAUDE.md`, «Владение фактами»): один SharedWorker на все
 * вкладки, значит одно обращение в сеть и одна запись в IndexedDB вместо N
 * независимых. Вкладке остаётся то, что у tweb и так на вкладке: `I18n.strings`,
 * живые `.i18n`-узлы и подмешивание локального английского ПОД серверный пакет
 * (`lib/langPack.ts`).
 *
 * Из-за этого арифметика версии (`handleUpdateLangPack*`,
 * `checkLangPackForUpdates`) переехала СЮДА, к кэшу: считать разницу там, где
 * не лежит пакет, значило бы возить пакет через RPC-границу туда и обратно на
 * каждую проверку.
 *
 * ── ЧТО В КЭШЕ ЛЕЖИТ ────────────────────────────────────────────────────────
 * ТОЛЬКО СЕРВЕРНЫЙ пакет. У tweb в `commonStateStorage` попадает уже слитый
 * (локальный английский + серверные строки, :237-244), потому что слияние там
 * происходит до записи. У нас английский источник — модуль вкладки
 * (`src/lang.ts`), и хранить его копию в IndexedDB незачем: он приезжает
 * бандлом и всегда свежий, а слияние делает вкладка на применении. Побочный
 * выигрыш: пакет в кэше не раздут 1288 английскими строками, которые и так
 * лежат в бандле.
 *
 * ── ПОЧЕМУ ИМЕННО ЭТО ХРАНИЛИЩЕ ────────────────────────────────────────────
 * Ключ-значение в IndexedDB (`core/store/idbKv.ts`, БД `msgr`, стор `kv`) —
 * наш аналог tweb `commonStateStorage`: тем же местом живут токен
 * (`core/auth/tokenStore.ts`), список аккаунтов, пасскод и курсор апдейтов.
 * Два соседа не подошли:
 *   • `core/store/persist.ts` (msgr-store) — АККАУНТНОЕ хранилище: скоуп по
 *     session_token, полный сброс на логауте, под passcode-локом не читается и
 *     не пишется. Строки нужны ЭКРАНУ ВХОДА, то есть до того, как появился
 *     токен, и обязаны пережить логаут — там им не место;
 *   • `core/files/cacheStorage.ts` — байты медиа (Response/Blob по URL). Пакет
 *     это структура, а не файл.
 * Хранилище приходит зависимостью (`kv`), а не импортом: тесты подставляют
 * карту в памяти, как это делает `newCursor`.
 *
 * ── РАСХОЖДЕНИЯ С ОРИГИНАЛОМ ────────────────────────────────────────────────
 *  • `lang_pack` (`web`/`webk`) — ПЕРВЫЙ аргумент всех методов оригинала
 *    (`appLangPackManager.ts:18,32,40`, `config/app.ts:25`), и на нём у tweb
 *    держится каркас слияния ДВУХ пакетов (`web` поверх `android`,
 *    `langPack.ts:192-203, 238-241`). У наших маршрутов места для него нет
 *    вовсе: пакет один, и второго предмета не существует — сервер отдаёт
 *    строки по коду языка (`GET /langpack/{code}`). Аргумент здесь не
 *    выдуман и не подставлен пустым: расхождение названо, работы за ним нет.
 *  • Кадров `updateLangPack`/`updateLangPackTooLong` наш сервер не шлёт
 *    (`backend/internal` их не порождает), поэтому подписки `after()`
 *    оригинала здесь нет, а `handleUpdateLangPack` вызывается не кадром, а
 *    проверкой обновлений. Предмета для кадра нет: строки на сервере меняются
 *    только пересевом из словарей клиента, то есть на выкладке, и каждый
 *    клиент спрашивает разницу на старте.
 *  • `getCountriesList` оригинала (`appLangPackManager.ts:25`) не портирован —
 *    списка стран у нас нет (то же отступление уже записано в
 *    `lib/langPack.ts`).
 *  • `langpack.getStrings` (доспрос отдельных ключей) и `langpack.getLanguages`
 *    (список языков) на бэкенде есть, а вызывающего у них здесь нет ни одного:
 *    доспрос у самого tweb мёртв (`I18n.getStrings` не зовёт никто), а список
 *    языков рисует ЭКРАН — задача 8 (живая смена языка), см. отчёт задачи 5.
 *    Метод без вызывающего — мёртвый код, и заводить его заранее нельзя.
 */

/** Ключ кэша. Один на приложение, как `langPack` у tweb (:114): пакет хранится
 *  для ТЕКУЩЕГО языка, смена языка перезаписывает запись целиком. */
const CACHE_KEY = 'langpack'

/** Хранилище ключ-значение (`core/store/idbKv.ts`). Инъекцией — ради тестов. */
export interface LangPackKV {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
}

interface LangPackDeps {
  rest: RestClient
  kv: LangPackKV
}

export function newLangPackManager({ rest, kv }: LangPackDeps) {
  /**
   * Полёты за пакетом по коду языка. У tweb ту же роль играет
   * `cacheLangPackPromise` (:112, :116) — второй вызов не заводит второго
   * запроса. У нас это тем более важно: сюда сходятся ВСЕ вкладки.
   */
  const inFlight = new Map<string, Promise<LangPackDifference | null>>()

  /** Пакет из кэша. Отказ IndexedDB — это «кэша нет», а не падение: приложение
   *  обязано подняться и в приватном окне, где хранилище недоступно. */
  async function cached(): Promise<LangPackDifference | null> {
    try {
      return (await kv.get<LangPackDifference>(CACHE_KEY)) ?? null
    } catch {
      return null
    }
  }

  /** Порт `saveLangPack` (:249-256). Отказ записи глотаем по той же причине,
   *  что и отказ чтения: непрочитанный кэш хуже, чем несохранённый. */
  async function save(pack: LangPackDifference): Promise<LangPackDifference> {
    try {
      await kv.set(CACHE_KEY, pack)
    } catch { /* IndexedDB недоступен — пакет живёт до конца сессии */ }
    return pack
  }

  /** Порт `loadLangPack` (:192-203) + `langpack.getLangPack`: весь пакет языка.
   *  Сеть отказала — отдаём null, решение о запасном пути принимает вкладка
   *  (у неё локальный английский). */
  async function fetchPack(langCode: string): Promise<LangPackDifference | null> {
    try {
      return await save(await rest.get<LangPackDifference>(`/langpack/${encodeURIComponent(langCode)}`))
    } catch {
      return null
    }
  }

  /**
   * Порт `handleUpdateLangPack` (:696-750): разница ложится на пакет из кэша.
   *
   * Три отказа применить — три РАЗНЫХ утверждения, и путать их нельзя:
   *   • чужой язык — разница не про наш пакет;
   *   • версия не больше нашей — откат назад (сервер откатили, ответ
   *     пришёл вторым из двух параллельных). Порт `checkLangPackForUpdates`
   *     (:773-779), где ровно это сравнение и стоит;
   *   • `from_version` не равен нашей версии — между пакетами ДЫРА: разницу
   *     класть не на что, и tweb здесь идёт за всем пакетом заново
   *     (`handleUpdateLangPackTooLong`, :752-763).
   */
  async function applyDifference(
    stored: LangPackDifference,
    difference: LangPackDifference,
  ): Promise<LangPackDifference | null> {
    if (difference.lang_code !== stored.lang_code) return null
    if (difference.version <= stored.version) return null
    if (difference.from_version !== stored.version) return fetchPack(stored.lang_code)

    const strings: LangPackString[] = stored.strings.slice()
    for (const string of difference.strings) {
      const index = strings.findIndex((s) => s.key === string.key)
      // Снятый ключ (`langPackStringDeleted`) УДАЛЯЕТСЯ из серверного слоя, а не
      // кладётся в него. Расхождение с tweb (:718-725 — там снятый конструктор
      // просто дописывается в массив) и оно осознанное: у нас под серверным
      // слоем лежит локальный английский, и удаление открывает его — ровно то,
      // что значит «строки на сервере больше нет». Дописанный `langPackStringDeleted`
      // перекрыл бы английский собой, а `I18n.format` отдаёт на него СИМВОЛИЧЕСКИЙ
      // КЛЮЧ (`lib/langPack.ts`, ветка `input = key`) — то есть на экран приехал бы
      // `CurrentSession` вместо «This device».
      if (string._ === 'langPackStringDeleted') {
        if (index !== -1) strings.splice(index, 1)
      } else if (index !== -1) {
        strings[index] = string
      } else {
        strings.push(string)
      }
    }

    return save({ ...stored, strings, from_version: difference.from_version, version: difference.version })
  }

  return {
    /**
     * Порт `getCacheLangPack(true)` (:110-115): пакет из кэша, БЕЗ СЕТИ.
     * Путь холодного старта — вкладка поднимает язык с диска и применяет его
     * до всякого запроса; чего в кэше нет, то расскажет локальный английский.
     */
    cachedPack: (): Promise<LangPackDifference | null> => cached(),

    /**
     * Пакет языка: кэш, если он про этот же язык, иначе сеть.
     * Порт `getLangPackAndApply` в части загрузки (:230-236) — применение
     * осталось на вкладке, где живут `I18n.strings` и живые узлы.
     */
    async getPack(langCode: string): Promise<LangPackDifference | null> {
      const stored = await cached()
      if (stored?.lang_code === langCode) return stored

      let flight = inFlight.get(langCode)
      if (!flight) {
        flight = fetchPack(langCode).finally(() => { inFlight.delete(langCode) })
        inFlight.set(langCode, flight)
      }
      return flight
    },

    /**
     * Порт `checkLangPackForUpdates` (:771-779): спросить разницу от версии
     * кэша и положить её на пакет.
     *
     * Отдаёт ОБНОВЛЁННЫЙ пакет либо null («применять нечего»): вкладка по null
     * не делает ничего — не перерисовывает узлы и не трогает `I18n.strings`.
     * Пакета в кэше нет — проверять нечего: сравнивать не с чем, а тянуть весь
     * пакет здесь значило бы делать работу `getPack` вторым путём.
     */
    async checkForUpdates(): Promise<LangPackDifference | null> {
      const stored = await cached()
      if (!stored) return null

      let difference: LangPackDifference
      try {
        difference = await rest.get<LangPackDifference>(
          `/langpack/${encodeURIComponent(stored.lang_code)}/difference`,
          { from_version: stored.version },
        )
      } catch {
        // Сеть/сервер отказали — остаёмся на том, что есть. Это не ошибка
        // приложения: язык уже применён, проверка повторится на следующем старте.
        return null
      }

      return applyDifference(stored, difference)
    },
  }
}

export type LangPackManager = ReturnType<typeof newLangPackManager>
