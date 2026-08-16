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
 * Не портированы: ветка `tg://iv?url=` c `safe` (нужен предпросмотр статей),
 * проверка `window[onclick]` (у нас исполнителя решает лента) и `MOUNT_CLASS_TO`.
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
  }

  out.action = action
  return out
}

/**
 * `wrapUrl` + allow-list. `undefined` — ссылку показывать нельзя (рисуем `<span>`).
 * Схему проверяем ДО и ПОСЛЕ `wrapUrl`: он может и дописать схему, и подменить url.
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
