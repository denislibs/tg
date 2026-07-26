// Offline-first кэш списка чатов в IndexedDB (аналог tweb loadAllStates): на
// холодном старте показываем последний известный список мгновенно, до ответа
// сети, а сеть реконсайлит поверх. Кэш скоупится по активному session_token
// (мультиаккаунт), не пишется под passcode-локом и не хранит plaintext секретных
// чатов (E2E).
import { idbGet, idbSet, idbDel } from '../core/store/idbKv'
import type { Dialog } from '../core/models'
import type { User } from '../core/managers/authManager'
import { useChatsStore } from './chatsStore'
import { useSettingsStore } from '../settings'

const CACHE_KEY = 'chats_cache'
const TOKEN_KEY = 'session_token' // тот же ключ, что у TokenStore
const MAX_CACHED = 100 // хватает на первый экран; остальное дольёт сеть

interface CacheShape {
  token: string | null
  me: User | null
  dialogs: Dialog[]
}

// Секретные чаты E2E: не персистим расшифрованный текст/шифр-блоб превью.
// Диалог остаётся (для мгновенного списка), превью дольётся сетью + дешифровкой.
function sanitize(dialogs: Dialog[]): Dialog[] {
  return dialogs.slice(0, MAX_CACHED).map((d) => {
    if (d.type !== 'secret' || !d.lastMessage) return d
    return { ...d, lastMessage: { ...d.lastMessage, text: '', encBody: undefined } }
  })
}

// Заполнить стор из кэша до первого рендера. Возвращает true, если что-то
// отрисовали (тогда useAuthGate стартует с authed=true оптимистично).
export async function hydrateChatsFromCache(): Promise<boolean> {
  // Под passcode-локом кэш не показываем: список чатов не должен мелькнуть до
  // экрана блокировки.
  if (useSettingsStore.getState().passcodeEnabled) return false
  try {
    const [cache, token] = await Promise.all([idbGet<CacheShape>(CACHE_KEY), idbGet<string>(TOKEN_KEY)])
    if (!cache?.dialogs?.length || cache.token !== token) return false
    const st = useChatsStore.getState()
    if (st.loaded) return false // сеть уже успела — не затираем
    st.setMe(cache.me)
    st.setMeId(cache.me?.id ?? null)
    st.setDialogs(cache.dialogs)
    return true
  } catch {
    return false // idb недоступен — фича мягко деградирует
  }
}

// Подписка на стор: дебаунсом персистит диалоги, чтобы следующий холодный старт
// был мгновенным. Вызывать один раз после первого рендера.
export function startChatsCachePersist(): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastDialogs = useChatsStore.getState().dialogs

  const flush = () => {
    timer = null
    const st = useChatsStore.getState()
    if (!st.loaded || !st.dialogs.length) return
    void (async () => {
      try {
        const token = (await idbGet<string>(TOKEN_KEY)) ?? null
        await idbSet(CACHE_KEY, { token, me: st.me, dialogs: sanitize(st.dialogs) })
      } catch { /* idb недоступен */ }
    })()
  }

  useChatsStore.subscribe((s) => {
    if (s.dialogs === lastDialogs) return // не диалоги (typing/presence) — пропускаем
    lastDialogs = s.dialogs
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, 800)
  })
}

export async function clearChatsCache(): Promise<void> {
  try { await idbDel(CACHE_KEY) } catch { /* idb недоступен */ }
}
