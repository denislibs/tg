// Порт tweb `src/helpers/string/toHHMMSS.ts:1-11` (812502980) — длительность в
// секундах строкой `ч:мм:сс` / `м:сс`. Первый потребитель — остаток срока
// ссылки-приглашения (`wrapLeftDuration`, `components/wrappers/wrapDuration.ts`).
// Расхождение: типы разрядов — `number | string`, а не `any` (строгий tsconfig).
export default function toHHMMSS(str: string | number, leadZero = false) {
  const sec_num = parseInt(str + '', 10)
  let hours: number | string = Math.floor(sec_num / 3600)
  let minutes: number | string = Math.floor((sec_num - (hours * 3600)) / 60)
  let seconds: number | string = sec_num - (hours * 3600) - (minutes * 60)

  if(hours && hours < 10 && leadZero) hours = '0' + hours
  if(minutes < 10 && (hours || leadZero)) minutes = '0' + minutes
  if(seconds < 10) seconds = '0' + seconds
  return (hours ? hours + ':' : '') + minutes + ':' + seconds
}
