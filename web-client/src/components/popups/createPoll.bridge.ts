// ВРЕМЕННО до порта popups/createPoll — мост вместо `openCreatePollPopup` из
// tweb `src/components/popups/createPoll/index.tsx:246-248` (812502980). До
// порта Solid-попапа опрос собирает текущий React `CreatePollPopup.tsx`,
// открытый ФУНКЦИЕЙ через `popupStore` (остров оверлеев) — тот же приём, что у
// `popups/datePicker.bridge.ts`. Порт заменяет импорт у вызывающего (пункт
// «Опрос» меню вложений, `ChatInput.attachMenuButtons`, tweb `input.ts:1178-1272`)
// и удаляет этот файл: `git grep -n "ВРЕМЕННО до порта popups/createPoll"` → пусто.
//
// Сигнатура — оригинала в объёме, который просит потребитель: `onSubmit(payload)`;
// отправку, как у tweb, делает вызывающий. Чего React-попап не умеет:
//  1. `isBroadcast` (подписи и «викторина» канала) и `supportedMediaTypes`
//     (вложения в вариантах) — поля принимаются и не читаются;
//  2. второй аргумент оригинала `HotReloadGuard` не нужен: HMR у нас нет.
import { createElement } from 'react'
import CreatePollPopup, { type NewPollData } from '@components/CreatePollPopup'
import { openPopup } from '@stores/popupStore'

export type CreatePollPayload = NewPollData

export function openCreatePollPopup(props: {
  isBroadcast?: boolean,
  onSubmit: (payload: CreatePollPayload) => void,
}) {
  openPopup((p) => createElement(CreatePollPopup, {
    onClose: p.destroy,
    onCreate: (payload: NewPollData) => {
      p.destroy()
      props.onSubmit(payload)
    },
  }))
}
