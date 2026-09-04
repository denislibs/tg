// Анимации смены аккаунта — 1:1 из tweb:
// - «Добавить аккаунт» (sidebarLeft/index.ts addAccount): чат уезжает
//   main-screen-exit → exiting (scale 1.75 + fade, 200мс), флаг «анимировать
//   auth» переживает reload;
// - возврат из auth (AuthCardsHost back): флаг «анимировать main» → после
//   reload мессенджер появляется main-screen-enter (scale 1.75 → 1, 200мс);
// - переключение аккаунта из меню: список чатов уезжает chatlist-exit
//   (translateY(18px) scale(1.01) + fade, 200мс).
// Флаги — в localStorage (tweb: sessionStorage should_animate_auth/main).
import { doubleRaf } from '@helpers/schedulers'

export const ANIMATE_AUTH_KEY = 'msgr_animate_auth'
export const ANIMATE_MAIN_KEY = 'msgr_animate_main'
export const PREV_ACCOUNT_KEY = 'msgr_prev_account'

export { doubleRaf }
export const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Команда перехода воркеру + перезагрузка ПОСЛЕ неё, чем бы команда ни
 * кончилась. Общая точка для всех вкладок-инициаторов (меню аккаунтов,
 * «добавить аккаунт», возврат к прежнему аккаунту, логаут с экрана пасскода).
 *
 * Отказ глотаем сознательно: команды перехода больше не реджектятся из-за
 * сети (`authManager.fetchMe(rederive)` не бросает наружу), остаётся сбой
 * IndexedDB при работе с реестром аккаунтов. Его исход неизвестен — токен мог
 * смениться, а мог и нет. Без перезагрузки вкладка застревала бы в интерфейсе
 * покинутого аккаунта (а на экране пасскода — прямо на нём, там кадр
 * rt:logging_out до неё не долетает: насос `smp.on` регистрируется в
 * `startRealtime()`, а тот гейтится `runWhenUnlocked`); reload же выводит
 * состояние с диска заново и потому верен при любом исходе. Тот же приём, что
 * у tweb `logOut()`: `.catch(error => error.handled = true).finally(clear)`
 * (`lib/appManagers/apiManager.ts:341-345`) — очистка доводится до конца, а
 * ошибка наружу не идёт.
 */
export async function commandThenReload(command: Promise<unknown>): Promise<void> {
  try { await command } catch { /* исход неизвестен — см. докблок */ }
  location.reload()
}

// tweb sidebarLeft.addAccount: exit чата перед уходом на экран входа
export async function playMainScreenExit(el: HTMLElement | null): Promise<void> {
  if (!el) return
  el.classList.add('main-screen-exit')
  await doubleRaf()
  el.classList.add('main-screen-exiting')
  await pause(200)
}

// tweb src/index.ts (should_animate_main): появление мессенджера
export async function playMainScreenEnter(el: HTMLElement | null): Promise<void> {
  if (!el) return
  el.classList.add('main-screen-enter')
  await doubleRaf()
  el.classList.add('main-screen-entering')
  await pause(200)
  el.classList.remove('main-screen-enter', 'main-screen-entering')
}

// tweb меню аккаунтов: список чатов уезжает перед changeAccount
export async function playChatlistExit(el: HTMLElement | null): Promise<void> {
  if (!el) return
  el.classList.add('chatlist-exit')
  await doubleRaf()
  el.classList.add('chatlist-exiting')
  await pause(200)
}

// playAuthHostEnter/playAuthHostExit (WAAPI-хелперы hostEnter/hostExit auth-
// хоста) снесены вместе с React `AuthFlow.tsx` (задача 6 волны 3) — Solid
// `AuthCardsHost.solid.tsx` играет тот же вход/выход КЛАССАМИ
// (`.hostEnter/.hostEntering`/`.hostExit/.hostExiting`, `AuthFlow.module.scss`)
// напрямую в себе (`runEnterSequence`/`back()`), а не через эту пару функций
// — так у неё не осталось ни одного вызывающего.
