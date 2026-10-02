/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/passkeys.tsx:1-131 (+ `passkeys.module.scss`,
 * 812502980) — вкладка «Passkeys» (`AppPasskeysTab`, `solidJsTabs/tabs.ts`). Задача
 * 21 плана волны 2D. Открывает её строка `Privacy.Passkeys` экрана
 * «Конфиденциальность» (tweb `privacyAndSecurity.tsx:156-160`, `:290-306`): список
 * ключей и сеттер стора приходят полезной нагрузкой — открывающий видит
 * удаление и создание сразу, без перечитывания.
 *
 * Состав — как у оригинала: одна секция с подписью `Privacy.Passkeys.Caption`
 * вне карточки (ссылка «Learn more» открывает интро-попап `showPasskeyPopup`),
 * `MediaHeader` со стикером `key` 100px и подзаголовком `Passkey.Subtitle`,
 * строки ключей (`key_filled`, жирное имя, «Created … • used …»; удаление — из
 * контекстного меню через `confirmationPopup`, строка гаснет до ответа сервера),
 * кнопка `Privacy.Passkey.Create` (`btn-primary primary btn-transparent`,
 * `add`), пока WebAuthn есть и лимит не выбран. Без ключей и без WebAuthn
 * вкладка закрывается сама.
 *
 * Расхождения с оригиналом:
 *  1. (О-50) Ветки эмодзи менеджера паролей (`software_emoji_id` →
 *     `Row.Media size="abitbigger"` с `wrapAdaptiveCustomEmoji`, `:61-72`) нет:
 *     сервер не хранит AAGUID ключа и эмодзи не отдаёт — у каждой строки
 *     иконка `key_filled`. С ней не перенесено и правило `.container
 *     { --custom-emoji-size }` модуля стилей: читать его некому.
 *  2. (О-51) `appConfig.passkeys_account_passkeys_max` → константа
 *     `PASSKEYS_ACCOUNT_PASSKEYS_MAX`: `help.getAppConfig` у нас нет, лимит
 *     зашит на сервере (`backend/internal/usecase/passkeys/passkeys.go`, `maxPasskeys`).
 *  3. `appAccountManager.deletePasskey(id)` → `tab.managers.auth.passkeyDelete(id)`
 *     (`core/managers/authManager.ts`, REST); `createPasskey` берёт менеджеры
 *     аргументом (`components/popups/passkey.ts`, расхождение 1 там).
 *  4. Константа среды `IS_WEB_AUTHN_SUPPORTED` → вызов `isWebAuthnSupported()`
 *     (`core/webauthnBrowser.ts`): наш разбор опций не требует
 *     `parseCreationOptionsFromJSON`, а вызов на месте даёт тестам подменить среду.
 *  5. Отказ подтверждения удаления и ошибка создания гасятся (`try/catch`,
 *     `then(…, noop)`): у оригинала это необработанные отказы промиса; тост об
 *     ошибке создания показывает сам `createPasskey`.
 *  6. `showPasskeyPopup` — мост к React-попапу до 2C-10
 *     (`sidebarLeft/settingsPopups.tsx`); `useHotReloadGuard` не нужен — HMR-ветки
 *     tweb не портированы, модули берутся импортом.
 */
import { createEffect, createSignal, For, Show } from 'solid-js'
import type { Passkey } from '@layer'
import noop from '@helpers/noop'
import { formatDate } from '@helpers/date'
import anchorCallback from '@helpers/dom/anchorCallback'
import { i18n } from '@lib/langPack'
import { wrapEmojiText } from '@lib/richtext'
import { isWebAuthnSupported } from '@core/webauthnBrowser'
import Button from '@components/buttonTsx.solid'
import MediaHeader from '@components/mediaHeader.solid'
import { confirmationPopup } from '@components/popups/popupPeer'
import { createPasskey } from '@components/popups/passkey'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import type { AppPasskeysTab } from '@components/solidJsTabs/tabs'
import { showPasskeyPopup } from '../settingsPopups'
import styles from './passkeys.module.scss'

type AppPasskeysTabClass = typeof AppPasskeysTab

/** О-51 (расхождение 2): лимит сервера, `maxPasskeys` в `usecase/passkeys`. */
const PASSKEYS_ACCOUNT_PASSKEYS_MAX = 10

const PasskeyItem = (passkey: Passkey) => {
  const [tab] = useSuperTab<AppPasskeysTabClass>()
  const [disabled, setDisabled] = createSignal(false)
  const subtitle = () => {
    const created = i18n('Privacy.Passkey.Created', [formatDate(new Date(passkey.date * 1000), { withTime: true })])
    if(!passkey.last_usage_date) return created
    const lastUsed = i18n('Privacy.Passkey.LastUsage', [formatDate(new Date(passkey.last_usage_date * 1000), { withTime: true })])
    return [created, ' • ', lastUsed]
  }
  return (
    <Row
      disabled={disabled()}
      contextMenu={{
        buttons: [{
          icon: 'delete',
          text: 'Delete',
          onClick: async() => {
            try {
              await confirmationPopup({
                titleLangKey: 'Passkey.Deletion.Title',
                descriptionLangKey: 'Passkey.Deletion.Text',
                button: {
                  langKey: 'Delete',
                  isDanger: true,
                },
              })
            } catch {
              return
            }

            setDisabled(true)
            tab.managers!.auth.passkeyDelete(passkey.id).catch(noop).finally(() => {
              tab.payload.setPasskeys((passkeys) => passkeys.filter((item) => item.id !== passkey.id))
            })
          },
          danger: true,
        }],
      }}
    >
      {/* tweb :61-72 — `software_emoji_id` → `Row.Media`: О-50 (расхождение 1) */}
      <Row.Icon icon="key_filled" />
      <Row.Title class="text-bold">{wrapEmojiText(passkey.name)}</Row.Title>
      <Row.Subtitle>{subtitle()}</Row.Subtitle>
    </Row>
  )
}

const PasskeysTab = () => {
  const [tab] = useSuperTab<AppPasskeysTabClass>()

  const onCreation = (passkey: Passkey) => {
    tab.payload.setPasskeys((passkeys) => [passkey, ...passkeys])
  }

  createEffect(() => {
    if(!tab.payload.passkeys.length && !isWebAuthnSupported()) {
      void tab.close()
    }
  })

  return (
    <Section
      caption="Privacy.Passkeys.Caption"
      captionArgs={[anchorCallback(() => showPasskeyPopup(onCreation))]}
    >
      <MediaHeader>
        <MediaHeader.Sticker name="key" size={100} />
        <MediaHeader.Subtitle color="secondary">{i18n('Passkey.Subtitle')}</MediaHeader.Subtitle>
      </MediaHeader>
      <div class={styles.items}>
        <For each={tab.payload.passkeys}>
          {PasskeyItem}
        </For>
        <Show
          when={
            isWebAuthnSupported() &&
            tab.payload.passkeys.length < PASSKEYS_ACCOUNT_PASSKEYS_MAX
          }
        >
          <Button
            text="Privacy.Passkey.Create"
            primaryTransparent
            icon="add"
            onClick={() => createPasskey(tab.managers!).then(onCreation, noop)}
          />
        </Show>
      </div>
    </Section>
  )
}

export default PasskeysTab
