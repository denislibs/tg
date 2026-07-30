// src/core/realtime/channelFunnel.ts
//
// Per-channel pts-конверт (Волна 5). Каналы не делят общий пер-юзерный курсор
// (cursor.ts): у каждого канала свой плотный монотонный channel_pts, который
// сервер шлёт и в живом кадре (d.channel_pts), и в типизированном
// GET /channels/{id}/difference. Этот модуль — тот же funnel, что глобальный
// applyUpdate (dup/next/gap + буфер придержанных кадров), но по ключу chatId:
// живые кадры канала гейтятся против его курсора, а дыра добирается через
// difference. Массовая история поста грузится окном (REST) — funnel держит только
// живой хвост, поэтому первый кадр «сидирует» курсор без реплея всего лога.
//
// Заменяет наивное приближение pts≈maxSeq, которое раньше вёл React-хук
// useChannelExtras мимо воркера.

import { classifyPts } from './cursor'
import { newPendingPts, type NewPendingPts } from './pendingPts'

// Типизированный конверт канального апдейта — форма живого кадра и строки difference.
export interface ChannelUpdate { t: string; pts: number; d: unknown }
export interface ChannelDiff { updates: ChannelUpdate[]; pts: number; slice: boolean }

interface ChannelState {
  pts: number                              // плотный per-channel курсор
  seeded: boolean                          // курсор инициализирован (stored/первый live)
  pending: NewPendingPts                   // буфер out-of-order живых кадров
  syncing: boolean                         // идёт catch-up — живые кадры придерживаем
  timer: ReturnType<typeof setTimeout> | null
}

export interface ChannelFunnelDeps {
  // Отражение апдейта в SSOT + broadcast (тот же dispatch, что и глобальный funnel).
  dispatch: (t: string, d: unknown) => void
  // GET /channels/{id}/difference?pts=sincePts — типизированный конверт.
  getDifference: (chatId: number, sincePts: number) => Promise<ChannelDiff>
  loadPts: (chatId: number) => Promise<number | null>
  savePts: (chatId: number, pts: number) => void
}

// tweb: SYNC_DELAY — окно ожидания, что дыру закроют следующие живые кадры, прежде
// чем уходить в difference. Совпадает с глобальным PTS_SYNC_DELAY.
const SYNC_DELAY = 250

export function newChannelFunnel(deps: ChannelFunnelDeps) {
  const states = new Map<number, ChannelState>()

  function state(chatId: number): ChannelState {
    let st = states.get(chatId)
    if (!st) {
      st = { pts: 0, seeded: false, pending: newPendingPts(), syncing: false, timer: null }
      states.set(chatId, st)
    }
    return st
  }

  function advance(chatId: number, st: ChannelState, pts: number): void {
    if (pts > st.pts) { st.pts = pts; deps.savePts(chatId, pts) }
  }

  function clearTimer(st: ChannelState): void {
    if (st.timer) { clearTimeout(st.timer); st.timer = null }
  }

  // Слить подряд идущие буферные кадры после того, как next закрыл дыру.
  function drainPending(chatId: number, st: ChannelState): void {
    if (!st.pending.has()) return
    st.pending.drain(() => st.pts, (item) => {
      deps.dispatch(item.t, item.d)
      advance(chatId, st, item.pts)
    })
    if (!st.pending.has()) clearTimer(st)
  }

  function scheduleSync(chatId: number, st: ChannelState): void {
    if (st.timer) return
    st.timer = setTimeout(() => {
      st.timer = null
      if (!st.pending.has()) return
      st.pending.clear()            // как tweb: difference сбрасывает придержанные
      void catchUp(chatId)
    }, SYNC_DELAY)
  }

  // Добор пропущенных апдейтов через типизированный difference (по порядку pts).
  // Сериализован per-channel флагом syncing; страхуемся от отсутствия прогресса.
  async function catchUp(chatId: number): Promise<void> {
    const st = state(chatId)
    if (st.syncing) return
    st.syncing = true
    try {
      for (;;) {
        const since = st.pts
        const r = await deps.getDifference(chatId, since)
        for (const u of r.updates) {
          if (u.pts <= st.pts) continue     // дубль (live уже применил)
          deps.dispatch(u.t, u.d)
          advance(chatId, st, u.pts)
        }
        st.seeded = true
        if (!r.slice || st.pts <= since) break   // хвост исчерпан / нет прогресса
      }
    } catch { /* сеть моргнула — следующий gap/open доберёт */ } finally {
      st.syncing = false
      drainPending(chatId, state(chatId))
    }
  }

  return {
    // Живой канальный кадр (несёт channel_pts). Та же арифметика dup/next/gap, что
    // и глобальный funnel, но против per-channel курсора.
    applyLive(chatId: number, t: string, pts: number, d: unknown): void {
      const st = state(chatId)
      // Первый живой кадр до сидирования курсора: принимаем его как базу (массовая
      // история — из REST-окна; funnel гейтит только живой хвост). Без реплея лога.
      if (!st.seeded) {
        st.seeded = true
        deps.dispatch(t, d)
        advance(chatId, st, pts)
        return
      }
      if (st.syncing) return               // идёт catch-up — он переотдаст по порядку
      const cls = classifyPts(st.pts, pts)
      if (cls === 'dup') return
      if (cls === 'gap') {
        if (!st.pending.push({ t, pts, d })) { st.pending.clear(); clearTimer(st); void catchUp(chatId); return }
        scheduleSync(chatId, st)
        return
      }
      deps.dispatch(t, d)
      advance(chatId, st, pts)
      drainPending(chatId, st)
    },

    // Открытие канала: сид курсора из IDB + добор пропущенного с прошлого визита
    // (посты И метаданные). Без сохранённого pts — остаёмся несидированными: первый
    // живой кадр примет базу, а текущий контент/карточку даёт REST-загрузка.
    async open(chatId: number): Promise<void> {
      const st = state(chatId)
      if (st.seeded) { void catchUp(chatId); return }
      const stored = await deps.loadPts(chatId)
      if (typeof stored === 'number' && stored > 0) {
        st.pts = stored
        st.seeded = true
        void catchUp(chatId)
      }
    },

    // Закрытие канала: сбросить транзиентные буфер/таймер, сохранённый курсор оставить.
    close(chatId: number): void {
      const st = states.get(chatId)
      if (!st) return
      clearTimer(st)
      st.pending.clear()
    },

    // Полный resync/сброс: забыть in-memory курсоры (IDB персистит) — следующее
    // открытие пересидирует. In-flight таймеры гасим.
    reset(): void {
      for (const st of states.values()) clearTimer(st)
      states.clear()
    },
  }
}
export type ChannelFunnel = ReturnType<typeof newChannelFunnel>
