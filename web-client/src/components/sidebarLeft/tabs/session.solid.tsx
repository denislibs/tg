/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/session.tsx:1-157 (812502980) — экран
 * одной сессии (`AppSessionTab`, `solidJsTabs/tabs.ts`; у tweb появился в
 * 944b578e9). Открывает его строка «Устройств» (`activeSessions.solid.tsx`);
 * задача 9 плана волны 2D.
 *
 * Состав: шапка `MediaHeader` (иконка платформы на плашке реестра
 * `rowIconBackground`, имя устройства, «online» или дата активности), секция
 * `Info` (приложение, система, место + подпись про оценку по IP) и кнопка
 * завершения — только при `onTerminate` (у текущей сессии его нет).
 *
 * Расхождения с оригиналом:
 *  1. (О-8) Секции `AuthSessions.View.AcceptTitle` (`:112-143`, тумблеры
 *     «секретные чаты»/«входящие звонки» через
 *     `account.changeAuthorizationSettings`) нет: у бэкенда нет ни ручки, ни
 *     колонок `call_requests_disabled`/`encrypted_requests_disabled`. Вместе с
 *     ней не перенесены `changeSetting` (`:38-74`) и `onSettingsChanged`.
 *  2. Место (`region`, `country`) — у нас приезжает одной строкой в `country`
 *     (GeoIP, `backend/internal/domain/mtaccount.go`), `region` пуст; склейка —
 *     дословно, пустые части отбрасывает `filter(Boolean)`.
 *  3. `i18n`/`toastNew`/`rootScope` не нужны: без секции п. 1 экран не пишет в
 *     сеть сам — завершение приходит колбэком от списка, как у оригинала.
 */
import { Show } from 'solid-js'
import Button from '@components/buttonTsx.solid'
import { IconTsx } from '@components/iconTsx.solid'
import MediaHeader from '@components/mediaHeader.solid'
import Section from '@components/section.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import type { AppSessionTab } from '@components/solidJsTabs/tabs'
import { formatDate } from '@helpers/date'
import { getRowIconBackgroundImage } from '@helpers/rowIconBackground'
import getSessionPlatformIcon from '@helpers/sessionPlatformIcon'
import { i18n } from '@lib/langPack'
import SessionInfoRow from './sessionInfoRow.solid'
import styles from './sessionDetails.module.scss'

export default function SessionTab() {
  const [tab] = useSuperTab<typeof AppSessionTab>()

  const authorization = () => tab.payload.authorization
  const isCurrent = () => !!authorization().pFlags.current
  const icon = () => getSessionPlatformIcon(authorization())

  const application = () => [authorization().app_name, authorization().app_version].filter(Boolean).join(' ')
  const system = () => authorization().system_version || authorization().platform
  const location = () => [authorization().region, authorization().country].filter(Boolean).join(', ')

  const terminate = async() => {
    if(await tab.payload.onTerminate!()) {
      void tab.close()
    }
  }

  const canTerminate = () => !!tab.payload.onTerminate

  return (
    <>
      <MediaHeader class={styles.heroHeader}>
        <MediaHeader.Sticker
          size={100}
          element={() => (
            <div
              class={styles.deviceIcon}
              style={{ 'background-image': getRowIconBackgroundImage(icon()) }}
            >
              <IconTsx icon={icon()} />
            </div>
          )}
        />
        <MediaHeader.Title class={styles.deviceName}>
          {authorization().device_model || application()}
        </MediaHeader.Title>
        <MediaHeader.Subtitle color="secondary">
          {isCurrent() ?
            i18n('Online') :
            formatDate(
              new Date(Math.max(authorization().date_active, authorization().date_created) * 1000),
              { withTime: true, shortMonth: true },
            )}
        </MediaHeader.Subtitle>
      </MediaHeader>

      <Section
        name="Info"
        caption={location() ? 'AuthSessions.View.LocationInfo' : undefined}
      >
        <SessionInfoRow label={i18n('AuthSessions.View.Application')} value={application()} />
        <SessionInfoRow label={i18n('AuthSessions.View.System')} value={system()} />
        <SessionInfoRow label={i18n('AuthSessions.View.Location')} value={location()} />
      </Section>

      {/* tweb :112-143 — секция AuthSessions.View.AcceptTitle: О-8 (расхождение 1) */}

      <Show when={canTerminate()}>
        <Section>
          <Button
            class="btn-primary btn-transparent danger"
            icon="stop"
            text="AuthSessions.View.TerminateSession"
            onClick={terminate}
          />
        </Section>
      </Show>
    </>
  )
}
