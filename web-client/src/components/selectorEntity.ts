// Порт tweb `src/components/selectorSearch.ts:321-404` — `SelectorSearch.renderEntity`
// (он же `AppSelectPeers.renderEntity`, appSelectPeers.ts:1201): чип
// `div.selector-user` — пир (аватар + имя) или произвольный ключ с иконкой.
//
// Потребитель — чипы пира и даты глобального поиска (tweb
// `sidebarLeft/index.ts:1257-1266`: `avatarSize: 30`, `fallbackIcon:
// 'calendarfilter'`, `primary: true`); helper, перенос чипа в поле и снятие —
// у владельца поиска. React-копия чипа у селектора пиров
// (`shared/ui/PeerSelector/PeerSelector.tsx`, `SelectorUserChip`) остаётся
// своему экрану.
//
// Стили — портированные партиалы: `styles/tweb/_selector.scss` (сам чип),
// `_leftSidebar.scss:332-391` (чип в поле поиска и в `.search-helper`),
// `_avatar.scss` (`avatar-icon-calendarfilter`; у `avatar-icon-saved_filled`
// своего правила нет — tweb 2197fee9c переименовал иконку, не тронув scss).
//
// ── Расхождения с оригиналом ───────────────────────────────────────────────
// 1. `managers` — опцией: аватар и имя объявляют пробел зеркала карточек
//    владельцу (`managers.peers.fillMirror`, `components/avatar.ts`,
//    `chat/peerTitle.ts`); у оригинала менеджеры — синглтон.
// 2. Ключ темы `<peerId>_<threadId>` (:360-367) не разбирается: ни аватар, ни
//    имя у нас не умеют `threadId` (топики форума — шапка `avatar.ts`), а
//    строковый ключ с `_` дальше идёт как не-пир — ровно как ключ даты
//    `date_<min>_<max>` у оригинала.
// 3. `PeerTitle` у нас синхронный: `update()` промиса не отдаёт, и в `promises`
//    уходит только `avatar.readyThumbPromise` (:380).
// 4. Аватар рисуется при создании (`avatarNew({peerId})`), а не отдельным
//    `avatarEl.render({peerId})` (:375-378): так устроен наш `avatarNew`.
// 5. Заголовок-узел кладётся одним `replaceContent` (:396); следующий за ним у
//    оригинала `t.append(title)` переносит тот же узел на то же место и ничего
//    не делает.
// 6. Заголовок-строка кладётся ТЕКСТОМ, а не `innerHTML` (:392-393): разметки
//    в строках потребителей нет (у чипов поиска это заголовки `fillTipDates`
//    из `Intl` и чисел), а HTML-вход из строки — лишняя дыра на будущее.
import Icon from '@components/icon'
import { avatarNew, type AvatarManagers } from '@components/avatar'
import PeerTitle, { type PeerTitleManagers } from '@components/chat/peerTitle'
import replaceContent from '@helpers/dom/replaceContent'
import type { Middleware } from '@helpers/middleware'
import { isPeerId } from '@core/peers/peerId'
import type { IconName } from '@core/tgico-icons'

export type SelectorEntityManagers = AvatarManagers & PeerTitleManagers

export function renderEntity({
  key,
  middleware,
  managers,
  title,
  avatarSize,
  fallbackIcon,
  meAsSaved = true,
  primary,
}: {
  key: PeerId | string
  middleware: Middleware
  managers: SelectorEntityManagers
  title?: string | HTMLElement
  avatarSize: number
  fallbackIcon?: IconName
  meAsSaved?: boolean
  primary?: boolean
}) {
  const div = document.createElement('div')
  div.classList.add('selector-user')
  const middlewareHelper = div.middlewareHelper = middleware.create()

  if (primary) {
    div.classList.add('selector-user-primary')
  }

  const keyStr = '' + key
  // tweb `key.isPeerId()` (peerIdPolyfill.ts:16-22, :34-36): число — всегда
  // пир, строка — если это знаковое целое.
  const peerId = typeof key === 'number' || isPeerId(key) ? +key : undefined

  const avatarContainer = document.createElement('div')
  avatarContainer.classList.add('selector-user-avatar-container')
  const avatarClose = document.createElement('div')
  avatarClose.classList.add('selector-user-avatar-close')
  avatarClose.append(Icon('close'))
  const avatarEl = avatarNew({
    middleware: middlewareHelper.get(),
    size: avatarSize,
    peerId,
    isDialog: meAsSaved,
    managers,
  })
  avatarEl.node.classList.add('selector-user-avatar')
  avatarContainer.append(avatarEl.node, avatarClose)

  div.dataset.key = keyStr
  const promises: Promise<unknown>[] = []
  if (peerId !== undefined) {
    if (title === undefined) {
      title = new PeerTitle({
        peerId,
        dialog: meAsSaved,
        middleware: middlewareHelper.get(),
        managers,
      }).element
    }

    promises.push(avatarEl.readyThumbPromise)
  } else if (fallbackIcon) {
    avatarEl.setIcon(fallbackIcon)
  }

  if (title) {
    const t = document.createElement('div')
    t.classList.add('selector-user-title')
    // Строка — текстом, узел — узлом (расхождение 6).
    replaceContent(t, title)
    div.append(t)
  }

  div.insertAdjacentElement('afterbegin', avatarContainer)

  return { element: div, avatar: avatarEl, promises }
}
