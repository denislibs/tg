// ВРЕМЕННО до 2C-14 — мост вместо `showBirthdayPopup`/`suggestUserBirthday` из
// tweb `src/components/popups/birthday.tsx:41-58` (812502980). Solid-попап даты
// рождения портирует задача 14 плана 2C; до неё дату выбирает текущий React
// `settings/BirthdayModal.tsx`, открытый ФУНКЦИЕЙ через `popupStore` (так велит
// план волны 7, «Особые пункты» 0б-10). Задача 2C-14 заменяет импорт у
// вызывающих на `@components/popups/birthday` и удаляет этот файл:
// `git grep -n "ВРЕМЕННО до 2C-14"` → пусто.
//
// Сигнатура — оригинала в объёме, который просит потребитель (вкладка
// «Изменить контакт», tweb `editContact.tsx:256-261`): `suggestForPeer` и
// `onSave`. Чего React-модалка не умеет (отличия закроет 2C-14):
//  1. заголовок «предложить дату для <пир>» (`BirthdayPopup.TitleForPeer`,
//     :241-242) и кнопка `BirthdayPopup.Suggest` (:296) — у модалки свои
//     «Дата рождения» и «Сохранить»;
//  2. подсказка о правиле приватности своей даты (:253, скрыта для
//     `suggestForPeer`) — у модалки показывается всегда.
import { createElement } from 'react'
import BirthdayModal from '@components/settings/BirthdayModal'
import { openPopup } from '@stores/popupStore'
import { toastNew } from '@components/toast'
import { startClient } from '@/client/bootstrap'
import type { Birthday } from '@core/peers/peer'

/** Порт `suggestUserBirthday` (tweb `popups/birthday.tsx:41-50`). */
export async function suggestUserBirthday(userId: number, date: Birthday): Promise<boolean> {
  try {
    await startClient().managers.profile.suggestUserBirthday(userId, date)
    return true
  } catch(error) {
    console.error(error)
    toastNew({ langPackKey: 'Error.AnError' })
    return false
  }
}

export default function showBirthdayPopup(props: {
  initialDate?: Birthday
  suggestForPeer?: PeerId
  onSave: (date: Birthday) => boolean | Promise<boolean>
}) {
  openPopup((p) => createElement(BirthdayModal, {
    open: true,
    initial: props.initialDate ?? null,
    onClose: p.destroy,
    // оригинал ждёт `onSave` и закрывает попап (`callback` → `true`, :297-300)
    onSave: (date) => {
      void Promise.resolve(props.onSave(date)).then(p.destroy)
    },
  }))
}
