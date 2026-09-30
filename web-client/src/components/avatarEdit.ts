/**
 * Порт tweb `src/components/avatarEdit.ts` (812502980, класс `AvatarEdit`
 * :156-191) — круглая кнопка выбора аватара нового чата:
 * `button.avatar-edit > canvas.avatar-edit-canvas + span.avatar-edit-icon`.
 * Стили — `styles/tweb/_bridge.scss` (tweb `base.scss:797-849`) и
 * `pages/_chats.scss:40` (размер 120px внутри мессенджера).
 * Первый потребитель — вкладка «Новый канал» (`sidebarLeft/tabs/newChannel.solid.tsx`).
 *
 * ВРЕМЕННО до 2D-27 — порт в объёме класса, без медиаредактора. Расхождения:
 *  1. Клик открывает не медиаредактор (`getFileAndOpenEditor`, :172-183 —
 *     кадрирование, видео-аватар), а выбор файла `requestFile('image/*')`.
 *     Наш редактор — React (`MediaEditor.tsx`, волна 4), кроппер
 *     `settings/AvatarCropper.tsx` — тоже React, а обратного моста «React
 *     внутри Solid» нет (спека § 6). Та же развилка — у карточки регистрации
 *     (`auth/cards/SignUpCard.solid.tsx`, долг
 *     `backlogs/frontend/avatar-cropper-solid-port.md`): файл ужимается
 *     `scaleImageForSend`, превью — центральный квадрат на канве. Снимает
 *     задача 2D-27 (порт `avatarEdit.ts` целиком).
 *  2. `finishFromResult` (:199-246): полёт превью в круг
 *     (`animateImageToTarget`) и видео-ветка (:248-313) не портированы — их
 *     источник — результат медиаредактора (п. 1). Затемнение канвы
 *     `rgba(0, 0, 0, 0.3)` (:230-231) — дословно.
 *  3. `AvatarEditPayload.file` отдаёт id загруженного медиа (`managers.media.upload`),
 *     а не `InputFile`: у нас фото чата ставится по `media_id`
 *     (`groups.setPhoto`), провода `InputFile` нет. Поэтому конструктор
 *     получает `managers` опцией — у оригинала загрузчик глобальный
 *     (`appDownloadManager.upload`). `video`/`videoStartTs` — нет (п. 2).
 *  4. `ariaLabel: 'AccDescr.EditAvatar'` (:162) — нет: опции нет у нашего
 *     `Button` (как у `buttonCorner.ts`). `isForum` (:28, :174) — нет: его
 *     потребитель — создание форума, у нас его нет в этой волне.
 */
import Button from '@components/button'
import Icon from '@components/icon'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import requestFile from '@helpers/files/requestFile'
import { scaleImageForSend } from '@core/media/scaleImageForSend'
import type { Managers } from '@/client/bootstrap'

export type AvatarEditPayload = {
  /** загрузить выбранное фото; результат — `media_id` (расхождение 3) */
  file: () => Promise<number>
}

export type AvatarEditManagers = Pick<Managers, 'media'>

export default class AvatarEdit {
  public container: HTMLElement
  private canvas: HTMLCanvasElement
  private icon: HTMLSpanElement

  constructor(onChange: (payload: AvatarEditPayload) => void, options: { managers: AvatarEditManagers }) {
    this.container = Button('avatar-edit', { noRipple: true })

    this.canvas = document.createElement('canvas')
    this.canvas.classList.add('avatar-edit-canvas')

    this.icon = Icon('cameraadd', 'avatar-edit-icon')

    this.container.append(this.canvas, this.icon)

    // ВРЕМЕННО до 2D-27 — выбор файла вместо медиаредактора (расхождение 1)
    attachClickEvent(this.container, () => {
      requestFile('image/*').then((file) => this.finishFromFile(file, onChange, options.managers), () => {})
    })
  }

  public clear() {
    const ctx = this.canvas.getContext('2d')
    ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  // ВРЕМЕННО до 2D-27 — вместо `finishFromResult` (расхождение 2): превью —
  // центральный квадрат исходника, затемнение — как у оригинала (:230-231).
  private async finishFromFile(file: File, onChange: (payload: AvatarEditPayload) => void, managers: AvatarEditManagers) {
    const prepared = await scaleImageForSend(file)

    onChange({
      file: async() => {
        const bytes = await prepared.file.arrayBuffer()
        return managers.media.upload({
          bytes,
          mime: prepared.file.type || 'image/jpeg',
          size: bytes.byteLength,
          width: prepared.width,
          height: prepared.height,
        })
      },
    })

    const url = URL.createObjectURL(prepared.file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const side = Math.min(img.naturalWidth, img.naturalHeight)
      if(!side) return
      const canvas = this.canvas
      canvas.width = canvas.height = side
      const ctx = canvas.getContext('2d')
      if(!ctx) return
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, side, side)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
      ctx.fillRect(0, 0, side, side)
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }
}
