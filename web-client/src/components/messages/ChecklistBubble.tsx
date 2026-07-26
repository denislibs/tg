// Баббл чек-листа — порт tweb ChecklistBubble (bubbles/checklist.tsx): заголовок
// + подпись типа, список пунктов с чекбоксами (отметка показывает, КТО отметил),
// прогресс «N из M выполнено» и — если разрешено — инлайн-добавление пункта.
// Право отмечать/добавлять: автор (out) всегда; другие — только по флагам
// others_can_mark / others_can_add (сервер дублирует проверку).
import { useState } from 'react'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import UserAvatar from '../UserAvatar'
import classNames from '../../shared/lib/classNames'
import { useManagers } from '../../core/hooks/useManagers'
import { useMessagesStore } from '../../stores/messagesStore'
import { useChatsStore } from '../../stores/chatsStore'
import { usePeers } from '../../core/hooks/usePeers'
import type { Checklist } from '../../core/models'
import { useT } from '../../i18n'
import s from './ChecklistBubble.module.scss'

export default function ChecklistBubble({ checklist, out }: { checklist: Checklist; out: boolean }) {
  const t = useT()
  const managers = useManagers()
  // чек-лист рендерится только в открытом чате — его id и есть чат сообщения
  const chatId = useChatsStore((st) => st.activeChatId) ?? 0
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const canMark = out || checklist.othersCanMark
  const canAdd = out || checklist.othersCanAdd

  const done = checklist.items.filter((it) => it.markedBy.length > 0).length
  const total = checklist.items.length

  // имена/аватары отметивших (для группового чек-листа показываем, кто отметил)
  const markerIds = Array.from(new Set(checklist.items.flatMap((it) => it.markedBy)))
  const peers = usePeers(markerIds)

  const apply = (updated: Checklist) => useMessagesStore.getState().applyChecklistUpdate(chatId, updated)

  const toggle = (itemId: number) => {
    if (!canMark || busy) return
    setBusy(true)
    void managers.messages
      .toggleChecklistItem(checklist.id, itemId)
      .then(apply)
      .finally(() => setBusy(false))
  }

  const submitAdd = () => {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    void managers.messages
      .addChecklistItems(checklist.id, [text])
      .then(apply)
      .finally(() => {
        setBusy(false)
        setDraft('')
        setAdding(false)
      })
  }

  return (
    <div className={classNames(s.checklist, out ? s.out : '')}>
      <div className={s.title}>{checklist.title}</div>
      <Text size={13} color="var(--b-time)">
        {checklist.othersCanMark ? t('Group Checklist') : t('Checklist')}
      </Text>

      <div className={s.items}>
        {checklist.items.map((it) => {
          const marked = it.markedBy.length > 0
          const by = it.markedBy[0]
          const peer = by != null ? peers.get(by) : undefined
          return (
            <div
              key={it.id}
              className={classNames(s.item, canMark ? s.clickable : '')}
              onClick={() => toggle(it.id)}
            >
              <span className={classNames(s.check, marked ? s.checked : '')}>
                {marked && <TgIcon name="check" size={14} color="#fff" />}
              </span>
              <div className={s.body}>
                <Text size={15} color="var(--b-text)" className={marked ? s.textDone : undefined}>
                  {it.text}
                </Text>
                {checklist.othersCanMark && marked && by != null && (
                  <span className={s.markedBy}>
                    <UserAvatar id={by} name={peer?.displayName ?? ''} avatarUrl={peer?.avatarUrl} size={16} />
                    <Text size={12} color="var(--b-time)">{peer?.displayName ?? `#${by}`}</Text>
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className={s.footer}>
        <Text size={13} color="var(--b-time)">{`${done} ${t('of')} ${total} ${t('done')}`}</Text>
        {canAdd && !adding && (
          <span className={s.addBtn} onClick={() => setAdding(true)}>
            <TgIcon name="add" size={16} color="var(--tg-accent)" />
            <Text size={13} weight={600} color="var(--tg-accent)">{t('Add a Task')}</Text>
          </span>
        )}
      </div>

      {adding && (
        <div className={s.addRow}>
          <input
            className={s.addInput}
            value={draft}
            autoFocus
            maxLength={255}
            placeholder={t('New task')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitAdd()
              else if (e.key === 'Escape') { setAdding(false); setDraft('') }
            }}
            onBlur={() => { if (!draft.trim()) setAdding(false) }}
          />
        </div>
      )}
    </div>
  )
}
