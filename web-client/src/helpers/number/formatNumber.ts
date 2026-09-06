// Порт tweb `helpers/number/formatNumber.ts` — компактная форма числа
// («12.5K», «1.23M»), которой оригинал печатает счётчики.
//
// `fmtViews` (`core/format/fmtViews.ts`) — наша более ранняя и более грубая
// версия того же (всегда один знак после запятой, потолок «M»); её зовут
// просмотры поста и счётчик комментариев. Свести их в один вызов здесь нельзя:
// у оригинала точность — аргумент вызова (`formatNumber(views, 1)` против
// `formatNumber(count)` у реакции), а оба этих места правятся в параллельных
// ветках.

export default function formatNumber(n: number, decimals = 2): string {
  if (n === 0) return '0'
  if (n < 0) return '-' + formatNumber(-n, decimals)

  const k = 1000
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['', 'K', 'M', 'B', 'T']

  // Показатель степени сверху ничем не ограничен, поэтому его прижимают к
  // последней доступной единице: иначе индекс уехал бы за `sizes` и сумма с
  // `undefined` дала бы NaN вместо строки.
  const i = Math.min(Math.floor(Math.log(n) / Math.log(k)), sizes.length - 1)

  return parseFloat((n / Math.pow(k, i)).toFixed(dm)) + sizes[i]
}
