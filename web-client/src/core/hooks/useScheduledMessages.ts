import { useCallback, useEffect, useRef, useState } from 'react'
import { useManagers } from './useManagers'
import { useMessagesStore } from '../../stores/messagesStore'
import type { MyMessage } from '../models'

// Запланированные сообщения чата (tweb ChatType.Scheduled): список + действия
// «отправить сейчас» / «удалить» / «перепланировать». Read/command-путь через
// managers; onChanged уведомляет родителя о новом счётчике (для календарика).
export function useScheduledMessages(chatId: number, onChanged: (count: number) => void): {
  list: MyMessage[] | null
  reschedule: { id: number; sendAt: number } | null
  setReschedule: (r: { id: number; sendAt: number } | null) => void
  doReschedule: (sendAtUnix: number) => void
  sendNow: (id: number) => void
  remove: (id: number) => void
} {
  const managers = useManagers()
  const [list, setList] = useState<MyMessage[] | null>(null)
  // Перепланирование (tweb MessageScheduleEditTime): id записи + её текущее время
  // для префилла пикера.
  const [reschedule, setReschedule] = useState<{ id: number; sendAt: number } | null>(null)

  // onChanged держим в ref — колбэк родителя не обязан быть стабильным, а
  // перезагрузку хотим только при смене чата.
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  const reload = useCallback(() => {
    void managers.messages.listScheduled(chatId).then((l) => {
      setList(l)
      onChangedRef.current(l.length)
    })
  }, [managers, chatId])

  useEffect(() => { reload() }, [reload])

  const doReschedule = (sendAtUnix: number) => {
    const r = reschedule
    setReschedule(null)
    if (!r) return
    void managers.messages.editScheduled(chatId, r.id, sendAtUnix).then(reload)
  }
  const sendNow = (id: number) => {
    void managers.messages.sendScheduledNow(chatId, id).then((msg) => {
      useMessagesStore.getState().applyIncoming(chatId, msg)
      reload()
    })
  }
  const remove = (id: number) => {
    void managers.messages.deleteScheduled(chatId, id).then(reload)
  }

  return { list, reschedule, setReschedule, doReschedule, sendNow, remove }
}
