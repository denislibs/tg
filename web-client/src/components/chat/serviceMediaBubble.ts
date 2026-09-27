// src/components/chat/serviceMediaBubble.ts
//
// Порт tweb `components/chat/bubbleParts/serviceMediaBubble.ts`
// (`wrapServiceMediaBubble`) — служебный бабл, тело которого — круглое фото по
// центру и подпись под ним. Им оригинал рисует смену фото группы/канала
// (`PHOTO_BUBBLE_ACTIONS`, bubbles.ts:331-341, ветка :8215-8263).
//
// Разметка дословная (классы стилизует `_chatBubble.scss:2462-2488`, порт 1:1):
//   div.service-msg.bubble-service-media-wrapper
//     div.bubble-service-media-avatar-container
//       div.avatar.avatar-like.avatar-100.avatar-gradient.bubble-service-media-avatar
//         img.avatar-photo.avatar-photo-thumbnail   ← stripped-превью
//         img.avatar-photo                          ← само фото
//     div.bubble-service-media-text
//       span.i18n                                   ← фраза действия
//
// ─── Не портировано (предмета нет) ─────────────────────────────────────────
//  • клик по фото (`onMediaClick` → медиавьювер с фильтром
//    `inputMessagesFilterChatPhotos`, bubbles.ts:8227-8235): поиска по
//    фотографиям чата у нас нет, открывать вьювер не с чем. Без обработчика
//    оригинал оставляет фото некликабельным (нет `is-clickable`) — так и здесь;
//  • кнопка (`button`) — только у `messageActionSuggestProfilePhoto` (:8247),
//    а принять предложенное фото у нас нечем;
//  • `lazyLoadQueue` — очереди ленивой загрузки у ленты нет (см. шапку
//    `components/avatar.ts`), фото грузится сразу.
import { avatarNew, wrapPhotoToAvatar } from '@components/avatar'
import type { AvatarManagers } from '@components/avatar'
import type { MyPhoto } from '@core/media/messageMedia'
import type { Middleware } from '@helpers/middleware'

const CLASS_NAME = 'bubble-service-media'

export interface WrapServiceMediaBubbleOptions {
  /** `.service-msg`, который надо наполнить (колонка по центру) */
  container: HTMLElement
  middleware: Middleware
  managers: AvatarManagers
  photo: MyPhoto
  /** диаметр круга в px (tweb по умолчанию 100) */
  size?: number
  /** фраза действия под фото */
  caption?: HTMLElement
}

export default function wrapServiceMediaBubble(options: WrapServiceMediaBubbleOptions): {
  avatarContainer: HTMLDivElement
  loadPromise: Promise<unknown>
} {
  const { container, middleware, managers, photo, size = 100, caption } = options

  container.classList.add(CLASS_NAME + '-wrapper')

  const avatarContainer = document.createElement('div')
  avatarContainer.classList.add(CLASS_NAME + '-avatar-container')

  const avatar = avatarNew({ middleware, managers, size, isDialog: false })
  avatar.node.classList.add(CLASS_NAME + '-avatar')

  const loadPromise = wrapPhotoToAvatar(avatar, photo, size, middleware)

  avatarContainer.append(avatar.node)
  container.append(avatarContainer)

  if (caption) {
    const text = document.createElement('div')
    text.classList.add(CLASS_NAME + '-text')
    text.append(caption)
    container.append(text)
  }

  return { avatarContainer, loadPromise }
}
