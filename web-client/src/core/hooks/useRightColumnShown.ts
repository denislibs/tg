// tweb держит ОДНУ правую колонку — постоянно смонтированный #column-right со
// вкладками-слайдером внутри (профиль/поиск и т.п.), поэтому один булев класс
// body.is-right-column-shown ей и соответствует (appSidebarRight сам решает,
// когда колонка открыта). Наша правая колонка распалась на НЕСКОЛЬКО
// независимых React-порталов: UserInfoPanel (панель профиля) и RightSearchTab
// (поиск стикеров/GIF, открывается из подвала EmojiDropdown композера — см.
// EmojiDropdown.tsx:712-713). Композер доступен независимо от того, открыта
// ли панель профиля, поэтому обе панели МОГУТ быть смонтированы и открыты
// ОДНОВРЕМЕННО (проверено по коду — грep не нашёл места, которое закрывало бы
// одну при открытии другой). Класс на body при этом общий (styles/tweb/_chat.scss:
// 438,458,513 — сдвиг #column-center только под ним), а булев `classList.toggle`
// в двух независимых местах гасил бы его, как только закроется ЛЮБАЯ из
// панелей, даже если вторая ещё открыта. Поэтому класс держится счётчиком
// открытых панелей, а не флагом одной.
import { useLayoutEffect } from 'react'

const CLASS = 'is-right-column-shown'
let openCount = 0

function retain(): void {
  openCount += 1
  document.body.classList.add(CLASS)
}

function release(): void {
  openCount = Math.max(0, openCount - 1)
  if (openCount === 0) document.body.classList.remove(CLASS)
}

/**
 * @param open — открыта ли ИМЕННО эта правая панель (профиль или экран
 * поиска); класс на body держится, пока открыта хотя бы одна.
 */
export function useRightColumnShown(open: boolean): void {
  useLayoutEffect(() => {
    if (!open) return
    retain()
    return release
  }, [open])
}
