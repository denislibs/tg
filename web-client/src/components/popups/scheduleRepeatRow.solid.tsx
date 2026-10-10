/** @jsxImportSource solid-js */
/**
 * Ряд «Повторять» календаря планирования — порт `RepeatRow` и `REPEAT_OPTIONS`
 * tweb `src/components/popups/scheduleSendingPopup.tsx:15-24`, `:110-155`
 * (812502980). Отдельным файлом, потому что календарь у нас — React-мост
 * (`popups/datePicker.bridge.ts`, ВРЕМЕННО до 2C-23), а ряд — Solid: мост
 * монтирует его островом в слот `bodyAfter` (tweb `datePicker.tsx:906-908`).
 *
 * ОСОЗНАННОЕ ОТСТУПЛЕНИЕ ОТ TWEB (решение пользователя 2026-10-10, Ф-5):
 * повтор отложенных доступен БЕЗ Telegram Premium. У оригинала щелчок по ряду
 * без премиума показывает тост `Schedule.Repeat.PremiumRequired` и выходит
 * (`:115-125`), а справа стоит замок `premium_lock` (`:149-151`); здесь гейта и
 * замка нет — ряд открывает выбор периода всем.
 */
import { createSignal } from 'solid-js'
import Row from '@components/rowTsx.solid'
import InlineSelect from '@components/sidebarLeft/tabs/passcodeLock/inlineSelect.solid'
import { i18n } from '@lib/langPack'

const DAY = 86400

/** tweb `:16-24` — период повтора в секундах (`schedule_repeat_period`). */
export const REPEAT_OPTIONS: { value: number, label: () => HTMLElement }[] = [
  { value: 0, label: () => i18n('Never') },
  { value: DAY, label: () => i18n('Schedule.Repeat.Daily') },
  { value: 7 * DAY, label: () => i18n('Schedule.Repeat.Weekly') },
  { value: 14 * DAY, label: () => i18n('Schedule.Repeat.Biweekly') },
  { value: 30 * DAY, label: () => i18n('Schedule.Repeat.Monthly') },
  { value: 91 * DAY, label: () => i18n('Schedule.Repeat.Every3Months') },
  { value: 182 * DAY, label: () => i18n('Schedule.Repeat.Every6Months') },
  { value: 365 * DAY, label: () => i18n('Schedule.Repeat.Yearly') },
]

/** tweb `RepeatRow` (`:110-155`) — без премиум-гейта (см. шапку). */
export default function ScheduleRepeatRow(props: { initValue: number, onChange: (value: number) => void }) {
  const [value, setValue] = createSignal(props.initValue)
  const [selectOpen, setSelectOpen] = createSignal(false)
  const [rowEl, setRowEl] = createSignal<HTMLElement>()

  return (
    <Row
      ref={setRowEl}
      clickable={() => setSelectOpen((v) => !v)}
      class="popup-schedule-repeat"
    >
      <Row.Title>{i18n('Schedule.Repeat')}</Row.Title>
      <Row.RightContent>
        <InlineSelect
          value={value()}
          onChange={(next: number) => {
            setValue(next)
            props.onChange(next)
            setSelectOpen(false)
          }}
          options={REPEAT_OPTIONS}
          parent={rowEl()!}
          isOpen={selectOpen()}
          onClose={() => setSelectOpen(false)}
        />
      </Row.RightContent>
    </Row>
  )
}
