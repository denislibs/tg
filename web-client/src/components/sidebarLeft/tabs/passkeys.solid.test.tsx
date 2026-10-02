/** @jsxImportSource solid-js */
/**
 * Вкладка «Passkeys» (`passkeys.solid.tsx`, порт tweb `sidebarLeft/tabs/passkeys.tsx`,
 * 812502980) — задача 21 плана волны 2D. Вкладка настоящая (`AppPasskeysTab` на
 * колоночном слайдере), список и сеттер — Solid-стор, как у открывающего в
 * оригинале (`privacyAndSecurity.tsx:179`). Подменены: сеть (`managers.auth`),
 * регистрация WebAuthn (`createPasskey`), попап подтверждения и интро-попап
 * (мост до 2C-10) — у каждого свой DOM-слой, предмет здесь — вкладка.
 *
 * Пины — на результат:
 *  • разметка HEAD: `MediaHeader` (стикер 100px, `Passkey.Subtitle`) и строки
 *    ключей внутри карточки, подпись `Privacy.Passkeys.Caption` вне её со ссылкой
 *    на интро-попап; строка — `key_filled`, жирное имя, «Created … • used …»;
 *  • удаление: меню `Delete` (danger) → подтверждение → строка `is-disabled` до
 *    ответа сервера → строки нет ни в DOM, ни в сторе открывающего;
 *  • кнопка создания — по WebAuthn и лимиту; созданный ключ — первой строкой;
 *  • без ключей и без WebAuthn вкладка закрывается сама;
 *  • на закрытии Solid-остров снят (DoD 5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'solid-js/store'
import type { Passkey } from '@layer'
import type { Managers } from '@/client/bootstrap'
import type SliderSuperTab from '@components/sliderTab'
import lang from '@/lang'
import { glyph } from '@core/tgico-icons'
import contextMenuController from '@helpers/contextMenuController'
import { AppPasskeysTab } from '@components/solidJsTabs/tabs'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'

const confirmationPopup = vi.hoisted(() => vi.fn(async(_options: unknown) => {}))
vi.mock('@components/popups/popupPeer', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmationPopup,
}))

const createPasskey = vi.hoisted(() => vi.fn<(managers: unknown) => Promise<Passkey>>())
vi.mock('@components/popups/passkey', () => ({ createPasskey }))

const showPasskeyPopup = vi.hoisted(() => vi.fn<(onCreation?: (passkey: Passkey) => void) => void>())
vi.mock('@components/sidebarLeft/settingsPopups', () => ({ showPasskeyPopup }))

const DATE = Math.floor(Date.parse('2025-03-04T10:00:00Z') / 1000)
const USED = Math.floor(Date.parse('2025-05-06T10:00:00Z') / 1000)

const passkey = (id: string, name: string, extra: Partial<Passkey> = {}): Passkey => ({
  _: 'passkey',
  id,
  name,
  date: DATE,
  ...extra,
})

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let host: InstalledSidebarLeft
let auth: { passkeyDelete: ReturnType<typeof vi.fn<(id: string) => Promise<void>>> }

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  vi.stubGlobal('PublicKeyCredential', class {})
  confirmationPopup.mockReset().mockResolvedValue(undefined)
  createPasskey.mockReset()
  showPasskeyPopup.mockReset()
  auth = { passkeyDelete: vi.fn(async() => {}) }

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = installSidebarLeft({ auth } as unknown as Managers, columnEl)
})

afterEach(async() => {
  contextMenuController.close()
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function open(list: Passkey[]) {
  const [passkeys, setPasskeys] = createStore(list)
  const tab = await host.openTab(AppPasskeysTab, { passkeys, setPasskeys })
  return { tab, passkeys }
}

const rows = (tab: SliderSuperTab) => [...tab.scrollable.container.querySelectorAll<HTMLElement>('.row')]
const rowTitle = (row: HTMLElement) => row.querySelector('.row-title:not(.row-title-right)')!
const createButton = (tab: SliderSuperTab) => [...tab.scrollable.container.querySelectorAll<HTMLElement>('button')]
  .find((b) => b.textContent!.endsWith(lang['Privacy.Passkey.Create']))

const openedMenuItem = () => vi.waitFor(() => {
  const item = document.querySelector<HTMLElement>('.btn-menu.active .btn-menu-item')
  if(!item) throw new Error('меню не открыто')
  return item
})

describe('«Passkeys» — разметка', () => {
  it('шапка вкладки — Privacy.Passkeys', async() => {
    const { tab } = await open([passkey('1', 'Chrome')])
    expect(tab.container.querySelector('.sidebar-header__title')!.textContent).toBe(lang['Privacy.Passkeys'])
  })

  it('одна секция: MediaHeader (стикер 100px, Passkey.Subtitle), затем строки и кнопка в `items`', async() => {
    const { tab } = await open([passkey('1', 'Chrome')])
    const sections = tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')
    expect(sections).toHaveLength(1)

    const content = sections[0].querySelector<HTMLElement>('.sidebar-left-section-content')!
    const [header, items] = [...content.children] as HTMLElement[]
    expect(header.querySelector('[style*="--sticker-size: 100px"]')).not.toBeNull()
    expect(header.textContent).toBe(lang['Passkey.Subtitle'])
    expect(items.querySelectorAll('.row')).toHaveLength(1)
    expect(items.lastElementChild!.tagName).toBe('BUTTON')
  })

  it('подпись Privacy.Passkeys.Caption — вне карточки; ссылка открывает интро-попап', async() => {
    const { tab } = await open([passkey('1', 'Chrome')])
    const container = tab.scrollable.container.querySelector<HTMLElement>('.sidebar-left-section-container')!
    const caption = container.querySelector<HTMLElement>(':scope > .sidebar-left-section-caption')!
    expect(caption).not.toBeNull()
    // ` >` словаря — иконка `next` (`superFormatter`, tweb `langPack.ts:349-356`)
    const link = caption.querySelector<HTMLAnchorElement>('a')!
    expect(caption.textContent!.startsWith('Your passkey is stored securely in your password manager. Learn more')).toBe(true)
    expect(link.querySelector('.tgico')!.textContent).toBe(glyph('next'))

    link.click()
    expect(showPasskeyPopup).toHaveBeenCalledTimes(1)
  })

  it('строка ключа: key_filled, жирное имя, «Created …» без даты использования', async() => {
    const { tab } = await open([passkey('1', 'Chrome')])
    const [row] = rows(tab)
    expect(row.querySelector('.row-icon')!.textContent).toBe(glyph('key_filled'))
    expect(rowTitle(row).classList.contains('text-bold')).toBe(true)
    expect(rowTitle(row).textContent).toBe('Chrome')
    const subtitle = row.querySelector('.row-subtitle')!.textContent!
    expect(subtitle.startsWith('Created ')).toBe(true)
    expect(subtitle).not.toContain('•')
  })

  it('с датой использования подзаголовок — «Created … • used …»', async() => {
    const { tab } = await open([passkey('1', 'Chrome', { last_usage_date: USED })])
    expect(rows(tab)[0].querySelector('.row-subtitle')!.textContent).toMatch(/^Created .+ • used .+$/)
  })
})

describe('«Passkeys» — удаление', () => {
  it('меню Delete (danger) → подтверждение Passkey.Deletion.* → строка гаснет, затем исчезает из DOM и стора', async() => {
    let resolveDelete!: () => void
    auth.passkeyDelete.mockReturnValue(new Promise<void>((resolve) => { resolveDelete = resolve }))
    const { tab, passkeys } = await open([passkey('1', 'Chrome'), passkey('2', 'Safari')])

    const row = rows(tab)[0]
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    const item = await openedMenuItem()
    expect(item.classList.contains('danger')).toBe(true)
    expect(item.querySelector('.btn-menu-item-text')!.textContent).toBe(lang.Delete)
    item.click()

    await vi.waitFor(() => expect(auth.passkeyDelete).toHaveBeenCalledWith('1'))
    expect(confirmationPopup).toHaveBeenCalledWith(expect.objectContaining({
      titleLangKey: 'Passkey.Deletion.Title',
      descriptionLangKey: 'Passkey.Deletion.Text',
      button: { langKey: 'Delete', isDanger: true },
    }))
    expect(row.classList.contains('is-disabled')).toBe(true)
    expect(rows(tab)).toHaveLength(2)

    resolveDelete()
    await vi.waitFor(() => expect(rows(tab)).toHaveLength(1))
    expect(rowTitle(rows(tab)[0]).textContent).toBe('Safari')
    expect(passkeys.map((p) => p.id)).toEqual(['2'])
  })

  it('отказ в подтверждении — сеть не зовётся, строка на месте', async() => {
    confirmationPopup.mockRejectedValue(undefined)
    const { tab } = await open([passkey('1', 'Chrome')])

    rows(tab)[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    ;(await openedMenuItem()).click()
    await vi.waitFor(() => expect(confirmationPopup).toHaveBeenCalled())
    await pause(0)

    expect(auth.passkeyDelete).not.toHaveBeenCalled()
    expect(rows(tab)[0].classList.contains('is-disabled')).toBe(false)
  })
})

describe('«Passkeys» — создание', () => {
  it('кнопка Privacy.Passkey.Create — btn-primary primary btn-transparent с иконкой add', async() => {
    const { tab } = await open([passkey('1', 'Chrome')])
    const button = createButton(tab)!
    expect([...button.classList]).toEqual(expect.arrayContaining(['btn-primary', 'primary', 'btn-transparent']))
    expect(button.querySelector('.tgico')!.textContent).toBe(glyph('add'))
  })

  it('созданный ключ встаёт первой строкой и попадает в стор открывающего', async() => {
    createPasskey.mockResolvedValue(passkey('9', 'Firefox'))
    const { tab, passkeys } = await open([passkey('1', 'Chrome')])

    createButton(tab)!.click()

    await vi.waitFor(() => expect(rows(tab)).toHaveLength(2))
    expect(rowTitle(rows(tab)[0]).textContent).toBe('Firefox')
    expect(passkeys.map((p) => p.id)).toEqual(['9', '1'])
  })

  it('ошибка создания — список не меняется', async() => {
    createPasskey.mockRejectedValue(new Error('NotAllowedError'))
    const { tab } = await open([passkey('1', 'Chrome')])

    createButton(tab)!.click()
    await vi.waitFor(() => expect(createPasskey).toHaveBeenCalled())
    await pause(0)

    expect(rows(tab)).toHaveLength(1)
  })

  it('лимит (10 ключей) — кнопки нет', async() => {
    const list = Array.from({ length: 10 }, (_, i) => passkey(String(i + 1), 'Key ' + (i + 1)))
    const { tab } = await open(list)
    expect(createButton(tab)).toBeUndefined()
  })

  it('без WebAuthn — кнопки нет, а вкладка с ключами остаётся открытой', async() => {
    vi.stubGlobal('PublicKeyCredential', undefined)
    const { tab } = await open([passkey('1', 'Chrome')])
    expect(createButton(tab)).toBeUndefined()
    await pause(400)
    expect(tab.container.isConnected).toBe(true)
  })
})

describe('«Passkeys» — жизненный цикл', () => {
  it('без ключей и без WebAuthn вкладка закрывается сама', async() => {
    vi.stubGlobal('PublicKeyCredential', undefined)
    const { tab } = await open([])
    await vi.waitFor(() => expect(tab.container.isConnected).toBe(false), { timeout: 2000 })
  })

  it('после закрытия Solid-остров снят: строк в DOM нет (DoD 5)', async() => {
    const { tab } = await open([passkey('1', 'Chrome')])
    expect(document.querySelectorAll('.row').length).toBeGreaterThan(0)

    tab.close()
    await pause(400)

    expect(document.querySelectorAll('.row')).toHaveLength(0)
    expect(tab.container.isConnected).toBe(false)
  })
})
