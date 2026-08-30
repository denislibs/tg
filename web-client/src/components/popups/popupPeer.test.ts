// Тесты порта tweb `components/popups/peer.ts` + `simpleConfirmation.ts` (см.
// `popupPeer.ts` рядом — там же ссылки file:line на исходник). Как и
// `popupElement.test.ts`, гоняют НАСТОЯЩИЕ классы на реальном DOM (happy-dom),
// без моков.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initHotkeys } from '@core/hotkeys'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import type { AvatarManagers } from '@components/avatar'
import PopupElement from './popupElement'
import PopupPeer, { confirmationPopup } from './popupPeer'

// Ядро локализации наполняется побочным эффектом создания хранилища языка
// (`i18n/index.tsx`); в продукте этот импорт лежит на пути холодного старта
// (`main.tsx` → `client/boot.ts`). Здесь строятся узлы `i18n()` — без него ядро
// пусто и печатает имя ключа.
import '@/i18n'

afterEach(() => {
  document.body.replaceChildren()
  resetPeerMirror()
  vi.useRealTimers()
})

describe('confirmationPopup — порт tweb popups/peer.ts + simpleConfirmation.ts', () => {
  it('заголовок и описание попадают в разметку', () => {
    // отмену никто не проверяет в этом тесте — гасим необработанный reject
    void confirmationPopup({
      titleLangKey: 'ChatList.Context.DeleteChat',
      descriptionLangKey: 'AreYouSureDeleteSingleMessage',
      button: { langKey: 'Delete' }
    }).catch(() => {})

    const root = document.querySelector('.popup-confirmation') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.querySelector('.popup-title')?.textContent).toBe('Delete Chat')
    expect(root.querySelector('.popup-description')?.textContent).toBe('Are you sure you want to delete this message?')
  })

  it('клик по кнопке подтверждения резолвит промис, попап закрывается после исхода', async() => {
    vi.useFakeTimers()

    const promise = confirmationPopup({
      titleLangKey: 'ChatList.Context.DeleteChat',
      descriptionLangKey: 'AreYouSureDeleteSingleMessage',
      button: { langKey: 'Delete', isDanger: true }
    })

    const root = document.querySelector('.popup-confirmation') as HTMLElement
    const buttons = root.querySelectorAll<HTMLButtonElement>('.popup-button')
    expect(buttons).toHaveLength(2) // options.button + авто-Cancel (addCancelButton)

    const confirmButton = Array.from(buttons).find((b) => b.classList.contains('danger'))!
    confirmButton.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    await expect(promise).resolves.toBeUndefined()

    // не остаётся висеть: destroy() уже начался (клик сам зовёт hide()),
    // узел снимается по таймеру базы (popupElement.ts destroy(), 250мс)
    expect(document.body.contains(root)).toBe(true)
    vi.advanceTimersByTime(300)
    expect(document.body.contains(root)).toBe(false)
  })

  it('клик по Cancel реджектит промис, попап закрывается после исхода', async() => {
    vi.useFakeTimers()

    const promise = confirmationPopup({
      titleLangKey: 'ChatList.Context.DeleteChat',
      descriptionLangKey: 'AreYouSureDeleteSingleMessage',
      button: { langKey: 'Delete', isDanger: true }
    })

    const root = document.querySelector('.popup-confirmation') as HTMLElement
    const cancelButton = Array.from(root.querySelectorAll<HTMLButtonElement>('.popup-button'))
      .find((b) => !b.classList.contains('danger'))!
    cancelButton.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    await expect(promise).rejects.toBeUndefined()

    vi.advanceTimersByTime(300)
    expect(document.body.contains(root)).toBe(false)
  })

  it('Esc реджектит промис (отмена), а не оставляет попап висеть без исхода', async() => {
    vi.useFakeTimers()
    const deactivate = initHotkeys({})

    const promise = confirmationPopup({
      titleLangKey: 'ChatList.Context.DeleteChat',
      descriptionLangKey: 'AreYouSureDeleteSingleMessage',
      button: { langKey: 'Delete', isDanger: true }
    })

    const root = document.querySelector('.popup-confirmation') as HTMLElement

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    // closeAfterTimeout (реджект «на отмену без кнопки») стреляет через 250мс
    // после destroy(), которую Esc запускает синхронно через pushEsc → hide()
    vi.advanceTimersByTime(300)

    await expect(promise).rejects.toBeUndefined()
    expect(document.body.contains(root)).toBe(false)

    deactivate()
  })
})

