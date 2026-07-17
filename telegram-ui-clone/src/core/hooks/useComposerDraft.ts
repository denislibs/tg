// Облачный черновик композера (tweb ChatInput.saveDraftDebounced/saveDraft):
// восстановление текста при открытии чата, сейв с дебаунсом 2.5с при вводе и
// немедленный — при смене чата/размонтировании. Пустой текст удаляет черновик
// (бэк трактует пустой save как draftMessageEmpty).
import { useEffect, useRef } from 'react'
import { useManagers } from './useManagers'
import { useEvent } from './useEvent'
import { useDraftsStore } from '../../stores/draftsStore'

const SAVE_DEBOUNCE_MS = 2500 // tweb saveDraftDebounced

export function useComposerDraft(chatId: number | null): {
  initialDraft: string
  onDraftChange: (text: string) => void
} {
  const managers = useManagers()
  const initialDraft = useDraftsStore((s) => (chatId != null ? s.byChat[chatId]?.text : undefined)) ?? ''
  const textRef = useRef(initialDraft)
  const savedRef = useRef(initialDraft)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useEvent((text: string) => {
    if (chatId == null || text === savedRef.current) return
    savedRef.current = text
    // Оптимистично — превью «Черновик:» в списке чатов обновляется сразу;
    // rt:draft_update с бэка сверит остальные вкладки/устройства.
    const st = useDraftsStore.getState()
    if (text.trim()) st.setDraft({ chatId, text, replyToId: null, updatedAt: new Date().toISOString() })
    else st.removeDraft(chatId)
    void managers.drafts.save(chatId, text).catch(() => {})
  })

  const onDraftChange = useEvent((text: string) => {
    textRef.current = text
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => persist(textRef.current), SAVE_DEBOUNCE_MS)
  })

  // Смена чата: сбросить refs под новый чат; при уходе — немедленный сейв.
  useEffect(() => {
    const st = useDraftsStore.getState()
    const cur = chatId != null ? (st.byChat[chatId]?.text ?? '') : ''
    textRef.current = cur
    savedRef.current = cur
    return () => {
      if (timer.current) clearTimeout(timer.current)
      persist(textRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])

  return { initialDraft, onDraftChange }
}
