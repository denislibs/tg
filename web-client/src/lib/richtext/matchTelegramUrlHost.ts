// Порт tweb/src/lib/richTextProcessor/matchTelegramUrlHost.ts (fcfe06f76).
// `T_ME_PREFIXES` у оригинала живёт в `@appManagers/constants.ts:26`; у нас
// единственный читатель — этот модуль, поэтому набор лежит здесь.
const T_ME_PREFIXES = new Set(['web', 'k', 'z', 'a'])

const TELEGRAM_LINK_HOSTS = ['t.me', 'telegram.me']
export const TELESCOPE_LINK_HOST = 'telesco.pe'

/**
 * Лежит ли адрес на одном из `hosts` (или на его поддомене).
 *
 * Любое решение о хосте принимается по РАЗОБРАННОМУ адресу: проверка по сырому
 * тексту поверила бы и `t.me.evil.com` (хост ничем не заканчивается), и
 * `t.me@evil.com` (там хост — это логин), и `telesco.pe/…`, зарытому в путь чужого
 * хоста. Userinfo отвергается целиком, а не игнорируется: адресу, который прячет
 * логин, внутреннее действие ни к чему.
 *
 * Возвращает найденный хост и метки перед ним (`durov.t.me` → `durov`) либо
 * `undefined`, если адрес на другом хосте.
 */
export function matchUrlHost(url: URL | undefined, hosts: string[]) {
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return
  }

  const hostname = url.hostname.toLowerCase()
  const host = hosts.find((host) => hostname === host || hostname.endsWith('.' + host))
  if (!host) {
    return
  }

  return { host, subdomain: hostname === host ? '' : hostname.slice(0, -host.length - 1) }
}

/**
 * Отличает хост ссылки Telegram от любого другого.
 *
 * ВЕРДИКТ — ВОЗВРАЩЁННЫЙ ОБЪЕКТ, а не `prefix`. В `prefix` — username, который
 * пишет сам хост (`durov.t.me` → `durov`), и на обычной `t.me/durov` он
 * `undefined`; вызывающий, проверяющий `match?.prefix` вместо `match`, счёл бы
 * внешней каждую ссылку без поддомена.
 */
export default function matchTelegramUrlHost(url: URL | undefined): { prefix?: string } | undefined {
  const match = matchUrlHost(url, TELEGRAM_LINK_HOSTS)
  if (!match) {
    return
  }

  // `web.t.me`, `k.t.me` … называют клиент, а не пользователя
  const prefixLabels = match.subdomain ? match.subdomain.split('.') : []
  while (prefixLabels.length && T_ME_PREFIXES.has(prefixLabels[prefixLabels.length - 1])) {
    prefixLabels.pop()
  }

  const prefix = prefixLabels.join('.')
  return { prefix: prefix || undefined }
}