describe('PopupPeer — аватар пира (peerId), раунд правок 1', () => {
  it('destroy() снимает подписку аватара на зеркало пиров: обновление карточки не трогает оторванный узел', () => {
    const ALICE = 90001
    const fillMirror = vi.fn(async() => {})
    const managers: AvatarManagers = { peers: { fillMirror } }

    const popup = PopupElement.createPopup(PopupPeer, 'popup-peer-avatar-test', {
      peerId: ALICE,
      titleLangKey: 'Notifications',
      descriptionLangKey: 'AreYouSureDeleteSingleMessage',
      buttons: [{ langKey: 'ChatList.Context.Mute' }],
      managers
    })
    popup.show()

    const avatarNode = document.querySelector('.popup-peer-avatar-test .avatar') as HTMLElement
    expect(avatarNode).not.toBeNull() // peer.ts:46-54 — узел аватарки в шапке
    // Карточки в зеркале ещё нет — ни инициалов, ни цвета (avatar.ts renderInner).
    expect(avatarNode.dataset.color).toBeUndefined()
    expect(avatarNode.childNodes.length).toBe(0)

    popup.forceHide() // destroy() сразу — включая middlewareHelper.destroy() (popupElement.ts, раунд правок 1)

    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ALICE, first_name: 'Алиса', pFlags: {} }] }])

    // Ровно тот класс утечки, что уже ловили в ленте («лента умирает на каждой
    // смене чата, а слушатели переживают её», web-client/CLAUDE.md → «Владение
    // фактами»): если бы `avatarNew` не отписался от зеркала при закрытии
    // попапа, этот upsert перерисовал бы ОТОРВАННЫЙ узел — появились бы
    // инициалы «А» и `data-color`. Узел остаётся ровно таким, каким был до
    // destroy() — подписка снята через `middleware.onClean` (avatar.ts).
    expect(avatarNode.dataset.color).toBeUndefined()
    expect(avatarNode.childNodes.length).toBe(0)
  })
})

describe('PopupPeer — body/zIndex/описание опционально, раунд правок 2 (задача 3)', () => {
  it('body:true форвардится в PopupElement — появляется .popup-body, потребитель кладёт в него свой узел', () => {
    const popup = PopupElement.createPopup(PopupPeer, 'popup-body-test', {
      titleLangKey: 'Notifications',
      buttons: [{ langKey: 'ChatList.Context.Mute' }],
      body: true,
    })
    popup.show()

    // .popup-body — узел создаёт PopupElement только при options.body (popupElement.ts,
    // `if(options.body)`); без форвардинга body в super() узла не было бы вовсе.
    expect(document.querySelector('.popup-body-test .popup-body')).not.toBeNull()
    popup.forceHide()
  })

  it('без descriptionLangKey — параграфа .popup-description нет вовсе (PopupMute его не задаёт)', () => {
    const popup = PopupElement.createPopup(PopupPeer, 'popup-no-description-test', {
      titleLangKey: 'Notifications',
      buttons: [{ langKey: 'ChatList.Context.Mute' }],
      // descriptionLangKey не передан — раньше это было бы TS-ошибкой (поле было
      // обязательным); опционально с раунда правок 2, реальный потребитель — PopupMute.
    })
    popup.show()

    expect(document.querySelector('.popup-no-description-test .popup-description')).toBeNull()
    popup.forceHide()
  })

  it('zIndex форвардится в PopupElement.style.zIndex — потребитель ConfirmDialog.tsx поверх React-оверлеев', () => {
    const popup = PopupElement.createPopup(PopupPeer, 'popup-zindex-test', {
      titleLangKey: 'Notifications',
      descriptionLangKey: 'AreYouSureDeleteSingleMessage',
      buttons: [{ langKey: 'OK' }],
      zIndex: 4300,
    })
    popup.show()

    const el = document.querySelector('.popup-zindex-test') as HTMLElement
    expect(el.style.zIndex).toBe('4300')
    popup.forceHide()
  })
})

describe('confirmationPopup — zIndex, раунд правок 2 (задача 3)', () => {
  it('zIndex доезжает до PopupElement через confirmationPopup', () => {
    const promise = confirmationPopup({
      titleLangKey: 'MediaEditor.DiscardChanges',
      descriptionLangKey: 'AreYouSureDeleteSingleMessage',
      button: { langKey: 'Discard' },
      zIndex: 90,
    })
    promise.catch(() => {})

    const el = document.querySelector('.popup-confirmation') as HTMLElement
    expect(el.style.zIndex).toBe('90')

    const cancelButton = Array.from(el.querySelectorAll<HTMLButtonElement>('.popup-button'))
      .find((b) => !b.classList.contains('danger'))!
    cancelButton.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
  })
})

