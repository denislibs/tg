/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/usernameRow.tsx:1-75` (812502980) — строка имени
 * или ссылки на `Row`: круглая плашка-иконка `usernames-username-icon` с
 * градиентом (`avatar-gradient`, цвет — `data-color`), заголовок (у ссылки —
 * жирный), подпись `usernames-username-status`. Стили — `styles/tweb/_usernames.scss`.
 * Первый потребитель — строки ссылок вкладки «Пригласительные ссылки»
 * (`sidebarRight/tabs/chatInviteLinks.solid.tsx`, задача 0б-3 волны 7).
 *
 *   a.row.usernames-username[.is-link][.is-paid] (+ row-clickable)
 *     div.row-title.text-bold + div.row-subtitle.usernames-username-status
 *     div.row-media.row-media-abitbigger.usernames-username-icon.avatar-gradient[data-color] > span.tgico
 *
 * Расхождения с оригиналом:
 *  1. Глобальный тип `Icon` → `IconName` (`@core/tgico-icons`), как в `rowTsx.solid.tsx`.
 *  2. Пропы без потребителя не перенесены: сортировка и «активное» имя
 *     (`ref`, `active`, `sortable`, `sortingEnabled`, `dragging`,
 *     `sortHandlePointerDown`, `style`, `:8-18`, `:34-39`, `:65-72`) — у
 *     оригинала их зовёт только `UsernamesSection` (коллекции имён у нас нет,
 *     О-17 волны 7); `clickable` (`:14`, всегда `true`), `titleRight`/
 *     `subtitleRight` (`:21-22` — цена и «в месяц» платной ссылки, О-123).
 */
import type { JSX, Ref } from 'solid-js'
import { IconTsx } from '@components/iconTsx.solid'
import Row from '@components/rowTsx.solid'
import type { IconName } from '@core/tgico-icons'

const CLASS_NAME = 'usernames'

export default function UsernameRow(props: {
  isLink?: boolean,
  icon?: IconName,
  color?: string,
  title?: JSX.Element,
  subtitle?: JSX.Element,
  titleRef?: Ref<HTMLDivElement>,
  subtitleRef?: Ref<HTMLDivElement>,
  mediaRef?: Ref<HTMLDivElement>
}) {
  const icon = (): IconName => props.icon || 'limit_link'
  return (
    <Row
      class={`${CLASS_NAME}-username`}
      classList={{
        'is-link': !!props.isLink,
        'is-paid': !!props.isLink && icon() === 'link_paid',
      }}
      clickable
    >
      <Row.Title
        ref={props.titleRef}
        class={props.isLink ? 'text-bold' : undefined}
      >
        {props.title}
      </Row.Title>
      <Row.Subtitle
        ref={props.subtitleRef}
        class={`${CLASS_NAME}-username-status`}
      >
        {props.subtitle}
      </Row.Subtitle>
      <Row.Media
        ref={props.mediaRef}
        size="abitbigger"
        class={`${CLASS_NAME}-username-icon avatar-gradient`}
        data-color={props.color}
      >
        <IconTsx icon={icon()} />
      </Row.Media>
    </Row>
  )
}
