// Порт tweb `src/helpers/formatDuration.ts:1-54` (812502980) — разложение
// длительности в секундах на разряды (`showLast` старших ненулевых). Первый
// потребитель — «Автоудаление» (свой срок вне списка,
// `sidebarLeft/tabs/autoDeleteMessages/options.ts`).
//
// Расхождения с оригиналом: `m` в таблице разрядов — обязательное поле (у tweb
// `m?: number` при `strict: false`, но задано у всех).
export enum DurationType {
  Seconds,
  Minutes,
  Hours,
  Days,
  Weeks,
  Months,
  Years,
}

/** Тип результата `formatDuration` (tweb `:18`). */
export type FormattedDuration = { duration: number, type: DurationType }[]

export default function formatDuration(duration: number, showLast = 2): FormattedDuration {
  if(!duration) {
    duration = 1
  }

  const d: FormattedDuration = []
  const p: Array<{ m: number, t: DurationType }> = [
    { m: 1, t: DurationType.Seconds },
    { m: 60, t: DurationType.Minutes },
    { m: 60, t: DurationType.Hours },
    { m: 24, t: DurationType.Days },
    { m: 7, t: DurationType.Weeks },
    { m: 365 / 12 / 7, t: DurationType.Months },
    { m: 12, t: DurationType.Years },
  ]
  const s = 1
  let t = s
  p.forEach((o, idx) => {
    t = Math.round(t * o.m)

    if(duration < t) {
      return
    }

    let dd = duration / t
    if(idx !== (p.length - 1)) {
      const modulus = p[idx === (p.length - 1) ? idx : idx + 1].m
      dd %= modulus
    }

    d.push({
      duration: dd | 0,
      type: o.t,
    })
  })

  const out = d.slice(-showLast).reverse()
  for(let i = out.length - 1; i >= 0; --i) {
    if(out[i].duration === 0) {
      out.splice(i, 1)
    }
  }

  return out
}
