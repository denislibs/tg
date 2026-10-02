// Публичные ссылки — аналог `https://t.me/...`.
//
// У tweb это адреса домена Telegram (`t.me/<username>`, `t.me/<username>/<mid>`,
// `t.me/c/<id>/<mid>`, `t.me/addstickers/<name>` …), страницы-превью которых
// рендерит t.me. У клона свой такой хост — `AppConfig.tmeOrigin`
// (VITE_TME_ORIGIN): те же страницы (вёрстка tgme_page) рендерит наш бэкенд
// (`backend/internal/adapter/delivery/http/public_page.go`), nginx отдаёт ему
// хост целиком. Пути — 1:1 с t.me, поэтому ссылку на этот хост распознаёт тот же
// разбор, что и t.me (`lib/richtext/matchTelegramUrlHost.ts`).
import { AppConfig } from '@config/app'

const tme = () => AppConfig.tmeOrigin

/** Имя хоста ссылок — для распознавания «своих» ссылок наравне с t.me. */
export function publicLinkHostname(): string {
  return new URL(tme()).hostname
}

/** `t.me/<username>[/<post>]`. */
export function publicUsernameLink(username: string, post?: number): string {
  return `${tme()}/${username}${post !== undefined ? `/${post}` : ''}`
}

/** `t.me/c/<chatId>/<post>` — пост чата без юзернейма (tweb contextMenu `getUrlToMessage`). */
export function publicPrivatePostLink(chatId: number, post: number): string {
  return `${tme()}/c/${chatId}/${post}`
}

/** tweb popups/stickers.tsx:282 — `t.me/${isEmojis ? 'addemoji' : 'addstickers'}/<short_name>`. */
export function publicStickerSetLink(shortName: string, isEmojis: boolean): string {
  return `${tme()}/${isEmojis ? 'addemoji' : 'addstickers'}/${shortName}`
}

/** Голый текст `t.me/<путь>` → тот же путь на нашем хосте ссылок. */
export function publicLinkFromTelegramPath(path: string): string {
  return `${tme()}/${path}`
}
