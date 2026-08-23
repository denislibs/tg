import { createPortal } from 'react-dom'
import { useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import Avatar from '../shared/ui/Avatar'
import TgIcon from './TgIcon'
import { useChatsStore } from '../stores/chatsStore'
import { useManagers } from '../core/hooks/useManagers'
import { useStoriesStore } from '../stores/storiesStore'
import { gradientFor } from '../core/dialogToChat'
import { getUserTitle } from '../core/peers/getPeerTitle'
import { cachedUser } from '../core/peerCache'
import { isUser } from '../core/peers/peerId'
import type { UserReal } from '../core/peers/peer'
import rootScope from '@lib/rootScope'
import { useT } from '../i18n'
import classNames from '../shared/lib/classNames'
import type { StoryItem, StoryPrivacy } from '../core/stories/story'
import { storyAllowIds, storyCaption, storyPrivacy } from '../core/stories/story'
import s from './AddStorySheet.module.scss'

const MAX_CAPTION_LEN = 2048

const PRIVACY_OPTIONS: { key: StoryPrivacy; label: string }[] = [
  { key: 'everyone', label: 'Все' },
  { key: 'contacts', label: 'Контакты' },
  { key: 'close', label: 'Близкие' },
  { key: 'selected', label: 'Выбранные' },
]

/**
 * Edit-story sheet (постинг-сторона, референса нет — минималистично «по мотивам»
 * TG, переиспользует поля/вёрстку AddStorySheet). Редактирует подпись и
 * приватность своей истории; период/медиа не меняются. Для selected показываем
 * выбор контактов всегда (предзаполнен текущей аудиторией); приватность шлём при
 * смене режима или правке списка (иначе бэк не пересоберёт allow-лист). Portal над вьювером.
 */
export default function EditStorySheet({
  story,
  onClose,
}: {
  story: StoryItem
  onClose: () => void
}) {
  const t = useT()
  const managers = useManagers()
  const dialogs = useChatsStore((st) => st.dialogs)
  const applyStoryEdit = useStoriesStore((st) => st.applyStoryEdit)
  // Собеседники живут в зеркале пиров (вектор `users` контейнера `/chats`), а не
  // внутри строки диалога; «приватный» — это ключ пользователя.
  const contacts = dialogs
    .filter((d) => isUser(d.peerId))
    .map((d) => cachedUser(d.peerId))
    .filter((u): u is UserReal => !!u && u._ === 'user')

  const [caption, setCaption] = useState(storyCaption(story))
  // Вид аудитории ВЫВОДИТСЯ из флагов конструктора: строки `privacy` на проводе
  // больше нет, а allow-лист — правило `privacyValueAllowUsers` внутри `privacy`.
  const [privacy, setPrivacy] = useState<StoryPrivacy>(storyPrivacy(story))
  const [allow, setAllow] = useState<Set<number>>(() => new Set(storyAllowIds(story)))
  const [busy, setBusy] = useState(false)
  const meId = useChatsStore((st) => st.meId)

  const toggleContact = (id: number) =>
    setAllow((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const save = async () => {
    if (busy) return
    setBusy(true)
    const privacyChanged = privacy !== storyPrivacy(story)
    // Считаем allow-лист изменившимся по сравнению множеств, а не по смене
    // приватности: у уже-selected истории аудиторию можно править без смены режима.
    const initialAllow = storyAllowIds(story)
    const allowChanged =
      privacy === 'selected' && (allow.size !== initialAllow.length || initialAllow.some((id) => !allow.has(id)))
    // Бэк пересобирает story_allow только когда privacy передана (Edit при
    // privacy==nil не трогает allow), поэтому при правке списка шлём и privacy.
    const sendPrivacy = privacyChanged || allowChanged
    const sendAllow = privacy === 'selected' && sendPrivacy
    try {
      // Своя история, поэтому автор — сам зритель; адрес всё равно пара.
      await managers.stories.editStory(meId ?? 0, story.id, {
        caption: caption.trim(),
        privacy: sendPrivacy ? privacy : undefined,
        allowIds: sendAllow ? [...allow] : undefined,
      })
      applyStoryEdit(story.id, {
        caption: caption.trim(),
        privacy: sendPrivacy ? privacy : undefined,
        allowIds: sendAllow ? [...allow] : undefined,
      })
      rootScope.dispatchEvent('ui:toast', t('Story edited'))
      onClose()
    } catch {
      rootScope.dispatchEvent('ui:toast', t('Something went wrong'))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className={s.sheetFixed}>
      <div className={s.header}>
        <IconButton onClick={onClose} aria-label={t('Back')} color="var(--secondary-text-color)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--primary-text-color)">
          {t('Edit story')}
        </Text>
      </div>

      <div className={s.body}>
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
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPrivacy(opt.key) } }}
                  className={classNames(s.segment, active ? s.segmentActive : '')}
                >
                  {opt.label}
                </div>
              )
            })}
          </div>
        </div>

        {privacy === 'selected' && (
          <div className={s.contactsBlock}>
            <Text size={14} weight={600} color="var(--primary-color)" className={s.sectionLabel}>
              Контакты
            </Text>
            <div className={classNames(s.card, s.contactsList)}>
              {contacts.length === 0 && (
                <Text size={15} color="var(--secondary-text-color)" className={s.emptyRow}>Нет контактов</Text>
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
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleContact(c.id) } }}
                    className={s.contactRow}
                  >
                    <Avatar background={gradientFor(c.id)} text={getUserTitle(c).charAt(0).toUpperCase()} size="sm" />
                    <Text noWrap size={16} color="var(--primary-text-color)" className={s.contactName}>{getUserTitle(c)}</Text>
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

      {/* tweb не масштабирует угловую кнопку по hover/tap — отклик там даёт
          ripple и смена фона (_button.scss:75-77); whileHover/whileTap сняты. */}
      <div
        onClick={save}
        role="button"
        aria-label={t('Save')}
        aria-disabled={busy}
        className={classNames(s.fab, busy ? s.fabBusy : '')}
      >
        <TgIcon name="check" />
      </div>
    </div>,
    document.body,
  )
}
