/**
 * ВРЕМЕННО до 2C-12 (план 2C `docs/superpowers/plans/2026-09-27-wave-2c-popups-solid.md`,
 * «Задача 12: устройство вывода → 2D-26»): React-мост попапа выбора устройства.
 *
 * Имя, путь и сигнатура — tweb `components/rtmp/outputDevicePopup.tsx:18-30`
 * (812502980), поэтому Solid-вызывающий (`call/callDeviceSettings.solid.tsx`)
 * зовёт `showOutputDevicePopup(options)` ровно как оригинал; задача 2C-12
 * заменяет этот файл Solid-портом (`PopupElement` + `RadioFieldTsx`) и удаляет
 * его вместе со стилями `outputDevicePopup.module.scss`.
 *
 * Поведение оригинала, которое мост уже держит: показ после
 * `enumerateDevices` (`:110-116`), пересписок по `devicechange` (`:61-67`),
 * «Default» первым и отсев заглушек `''`/`'default'` (`:75-89`), однократный
 * `onStaleCurrentId`, если выбранного устройства больше нет (`:45-57`),
 * заголовок `titleLangKey || 'Rtmp.OutputPopup.Title'`, «Save» → `onPick`.
 *
 * Попап открывается через глобальный `popupStore` (`PopupHost` — в React-дереве
 * шелла), как мосты корня настроек (`sidebarLeft/settingsPopups.tsx`).
 */
import { useEffect, useRef, useState } from 'react'
import type { LangPackKey } from '@/lang'
import { openPopup, type PopupApi } from '@stores/popupStore'
import Popup from '../../shared/ui/Popup'
import Text from '../../shared/ui/Text'
import { useT } from '../../i18n'
import { useMiddlewareHelper } from '@core/hooks/useMiddlewareHelper'
import s from './outputDevicePopup.module.scss'

export type OutputDevicePopupOptions = {
  kind: MediaDeviceKind
  currentId?: string
  titleLangKey?: LangPackKey
  onPick: (deviceId: string) => void
  // Fires when `currentId` is set but missing from the live enumerateDevices
  // list (e.g. the user unplugged the device since picking it). Callers wire
  // this to clear the matching `appSettings.callDevices.*` field so the
  // picker UI and the persisted state agree on "Default is now selected".
  onStaleCurrentId?: () => void
}

function OutputDevicePopup({ api, options }: { api: PopupApi, options: OutputDevicePopupOptions }) {
  const t = useT()
  const [chosenDeviceId, setChosenDeviceId] = useState(options.currentId || '')
  const [devices, setDevices] = useState<MediaDeviceInfo[] | undefined>(undefined)
  const chosenRef = useRef(chosenDeviceId)
  chosenRef.current = chosenDeviceId
  const prunedStaleId = useRef(false)
  const middlewareHelper = useMiddlewareHelper()

  useEffect(() => {
    const scope = middlewareHelper.get().create()
    const middleware = scope.get()
    const refresh = () => {
      navigator.mediaDevices.enumerateDevices().then((list) => {
        if(!middleware()) return
        const filtered = list.filter((d) => d.kind === options.kind)
        setDevices(filtered)
        if(!prunedStaleId.current && chosenRef.current && !filtered.some((d) => d.deviceId === chosenRef.current)) {
          prunedStaleId.current = true
          setChosenDeviceId('')
          options.onStaleCurrentId?.()
        }
      }).catch(() => { if(middleware()) setDevices([]) })
    }
    refresh()
    navigator.mediaDevices.addEventListener?.('devicechange', refresh)
    return () => {
      scope.destroy()
      navigator.mediaDevices.removeEventListener?.('devicechange', refresh)
    }
  }, [options, middlewareHelper])

  if(!devices) return null

  const values = [
    { label: t('Rtmp.OutputPopup.Default'), value: '' },
    ...devices
      .filter((d) => d.deviceId && d.deviceId !== 'default')
      .map((d) => ({ label: d.label || d.deviceId, value: d.deviceId })),
  ]

  return (
    <Popup
      open={api.open}
      className="rtmp-output-popup"
      width={360}
      title={t(options.titleLangKey || 'Rtmp.OutputPopup.Title')}
      onClose={api.requestClose}
      onExitComplete={api.onExitComplete}
      action={{
        label: t('Save'),
        onClick: () => {
          options.onPick(chosenDeviceId)
          api.requestClose()
        },
      }}
    >
      <div className={s.options}>
        {values.map((o) => (
          <div key={o.value} className={s.option} onClick={() => setChosenDeviceId(o.value)}>
            <span className={s.radio} data-on={chosenDeviceId === o.value || undefined} />
            <Text size={16} color="var(--primary-text-color)">{o.label}</Text>
          </div>
        ))}
      </div>
    </Popup>
  )
}

export default function showOutputDevicePopup(options: OutputDevicePopupOptions): void {
  openPopup((api) => <OutputDevicePopup api={api} options={options} />, 'output-device')
}