describe('PopupPeer — checkboxes, раунд правок 3 (peer.ts:22, :96-124)', () => {
  it('checkboxes непуст — have-checkbox на container, label в шапке между описанием и кнопками', () => {
    const popup = PopupElement.createPopup(PopupPeer, 'popup-checkbox-test', {
      titleLangKey: 'DeleteSingleMessagesTitle',
      descriptionLangKey: 'AreYouSureDeleteSingleMessage',
      buttons: [{ langKey: 'Delete', isDanger: true, callback: () => {} }],
      checkboxes: [{ text: 'Also delete for Maya' }],
    })
    popup.show()

    const container = document.querySelector('.popup-checkbox-test .popup-container')!
    expect(container.classList.contains('have-checkbox')).toBe(true) // peer.ts:104

    const label = document.querySelector('.popup-checkbox-test .checkbox-field')!
    expect(label.querySelector('.checkbox-caption')!.textContent).toBe('Also delete for Maya')

    // порядок в шапке: описание, потом чекбокс, потом кнопки (peer.ts:63-126)
    const kids = Array.from(container.children).map((c) =>
      c.classList.contains('popup-description') ? 'description'
        : c.classList.contains('checkbox-field') ? 'checkbox'
          : c.classList.contains('popup-buttons') ? 'buttons'
            : c.classList.contains('popup-header') ? 'header'
              : c.tagName)
    expect(kids).toEqual(['header', 'description', 'checkbox', 'buttons'])
    popup.forceHide()
  })

  it('без чекбокса — не отмечен, колбэк кнопки получает ПУСТОЙ Set', () => {
    const onDelete = vi.fn()
    const popup = PopupElement.createPopup(PopupPeer, 'popup-checkbox-unchecked', {
      titleLangKey: 'DeleteSingleMessagesTitle',
      buttons: [{ langKey: 'Delete', isDanger: true, callback: onDelete }],
      checkboxes: [{ text: 'Also delete for Maya' }],
    })
    popup.show()

    const button = document.querySelector<HTMLButtonElement>('.popup-checkbox-unchecked .popup-button.danger')!
    button.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete.mock.calls[0][0]).toEqual(new Set())
  })

  it('чекбокс отмечен — колбэк кнопки получает Set с его подписью (peer.ts:111-121)', () => {
    const onDelete = vi.fn()
    const popup = PopupElement.createPopup(PopupPeer, 'popup-checkbox-checked', {
      titleLangKey: 'DeleteSingleMessagesTitle',
      buttons: [{ langKey: 'Delete', isDanger: true, callback: onDelete }],
      checkboxes: [{ text: 'Also delete for Maya' }],
    })
    popup.show()

    document.querySelector<HTMLInputElement>('.popup-checkbox-checked .checkbox-field-input')!.click()
    document.querySelector<HTMLButtonElement>('.popup-checkbox-checked .popup-button.danger')!.dispatchEvent(
      new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }),
    )

    expect(onDelete.mock.calls[0][0]).toEqual(new Set(['Also delete for Maya']))
  })

  it('checked:true — чекбокс предвзведён (tweb :64-66)', () => {
    const popup = PopupElement.createPopup(PopupPeer, 'popup-checkbox-preset', {
      titleLangKey: 'DeleteSingleMessagesTitle',
      buttons: [{ langKey: 'Delete' }],
      checkboxes: [{ text: 'Delete for all members', checked: true }],
    })
    popup.show()

    expect(document.querySelector<HTMLInputElement>('.popup-checkbox-preset .checkbox-field-input')!.checked).toBe(true)
  })

  it('без checkboxes вовсе — колбэк зовётся БЕЗ аргументов, не с пустым Set (peer.ts:96 — условная обёртка)', () => {
    const onDelete = vi.fn()
    const popup = PopupElement.createPopup(PopupPeer, 'popup-no-checkbox', {
      titleLangKey: 'DiscardVoiceMessageTitle',
      buttons: [{ langKey: 'Discard', isDanger: true, callback: onDelete }],
    })
    popup.show()

    document.querySelector<HTMLButtonElement>('.popup-no-checkbox .popup-button.danger')!.dispatchEvent(
      new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }),
    )

    expect(onDelete).toHaveBeenCalledWith() // ноль аргументов — не (new Set())
  })
})
