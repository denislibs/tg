// `openUrl` владельца глобального поиска (`components/sidebarLeft/globalSearch.ts`,
// порт tweb `initSearch`) — роль `appImManager.openUrl` (tweb
// `appImManager.ts:1585-1598`); владельца заводит класс колонки
// (`AppSidebarLeft.construct`, `components/sidebarLeft/index.ts`).
//
// ── ОБЪЯВЛЕННОЕ РАСХОЖДЕНИЕ С ОРИГИНАЛОМ ────────────────────────────────────
//  `openUrl` (роль `appImManager.openUrl`, tweb `appImManager.ts:1585-1598`).
//     Владелец зовёт его только для ссылки с внутренним действием `wrapUrl`
//     (`globalSearch.ts`, `onEnter`). Исполнителя внутренних ссылок
//     (`internalLinkProcessor`, глобали `addAnchorListener`) у нас нет —
//     шапка `lib/richtext/url.ts`, реестр `KNOWN_ANCHOR_ACTIONS`. Что есть:
//     `appImManager.openUsername` (tweb `appImManager.ts:2165`). Поэтому действие `im` с именем в пути (`t.me/durov`,
//     `durov.t.me`, `t.me/durov/12`) открывается им, остальные действия
//     (`joinchat`, `addstickers`, `t.me/c/…` …) — внешней вкладкой по адресу,
//     прошедшему allow-list `safeWrapUrl`.
import matchTelegramUrlHost from '@lib/richtext/matchTelegramUrlHost'
import { safeWrapUrl } from '@lib/richtext/url'
import appImManager from '@lib/appImManager'

const USERNAME_REG_EXP = /^[a-z]\w{3,31}$/i

/** Расхождение в шапке. */
export function openSearchUrl(url: string) {
  const wrapped = safeWrapUrl(url)
  if (!wrapped) return

  if (wrapped.action === 'im') {
    let parsed: URL | undefined
    try {
      parsed = new URL(wrapped.url)
    } catch { /* ниже — внешней вкладкой */ }
    const match = matchTelegramUrlHost(parsed)
    if (parsed && match) {
      const path = parsed.pathname.split('/').filter(Boolean)
      if (match.prefix) path.unshift(match.prefix)
      const [username, post] = path
      if (USERNAME_REG_EXP.test(username) && (post === undefined || /^\d+$/.test(post)) && path.length <= 2) {
        void appImManager.openUsername({ userName: username, lastMsgId: post ? +post : undefined })
        return
      }
    }
  }

  window.open(wrapped.url, '_blank', 'noopener,noreferrer')
}
