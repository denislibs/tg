import { useEffect, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import Text from '../shared/ui/Text'
import { useChatsStore } from '../stores/chatsStore'
import { useManagers } from '../core/hooks/useManagers'
import { gradientFor } from '../core/dialogToChat'
import { getUserTitle } from '../core/peers/getPeerTitle'
import classNames from '../shared/lib/classNames'
import Emoji from './emoji/Emoji'
import s from './AddStorySheet.module.scss'
import type { StoryPrivacy, MediaArea } from '../core/managers/storiesManager'

export type { StoryPrivacy }

// Лимит длины подписи истории — совпадает с бэком (maxCaptionRunes).
const MAX_CAPTION_LEN = 2048

// 4d: набор эмодзи для reaction-стикера (media area). Минимальный редактор —
// одна reaction-область в нижней центральной части (без свободного перетаскивания).
const REACTION_STICKERS = ['❤', '👍', '🔥', '🥰', '👏', '😁', '🎉']

const PRIVACY_OPTIONS: { key: StoryPrivacy; label: string }[] = [
  { key: 'everyone', label: 'Все' },
  { key: 'contacts', label: 'Контакты' },
  { key: 'close', label: 'Близкие' },
  { key: 'selected', label: 'Выбранные' },
]

// Период жизни истории в секундах (tweb story period): 6/12/24/48 часов.
const PERIOD_OPTIONS: { key: number; label: string }[] = [
  { key: 21600, label: '6ч' },
  { key: 43200, label: '12ч' },
  { key: 86400, label: '24ч' },
  { key: 172800, label: '48ч' },
]

/**
 * Caption + privacy sheet shown after a story media file is picked + uploaded.
 * Reuses the app's slide-in panel pattern (mirrors NewGroupFlow / UserInfoPanel's
 * RightsEditor): an absolute-positioned motion panel over the sidebar with a
 * back header, a rounded card body and a confirm FAB.
 */
export default function AddStorySheet({
  onBack,
  onPublish,
  onEditCloseFriends,
}: {
  onBack: () => void
  onPublish: (args: { caption: string; privacy: StoryPrivacy; allowIds: number[]; period: number; mediaAreas: MediaArea[] }) => void | Promise<void>
  // переход в редактор списка близких друзей (при выборе аудитории «Близкие»)
  onEditCloseFriends?: () => void
}) {
  const dialogs = useChatsStore((s) => s.dialogs)
  const managers = useManagers()
  // private peers only — the contact pool for the "Выбранные" audience
  const contacts = dialogs
    .filter((d) => d.type === 'private' && d.peer)
    .map((d) => d.peer!)

  const [caption, setCaption] = useState('')
  const [privacy, setPrivacy] = useState<StoryPrivacy>('contacts')
  const [period, setPeriod] = useState(86400)
  const [allow, setAllow] = useState<Set<number>>(new Set())
  const [reactionSticker, setReactionSticker] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // кол-во близких друзей — для подсказки при аудитории «Близкие»
  const [closeCount, setCloseCount] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    managers.stories.closeFriends().then((ids) => { if (alive) setCloseCount(ids.length) }).catch(() => {})
    return () => { alive = false }
  }, [managers])

  const toggleContact = (id: number) =>
    setAllow((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const publish = async () => {
    if (busy) return
    setBusy(true)
    try {
      const mediaAreas: MediaArea[] = reactionSticker
        ? [{ type: 'reaction', coordinates: { x: 50, y: 78, w: 22, h: 12, rotation: 0 }, reaction: reactionSticker, dark: false, flipped: false }]
        : []
      await onPublish({
        caption: caption.trim(),
        privacy,
        allowIds: privacy === 'selected' ? [...allow] : [],
        period,
        mediaAreas,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={s.sheet}>
      {/* Шапка */}
      <div className={s.header}>
        <IconButton onClick={onBack} aria-label="Назад" color="var(--secondary-text-color)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--primary-text-color)">
          Новая история
        </Text>
      </div>

      <div className={s.body}>
        {/* Подпись */}
        <div className={classNames(s.card, s.captionCard)}>
          <div className={s.captionField}>
            <textarea
              autoFocus
              rows={1}
              maxLength={MAX_CAPTION_LEN}
              className={s.captionInput}
              placeholder=" "
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <label className={s.captionLabel}>Подпись</label>
          </div>
        </div>

        {/* Селектор приватности (сегментированные кнопки) */}
        <div className={s.privacyBlock}>
          <Text size={14} weight={600} color="var(--primary-color)" className={s.sectionLabel}>
            Кто может видеть
          </Text>
          <div className={classNames(s.card, s.segments)} role="radiogroup" aria-label="Кто может видеть историю">
            {PRIVACY_OPTIONS.map((opt) => {
              const active = privacy === opt.key
              return (
                <div
                  key={opt.key}
                  role="radio"
                  aria-checked={active}
                  tabIndex={0}
                  onClick={() => setPrivacy(opt.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setPrivacy(opt.key)
                    }
                  }}
                  className={classNames(s.segment, active ? s.segmentActive : '')}
                >
                  {opt.label}
                </div>
              )
            })}
          </div>
        </div>

        {/* Селектор периода (tweb story period): сколько часов история живёт */}
        <div className={s.privacyBlock} style={{ marginTop: 12 }}>
          <Text size={14} weight={600} color="var(--primary-color)" className={s.sectionLabel}>
            Сколько хранить
          </Text>
          <div className={classNames(s.card, s.segments)} role="radiogroup" aria-label="Сколько хранить историю">
            {PERIOD_OPTIONS.map((opt) => {
              const active = period === opt.key
              return (
                <div
                  key={opt.key}
                  role="radio"
                  aria-checked={active}
                  tabIndex={0}
                  onClick={() => setPeriod(opt.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setPeriod(opt.key)
                    }
                  }}
                  className={classNames(s.segment, active ? s.segmentActive : '')}
                >
                  {opt.label}
                </div>
              )
            })}
          </div>
        </div>

        {/* 4d: reaction-стикер (media area). Минимальный редактор — выбор эмодзи,
            область ставится в нижнюю центральную часть истории. */}
        <div className={s.privacyBlock} style={{ marginTop: 12 }}>
          <Text size={14} weight={600} color="var(--primary-color)" className={s.sectionLabel}>
            Реакция-стикер
          </Text>
          <div className={classNames(s.card, s.segments)} role="radiogroup" aria-label="Реакция-стикер">
            <div
              role="radio"
              aria-checked={reactionSticker === null}
              tabIndex={0}
              onClick={() => setReactionSticker(null)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setReactionSticker(null) } }}
              className={classNames(s.segment, reactionSticker === null ? s.segmentActive : '')}
            >
              Нет
            </div>
            {REACTION_STICKERS.map((emo) => {
              const active = reactionSticker === emo
              return (
                <div
                  key={emo}
                  role="radio"
                  aria-checked={active}
                  aria-label={emo}
                  tabIndex={0}
                  onClick={() => setReactionSticker(active ? null : emo)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setReactionSticker(active ? null : emo) } }}
                  className={classNames(s.segment, active ? s.segmentActive : '')}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Emoji e={emo} size={22} />
                </div>
              )
            })}
          </div>
        </div>

        {/* Подсказка для аудитории "Близкие" + переход в редактор списка */}
        {privacy === 'close' && (
          <div className={s.contactsBlock}>
            <div
              className={classNames(s.card, s.contactRow)}
              role="button"
              tabIndex={0}
              onClick={onEditCloseFriends}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEditCloseFriends?.() } }}
              style={{ margin: 0, borderRadius: 16 }}
            >
              <TgIcon name="newprivate" size={22} color="var(--primary-color)" />
              <Text size={15} color="var(--primary-text-color)" className={s.contactName}>
                Список близких друзей{closeCount != null ? ` (${closeCount})` : ''}
              </Text>
              <TgIcon name="next" size={20} color="var(--secondary-text-color)" />
            </div>
          </div>
        )}

        {/* Выбор контактов для аудитории "Выбранные" */}
        {privacy === 'selected' && (
          <div className={s.contactsBlock}>
            <Text size={14} weight={600} color="var(--primary-color)" className={s.sectionLabel}>
              Контакты
            </Text>
            <div className={classNames(s.card, s.contactsList)}>
              {contacts.length === 0 && (
                <Text size={15} color="var(--secondary-text-color)" className={s.emptyRow}>
                  Нет контактов
                </Text>
              )}
              {contacts.map((c) => {
                const checked = allow.has(c.id)
                return (
                  <div
                    key={c.id}
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={getUserTitle(c)}
                    tabIndex={0}
                    onClick={() => toggleContact(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleContact(c.id)
                      }
                    }}
                    className={s.contactRow}
                  >
                    <Avatar
                      background={gradientFor(c.id)}
                      text={getUserTitle(c).charAt(0).toUpperCase()}
                      size="sm"
                    />
                    <Text noWrap size={16} color="var(--primary-text-color)" className={s.contactName}>
                      {getUserTitle(c)}
                    </Text>
                    <div className={classNames(s.check, checked ? s.checkOn : '')}>
                      {checked && <TgIcon name="check" size={16} />}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* FAB публикации */}
      {/* tweb не масштабирует угловую кнопку по hover/tap — отклик там даёт
          ripple и смена фона (_button.scss:75-77); whileHover/whileTap сняты. */}
      <div
        onClick={publish}
        role="button"
        aria-label="Опубликовать"
        aria-disabled={busy}
        className={classNames(s.fab, busy ? s.fabBusy : '')}
      >
        <TgIcon name="check" />
      </div>
    </div>
  )
}
