// Синхронизация main-thread-стора диалогов с нормализованным офлайн-стором
// (core/store/persist.ts). НЕ путать с прежним «chats_cache» — тот подход persist
// уже заменил; здесь — актуальный слой персиста именно диалогов+me поверх persist.
// Диалоги — единственная сущность, чей самый свежий вид (порядок/непрочитанное/
// превью) живёт в main-thread-сторе (туда их правит storeProjection), поэтому
// именно ЗДЕСЬ он собирается. Но ФИЗИЧЕСКИ в IndexedDB пишет воркер (persistManager):
// один writer на все вкладки — main лишь шлёт снапшот командой. На холодном старте
// hydrate ЧИТАЕТ последний список прямо с main (данные прошлой сессии уже
// закоммичены), мгновенно, до ответа сети, а сеть реконсайлит поверх.
//
// Скоуп по токену и очистку при смене аккаунта делает persistScope (boot.ts);
// под passcode-локом persist сам ничего не пишет/не читает (нет plaintext at rest).
import { loadDialogs, loadMe } from '../core/store/persist'
import { useChatsStore } from './chatsStore'
import { useSettingsStore } from '../settings'
import type { Dialog } from '../core/models'
import type { User } from '../core/managers/authManager'

// RPC-фасад writer'а из воркера (persistManager). main собирает свежий вид, пишет воркер.
type PersistWriter = {
  dialogs(dialogs: Dialog[], me: User | null): Promise<void>
  clearAll(): Promise<void>
}

// Заполнить стор из персиста до первого рендера. Возвращает true, если что-то
// отрисовали (тогда useAuthGate стартует с authed=true оптимистично).
export async function hydrateDialogsFromPersist(): Promise<boolean> {
  // Под passcode-локом список чатов не должен мелькнуть до экрана блокировки.
  if (useSettingsStore.getState().passcodeEnabled) return false
  try {
    const [dialogs, me] = await Promise.all([loadDialogs(), loadMe()])
    if (!dialogs.length) return false
    const st = useChatsStore.getState()
    if (st.loaded) return false // сеть уже успела — не затираем
    // ИСКЛЮЧЕНИЕ из «пишет только проектор» (Stage 1C.2, Task 1 — см. докблок
    // setMe в chatsStore.ts, stores/noDuplicateMe.test.ts): гидратация с диска
    // ДО поднятия воркера/rootScope — красим последний закоммиченный снимок
    // мгновенно, до сети. Не независимый ВЫВОД факта, а чтение вчерашнего кэша
    // (тот же приём, что setDialogs ниже); воркерный rt:me поправит поверх, как
    // только придёт.
    st.setMe(me) // meId выводится из me внутри setMe
    st.setDialogs(dialogs)
    return true
  } catch {
    return false // idb недоступен — фича мягко деградирует
  }
}

// Подписка на стор: дебаунсом шлёт диалоги + me воркеру на запись, чтобы следующий
// холодный старт был мгновенным. Вызывать один раз после первого рендера.
export function startDialogsPersist(managers: { persist: Pick<PersistWriter, 'dialogs'> }): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastDialogs = useChatsStore.getState().dialogs
  let lastMe = useChatsStore.getState().me

  const flush = () => {
    timer = null
    const st = useChatsStore.getState()
    if (!st.loaded || !st.dialogs.length) return
    void managers.persist.dialogs(st.dialogs, st.me)
  }

  useChatsStore.subscribe((s) => {
    if (s.dialogs === lastDialogs && s.me === lastMe) return // не диалоги/me — пропускаем
    lastDialogs = s.dialogs
    lastMe = s.me
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, 800)
  })
}

export async function clearDialogsPersist(managers: { persist: Pick<PersistWriter, 'clearAll'> }): Promise<void> {
  await managers.persist.clearAll()
}
