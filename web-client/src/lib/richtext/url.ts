// Ссылки — порт tweb `lib/richTextProcessor/{matchUrlProtocol,wrapUrl,setBlankToAnchor,wrapTelegramUrlToAnchor}.ts`
// с ДВУМЯ обязательными отличиями (оба — требования `web-client/CLAUDE.md`, раздел «Безопасность»):
//
// 1. **Allow-list схем.** tweb (`matchUrlProtocol.ts`) блокирует ровно одну схему —
//    `javascript:`; `data:`, `blob:`, `vbscript:`, `file:` у него проходят. У нас
//    любой href обязан пройти `@core/safeUrl` (http/https/mailto/tel/tg), и
//    проверяется ИСХОДНАЯ строка — до того, как `wrapUrl` допишет `https://`
//    к строке без схемы (иначе `javascript:alert(1)` превратился бы в
//    «безопасный» `https://javascript:alert(1)` и прошёл бы). Отклонённая ссылка
//    рисуется `<span>`, а не `<a>` (см. wrapRichText).
// 2. **Никаких inline-обработчиков.** tweb вешает `setAttribute('onclick', name + '(this)')`
//    и рассчитывает на глобали из `addAnchorListener`. Мы кладём имя действия в
//    `dataset.anchorAction`, а слушателя вешает лента одним делегированием.
import { safeUrl } from '@core/safeUrl'

/** Атрибут-носитель действия вместо tweb'овского inline `onclick`. */
export const ANCHOR_ACTION_ATTRIBUTE = 'data-anchor-action'

/**
 * Действия внутренних ссылок Telegram (имена — 1:1 tweb `addAnchorListener.ts`,
 * там это имена глобальных функций). Кто их исполняет — забота ленты.
 * Строка, а не объединение литералов: читатель берёт значение из DOM-атрибута
 * (`components/chat/bubbles.ts:2364`). Какие имена допустимы — держит реестр
 * `KNOWN_ANCHOR_ACTIONS` ниже.
 */
export type AnchorAction = string

// tweb `@appManagers/constants.ts:26`
const T_ME_PREFIXES = new Set(['web', 'k', 'z', 'a'])
const PHONE_NUMBER_REG_EXP = /^\+\d+$/
// Первые сегменты t.me-пути, которые сами по себе являются действием (tweb wrapUrl.ts:36-48).
const T_ME_ACTION_PATHS = new Set([
  'm', 'addlist', 'joinchat', 'addstickers', 'addemoji', 'voicechat', 'call',
  'invoice', 'boost', 'giftcode', 'share', 'nft', 'addstyle',
])

/**
 * РЕЕСТР ИЗВЕСТНЫХ ДЕЙСТВИЙ — порт tweb `wrapUrl.ts:86-88`:
 *
 * ```js
 * if(!(window as any)[onclick]) {
 *   onclick = undefined;
 * }
 * ```
 *
 * У оригинала реестр НЕЯВНЫЙ: `addAnchorListener` кладёт обработчик в
 * `window[(protocol ? protocol + '_' : '') + name]`
 * (`helpers/addAnchorListener.ts:58`), а `wrapUrl` в конце снимает действие,
 * для которого такой глобали нет. Проверка обязательна, потому что имя действия
 * ветка `tg:` собирает КОНКАТЕНАЦИЕЙ из адреса (`wrapUrl.ts:65`, у нас — ниже),
 * а схема `tg:` разрешена и бэкендом (`backend/internal/usecase/chat/sanitize.go`),
 * и `@core/safeUrl`: без реестра любой `tg://чтоугодно` из ЧУЖОГО сообщения
 * получал бы `data-anchor-action="tg_чтоугодно"` — имя действия целиком под
 * контролем отправителя.
 *
 * Глобалей у нас нет (inline-обработчики запрещены — см. шапку файла), поэтому
 * реестр перечислен явно. В нём РОВНО те имена, которые наш собственный код
 * кладёт в `data-anchor-action`; записей «на будущее» нет — действие без
 * потребителя было бы мёртвым. Что реестр не разъехался с разметкой — РАВЕН
 * множеству имён, которые эмитит наш код, — держит `url.test.ts`
 * (it «в реестре нет мёртвых записей…»: краснеет и на лишней записи, и на
 * пропавшей).
 *
 * НЕ включены, каждое осознанно:
 *  • `voicechat`. `T_ME_ACTION_PATHS` его эмитит (он есть в `switch` оригинала —
 *    `wrapUrl.ts:41`), но регистрации БЕЗ протокола у tweb нет — только
 *    `tg://voicechat` (`internalLinkProcessor.ts:216-217`). То есть
 *    `window.voicechat` не существует никогда и гейт ОРИГИНАЛА это действие
 *    снимает. Снимаем и мы.
 *  • Всё семейство `tg_*` — у tweb для него зарегистрирован 21 обработчик
 *    (`tg_resolve` :404-405, `tg_settings` :717-718, `tg_iv` :676-677, …), у нас
 *    исполнителя нет НИ ОДНОГО: единственный читатель атрибута — делегирование
 *    ленты (`components/chat/bubbles.ts:2362`), а `openInternalLink` не
 *    реализована и даже не прокидывается хостом (`components/chat/VanillaFeed.tsx:204`
 *    передаёт другие ручки). Сюда же попадает `tg_iv` из задачи #33 — см. ниже.
 *  • `execBotCommand` (tweb `internalLinkProcessor.ts:90`, ставится в
 *    `wrapRichText.ts:393`) и `setMediaTimestamp` (:119 / `wrapRichText.ts:725`):
 *    сущностей `messageEntityBotCommand`/`messageEntityTimestamp` наш
 *    `wrapRichText` не портировал (перечислены в его шапке), этих имён мы не
 *    эмитим вовсе.
 */
