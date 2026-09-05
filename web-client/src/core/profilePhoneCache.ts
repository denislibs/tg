// src/core/profilePhoneCache.ts
//
// Приватность-применённый телефон ЧУЖОГО пира — Task 2 профиля на Solid
// (`docs/superpowers/plans/2026-09-05-profile-card-solid.md`), находка ревью
// задачи 1.5 («пятый писатель»).
//
// ── Почему это ОТДЕЛЬНОЕ зеркало, а не поле общей карточки пира ─────────────
// Расследование (см. коммит): у нашего бэкенда `phone` РЕАЛЬНО (по правилу
// `PrivacyPhoneNumber`, для конкретного зрителя) считает и отдаёт ТОЛЬКО ОДНА
// ручка — `GET /users/{id}` (`managers.privacy.profile`, backend
// `usecase/privacy/privacy.go:227-229`: `if check(PrivacyPhoneNumber) {
// brief.Phone = u.Phone }`). Общий путь, которым наполняется зеркало пиров
// (`core/peerCache.ts`) — диалоги, отправители сообщений, массовый
// `/users?ids=` (backend `peerscan.go::userRealScan` → `UserRecord.ToUser()`,
// без прав чтения приватности вообще) — `phone` НЕ шлёт НИКОГДА, не потому что
// скрыт приватностью, а потому что эта ручка его не спрашивает. Значит
// `cachedPeer(peerId)?.phone` не эквивалентен `profile.user.phone`: писать
// телефон privacy.profile() в ОБЩЕЕ зеркало пиров означало бы либо затирать
// его пустотой для потребителей, которые НЕ ходили за приватным профилем, либо
// протаскивать «повезло — есть» в зеркало, которым правит ЕДИНСТВЕННЫЙ
// писатель — проектор (`core/peerCache.ts`, пин `noDuplicatePeers.test.ts`,
// «второго писателя быть не должно»).
//
// `username`/`pFlags.verified`/`pFlags.premium`/`emoji_status_emoticon`
// (остальные поля `PeerProfile.user`) сюда НЕ попадают НАРОЧНО — они одинаковы
// на ЛЮБОМ пути (та же `ToUser()`, без гейта приватности, backend
// `user.go:65-80`), поэтому читаются из ОБЩЕГО зеркала (`core/peerCache.ts`,
// `usePeers`/`cachedUser`) — заводить для них дубликат было бы вторым
// источником факта, который и так уже есть.
//
// ── Единственный писатель ────────────────────────────────────────────────────
// `stores/fullPeers.solid.ts::requestFullPeer` — ТА ЖЕ сетевая функция и ТОТ
// ЖЕ ответ `privacy.profile()`, из которого она уже берёт `fullUser` (Task
// 1.5 свела оба фреймворка на неё). Телефон приезжает В ТОЙ ЖЕ паре — второго
// похода в сеть заводить не нужно, только вторую запись из уже полученного
// ответа. `core/hooks/useUserProfileData.ts::useUserProfile` (React) читает
// это зеркало, а не зовёт `managers.privacy.profile()` сам — так закрыт
// «пятый писатель» (docs брифа задачи 2).
import { isFetchTicketCurrent } from './chatFullCache'

const mirror = new Map<PeerId, string>()
let version = 0
const subs = new Set<() => void>()

export function subscribeProfilePhoneMirror(cb: () => void): () => void {
  subs.add(cb)
  return () => { subs.delete(cb) }
}

export function profilePhoneMirrorVersion(): number {
  return version
}

/** Синхронное чтение; `undefined` — ещё не приходил ответ `privacy.profile()`
 *  для этого peerId (не «скрыт приватностью» — то различить нечем и не нужно:
 *  потребитель показывает строку «Телефон» только когда есть непустое значение). */
export function cachedProfilePhone(peerId: PeerId): string | undefined {
  return mirror.get(peerId)
}

/** `ticket` — из `beginPeerFullFetch` (`core/chatFullCache.ts`), взятый ДО
 *  похода за той же карточкой — ТА ЖЕ гонка, что у `saveChatFull`: устаревший,
 *  но задержавшийся сетью ответ не должен переписать телефон, который положил
 *  более новый поход. */
export function saveProfilePhone(peerId: PeerId, phone: string, ticket?: number): void {
  if (!isFetchTicketCurrent(peerId, ticket)) return
  if (mirror.get(peerId) === phone) return
  mirror.set(peerId, phone)
  ++version
  subs.forEach((f) => f())
}

/** Смена аккаунта: телефон прошлой сессии чужой (та же причина, что у
 *  `resetPeerMirror`/`resetChatFullMirror`). */
export function resetProfilePhoneMirror(): void {
  if (!mirror.size) return
  mirror.clear()
  ++version
  subs.forEach((f) => f())
}
