// Порт tweb `src/components/sidebarLeft/tabs/autoDeleteMessages/options.ts:1-92`
// (812502980) — сроки автоудаления: список вкладки (Off / 1 день / 1 неделя /
// 1 месяц), барабан своего срока (1–6 дней, 1–3 недели, 1–6 месяцев, 1 год) и
// подбор подписи к произвольному периоду (±10% к ближайшему сроку барабана,
// иначе — `formatDuration`).
//
// Расхождения с оригиналом:
//  1. Константы срока — локальные, как в `dataAndStorage/storageQuota.solid.tsx`
//     (у tweb `lib/constants.ts:20-24`, модуля с ними у нас нет); месяц — 31 день.
//     Прежний React-экран писал месяц как 30 дней: такие периоды ±10% сводятся к
//     тем же «k месяцев» (`findMatchingCustomOption`).
import formatDuration, { DurationType } from '@helpers/formatDuration'
import { wrapFormattedDuration } from '@components/wrappers/wrapDuration'

const oneHourInSeconds = 60 * 60
const oneDayInSeconds = 24 * oneHourInSeconds
const oneWeekInSeconds = oneDayInSeconds * 7
const oneMonthInSeconds = oneDayInSeconds * 31
const oneYearInSeconds = oneDayInSeconds * 365

export type Option = {
  value: number
  label: () => Element
}

export type DetailedOption = Option & {
  duration: number
  type: DurationType
}

const makeOption = (value: number, duration: number, type: DurationType): DetailedOption => ({
  value,
  label: () => wrapFormattedDuration([{ duration, type }]),
  duration,
  type,
})

type GetDefaultOptionsArgs = {
  offLabel: () => Element
}

export const getDefaultOptions = ({ offLabel }: GetDefaultOptionsArgs): Option[] => [
  {
    value: 0,
    label: offLabel,
  },
  makeOption(oneDayInSeconds, 1, DurationType.Days),
  makeOption(oneWeekInSeconds, 1, DurationType.Weeks),
  makeOption(oneMonthInSeconds, 1, DurationType.Months),
]

export const customTimeOptions: DetailedOption[] = [
  makeOption(oneDayInSeconds, 1, DurationType.Days),
  makeOption(oneDayInSeconds * 2, 2, DurationType.Days),
  makeOption(oneDayInSeconds * 3, 3, DurationType.Days),
  makeOption(oneDayInSeconds * 4, 4, DurationType.Days),
  makeOption(oneDayInSeconds * 5, 5, DurationType.Days),
  makeOption(oneDayInSeconds * 6, 6, DurationType.Days),
  makeOption(oneWeekInSeconds, 1, DurationType.Weeks),
  makeOption(oneWeekInSeconds * 2, 2, DurationType.Weeks),
  makeOption(oneWeekInSeconds * 3, 3, DurationType.Weeks),
  makeOption(oneMonthInSeconds, 1, DurationType.Months),
  makeOption(oneMonthInSeconds * 2, 2, DurationType.Months),
  makeOption(oneMonthInSeconds * 3, 3, DurationType.Months),
  makeOption(oneMonthInSeconds * 4, 4, DurationType.Months),
  makeOption(oneMonthInSeconds * 5, 5, DurationType.Months),
  makeOption(oneMonthInSeconds * 6, 6, DurationType.Months),
  makeOption(oneYearInSeconds, 1, DurationType.Years),
]

export const allTimeOptionsForAutoDeleteIcon = [
  makeOption(oneHourInSeconds, 1, DurationType.Hours),
  makeOption(oneHourInSeconds * 2, 2, DurationType.Hours),
  makeOption(oneHourInSeconds * 3, 3, DurationType.Hours),
  makeOption(oneHourInSeconds * 4, 4, DurationType.Hours),
  makeOption(oneHourInSeconds * 5, 5, DurationType.Hours),
  makeOption(oneHourInSeconds * 6, 6, DurationType.Hours),
  makeOption(oneHourInSeconds * 7, 7, DurationType.Hours),
  makeOption(oneHourInSeconds * 8, 8, DurationType.Hours),
  ...customTimeOptions,
]

export function findBestMatchingOption<T extends Option>(period: number, options: T[]) {
  const threshold = 0.1
  const isCloseTo = (period: number, targetPeriod: number) => targetPeriod > 0 && Math.abs(period - targetPeriod) / targetPeriod < threshold

  for(const option of options) {
    if(isCloseTo(period, option.value)) return option
  }

  return null
}

export function findMatchingCustomOption(period: number) {
  return findBestMatchingOption(period, customTimeOptions)
}

export function findMatchingAutoDeleteIconOption(period: number) {
  return findBestMatchingOption(period, allTimeOptionsForAutoDeleteIcon)
}

export function findExistingOrCreateCustomOption(period: number): Option {
  return findMatchingCustomOption(period) || {
    label: () => wrapFormattedDuration(formatDuration(period)),
    value: period,
  }
}