export const KNOWN_ANCHOR_ACTIONS: ReadonlySet<string> = new Set([
  // Ставит `wrapUrl` ниже по t.me-пути. Строки — регистрация обработчика в tweb
  // `lib/internalLinkProcessor.ts`, то есть доказательство, что `window[имя]`
  // у оригинала есть и его гейт эти действия пропускает.
  'im', //          :271 — t.me/<username>, t.me/c/…, telesco.pe/…
  'invoice', //     :175 — t.me/$slug, t.me/invoice/<slug>
  'joinchat', //    :201 — t.me/+hash, t.me/joinchat/<hash>
  'm', //           :570
  'addlist', //     :188
  'addstickers', // :142 (цикл по ['addstickers','addemoji'] :136-141)
  'addemoji', //    :142 (тот же цикл)
  'call', //        :230 — внутри `if(IS_GROUP_CALL_SUPPORTED)` :212; в браузере с WebRTC истинно
  'boost', //       :514
  'giftcode', //    :541
  'share', //       :612
  'nft', //         :645
  'addstyle', //    :781
  // Ставит `wrapRichText` (`:377`, `:417`), МИМО `wrapUrl` — ровно как в tweb:
  // там оба имени присваиваются уже после возврата `wrapUrl`
  // (`wrapRichText.ts:590` и `:637`), так что гейт оригинала их тоже не видит.
  // В реестре они потому, что это реестр ВСЕХ имён, которые наша разметка
  // отдаёт в DOM, — за совпадением следит тест.
  'showMaskedAlert', //  tweb `internalLinkProcessor.ts:63`
  'searchByHashtag', //  tweb `internalLinkProcessor.ts:107`
])

/** Порт tweb `matchUrlProtocol.ts`; отличие — allow-list вместо запрета одной схемы. */
export function matchUrlProtocol(text: string) {
  if (!text) {
    return null
  }

  try {
    const protocol = new URL(text).protocol
    if (!safeUrl(text)) {
      return null
    }

    return protocol
  } catch {
    return null
  }
}

/** Порт tweb `setBlankToAnchor.ts`. */
export function setBlankToAnchor(anchor: HTMLAnchorElement) {
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  return anchor
}

/**
 * Порт tweb `wrapUrl.ts` — дописывает схему и распознаёт внутренние t.me-ссылки.
 *
 * Проверка `window[onclick]` (`wrapUrl.ts:86-88`) портирована реестром
 * `KNOWN_ANCHOR_ACTIONS`. Не портирован `MOUNT_CLASS_TO`.
 * Про `tg://iv` и флаг `safe` — см. ниже по коду.
 */
