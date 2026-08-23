// Облачный черновик композера (tweb ChatInput.saveDraftDebounced/saveDraft):
// восстановление текста при открытии чата, сейв с дебаунсом 2.5с при вводе и
// немедленный — при смене чата/размонтировании. Пустой текст без reply удаляет
// черновик (бэк трактует пустой save как draftMessageEmpty). Вместе с текстом
// сохраняется reply_to_id текущего reply-стейта (tweb draft.reply_to_msg_id).
import { useEffect, useRef } from 'react'
import { useManagers } from './useManagers'
import { useEvent } from './useEvent'
import { useChatsStore } from '../../stores/chatsStore'
import { draftReplyToId as replyOfDraft, draftText } from '../dialogs/draft'

const SAVE_DEBOUNCE_MS = 2500 // tweb saveDraftDebounced

// Сигнатура сохранённого состояния: текст + reply, чтобы не слать PUT без изменений.
const sigOf = (text: string, replyToId: number | null) => `${replyToId ?? ''}\u0000${text}`

export function useComposerDraft(peerId: PeerId | null, replyToId: number | null): {
  initialDraft: string
  onDraftChange: (text: string) => void
} {
  const managers = useManagers()
  // Черновик читается из САМОГО диалога — своего стора у него больше нет.
  const initialDraft = useChatsStore((st) =>
    draftText(peerId == null ? undefined : st.dialogs.find((d) => d.peerId === peerId)?.draft))
  const textRef = useRef(initialDraft)
  const savedRef = useRef(sigOf(initialDraft, null))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Первый прогон reply-эффекта после маунта/смены чата скипается: replyToId ещё
  // null (восстановление из черновика придёт позже), сейв бы стёр reply на бэке.
  const skipReplyEffect = useRef(true)

  const persist = useEvent((text: string) => {
    if (peerId == null) return
    const sig = sigOf(text, replyToId)
    if (sig === savedRef.current) return
    savedRef.current = sig
    // Оптимистики на витрине больше нет: черновик — поле диалога, а диалогами
    // владеет воркер. Ответ ручки и кадр `rt:draft_update` (одно устройство их
    // получает первым) применяет тот же владелец, и превью «Черновик:» вместе
    // с местом строки в списке обновляется ровно один раз.
    void managers.drafts.save(peerId, text, replyToId).catch(() => {})
  })

  const onDraftChange = useEvent((text: string) => {
    textRef.current = text
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => persist(textRef.current), SAVE_DEBOUNCE_MS)
  })

  // Смена чата: сбросить refs под новый чат; при уходе — немедленный сейв.
  useEffect(() => {
    const draft = peerId == null
      ? undefined
      : useChatsStore.getState().dialogs.find((d) => d.peerId === peerId)?.draft
    textRef.current = draftText(draft)
    savedRef.current = sigOf(draftText(draft), replyOfDraft(draft))
    skipReplyEffect.current = true
    return () => {
      if (timer.current) clearTimeout(timer.current)
      persist(textRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId])

  // Смена reply (установка/отмена из меню, восстановление из черновика) —
  // дебаунс-сейв как при вводе; no-op, если состояние совпадает с сохранённым.
  useEffect(() => {
    if (skipReplyEffect.current) {
      skipReplyEffect.current = false
      return
    }
    if (peerId == null) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => persist(textRef.current), SAVE_DEBOUNCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyToId])

  return { initialDraft, onDraftChange }
}
