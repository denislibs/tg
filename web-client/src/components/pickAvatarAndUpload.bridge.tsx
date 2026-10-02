// ВРЕМЕННО до МР-5 — мост вместо `pickAvatarAndUpload` из tweb
// `src/components/avatarEdit.ts:139-158` (812502980). Функцию вместе с
// медиаредактором аватара (`getFileAndOpenEditor`, `handleAvatarEditorResult`)
// портирует задача МР-5 плана медиаредактора
// (`docs/superpowers/plans/2026-09-30-media-editor-port.md`): наш `AvatarEdit`
// (`components/avatarEdit.ts`) до неё — только класс кнопки с выбором файла,
// а у вкладки контакта нет кнопки-аватара — есть «Установить/Предложить фото».
// До МР-5 выбор файла и кроп делает текущий React `settings/AvatarCropper.tsx`,
// открытый ФУНКЦИЕЙ через `popupStore` (план волны 7, «Особые пункты» 0б-10).
// МР-5 заменяет импорт у вызывающего на `@components/avatarEdit` и удаляет
// этот файл: `git grep -n "ВРЕМЕННО до МР-5"` покажет и его.
//
// Сигнатура — оригинала в объёме режима контакта (`mode: {userId, suggest?}`),
// единственного, который просит потребитель (вкладка «Изменить контакт»,
// `sidebarRight/tabs/editContact.solid.tsx`, tweb `editContact.tsx:73-96`).
// Хвост `handleAvatarEditorResult` (`avatarEdit.ts:72-137`) для контакта —
// загрузка и `uploadContactProfilePhoto({userId, suggest | save: true})` — у
// нас две ручки: `media.upload` и `contacts.setPhoto`/`suggestPhoto`.
// Режимов `'self'`/`'fallback'`, видео-аватара и `onUploadStart` нет (О-24
// плана 2D — видео через медиаредактор).
import { createElement } from 'react'
import AvatarCropper from '@components/settings/AvatarCropper'
import { openPopup } from '@stores/popupStore'
import type { Managers } from '@/client/bootstrap'

export function pickAvatarAndUpload(opts: {
  managers: Managers
  mode: { userId: number, suggest?: boolean }
  onUploaded?: () => void
}) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if(!file) return

    openPopup((p) => createElement(AvatarCropper, {
      file,
      onCancel: p.destroy,
      onConfirm: (blob, width, height) => {
        p.destroy()
        void upload(blob, width, height)
      },
    }))
  })
  input.click()

  async function upload(blob: Blob, width: number, height: number) {
    const { managers, mode } = opts
    let mediaId: number
    try {
      mediaId = await managers.media.upload({ bytes: await blob.arrayBuffer(), mime: 'image/jpeg', size: blob.size, width, height })
    } catch {
      return // upload failed (avatarEdit.ts:109-111)
    }

    if(mode.suggest) {
      await managers.contacts.suggestPhoto(mode.userId, mediaId)
    } else {
      await managers.contacts.setPhoto(mode.userId, mediaId)
    }

    opts.onUploaded?.()
  }
}
