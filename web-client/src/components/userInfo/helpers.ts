// userInfo/helpers.ts
// Чистые хелперы и константы панели профиля (UserInfoPanel): склонения счётчиков
// подзаголовков, подпись активной вкладки в залитой шапке, геометрия шапки и
// порог «доехали до шаред-медиа».
import type AppSearchSuper from '../appSearchSuper'
import type { SearchSuperMediaType } from '../appSearchSuper'

// склонение «N единиц» (счётчики подзаголовков)
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many
  return `${n} ${word}`
}

// «N участник(а/ов)» — подзаголовок профиля группы
export function membersLabel(n: number, isChannel: boolean): string {
  if (isChannel) return `${n} подписчиков`
  return plural(n, 'участник', 'участника', 'участников')
}

// «N чат(а/ов)» — подзаголовок «Избранного» (число сохранённых диалогов)
export const chatsLabel = (n: number) => plural(n, 'чат', 'чата', 'чатов')

// подпись счётчика активной вкладки в залитой шапке (tweb sharedMedia.tsx:
// 458-471 — пары type→LangPackKey: SavedDialogsTabCount/Members/MediaFiles/
// StarGiftsCount/Files/Links/MusicFiles/Voice). Ключ — тип вкладки класса
// `AppSearchSuper` (`SearchSuperMediaType`), число приходит из `onLengthChange`.
export function countLabel(tab: SearchSuperMediaType, n: number, isChannel: boolean): string {
  switch (tab) {
    case 'members': return membersLabel(n, isChannel)
    case 'savedDialogs': return chatsLabel(n)
    case 'gifts': return plural(n, 'подарок', 'подарка', 'подарков')
    case 'media': return plural(n, 'медиафайл', 'медиафайла', 'медиафайлов')
    case 'files': return plural(n, 'файл', 'файла', 'файлов')
    case 'links': return plural(n, 'ссылка', 'ссылки', 'ссылок')
    case 'music': return plural(n, 'аудиофайл', 'аудиофайла', 'аудиофайлов')
    case 'voice': return plural(n, 'голосовое сообщение', 'голосовых сообщения', 'голосовых сообщений')
    default: return String(n)
  }
}

// высота шапки панели — порог header-filled (tweb 3.5rem)
export const HEADER_H = 56
/** tweb sharedMedia.tsx:481-483 — ADDITIONAL_OFFSET/BODY_PADDING порога header-filled */
export const ADDITIONAL_OFFSET = 16
export const BODY_PADDING = 16

/**
 * «Доехали до шаред-медиа?» — порт tweb `sharedMedia.tsx:487-492` (тело
 * `scrollable.onAdditionalScroll`): меряется ряд вкладок класса, а при
 * единственной вкладке (`is-single` — ряд схлопнут в ноль, `_searchSuper.scss:
 * 27-34`) — сам контейнер подсистемы. Узел без ширины (панель скрыта) — `undefined`:
 * оригинал в этом случае выходит, не меняя режим. Чистая функция, потому что
 * сам обработчик живёт в нерендерибельной панели (`UserInfoPanel.tsx`), а
 * порог обязан быть проверен (`helpers.test.ts`).
 */
export function isSharedMediaReached(
  searchSuper: Pick<AppSearchSuper, 'navScrollableContainer' | 'container' | 'nav'>,
): boolean | undefined {
  const isSingle = searchSuper.navScrollableContainer.classList.contains('is-single')
  const rect = (isSingle ? searchSuper.container : searchSuper.nav).getBoundingClientRect()
  if (!rect.width) return undefined
  const top = rect.top - 1
  return top <= HEADER_H + ADDITIONAL_OFFSET + BODY_PADDING
}

/**
 * Гейт «нет фото → держать свёрнутым» шапки-аватаров (tweb
 * `peerProfileAvatars.ts:341-344`, createEffect `if(this.hasNoPhoto &&
 * !folded()) fold()`). Вынесена ЧИСТОЙ функцией — эффект в `UserInfoPanel.tsx`
 * (`folded → avatars.setCollapsed(folded)`) сам не протестировать напрямую
 * (панель нерендерибельна в vitest, `UserInfoPanel.shell.test.ts` — пин
 * текстом), а логику гейта — можно и нужно (норма проводки задачи 5:
 * «Гейт обязателен к покрытию тестом»). `hasPhoto` — публичный геттер класса
 * `PeerProfileAvatars` (зеркало `currentHasPhoto`), `folded` — из
 * `useCollapsable()`.
 */
export function shouldForceFold(hasPhoto: boolean, folded: boolean): boolean {
  return !hasPhoto && !folded
}
