// Порт `tweb/src/components/chat/bubbleParts/pollMessageContent/roundPercents.ts`
// — округление долей опроса методом НАИБОЛЬШИХ ОСТАТКОВ.
//
// Наивное `Math.round` по каждому варианту не годится: 33.3/33.3/33.3 дало бы
// «33% 33% 33%» (сумма 99), а 16.6/16.6/66.6 — «17% 17% 67%» (сумма 101).
// Оригинал раздаёт недостающие проценты по убыванию дробной части, поэтому
// сумма показанных чисел ВСЕГДА ровно 100 — это видимое свойство, и тест ниже
// пинует именно его, а не форму вызова.
import type { PollResults } from '@core/media/messageMedia'

/** tweb roundPercents.ts:3-26 — 1:1. */
export function roundPercents(percents: number[]): number[] {
  const base = percents.map(Math.floor)

  const remainders = percents.map((p, i) => ({
    index: i,
    remainder: p - base[i],
  }))

  const sum = base.reduce((a, b) => a + b, 0)
  const diff = 100 - sum

  remainders.sort((a, b) => {
    // Равные остатки разводит БОЛЬШАЯ целая часть: лишний процент достаётся
    // варианту, который и так крупнее (tweb :16).
    if (a.remainder === b.remainder) return base[b.index] - base[a.index]
    return b.remainder - a.remainder
  })

  const mxI = Math.min(diff, remainders.length)

  for (let i = 0; i < mxI; i++) {
    base[remainders[i].index]++
  }

  return base
}

/**
 * tweb roundPercents.ts:28-38 — 1:1.
 *
 * Знаменатель — СУММА ГОЛОСОВ ПО ВАРИАНТАМ, а не `total_voters`: при
 * мультивыборе один человек голосует за несколько вариантов, и деление на число
 * людей дало бы в сумме больше 100%.
 */
export const getRoundedPercentsFromResults = (pollResults?: PollResults): number[] => {
  const results = pollResults?.results
  if (!results) return []

  const totalVotes = results.reduce((acc, r) => acc + (r.voters ?? 0), 0)
  // `new Array(n).fill(0)` оригинала — тем же по значению `map`: линтер не
  // пускает конструктор с одним аргументом (двусмысленность «длина или
  // элемент»), а результат идентичен.
  if (!totalVotes) return results.map(() => 0)

  return roundPercents(results.map((r) => (totalVotes ? ((r.voters ?? 0) / totalVotes) * 100 : 0)))
}
