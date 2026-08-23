// src/core/realtime/channelFunnel.ts
//
// Per-channel pts-конверт (Волна 5). Каналы не делят общий пер-юзерный курсор
// (cursor.ts): у каждого канала свой плотный монотонный курсор, который сервер
// шлёт и в живом кадре — параметром `pts` канального КОНСТРУКТОРА
// (updateNewChannelMessage у поста, updateChannelFullSnapshot и
// updateChannelBoostStatus у метаданных), — и в типизированном
// GET /channels/{id}/difference. Этот модуль — тот же funnel, что глобальный
// applyUpdate (dup/next/gap + буфер придержанных кадров), но по ключу peerId:
// живые кадры канала гейтятся против его курсора, а дыра добирается через
// difference. Массовая история поста грузится окном (REST) — funnel держит только
// живой хвост, поэтому первый кадр «сидирует» курсор без реплея всего лога.
//
// Заменяет наивное приближение pts≈maxSeq, которое раньше вёл React-хук
// useChannelExtras мимо воркера.

import { classifyPts } from './cursor'
import { frameKey } from './updateCatalog'
import { newPendingPts, type NewPendingPts } from './pendingPts'
import type { EventMeta } from '../../rpc/superMessagePort'

// Типизированный конверт канального апдейта — строка difference. `t` — тип
// строки журнала; маршрутизируется кадр по КОНСТРУКТОРУ из тела (frameKey).
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
  // meta — происхождение кадра (pts/catchUp); funnel — единственное место, которое
  // его знает, поэтому проставляет здесь, а не выше по стеку.
  dispatch: (key: string, d: unknown, meta?: EventMeta) => void
  // GET /channels/{id}/difference?pts=sincePts — типизированный конверт.
  getDifference: (peerId: number, sincePts: number) => Promise<ChannelDiff>
  loadPts: (peerId: number) => Promise<number | null>
  savePts: (peerId: number, pts: number) => void
}

// tweb: SYNC_DELAY — окно ожидания, что дыру закроют следующие живые кадры, прежде
// чем уходить в difference. Совпадает с глобальным PTS_SYNC_DELAY.
const SYNC_DELAY = 250

export function newChannelFunnel(deps: ChannelFunnelDeps) {
  const states = new Map<number, ChannelState>()

  function state(peerId: number): ChannelState {
    let st = states.get(peerId)
    if (!st) {
      st = { pts: 0, seeded: false, pending: newPendingPts(), syncing: false, timer: null }
      states.set(peerId, st)
    }
    return st
  }

  function advance(peerId: number, st: ChannelState, pts: number): void {
    if (pts > st.pts) { st.pts = pts; deps.savePts(peerId, pts) }
  }

  function clearTimer(st: ChannelState): void {
    if (st.timer) { clearTimeout(st.timer); st.timer = null }
  }

  // Слить подряд идущие буферные кадры после того, как next закрыл дыру. Кадры
  // в буфере — живые (пришли по WS, просто придержаны из-за переупорядочивания),
  // поэтому catchUp:false, даже если слив происходит после catchUp() (ветка ниже).
  function drainPending(peerId: number, st: ChannelState): void {
    if (!st.pending.has()) return
    st.pending.drain(() => st.pts, (item) => {
      deps.dispatch(item.key, item.d, { pts: item.pts, catchUp: false })
      advance(peerId, st, item.pts)
    })
    if (!st.pending.has()) clearTimer(st)
  }

  function scheduleSync(peerId: number, st: ChannelState): void {
    if (st.timer) return
    st.timer = setTimeout(() => {
      st.timer = null
      if (!st.pending.has()) return
      st.pending.clear()            // как tweb: difference сбрасывает придержанные
      void catchUp(peerId)
    }, SYNC_DELAY)
  }

  // Добор пропущенных апдейтов через типизированный difference (по порядку pts).
  // Сериализован per-channel флагом syncing; страхуемся от отсутствия прогресса.
  //
  // Сознательно НЕ шлёт rt:state_synchronizing/synchronized (Задача 1, ревью): в
  // tweb оба dispatch'а индикатора «Обновление…» гейтятся `!channelId &&`
  // (apiUpdatesManager.ts:462, :466) — канальный догон намеренно не зажигает этот
  // индикатор, только пер-юзерный /sync (см. syncEngine.onSyncStart/onSyncEnd).
  // Не добавлять сюда onSyncStart/onSyncEnd — это было бы отсебятиной сверх tweb.
  async function catchUp(peerId: number): Promise<void> {
    const st = state(peerId)
    if (st.syncing) return
    st.syncing = true
    try {
      for (;;) {
        const since = st.pts
        const r = await deps.getDifference(peerId, since)
        for (const u of r.updates) {
          if (u.pts <= st.pts) continue     // дубль (live уже применил)
          deps.dispatch(frameKey(u.t, u.d), u.d, { pts: u.pts, catchUp: true })
          advance(peerId, st, u.pts)
        }
        st.seeded = true
        if (!r.slice || st.pts <= since) break   // хвост исчерпан / нет прогресса
      }
    } catch { /* сеть моргнула — следующий gap/open доберёт */ } finally {
      st.syncing = false
      drainPending(peerId, state(peerId))
    }
  }

  return {
    // Живой канальный кадр (курсор канала выбран вызывающим по дискриминатору).
    // Та же арифметика dup/next/gap, что
    // и глобальный funnel, но против per-channel курсора.
    applyLive(peerId: number, key: string, pts: number, d: unknown): void {
      const st = state(peerId)
      // Первый живой кадр до сидирования курсора: принимаем его как базу (массовая
      // история — из REST-окна; funnel гейтит только живой хвост). Без реплея лога.
      if (!st.seeded) {
        st.seeded = true
        deps.dispatch(key, d, { pts, catchUp: false })
        advance(peerId, st, pts)
        return
      }
      if (st.syncing) return               // идёт catch-up — он переотдаст по порядку
      const cls = classifyPts(st.pts, pts)
      if (cls === 'dup') return
      if (cls === 'gap') {
        if (!st.pending.push({ key, pts, d })) { st.pending.clear(); clearTimer(st); void catchUp(peerId); return }
        scheduleSync(peerId, st)
        return
      }
      deps.dispatch(key, d, { pts, catchUp: false })
      advance(peerId, st, pts)
      drainPending(peerId, st)
    },

    // Открытие канала: сид курсора из IDB + добор пропущенного с прошлого визита
    // (посты И метаданные). Без сохранённого pts — остаёмся несидированными: первый
    // живой кадр примет базу, а текущий контент/карточку даёт REST-загрузка.
    async open(peerId: number): Promise<void> {
      const st = state(peerId)
      if (st.seeded) { void catchUp(peerId); return }
      const stored = await deps.loadPts(peerId)
      if (typeof stored === 'number' && stored > 0) {
        st.pts = stored
        st.seeded = true
        void catchUp(peerId)
      }
    },

    // Закрытие канала: сбросить транзиентные буфер/таймер, сохранённый курсор оставить.
    close(peerId: number): void {
      const st = states.get(peerId)
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
