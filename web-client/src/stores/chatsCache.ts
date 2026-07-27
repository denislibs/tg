// Синхронизация main-thread-стора диалогов с нормализованным офлайн-стором
// (core/store/persist.ts). Диалоги — единственная сущность, чей самый свежий вид
// (порядок/непрочитанное/превью) живёт в main-thread-сторе (туда их правит
// realtimeBridge), поэтому именно отсюда они и персистятся; юзеров и сообщения
// пишет воркер. На холодном старте hydrate поднимает последний список мгновенно,
// до ответа сети, а сеть реконсайлит поверх.
//
// Скоуп по токену и очистку при смене аккаунта делает persistScope (boot.ts);
// под passcode-локом persist сам ничего не пишет/не читает (нет plaintext at rest).
import { saveDialogs, saveMe, loadDialogs, loadMe, persistClearAll } from '../core/store/persist'
import { useChatsStore } from './chatsStore'
import { useSettingsStore } from '../settings'

// Заполнить стор из персиста до первого рендера. Возвращает true, если что-то
// отрисовали (тогда useAuthGate стартует с authed=true оптимистично).
export async function hydrateChatsFromCache(): Promise<boolean> {
  // Под passcode-локом список чатов не должен мелькнуть до экрана блокировки.
  if (useSettingsStore.getState().passcodeEnabled) return false
  try {
    const [dialogs, me] = await Promise.all([loadDialogs(), loadMe()])
    if (!dialogs.length) return false
    const st = useChatsStore.getState()
    if (st.loaded) return false // сеть уже успела — не затираем
    st.setMe(me)
    st.setMeId(me?.id ?? null)
    st.setDialogs(dialogs)
    return true
  } catch {
    return false // idb недоступен — фича мягко деградирует
  }
}

// Подписка на стор: дебаунсом персистит диалоги + me, чтобы следующий холодный
// старт был мгновенным. Вызывать один раз после первого рендера.
export function startChatsCachePersist(): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastDialogs = useChatsStore.getState().dialogs
  let lastMe = useChatsStore.getState().me

  const flush = () => {
    timer = null
    const st = useChatsStore.getState()
    if (!st.loaded || !st.dialogs.length) return
    void saveDialogs(st.dialogs)
    void saveMe(st.me)
  }

  useChatsStore.subscribe((s) => {
    if (s.dialogs === lastDialogs && s.me === lastMe) return // не диалоги/me — пропускаем
    lastDialogs = s.dialogs
    lastMe = s.me
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, 800)
  })
}

export async function clearChatsCache(): Promise<void> {
  await persistClearAll()
}
