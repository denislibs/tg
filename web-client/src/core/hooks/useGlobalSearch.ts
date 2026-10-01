// Шов «колонка ↔ владелец глобального поиска» (задача 13 плана
// `docs/superpowers/plans/2026-09-07-solid-wave-3-global-search.md`): роль
// `AppSidebarLeft.construct` в той части, что относится к поиску, — отдать
// владельцу (`components/sidebarLeft/globalSearch.ts`, порт `initSearch`,
// tweb `sidebarLeft/index.ts:1084-1585`) узлы статического каркаса
// (`index.html:91-102`) и снять его вместе с колонкой.
//
// Граница с React (правило `tweb-parity`): узел `#search-container` рендерит
// колонка ПОСТОЯННЫМ и пустым; его детей строит и сносит владелец. Классы
// перехода (`active/from/to/animating/backwards` на `#chatlist-container`,
// `#search-container`, `.sidebar-content`) и `is-search-active` на `.item-main`
// ставит только владелец — `className` этих узлов у колонки постоянный.
// React-состояние `searching` у колонки остаётся ОТРАЖЕНИЕМ владельца
// (`onSearchActive`), а не его источником: морф бургера, FAB, замок.
//
// Остров поднимается через `useImperativeIsland` (узел приходит чужим ref'ом —
// колонка рендерит его сама): layout-фаза, к ней ref'ы поля (`searchRef`
// `InputSearch`) и стрелки «назад» (`.sidebar-back-button` колонки) уже привязаны —
// React цепляет ref'ы и `useImperativeHandle` детей раньше эффектов родителя.
//
// ── ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ ───────────────────────────────────
//  1. `openUrl` (роль `appImManager.openUrl`, tweb `appImManager.ts:1585-1598`).
//     Владелец зовёт его только для ссылки с внутренним действием `wrapUrl`
//     (`globalSearch.ts`, `onEnter`). Исполнителя внутренних ссылок
//     (`internalLinkProcessor`, глобали `addAnchorListener`) у нас нет —
//     шапка `lib/richtext/url.ts`, реестр `KNOWN_ANCHOR_ACTIONS`. Что есть:
//     переход по `#@username[/пост]` (`applyHash`, `core/hooks/useUrlSync.ts`,
//     порт `openUsername`). Поэтому действие `im` с именем в пути (`t.me/durov`,
//     `durov.t.me`, `t.me/durov/12`) открывается им, остальные действия
//     (`joinchat`, `addstickers`, `t.me/c/…` …) — внешней вкладкой по адресу,
//     прошедшему allow-list `safeWrapUrl`.
//  2. Deep-open с префиллом (`initialQuery`, публичная страница `/?domain=…`):
//     у оригинала такого входа нет. Поиск открывается владельцем (`initSearch`
//     зовёт `onFocus` сам, :1489), значение пишется в поле объекта и уходит
//     его же `onChange` — тем путём, каким владелец пишет поле сам (:1250).
import { useRef, type RefObject } from 'react'
import GlobalSearch from '@components/sidebarLeft/globalSearch'
import type InputSearchHandle from '@shared/ui/InputSearch/inputSearchHandle'
import matchTelegramUrlHost from '@lib/richtext/matchTelegramUrlHost'
import { safeWrapUrl } from '@lib/richtext/url'
import { useImperativeIsland } from './useImperativeIsland'
import { useManagers } from './useManagers'
import { applyHash } from './useUrlSync'
import type { Managers } from '../../client/bootstrap'

type UseGlobalSearchOptions = {
  searchContainerRef: RefObject<HTMLElement | null>
  inputSearchRef: RefObject<InputSearchHandle | null>
  backBtnRef: RefObject<HTMLElement | null>
  onSearchActive: (active: boolean) => void
  initialQuery?: string
}

const USERNAME_REG_EXP = /^[a-z]\w{3,31}$/i

/** Расхождение 1 в шапке. */
export function openSearchUrl(url: string, managers: Managers) {
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
        void applyHash('#@' + username + (post ? '/' + post : ''), managers)
        return
      }
    }
  }

  window.open(wrapped.url, '_blank', 'noopener,noreferrer')
}

/** @returns ref на владельца — `closeSearch()` для `closeEverythingInside` колонки */
export function useGlobalSearch({ searchContainerRef, inputSearchRef, backBtnRef, onSearchActive, initialQuery }: UseGlobalSearchOptions) {
  const managers = useManagers()
  const ownerRef = useRef<GlobalSearch | null>(null)
  // Читаются в момент подъёма острова; колонка отдаёт стабильный сеттер.
  const onSearchActiveRef = useRef(onSearchActive)
  onSearchActiveRef.current = onSearchActive
  const initialQueryRef = useRef(initialQuery)

  useImperativeIsland((searchContainer) => {
    const inputSearch = inputSearchRef.current!
    const owner = ownerRef.current = new GlobalSearch({
      searchContainer,
      inputSearch,
      backBtn: backBtnRef.current!,
      managers,
      onSearchActive: (active) => onSearchActiveRef.current(active),
      openUrl: (url) => openSearchUrl(url, managers),
    })

    // Расхождение 2 в шапке. Значение пропа на момент монтирования колонки:
    // deep-open — событие загрузки, а не состояние.
    const query = initialQueryRef.current
    if (query) {
      owner.initSearch()
      inputSearch.value = query
      inputSearch.onChange?.(query)
    }

    return () => {
      owner.destroy()
      if (ownerRef.current === owner) ownerRef.current = null
    }
  }, [managers], { host: searchContainerRef })

  return ownerRef
}
