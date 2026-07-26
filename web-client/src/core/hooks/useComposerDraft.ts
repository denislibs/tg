// Облачный черновик композера (tweb ChatInput.saveDraftDebounced/saveDraft):
// восстановление текста при открытии чата, сейв с дебаунсом 2.5с при вводе и
// немедленный — при смене чата/размонтировании. Пустой текст без reply удаляет
// черновик (бэк трактует пустой save как draftMessageEmpty). Вместе с текстом
// сохраняется reply_to_id текущего reply-стейта (tweb draft.reply_to_msg_id).
import { useEffect, useRef } from 'react'
import { useManagers } from './useManagers'
import { useEvent } from './useEvent'
import { useDraftsStore } from '../../stores/draftsStore'

const SAVE_DEBOUNCE_MS = 2500 // tweb saveDraftDebounced

// Сигнатура сохранённого состояния: текст + reply, чтобы не слать PUT без изменений.
const sigOf = (text: string, replyToId: number | null) => `${replyToId ?? ''}\u0000${text}`

export function useComposerDraft(chatId: number | null, replyToId: number | null): {
  initialDraft: string
  onDraftChange: (text: string) => void
} {
  const managers = useManagers()
  const initialDraft = useDraftsStore((s) => (chatId != null ? s.byChat[chatId]?.text : undefined)) ?? ''
  const textRef = useRef(initialDraft)
  const savedRef = useRef(sigOf(initialDraft, null))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Первый прогон reply-эффекта после маунта/смены чата скипается: replyToId ещё
  // null (восстановление из черновика придёт позже), сейв бы стёр reply на бэке.
  const skipReplyEffect = useRef(true)

  const persist = useEvent((text: string) => {
    if (chatId == null) return
    const sig = sigOf(text, replyToId)
    if (sig === savedRef.current) return
    savedRef.current = sig
    // Оптимистично — превью «Черновик:» в списке чатов обновляется сразу;
    // rt:draft_update с бэка сверит остальные вкладки/устройства.
    const st = useDraftsStore.getState()
    if (text.trim() || replyToId != null) st.setDraft({ chatId, text, replyToId, updatedAt: new Date().toISOString() })
    else st.removeDraft(chatId)
    void managers.drafts.save(chatId, text, replyToId).catch(() => {})
  })

  const onDraftChange = useEvent((text: string) => {
    textRef.current = text
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => persist(textRef.current), SAVE_DEBOUNCE_MS)
  })

  // Смена чата: сбросить refs под новый чат; при уходе — немедленный сейв.
  useEffect(() => {
    const st = useDraftsStore.getState()
    const d = chatId != null ? st.byChat[chatId] : undefined
    textRef.current = d?.text ?? ''
    savedRef.current = sigOf(d?.text ?? '', d?.replyToId ?? null)
    skipReplyEffect.current = true
    return () => {
      if (timer.current) clearTimeout(timer.current)
      persist(textRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])

  // Смена reply (установка/отмена из меню, восстановление из черновика) —
  // дебаунс-сейв как при вводе; no-op, если состояние совпадает с сохранённым.
  useEffect(() => {
    if (skipReplyEffect.current) {
      skipReplyEffect.current = false
      return
    }
    if (chatId == null) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => persist(textRef.current), SAVE_DEBOUNCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyToId])

  return { initialDraft, onDraftChange }
}