export function wrapUrl(url: string): { url: string, action?: AnchorAction } {
  if (!matchUrlProtocol(url)) {
    url = 'https://' + url
  }

  const out: { url: string, action?: AnchorAction } = { url }
  let tgMeMatch, tgMatch
  let action: AnchorAction | undefined
  if ((tgMeMatch = url.match(/^(?:https?:\/\/)?(?:(.+?)\.)?(?:(?:web|k|z|a)\.)?t(?:elegram)?\.me(?:\/(.+))?/))) {
    const u = new URL(url)
    let prefix: string | undefined = tgMeMatch[1]
    if (prefix && T_ME_PREFIXES.has(tgMeMatch[1])) {
      prefix = undefined
    }

    if (prefix) {
      u.pathname = prefix + (u.pathname === '/' ? '' : u.pathname)
    }

    const fullPath = u.pathname.slice(1)
    const path = fullPath.split('/')

    if (path[0] && path[0][0] === '$' && path[0].length > 1) {
      action = 'invoice'
      // tweb пишет первую проверку регэкспом `/^\+/` — здесь startsWith, того же смысла (линт)
    } else if (fullPath.startsWith('+') && !PHONE_NUMBER_REG_EXP.test(fullPath)) { // second regexp is for phone numbers (t.me/+38050...)
      action = 'joinchat'
    } else if (path[0]) {
      // tweb пишет это `switch`'ем с провалом из списка case'ов в `default`
      // (wrapUrl.ts:35-61); у нас `noFallthroughCasesInSwitch` — те же две ветки
      // развёрнуты в if/else, поведение идентично.
      if (T_ME_ACTION_PATHS.has(path[0]) && path.length !== 1 && !prefix) {
        action = path[0]
      } else if (path.length <= 2 || path[1]?.match(/^\d+(?:\?(?:comment|thread)=\d+)?$/) || ['s', 'c', 'a'].includes(path[1])) {
        action = 'im'
      }
    }
  } else if (url.match(/^(?:https?:\/\/)?telesco\.pe\/([^/?]+)\/(\d+)/)) {
    action = 'im'
  } else if ((tgMatch = url.match(/tg:(?:\/\/)?(.+?)(?:\?|$)/))) {
    action = 'tg_' + tgMatch[1].split('/')[0]

    // `tg://iv?url=…` — Instant View. Оригинал (`wrapUrl.ts:67-81`) на этом месте
    // ПОДМЕНЯЕТ адрес ссылки содержимым `?url=`, но только если у сущности стоит
    // `safe`; иначе снимает действие (`onclick = undefined`).
    //
    // `safe` не проводной: в схеме `messageEntityTextUrl` — offset/length/url
    // (`schema/schema.json`), флаг дописан клиентской надстройкой
    // (`schema/schema_additional_params.json`, тот же файл в tweb — `:1308-1315`)
    // и выставляется ровно в двух местах, оба — внутри читалки Instant View, где
    // текст собран из `page.RichText` (tweb `wrapTelegramRichText.ts:114`,
    // `instantView.tsx:443`). Такой читалки у нас нет и не планируется: статью
    // отдаёт своя ручка `/iv` плоскими блоками (`core/managers/ivManager.ts`,
    // решение зафиксировано в `core/media/messageMedia.ts` у `webPage.has_iv`),
    // вход в неё — карточка ссылки, а не сущность-ссылка. Значит `safe` у нас
    // истинным не бывает, а `tg://iv?url=…` может прийти ТОЛЬКО из чужого
    // сообщения (`tg:` в allow-list и на бэке, и в `@core/safeUrl`).
    //
    // Поэтому подмену адреса не портируем вовсе — она разворачивала бы
    // подконтрольный отправителю адрес. Кода у этой ветки нет: `out.url`
    // остаётся исходным `tg:`-адресом. Действие (`tg_iv`) снимает общий реестр
    // ниже — вместе со всем семейством `tg_*`, у которого исполнителя нет;
    // отдельная проверка по имени, стоявшая здесь по задаче #33, стала
    // недостижимой и удалена, а поведение держат её же тесты (`url.test.ts`).
  }

  // Порт `wrapUrl.ts:86-88`: действие остаётся только если оно из реестра —
  // у оригинала это «есть ли `window[onclick]`», у нас `KNOWN_ANCHOR_ACTIONS`.
  // Стоит ПОСЛЕ всей цепочки, как в оригинале (:86 против конца цепочки :84):
  // проверяются и t.me-действия, и `tg_*`.
  if (action !== undefined && !KNOWN_ANCHOR_ACTIONS.has(action)) {
    action = undefined
  }

  out.action = action
  return out
}

/**
 * `wrapUrl` + allow-list. `undefined` — ссылку показывать нельзя (рисуем `<span>`).
 * Схему проверяем ДО и ПОСЛЕ `wrapUrl`: он дописывает схему, а в оригинале мог бы
 * и подменить адрес (`tg://iv`), так что вторая проверка обязана остаться —
 * что бы `wrapUrl` ни вернул, это проходит тот же allow-list.
 */
export function safeWrapUrl(url: string): { url: string, action?: AnchorAction } | undefined {
  if (!safeUrl(url)) {
    return undefined
  }

  const wrapped = wrapUrl(url)
  if (!safeUrl(wrapped.url)) {
    return undefined
  }

  return wrapped
}

/**
 * Порт tweb `wrapTelegramUrlToAnchor.ts` — БЕЗ `setAttribute('onclick', …)`.
 * Возвращает `undefined`, если ссылка не прошла allow-list.
 */
export function wrapTelegramUrlToAnchor(url1: string): HTMLAnchorElement | undefined {
  const wrapped = safeWrapUrl(url1)
  if (!wrapped) {
    return undefined
  }

  const element = document.createElement('a')
  element.href = wrapped.url
  if (wrapped.action) {
    element.setAttribute(ANCHOR_ACTION_ATTRIBUTE, wrapped.action)
  }

  return element
}
