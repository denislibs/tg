// src/core/boosts/boostsStatus.ts
//
// Статус бустов канала — конструктор `premium.boostsStatus` схемы, а не
// плоская camelCase-копия рядом с ним.
//
// Что было и почему это дефект. Модель держала
// `{level, boostsCount, currentLevelBoosts, nextLevelBoosts, boostedByMe, slots}`,
// а провод и в ответе ручки, и в кадре `updateChannelBoostStatus` нёс
// конструктор. Стоило это одной вещи, и она видна в самом маппере:
//
//   `nextLevelBoosts: r.next_level_boosts ?? 0` — ПОСЛЕДНИЙ УРОВЕНЬ (порога
//   дальше нет вовсе, параметр не поставлен) склеивался с «порог равен нулю».
//   Дальше `boostProgress` разводил их обратно догадкой «span<=0 значит
//   максимум» — то есть отсутствие сначала теряли, потом восстанавливали.
//
// Число СВОБОДНЫХ слотов зрителя в конструктор не входит и здесь его нет: в
// схеме на этом месте `my_boost_slots` — вектор идентификаторов ЗАНЯТЫХ слотов,
// другой предмет под похожим именем. Оно едет рядом, полем ответа, — как и на
// бэкенде.

import type { BoostsStatus } from '../models'

/** Пара «статус + наши свободные слоты» — то, что отдаёт ручка и держит стор. */
export interface ChannelBoosts {
  status: BoostsStatus
  /** свободных слотов буста у зрителя (наше поле, не из схемы) */
  slots: number
}

/** Я бустил этот канал — БИТ конструктора, а не поле рядом. */
export function boostedByMe(status: BoostsStatus | undefined): boolean {
  return !!status?.pFlags?.my_boost
}

/**
 * Доля заполнения полосы текущего уровня [0..1] и сколько бустов осталось до
 * следующего (порог tweb: `(boosts - current) / (next - current)`).
 *
 * Последний уровень — ОТСУТСТВИЕ `next_level_boosts`: полоса полная, добирать
 * нечего. Это состояние теперь читается прямо из конструктора, а не выводится
 * из нуля, который прежде ставил маппер.
 */
export function boostProgress(status: BoostsStatus | undefined): { progress: number; need: number } {
  if (!status || status.next_level_boosts === undefined) return { progress: 1, need: 0 }
  const span = status.next_level_boosts - status.current_level_boosts
  const progress = span > 0
    ? Math.min(Math.max((status.boosts - status.current_level_boosts) / span, 0), 1)
    : 1
  return { progress, need: Math.max(status.next_level_boosts - status.boosts, 0) }
}

/**
 * Живой кадр канала поверх своего состояния.
 *
 * Тело кадра одно на всех подписчиков, поэтому пер-зрительского в нём нет и
 * быть не может: ни `pFlags.my_boost`, ни свободных слотов. Оба сохраняются из
 * прежнего состояния — то же правило, что у агрегата реакций.
 */
export function mergeBoosts(prev: ChannelBoosts | undefined, status: BoostsStatus): ChannelBoosts {
  if (!prev) return { status, slots: 0 }
  const merged: BoostsStatus = { ...status }
  if (prev.status.pFlags?.my_boost) merged.pFlags = { ...merged.pFlags, my_boost: true }
  return { status: merged, slots: prev.slots }
}
