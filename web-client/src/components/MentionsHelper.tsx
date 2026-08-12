// Автокомплит @упоминаний над композером — порт tweb `chat/mentionsHelper.ts`
// поверх `chat/autocompletePeerHelper.ts`. Дерево 1:1
// (autocompletePeerHelper.ts:31-44 + :80-125, Scrollable оборачивает содержимое
// контейнера — scrollable.ts:104-110):
//
//   div.autocomplete-helper.z-depth-1.autocomplete-peer-helper.mentions-helper
//     div.scrollable.scrollable-y
//       div.autocomplete-peer-helper-list.mentions-helper-list.navigable-list
//         div.autocomplete-peer-helper-list-element.mentions-helper-list-element[data-peer-id][.active]
//           div.avatar…(-list-element-avatar)
//           div.…-list-element-name
//           div.…-list-element-description
//
// Стили — глобальные партиалы `_autocompleteHelper.scss` + `_autocompletePeerHelper.scss`
// (своего CSS-модуля у хелпера больше нет).
import { useEffect, useRef } from 'react'
import Avatar from '../shared/ui/Avatar'
import classNames from '../shared/lib/classNames'
import { useAvatarSrc } from './useAvatarSrc'
import { gradientFor } from '../core/dialogToChat'
import type { Peer } from '../core/managers/peersManager'

// autocompletePeerHelper.ts:11-12 — базовые имена классов строки списка.
const BASE = 'autocomplete-peer-helper-list-element'
// mentionsHelper.ts:18 передаёт className 'mentions-helper', из него
// autocompletePeerHelper.ts:88 собирает второй набор классов строки.
const OWN = 'mentions-helper-list-element'

// Показ/скрытие в tweb делает `AutocompleteHelper.toggle` через
// `SetTransition({className: 'is-visible', forwards: !hide})`
// (autocompleteHelper.ts:179-188); `forwards` вешает `singleTransition.ts:70`.
//
// отступление от tweb: монтированием управляет родитель (Composer), поэтому
// обратного прохода (fade-out перед скрытием) у нас нет.
const ROOT_CLASS = 'autocomplete-helper z-depth-1 autocomplete-peer-helper mentions-helper is-visible forwards'

function Row({ peer, active, onPick }: { peer: Peer; active: boolean; onPick: (p: Peer) => void }) {
  const avatarSrc = useAvatarSrc(peer.avatarUrl)
  const name = peer.displayName || peer.username || `#${peer.id}`
  return (
    <div
      className={classNames(BASE, OWN, active ? 'active' : '')}
      data-peer-id={peer.id}
      onClick={() => onPick(peer)}
    >
      {/* autocompletePeerHelper.ts:94-100 — avatarNew({size: 30}) */}
      <Avatar
        className={`${BASE}-avatar ${OWN}-avatar`}
        background={gradientFor(peer.id)}
        src={avatarSrc}
        preview={peer.avatarPreview}
        text={name.charAt(0).toUpperCase()}
        size={30}
      />
      <div className={`${BASE}-name ${OWN}-name`}>{name}</div>
      {peer.username && <div className={`${BASE}-description ${OWN}-description`}>@{peer.username}</div>}
    </div>
  )
}

export default function MentionsHelper({
  peers,
  activeIdx,
  onPick,
}: {
  peers: Peer[]
  activeIdx: number
  onPick: (p: Peer) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (activeIdx < 0) return
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIdx])
  return (
    <div
      className={ROOT_CLASS}
      // отступление от tweb: гасим mousedown, иначе клик уводит каретку из
      // contenteditable-редактора композера.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="scrollable scrollable-y">
        {/* `navigable-list` вешает attachListNavigation.ts:131, активную строку
            помечает `active` (attachListNavigation.ts:9). */}
        <div ref={listRef} className="autocomplete-peer-helper-list mentions-helper-list navigable-list">
          {peers.map((p, i) => (
            <Row key={p.id} peer={p} active={i === activeIdx} onPick={onPick} />
          ))}
        </div>
      </div>
    </div>
  )
}
