// ВРЕМЕННО до порта newMedia.tsx — мост вместо попапа tweb
// `src/components/popups/newMedia.tsx` (812502980, 2328 строк). Решение Р-2
// плана каркаса (`docs/superpowers/plans/2026-10-02-wave-7-carcass-first.md`,
// раздел 7): вложение фото — часть P0, поэтому до порта попапа выбранные файлы
// показывает текущий React `SendMediaPopup.tsx`, открытый ФУНКЦИЕЙ через
// `popupStore` (остров оверлеев `#react-overlays`) — тот же приём, что у
// `popups/datePicker.bridge.ts`. Имя файла и экспорты — оригинала: порт заменит
// тело, вызывающие не меняются. `git grep -n "ВРЕМЕННО до порта newMedia.tsx"`
// → пусто после порта.
//
// Точки входа оригинала, у которых есть вызывающие:
//  - `showNewMediaPopup` (tweb `:185`) — `ChatInput.fileInput` (tweb
//    `input.ts:1530-1563`) и вставка/сброс файлов блока K `appImManager`;
//  - `getCurrentNewMediaPopup` (tweb `:156`) — открытый попап, чтобы дописать
//    в него файлы (`addFiles`).
// Отправку, как у оригинала, делает сам попап (`newMedia.tsx:1022-1106`): пакет
// параметров снимается ОДИН раз на всю выборку (`getMessageSendingParams()`),
// несколько фото/видео «как медиа» уходят одним альбомом, плашка ответа гаснет
// после цикла (`input.onHelperCancel()`, :1104-1106).
//
// Расхождения с оригиналом (закроет порт попапа):
//  1. `sendGrouped` у нас нет: каждый файл — свой `messages.sendFile` с общим
//     `groupedId` (форма снесённого `useChatSend.sendPendingMedia`); подпись —
//     на первом.
//  2. Аргументы `ignoreInputValue`, `gifDocument`, `ephemeralSnapshot` — без
//     предмета: подпись из поля ввода попап не берёт (`wasDraft`, :418-431),
//     GIF из стикер-меню и эфемерного композера нет; правки медиа
//     (`editMessageMedia`) нет — Б-38.
//  3. У открытого попапа только `addFiles`; зон сброса внутри попапа
//     (`appendDrops`, `Preview.Dragging.AddItems`) у `SendMediaPopup` нет.
//  4. Секретный чат (E2E-путь `secret.sendMedia`) не поддержан: секретные чаты
//     на паузе (`SECRET_CHATS_ENABLED=false`, Б-56).
//  5. Пакет параметров берётся у `chat.input.getMessageSendingParams()`, а не у
//     `chat` (tweb `chat.ts:1352`): в К-4 `ChatInput` держит его у себя, перенос
//     на `Chat` — после влития П-5 (контракт К-4).
import { createElement, useLayoutEffect, useRef, useState } from 'react'
import SendMediaPopup from '@components/messages/SendMediaPopup'
import { openPopup } from '@stores/popupStore'
import { useChatsStore } from '@stores/chatsStore'
import { scaleImageForSend } from '@core/media/scaleImageForSend'
import type { Managers } from '@/client/bootstrap'
import type { MessageSendingParams } from '@core/managers/messages/sendingParams'
import type { SendMessageAction } from '@core/realtime/events'
import { ChatType } from '@components/chat/chatType'

/** tweb `newMedia.tsx` `WillAttachType` в объёме выбора файлов, вставки и сброса. */
export type WillAttachType = 'media' | 'document'

/** Открытый попап — то, что у него зовут вызывающие. */
export type NewMediaPopup = {
  addFiles(files: File[]): void
}

let currentPopup: NewMediaPopup | undefined

/** tweb `newMedia.tsx:156` */
export function getCurrentNewMediaPopup() {
  return currentPopup
}

/** Срез `Chat`, который читает мост (tweb `newMedia.tsx` — `chat.*`). */
export interface NewMediaChat {
  peerId: PeerId
  managers: Managers
  /** tweb `newMedia.tsx:1013` — в ленте отложенных отправка спрашивает время */
  type: ChatType
  input: {
    /** tweb `input.ts:2190-2217` — календарь; выбранное время ляжет в пакет */
    scheduleSending(callback: () => void): void | Promise<void>
    /** tweb `chat.ts:1352` `chat.getMessageSendingParams()`; у нас до К-4
     *  включительно лежит на `ChatInput` (расхождение 5) */
    getMessageSendingParams(): MessageSendingParams
    /** tweb `input.ts` — гасит плашку ответа после отправки */
    onHelperCancel(): void
  }
}

/**
 * Длительность аудио/видео до аплоада — порт tweb `newMedia.tsx:1562-1579`
 * (`new Audio()` на objectURL + `onMediaLoad` → `params.duration`). Сервер
 * считает длительность асинхронно: без неё первый `new_message` приезжает без
 * `documentAttributeAudio.duration`. Ошибку метаданных глотаем.
 */
function probeMediaDuration(file: File, kind: 'audio' | 'video'): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement(kind)
    const done = (d?: number) => { URL.revokeObjectURL(url); el.src = ''; resolve(d) }
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration) : undefined)
    el.onerror = () => done(undefined)
    el.src = url
  })
}

