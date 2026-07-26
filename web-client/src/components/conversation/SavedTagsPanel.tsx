// Панель тегов-реакций «Избранного» (Telegram saved reaction tags) над лентой
// самочата: чипы «реакция + имя + счётчик» для фильтрации истории по тегу.
// 1:1 по смыслу с tweb topbarSearch savedReaction / SavedTagFilterByTag. Клик по
// чипу — фильтр по тегу; кнопка-карандаш — inline-переименование (renameSavedTag).
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import Emoji from '../emoji/Emoji'
import TgIcon from '../TgIcon'
import { useManagers } from '../../core/hooks/useManagers'
import { uiEvents } from '../../core/hooks/uiEvents'
import { useT } from '../../i18n'
import type { SavedTag } from '../../core/managers/messagesManager'
import s from './SavedTagsPanel.module.scss'

function SavedTagsPanel({ activeTag, onFilter }: {
  activeTag: string | null
  onFilter: (reaction: string | null) => void
}) {
  const managers = useManagers()
  const t = useT()
  const [tags, setTags] = useState<SavedTag[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(() => {
    managers.messages.getSavedTags().then(setTags).catch(() => setTags([]))
  }, [managers])

  // Первичная загрузка + перезагрузка после любой мутации тега/реакции в самочате
  // (пометка/снятие/переименование эмитят 'ui:savedTagsChanged').
  useEffect(() => {
    reload()
    const off = uiEvents.on('ui:savedTagsChanged', reload)
    return off
  }, [reload])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startRename = (tag: SavedTag) => {
    setEditing(tag.reaction)
    setDraft(tag.title)
  }
  const commitRename = () => {
    if (editing == null) return
    const reaction = editing
    const title = draft.trim().slice(0, 12)
    setEditing(null)
    void managers.messages.renameSavedTag(reaction, title).then(reload)
  }

  if (tags.length === 0) return null

  return (
    <div className={s.panel} role="toolbar" aria-label={t('Tags')}>
      <div className={s.scroll}>
        {tags.map((tag) => {
          const active = activeTag === tag.reaction
          if (editing === tag.reaction) {
            return (
              <div key={tag.reaction} className={s.chipEditing}>
                <span className={s.emoji}><Emoji e={tag.reaction} size={20} /></span>
                <input
                  ref={inputRef}
                  className={s.input}
                  value={draft}
                  maxLength={12}
                  placeholder={t('Add a tag name')}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    else if (e.key === 'Escape') setEditing(null)
                  }}
                  onBlur={commitRename}
                />
              </div>
            )
          }
          return (
            <div
              key={tag.reaction}
              className={active ? `${s.chip} ${s.chipActive}` : s.chip}
              onClick={() => onFilter(active ? null : tag.reaction)}
              title={t('Filter by tag')}
            >
              <span className={s.emoji}><Emoji e={tag.reaction} size={20} /></span>
              {tag.title && <span className={s.title}>{tag.title}</span>}
              <span className={s.count}>{tag.count}</span>
              <button
                type="button"
                className={s.edit}
                title={t('Rename tag')}
                onClick={(e) => { e.stopPropagation(); startRename(tag) }}
              >
                <TgIcon name="edit" size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default memo(SavedTagsPanel)
