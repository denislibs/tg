// Содержимое поисковой карточки шапки чата (tweb topbarSearch): строка ввода с
// аватаром + jump-to-date, чипы фильтров (от кого / тип / реакция) с выпадающими
// меню, и растущий список результатов. Презентационно: вся логика — в
// useChatHeaderSearch, сюда приходит одним объектом `search`. Motion-обёртка и
// ключи AnimatePresence остаются в ChatHeader (чтобы exit-анимация не сломалась).
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Text from '../../shared/ui/Text'
import IconButton from '../../shared/ui/IconButton'
import Avatar from '../../shared/ui/Avatar'
import classNames from '../../shared/lib/classNames'
import TgIcon, { type IconName } from '../TgIcon'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import { useManagers } from '../../core/hooks/useManagers'
import { useT } from '../../i18n'
import { gradientFor } from '../../core/dialogToChat'
import { EASE, DUR } from '../../motion'
import { MEDIA_TYPES, REACTION_SET, type SearchResultRow } from './chatSearchMeta'
import type { ChatHeaderSearch } from '../../core/hooks/useChatHeaderSearch'
import type { Chat } from '../../data'
import s from './ChatHeader.module.scss'

// Чип фильтра поиска (tweb topbarSearch: «от кого»/«тип»/«реакция»). Активный —
// подсвечен, с × для сброса.
function FilterChip({ active, icon, label, onClick, onClear }: {
  active: boolean
  icon?: IconName
  label: string
  onClick: (rect: DOMRect) => void
  onClear: () => void
}) {
  return (
    <button
      type="button"
      className={classNames(s.chip, active ? s.chipActive : '')}
      onClick={(e) => (active ? onClear() : onClick(e.currentTarget.getBoundingClientRect()))}
    >
      {icon && <TgIcon name={icon} size={16} />}
      <span className={s.chipLabel}>{label}</span>
      {active && <TgIcon name="close" size={14} />}
    </button>
  )
}

// Split a preview string into runs, marking the parts that match the query so the
// result row can bold them (tweb shows the matched word dark, the rest grey).
function splitMatch(text: string, q: string): { t: string; m: boolean }[] {
  const query = q.trim()
  if (!query) return [{ t: text, m: false }]
  const lower = text.toLowerCase()
  const ql = query.toLowerCase()
  const out: { t: string; m: boolean }[] = []
  let i = 0
  while (i < text.length) {
    const idx = lower.indexOf(ql, i)
    if (idx < 0) { out.push({ t: text.slice(i), m: false }); break }
    if (idx > i) out.push({ t: text.slice(i, idx), m: false })
    out.push({ t: text.slice(idx, idx + query.length), m: true })
    i = idx + query.length
  }
  return out
}

// Preview line of a search result: text hits show the matched message text (with
// the query bolded); media hits show a type icon + the file name (fetched) or a
// type label — e.g. 🎵 song.mp3, 📄 report.pdf, 🖼 Фото.
function ResultPreview({ row, query }: { row: SearchResultRow; query: string }) {
  const managers = useManagers()
  const { text, mediaId, mediaType } = row
  const isMedia = !text.trim() && mediaId != null
  // Only audio/document carry a meaningful file name worth fetching; the rest use
  // a static type label.
  const wantsName = isMedia && (mediaType === 'audio' || mediaType === 'document')
  const [meta, setMeta] = useState<{ fileName: string; mime: string } | null>(null)
  useEffect(() => {
    if (!wantsName || mediaId == null) return
    let alive = true
    void managers.media.meta(mediaId).then((m) => { if (alive) setMeta({ fileName: m.fileName || '', mime: m.mime || '' }) })
    return () => { alive = false }
  }, [wantsName, mediaId, managers])
  const fileName = meta?.fileName || ''

  if (!isMedia) {
    return (
      <>
        {splitMatch(text, query).map((p, j) => (
          <span key={j} className={p.m ? s.match : undefined}>{p.t}</span>
        ))}
      </>
    )
  }

  const byType: Record<string, { icon: IconName; label: string }> = {
    audio: { icon: 'music', label: fileName || 'Аудио' },
    document: { icon: 'document', label: fileName || 'Файл' },
    photo: { icon: 'image', label: 'Фото' },
    video: { icon: 'videocamera_filled', label: 'Видео' },
    roundVideo: { icon: 'videocamera_filled', label: 'Видеосообщение' },
    voice: { icon: 'microphone_filled', label: 'Голосовое сообщение' },
  }
  // The message type may be "document" while the file is actually audio/video/an
  // image (sent as a file) — the mime is the source of truth for the icon.
  const mime = meta?.mime ?? ''
  const kind = mime.startsWith('audio/') ? 'audio'
    : mime.startsWith('video/') ? 'video'
    : mime.startsWith('image/') ? 'photo'
    : (mediaType ?? '')
  const { icon, label } = byType[kind] ?? { icon: 'document' as IconName, label: fileName || 'Файл' }
  return (
    <span className={s.mediaPreview}>
      <TgIcon name={icon} size={16} color="var(--tg-textFaint)" style={{ flexShrink: 0 }} />
      <span className={s.mediaLabel}>
        {splitMatch(label, query).map((p, j) => (
          <span key={j} className={p.m ? s.match : undefined}>{p.t}</span>
        ))}
      </span>
    </span>
  )
}

