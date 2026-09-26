/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/autoDownload/peerTypeSection.tsx:1-41
 * (812502980) — секция «Auto-download photos/videos/files»: четыре тумблера по
 * типам чатов, у файлов — ползунок размера после них. Разметка — дамп
 * `14-left-15b-settings-autodownload-photo` с классами HEAD (тумблер
 * `row-checkbox-field-toggle`, `docs/tweb/settings-rows.md` § 7).
 *
 * Расхождение с оригиналом: `CheckboxFieldTsx stateKey=settings.autoDownload.<тип>.<пир>`
 * (`:30-33`) → `checked`/`onChange` через `useAppSettings`: привязки поля к
 * состоянию по ключу (`stateKey`) у нашего `CheckboxField` нет — факт настроек
 * у нас zustand (шапка `checkboxFieldTsx.solid.tsx`, п. 1). Запись та же —
 * лист `autoDownload.<тип>.<пир>`, сразу на переключении, как у `stateKey`.
 */
import type { JSX } from 'solid-js'
import type { Middleware } from '@helpers/middleware'
import { i18n, type LangPackKey } from '@lib/langPack'
import { wrapSolidComponent } from '@helpers/solid/wrapSolidComponent'
import { useAppSettings } from '@stores/appSettings.solid'
import CheckboxFieldTsx from '@components/checkboxFieldTsx.solid'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'

export function autoDownloadPeerTypeSection(
  type: 'photo' | 'video' | 'file',
  title: LangPackKey,
  middleware: Middleware,
  /** Rendered after the per-peer-type toggles — the file tab's size limit slider. */
  children?: JSX.Element,
) {
  const [appSettings, setAppSettings] = useAppSettings()
  const options = [
    { key: 'contacts', title: 'AutodownloadContacts' },
    { key: 'private', title: 'AutodownloadPrivateChats' },
    { key: 'groups', title: 'AutodownloadGroupChats' },
    { key: 'channels', title: 'AutodownloadChannels' },
  ] as const

  return wrapSolidComponent(() => (
    <Section name={title}>
      {options.map((option) => (
        <Row>
          <Row.CheckboxFieldToggle>
            <CheckboxFieldTsx
              checked={appSettings.autoDownload[type][option.key]}
              onChange={(value) => setAppSettings('autoDownload', type, option.key, value)}
              toggle
            />
          </Row.CheckboxFieldToggle>
          <Row.Title>{i18n(option.title)}</Row.Title>
        </Row>
      ))}
      {children}
    </Section>
  ), middleware)
}