/** Один файл выборки — tweb `newMedia.tsx` `sendFileDetails` + `appMessagesManager.sendFile`. */
async function sendOneFile(
  chat: NewMediaChat,
  input: File,
  options: {
    asFile: boolean,
    caption: string,
    groupedId?: number,
    paidMediaPrice: number | null,
    spoiler: boolean,
    sendingParams: MessageSendingParams,
  },
) {
  const { asFile, caption, groupedId, paidMediaPrice, spoiler, sendingParams } = options
  const peerId = chat.peerId
  const origMime = input.type || 'application/octet-stream'
  // Трек решается по самому файлу, а не по пункту меню: у tweb ветка аудио
  // (`fileType.indexOf('audio/') === 0 || ['video/ogg'].indexOf(fileType) >= 0`)
  // в `makeDocumentAndMetaForSendingFile` стоит ДО `!args.isMedia`.
  const isAudio = origMime.startsWith('audio/') || origMime === 'video/ogg'
  const type = isAudio ? 'audio'
    : asFile ? 'document'
    : origMime.startsWith('image/') ? 'photo'
    : origMime.startsWith('video/') ? 'video'
    : 'document'
  // Фото «как медиа»: подготовка 1:1 с tweb (`scaleImageForTelegram`) перед
  // аплоадом; документы/видео/аудио не трогаем.
  const prepared = type === 'photo' ? await scaleImageForSend(input) : null
  const file = prepared?.file ?? input
  const mime = file.type || origMime
  const duration = isAudio
    ? await probeMediaDuration(input, 'audio')
    : origMime.startsWith('video/')
      ? await probeMediaDuration(input, 'video')
      : undefined
  const uploadAction: SendMessageAction = type === 'photo' ? { _: 'sendMessageUploadPhotoAction' }
    : type === 'video' ? { _: 'sendMessageUploadVideoAction' }
    : type === 'audio' ? { _: 'sendMessageUploadAudioAction' }
    : { _: 'sendMessageUploadDocumentAction' }
  // tweb `isMedia`: фото/видео как медиа — бабл сразу с локальным превью.
  const isVisual = (type === 'photo' || type === 'video') && !asFile
  await chat.managers.messages.sendFile({
    peerId,
    clientMsgId: `c-${peerId}-${performance.now()}-${Math.random().toString(36).slice(2)}`,
    senderId: useChatsStore.getState().meId ?? -1,
    file,
    type,
    mime,
    fileName: file.name,
    caption,
    width: prepared?.width ?? 0,
    height: prepared?.height ?? 0,
    duration,
    ...sendingParams,
    groupedId,
    paidMediaPrice,
    isMedia: isVisual,
    uploadAction,
    // спойлер — только у визуального медиа (tweb `canToggleSpoilers`)
    spoiler: spoiler && isVisual,
  })
}

/** Отправка выборки — tweb `newMedia.tsx:1022-1106` (расхождение 1). */
function send(
  chat: NewMediaChat,
  files: File[],
  caption: string,
  asFile: boolean,
  paidPrice?: number | null,
  spoilers?: boolean[],
  force = false,
) {
  // tweb :1013-1018 — в ленте отложенных сперва время; оно ляжет в пакет
  // (`scheduleDate`), и вся выборка уйдёт в очередь отложенных
  if(chat.type === ChatType.Scheduled && !force) {
    void chat.input.scheduleSending(() => send(chat, files, caption, asFile, paidPrice, spoilers, true))
    return
  }

  // tweb :1022 — пакет один на всю выборку
  const sendingParams = chat.input.getMessageSendingParams()
  // Несколько фото/видео «как медиа» → один альбом (grouped_id).
  const asAlbum = !asFile &&
    files.length > 1 &&
    files.every((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
  const groupedId = asAlbum ? Date.now() * 1000 + Math.floor(Math.random() * 1000) : undefined
  // Платное медиа — только одиночное фото/видео «как медиа».
  const price = !asFile && !asAlbum && files.length === 1 ? paidPrice ?? null : null
  void (async() => {
    for(let i = 0; i < files.length; i++) {
      await sendOneFile(chat, files[i], {
        asFile,
        caption: i === 0 ? caption : '',
        groupedId,
        paidMediaPrice: price,
        spoiler: !!spoilers?.[i],
        sendingParams,
      })
    }
  })()

  // tweb :1104-1106
  if(sendingParams.replyToMsgId) {
    chat.input.onHelperCancel()
  }
}

/**
 * Хозяин React-попапа на время его жизни: держит выборку (её дописывает
 * `addFiles`) и регистрирует себя открытым попапом. Медиаредактор
 * `SendMediaPopup` заменяет файл ПО МЕСТУ в массиве `files` — отправка читает
 * тот же массив.
 */
function NewMediaPopupHost(props: {
  chat: NewMediaChat,
  initialFiles: File[],
  willAttachType: WillAttachType,
  destroy: () => void,
}) {
  const [files, setFiles] = useState(props.initialFiles)
  const filesRef = useRef(files)
  filesRef.current = files

  useLayoutEffect(() => {
    const popup: NewMediaPopup = {
      addFiles: (added) => setFiles((prev) => [...prev, ...added]),
    }
    currentPopup = popup
    return () => {
      if(currentPopup === popup) currentPopup = undefined
    }
  }, [])

  return createElement(SendMediaPopup, {
    files,
    initialAsFile: props.willAttachType === 'document',
    onClose: props.destroy,
    onSend: (caption: string, asFile: boolean, paidPrice?: number | null, spoilers?: boolean[]) => {
      props.destroy()
      send(props.chat, filesRef.current, caption, asFile, paidPrice, spoilers)
    },
  })
}

/** tweb `newMedia.tsx:185` */
export default function showNewMediaPopup(
  chat: NewMediaChat,
  inputFiles: File[],
  willAttachType: WillAttachType,
) {
  openPopup((p) => createElement(NewMediaPopupHost, {
    chat,
    initialFiles: inputFiles,
    willAttachType,
    destroy: p.destroy,
  }))
}