export default function ChatSearchCard({ chat, avatarSrc, search }: {
  chat: Chat
  avatarSrc?: string
  search: ChatHeaderSearch
}) {
  const t = useT()
  const {
    query, onSearchChange, onSearchClear, onSearchClose,
    dateInputRef, openDatePicker, onDatePick,
    isGroup, filters, setFilters, meId,
    filterMenu, setFilterMenu, openFilterMenu,
    members, memberPeers, senderName, typeLabel,
    hasFilter, searchResults, activeIdx, setActiveIdx, onPickResult,
  } = search

  return (
    <>
      {/* строка tweb topbar-search: аватар чата + серое поле input-search
          (лупа + инпут + × внутри) + фильтры «от отправителя»/«по дате» */}
      <div className={s.searchInputRow}>
        <Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} src={avatarSrc} size="sm" />
        <div className={s.searchField}>
          <TgIcon name="search" size={22} color="var(--tg-textFaint)" />
          <input
            className={s.searchInput}
            autoFocus
            value={query}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onSearchClose() } }}
            placeholder={t('Search')}
          />
          <IconButton size="small" onClick={() => { if (query) onSearchClear(); else onSearchClose() }} color="var(--tg-textFaint)">
            <TgIcon name="close" size={20} />
          </IconButton>
        </div>
        {/* jump-to-date: кнопка-календарь открывает нативный date-picker */}
        <IconButton color="var(--tg-textSecondary)" onClick={openDatePicker} title={t('Jump to Date')}>
          <TgIcon name="calendar" />
        </IconButton>
        <input ref={dateInputRef} type="date" className={s.dateInput} onChange={(e) => onDatePick(e.target.value)} />
      </div>

      {/* чипы фильтров tweb topbarSearch: «от кого» (в группах) / «тип» / «реакция» */}
      <div className={s.filters}>
        {isGroup && (
          <FilterChip
            active={filters.senderId != null}
            icon="newprivate"
            label={senderName}
            onClick={openFilterMenu('sender')}
            onClear={() => setFilters({ ...filters, senderId: undefined })}
          />
        )}
        <FilterChip
          active={filters.mediaType != null}
          icon="document"
          label={typeLabel}
          onClick={openFilterMenu('type')}
          onClear={() => setFilters({ ...filters, mediaType: undefined })}
        />
        <FilterChip
          active={filters.reaction != null}
          label={filters.reaction ?? t('Search by reaction')}
          onClick={openFilterMenu('reaction')}
          onClear={() => setFilters({ ...filters, reaction: undefined })}
        />
      </div>

      {/* results grow out of the input (height animates as you type) */}
      <AnimatePresence initial={false}>
        {(query.trim() || hasFilter) && (
          <motion.div
            key="results"
            className={s.resultsWrap}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DUR.in, ease: EASE }}
          >
            <div className={s.divider} />
            <div className={s.resultsScroll}>
              {searchResults.length === 0 ? (
                <Text size={15} color="var(--tg-textSecondary)" className={s.noResults}>
                  {query.trim() ? (
                    <>
                      {t('There were no results for')}{' '}
                      <span className={s.bold}>“{query}”</span>
                      {t('. Try a new search.')}
                    </>
                  ) : (
                    t('No results')
                  )}
                </Text>
              ) : (
                searchResults.map((r, i) => (
                  <div
                    key={r.id}
                    className={s.resultRow}
                    data-active={i === activeIdx || undefined}
                    onClick={() => { setActiveIdx(i); onPickResult(r.seq) }}
                  >
                    <Avatar background={r.avatar} text={r.sender.charAt(0)} size="sm" />
                    <div className={s.resultBody}>
                      <div className={s.resultTop}>
                        <Text noWrap size={14.5} weight={600} color="var(--tg-textPrimary)" className={s.resultName}>{r.sender}</Text>
                        <Text size={12} color="var(--tg-textFaint)" className={s.resultTime}>{r.time}</Text>
                      </div>
                      <div className={s.resultPreview}>
                        <ResultPreview row={r} query={query} />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* выпадающее меню активного фильтра (переиспользуем shared Menu) */}
      <Menu open={filterMenu != null} onClose={() => setFilterMenu(null)} style={filterMenu?.style} className={s.filterMenu}>
        {filterMenu?.kind === 'sender' && members.map((m) => {
          const name = m.userId === meId ? 'Вы' : memberPeers.get(m.userId)?.displayName || String(m.userId)
          return (
            <MenuItem
              key={m.userId}
              icon={<Avatar background={gradientFor(m.userId)} text={name.charAt(0)} size={24} />}
              label={name}
              onClick={() => { setFilters({ ...filters, senderId: m.userId }); setFilterMenu(null) }}
            />
          )
        })}
        {filterMenu?.kind === 'type' && MEDIA_TYPES.map((mt) => (
          <MenuItem
            key={mt.value}
            icon={<TgIcon name={mt.icon} size={20} />}
            label={t(mt.labelKey)}
            onClick={() => { setFilters({ ...filters, mediaType: mt.value }); setFilterMenu(null) }}
          />
        ))}
        {filterMenu?.kind === 'reaction' && (
          <div className={s.reactionGrid}>
            {REACTION_SET.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={s.reactionBtn}
                onClick={() => { setFilters({ ...filters, reaction: emoji }); setFilterMenu(null) }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </Menu>
    </>
  )
}
