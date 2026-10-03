/** @jsxImportSource solid-js */
/**
 * Порт tweb `components/sidebarLeft/foldersSidebarContent/folderItem.tsx`
 * (812502980) — строка вертикальной колонки папок: иконка (по типу или эмодзи из
 * названия), подпись, бейдж непрочитанного.
 *
 * Расхождения:
 *  1. Подпись папки — `title` текстом, а не `wrapFolderTitle(title, middleware,
 *     true)` с рендерером кастомных эмодзи и его цветом (`:37-52`): название у нас
 *     строка без сущностей (шапка `types.ts`, как `foldersTabs.solid.tsx`
 *     расхождение 1). `useHotReloadGuard` не нужен: зависимости импортируются.
 *  2. `FolderAnimatedIcon` — без `docId`/`managers`/`color`/`size` (его шапка).
 */
import { createComputed, createMemo, createSignal, Show } from 'solid-js'
import buttonKeyDown from '@helpers/solid/buttonKeyDown'
import Badge from '@components/badge.solid'
import { IconTsx } from '@components/iconTsx.solid'
import ripple from '@components/ripple'
import FolderAnimatedIcon from '@components/sidebarLeft/foldersSidebarContent/folderAnimatedIcon.solid'
import type { FolderItemPayload } from '@components/sidebarLeft/foldersSidebarContent/types'

// tweb `keepMe(ripple)` — держит импорт директивы `use:ripple`
void ripple

type FolderItemProps = FolderItemPayload & {
  ref?: (el: HTMLDivElement) => void,
  class?: string,
  selected?: boolean,
  onClick?: () => void,
  'aria-label'?: string
}

export default function FolderItem(props: FolderItemProps) {
  const [failedToFetchIconDoc, setFailedToFetchIconDoc] = createSignal(false)

  const hasNotifications = () => !!props.notifications?.count

  const hasCustomIcon = () => props.emojiIcon
  const showCustomIcon = () => hasCustomIcon() && !failedToFetchIconDoc()

  const title = createMemo(() => {
    if(props.name) return props.name
    if(!props.title) return

    return props.title // расхождение 1
  })

  createComputed(() => {
    if(hasCustomIcon()) setFailedToFetchIconDoc(false)
  })

  return (
    <div
      use:ripple
      ref={(el) => {
        props.ref?.(el)
      }}
      class="folders-sidebar__folder-item"
      classList={{
        [props.class ?? '']: !!props.class,
        'folders-sidebar__folder-item--selected': props.selected,
      }}
      role="button"
      tabindex="0"
      aria-label={props['aria-label']}
      aria-pressed={props.selected ? 'true' : undefined}
      {...(props.id !== undefined ?
        { 'data-filter-id': props.id } :
        {}
      )}
      onClick={props.onClick}
      onKeyDown={buttonKeyDown}
    >
      <Show
        when={showCustomIcon()}
        fallback={<IconTsx icon={props.icon} class="folders-sidebar__folder-item-icon" />}
      >
        <FolderAnimatedIcon
          emoji={props.emojiIcon}
          class="folders-sidebar__folder-item-animated-icon"
          onFail={() => setFailedToFetchIconDoc(true)}
        />
      </Show>
      <Show when={title()}>
        <div class="folders-sidebar__folder-item-name">{title()}</div>
      </Show>
      <Show when={hasNotifications()}>
        <Badge
          class="folders-sidebar__folder-item-badge"
          tag="div"
          color={props.notifications!.muted/*  && !props.selected */ ? 'gray' : 'primary'}
          size={18}
        >
          {'' + props.notifications!.count}
        </Badge>
      </Show>
    </div>
  )
}
