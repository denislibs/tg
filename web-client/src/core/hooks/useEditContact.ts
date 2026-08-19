import { useEffect, useRef, useState } from 'react'
import { useManagers } from './useManagers'

// Целевое действие для выбранного фото: личное фото у себя или предложение контакту.
export type ContactPhotoMode = 'set' | 'suggest'

// ViewModel экрана «Изменить контакт» (tweb editContact, ветка существующего
// контакта): поля формы + все managers-команды (upsert, фото set/suggest/clear,
// удаление). Прегружает сохранённое имя/фамилию/заметку + признак личного фото.
export function useEditContact(peerId: number | null, seedFirst: string, onClose: () => void): {
  first: string; setFirst: (v: string) => void
  last: string; setLast: (v: string) => void
  note: string; setNote: (v: string) => void
  hasPersonal: boolean
  saving: boolean
  busyPhoto: boolean
  canSave: boolean
  setPhotoMode: (m: ContactPhotoMode) => void
  submit: () => Promise<void>
  onCropConfirm: (blob: Blob, width: number, height: number) => Promise<void>
  resetPhoto: () => Promise<void>
  del: () => Promise<void>
} {
  const managers = useManagers()
  const [first, setFirst] = useState(seedFirst)
  const [last, setLast] = useState('')
  const [note, setNote] = useState('')
  const [hasPersonal, setHasPersonal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyPhoto, setBusyPhoto] = useState(false)
  const modeRef = useRef<ContactPhotoMode>('set')

  useEffect(() => {
    if (peerId == null) return
    let alive = true
    void managers.contacts.list().then((list) => {
      const c = list.find((x) => x.userId === peerId)
      if (!alive || !c) return
      // Имя контакта живёт в самой КАРТОЧКЕ пользователя (`user.first_name`/
      // `last_name`), а не плоскими полями рядом с ней: плоская пара была
      // вторым источником того же факта.
      setFirst((c.user._ === 'user' ? c.user.first_name : '') || seedFirst)
      setLast((c.user._ === 'user' ? c.user.last_name : '') ?? '')
      setNote(c.note)
      setHasPersonal(c.hasCustomPhoto)
    }).catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId, managers])

  const canSave = peerId != null && first.trim().length > 0 && !saving
  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await managers.contacts.add({
        contactId: peerId!,
        firstName: first.trim(),
        lastName: last.trim(),
        note: note.trim(),
      })
      onClose()
    } catch {
      setSaving(false)
    }
  }

  const setPhotoMode = (m: ContactPhotoMode) => { modeRef.current = m }

  const onCropConfirm = async (blob: Blob, width: number, height: number) => {
    if (peerId == null) return
    setBusyPhoto(true)
    try {
      const bytes = await blob.arrayBuffer()
      const mediaId = await managers.media.upload({ bytes, mime: 'image/jpeg', size: blob.size, width, height })
      if (modeRef.current === 'set') {
        await managers.contacts.setPhoto(peerId, mediaId)
        setHasPersonal(true)
        await managers.dialogs.refresh() // обновить аватар в списке диалогов и шапке чата
      } else {
        await managers.contacts.suggestPhoto(peerId, mediaId)
      }
    } finally {
      setBusyPhoto(false)
    }
  }
  const resetPhoto = async () => {
    if (peerId == null) return
    setBusyPhoto(true)
    try {
      await managers.contacts.clearPhoto(peerId)
      setHasPersonal(false)
      await managers.dialogs.refresh()
    } finally {
      setBusyPhoto(false)
    }
  }

  const del = async () => {
    if (peerId == null) return
    await managers.contacts.del(peerId)
    await managers.dialogs.refresh()
    onClose()
  }

  return { first, setFirst, last, setLast, note, setNote, hasPersonal, saving, busyPhoto, canSave, setPhotoMode, submit, onCropConfirm, resetPhoto, del }
}
