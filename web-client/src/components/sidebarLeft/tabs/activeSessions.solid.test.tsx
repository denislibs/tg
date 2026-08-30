/** @jsxImportSource solid-js */
/**
 * Тесты вкладки «Устройства» (`activeSessions.solid.tsx`). Гоняют НАСТОЯЩИЕ
 * классы на реальном DOM (happy-dom) — вкладку строит её же объявление
 * (`solidJsTabs/tabs.ts`), подтверждение показывает настоящий `PopupPeer`,
 * всплывашку — настоящий `toast`. Замокан ровно один шов — менеджеры
 * (`tab.managers`), то есть граница с воркером.
 *
 * Данные — конструкторы `authorization` ТАКИМИ, какими их шлёт наш бэкенд
 * (`internal/domain/mtaccount.go`): даты в СЕКУНДАХ эпохи, `pFlags` объектом у
 * КАЖДОЙ строки (у не-текущей — пустым), а адрес текущей сессии — НОЛЬ: её не
 * отзывают по hash, из неё выходят. По этому нулю вкладка и узнаёт свою
 * строку — единственную, которую нельзя завершить.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Authorization } from '@layer'
import type { Managers } from '@/client/bootstrap'
import { createSliderStub } from '@components/sliderTab.testStub'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import { hideToast } from '@components/toast'
import contextMenuController from '@helpers/contextMenuController'
import { loadLang, useI18nStore } from '@/i18n'
import { AppActiveSessionsTab } from '@components/solidJsTabs/tabs'

type Auth = Authorization.authorization

// Всё, кроме `hash`/`pFlags`/имени приложения, у обеих сессий одинаково —
// различия ниже задаются точечно, чтобы в тесте было видно, что именно важно.
const baseAuth = {
  _: 'authorization',
  device_model: 'Chrome',
  platform: 'browser',
  system_version: 'macOS',
  api_id: 0,
  app_name: 'Telegram Web',
  app_version: '1.0',
  date_created: 1_700_000_000,
  date_active: 1_700_000_100,
  ip: '1.2.3.4',
  country: 'Germany',
  region: '',
} as Omit<Auth, 'pFlags' | 'hash'>

// Адрес текущей сессии — ноль (см. докблок): отозвать её по hash нельзя.
const current = { ...baseAuth, hash: 0, pFlags: { current: true } } as Auth
// Под-объект флагов есть и у не-текущей строки, просто пустой.
const other = { ...baseAuth, hash: 2, pFlags: {}, app_name: 'Telegram Android', app_version: '11.2' } as Auth

function makeManagers() {
  const terminate = vi.fn<(id: number) => Promise<boolean>>(async() => true)
  const terminateOthers = vi.fn<() => Promise<boolean>>(async() => true)
  return {
    terminate,
    terminateOthers,
    managers: { sessions: { terminate, terminateOthers } } as unknown as Managers,
  }
}

async function openTab(authorizations: Auth[], managers: Managers) {
  const tab = new AppActiveSessionsTab(createSliderStub(), true)
  tab.managers = managers
  await tab.open({ authorizations })
  return tab
}

/** Правый клик по строке сессии — второй вход в то же завершение. */
function rightClick(row: Element) {
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
  return document.getElementById('active-sessions-contextmenu')!
}

/** Клик по строке сессии → подтверждение → кнопка «Terminate» в попапе. */
function confirmTerminate(tab: { scrollable: { container: HTMLElement } }, hash: number) {
  const row = tab.scrollable.container.querySelector<HTMLElement>(`.row[data-hash="${hash}"]`)!
  row.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

  const popup = document.querySelector('.popup-peer')!
  expect(popup).not.toBeNull()
  popup.querySelector<HTMLElement>('.popup-button:not(.popup-close)')!
    .dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
}

afterEach(async() => {
  // Контекстное меню — общий синглтон-контроллер: незакрытое меню утекает
  // в следующий тест классом `active`.
  contextMenuController.close()

  // Всплывашка — модульный синглтон: пока её узел висит в своём контейнере,
  // повторный `toast()` не переприкрепит контейнер к body и следующий тест
  // не увидит всплывашку вовсе. Гасим её ПО-НАСТОЯЩЕМУ (снятие узла у
  // `hideToast` отложено на 200мс), а не сносом поддерева body.
  if(document.querySelector('.toast')) {
    hideToast()
    await new Promise((r) => setTimeout(r, 250))
  }
  document.body.replaceChildren()

  // Язык — тоже общее состояние (`I18n.strings` + хранилище): тесты перевода ниже
  // переключают его по-настоящему, и следующий тест иначе читал бы русские подписи.
  if(useI18nStore.getState().lang !== 'en') {
    useI18nStore.setState({ lang: 'en' })
    await loadLang('en')
  }
})

describe('вкладка «Устройства» — порт tweb sidebarLeft/tabs/activeSessions.tsx', () => {
  it('текущая сессия идёт отдельной секцией, остальные — списком', async() => {
    const { managers } = makeManagers()
    const tab = await openTab([current, other], managers)

    const sections = tab.scrollable.container.querySelectorAll('.sidebar-left-section')
    expect(sections).toHaveLength(2)
    expect(sections[0].querySelector('.row-title')!.textContent).toBe('Telegram Web 1.0')
    expect(sections[0].querySelector('.row-midtitle')!.textContent).toBe('Chrome, macOS')
    expect(sections[1].querySelectorAll('.row[data-hash]')).toHaveLength(1)
    expect(sections[1].querySelector('.row-title')!.textContent).toBe('Telegram Android 11.2')
    // Дата последней активности стоит только у ЧУЖИХ сессий: у текущей она
    // бессмысленна («сейчас»), поэтому `titleRight` там `undefined`.
    expect(sections[0].querySelector('.row-title-right')).toBeNull()
    expect(sections[1].querySelector('.row-title-right')!.textContent).not.toBe('')
  })

  it('текущую сессию находит по флагу, а не по месту в списке', async() => {
    const { managers } = makeManagers()
    // Порядок обратный: `findAndSplice` дойдёт до текущей ЧЕРЕЗ чужую строку с
    // пустым `pFlags`. Именно так её и отдаёт провод — под-объект есть всегда.
    const tab = await openTab([other, current], managers)

    const sections = tab.scrollable.container.querySelectorAll('.sidebar-left-section')
    expect(sections[0].querySelector('.row')!.getAttribute('data-hash')).toBe('0')
    expect(sections[1].querySelectorAll('.row[data-hash]')).toHaveLength(1)
  })

  it('пустые поля не рисуют мусорных разделителей, платформа заменяет версию системы', async() => {
    const { managers } = makeManagers()
    // `system_version` пуст у сессий, заведённых не разбором User-Agent (вход
    // по QR), `country` — когда GeoIP не знает места. Оригинал собирает обе
    // строки через `filter(Boolean)`, поэтому дыры не превращаются в « - » и
    // в ", » на конце.
    const bare = { ...baseAuth, hash: 3, pFlags: {}, system_version: '', country: '' } as Auth
    const tab = await openTab([current, bare], managers)

    const row = tab.scrollable.container.querySelector('.row[data-hash="3"]')!
    expect(row.querySelector('.row-midtitle')!.textContent).toBe('Chrome, browser')
    expect(row.querySelector('.row-subtitle')!.textContent).toBe('1.2.3.4')
  })

  it('завершение сессии подтверждается попапом и снимает строку', async() => {
    const { terminate, managers } = makeManagers()
    const tab = await openTab([current, other], managers)

    confirmTerminate(tab, 2)

    await vi.waitFor(() =>
      expect(tab.scrollable.container.querySelector('.row[data-hash="2"]')).toBeNull())
    expect(terminate).toHaveBeenCalledWith(2)
  })

  it('без подтверждения сессию не гасит: один клик по строке только открывает попап', async() => {
    const { terminate, managers } = makeManagers()
    const tab = await openTab([current, other], managers)

    const row = tab.scrollable.container.querySelector<HTMLElement>('.row[data-hash="2"]')!
    row.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    expect(document.querySelector('.popup-peer')).not.toBeNull()
    await new Promise((r) => setTimeout(r, 0))
    expect(terminate).not.toHaveBeenCalled()
    expect(tab.scrollable.container.querySelector('.row[data-hash="2"]')).not.toBeNull()
  })

  it('клик по строке ТЕКУЩЕЙ сессии не предлагает её завершить', async() => {
    const { managers } = makeManagers()
    const tab = await openTab([current, other], managers)

    const row = tab.scrollable.container.querySelector<HTMLElement>('.row[data-hash="0"]')!
    row.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    expect(document.querySelector('.popup-peer')).toBeNull()
  })

  it('на отказ FRESH_RESET_AUTHORISATION_FORBIDDEN показывает всплывашку', async() => {
    const { terminate, managers } = makeManagers()
    // Имя отказа приезжает полем `type` — его довозит через границу воркера
    // `superMessagePort.ts`, а на HTTP-границе им становится `error.text`
    // конструктора отказа (`net/restClient.ts`).
    //
    // `message` здесь НАМЕРЕННО другой: положи в оба поля одну строку — и
    // сверка по тексту сообщения прошла бы наравне со сверкой по имени
    // отказа, то есть тест перестал бы отличать одно от другого. Ветвиться
    // надо по названной причине, а не по человеческой фразе: её меняют, не
    // задумываясь, при первой же правке текстов.
    terminate.mockRejectedValue(Object.assign(
      new Error('не удалось завершить сессию'),
      { type: 'FRESH_RESET_AUTHORISATION_FORBIDDEN' }))
    const tab = await openTab([current, other], managers)

    confirmTerminate(tab, 2)

    await vi.waitFor(() => expect(document.querySelector('.toast')).not.toBeNull())
    expect(document.querySelector('.toast')!.textContent)
      .toContain('For security reasons')
    // строка на месте: сессия не завершена
    expect(tab.scrollable.container.querySelector('.row[data-hash="2"]')).not.toBeNull()
  })

  it('«завершить все прочие» подтверждается попапом и убирает всю секцию прочих', async() => {
    const { terminateOthers, managers } = makeManagers()
    const tab = await openTab([current, other], managers)

    const btn = tab.scrollable.container.querySelector<HTMLElement>('.sidebar-left-section-content .btn-primary.danger')!
    btn.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    document.querySelector<HTMLElement>('.popup-peer .popup-button:not(.popup-close)')!
      .dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    await vi.waitFor(() =>
      expect(tab.scrollable.container.querySelectorAll('.sidebar-left-section')).toHaveLength(1))
    expect(terminateOthers).toHaveBeenCalled()
  })

  it('кнопки «завершить все прочие» нет, когда прочих сессий нет', async() => {
    const { managers } = makeManagers()
    const tab = await openTab([current], managers)

    expect(tab.scrollable.container.querySelectorAll('.sidebar-left-section')).toHaveLength(1)
    expect(tab.scrollable.container.querySelector('.btn-primary.danger')).toBeNull()
  })

  it('правый клик по чужой строке открывает меню, а его «Terminate» доводит до подтверждения', async() => {
    const { terminate, managers } = makeManagers()
    const tab = await openTab([current, other], managers)

    // Пинит саму проводку `attachContextMenuListener`: без неё меню не
    // открывается и весь этот вход в завершение сессии недостижим.
    const menu = rightClick(tab.scrollable.container.querySelector('.row[data-hash="2"]')!)
    expect(menu.classList.contains('active')).toBe(true)

    menu.querySelector<HTMLElement>('.btn-menu-item')!
      .dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    document.querySelector<HTMLElement>('.popup-peer .popup-button:not(.popup-close)')!
      .dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    await vi.waitFor(() =>
      expect(tab.scrollable.container.querySelector('.row[data-hash="2"]')).toBeNull())
    expect(terminate).toHaveBeenCalledWith(2)
  })

  it('пункт контекстного меню ПЕРЕВЕДЁН, а не показывает сырой ключ', async() => {
    // Боевой дефект, найденный живой проверкой стенда: в `ButtonMenuSync` уезжал
    // ключ `'Terminate'`, а `ButtonMenuItem` ждал ГОТОВУЮ строку — переводил
    // вызывающий. В русском интерфейсе пункт меню показывал «Terminate», хотя
    // `Terminate: 'Завершить'` в словаре есть и всё остальное на вкладке
    // переведено (`Button`/`Row`/`SettingSection` переводили у себя — на этой
    // разнице дефект и вырос). Задача 7 свела обе стороны на `LangPackKey`.
    //
    // Язык переключается ПО-НАСТОЯЩЕМУ (настоящий `dict.ru`), а не подменой
    // переводчика: подпись строит `i18n()` ядра, и подмена `t()` в хранилище на
    // неё уже не влияет — проверка на подмене зеленела бы, ничего не проверяя.
    const { managers } = makeManagers()
    useI18nStore.setState({ lang: 'ru' })
    await loadLang('ru')

    const tab = await openTab([current, other], managers)
    const menu = rightClick(tab.scrollable.container.querySelector('.row[data-hash="2"]')!)

    expect(menu.querySelector('.btn-menu-item-text')!.textContent).toBe('Завершить')
  })

  it('правый клик по строке ТЕКУЩЕЙ сессии не открывает меню — свою сессию не завершить и отсюда', async() => {
    const { terminate, managers } = makeManagers()
    const tab = await openTab([current, other], managers)

    const menu = rightClick(tab.scrollable.container.querySelector('.row[data-hash="0"]')!)
    expect(menu.classList.contains('active')).toBe(false)

    // Второй рубеж: даже если до пункта меню дотянуться руками, закрытое меню
    // его не исполняет (`ButtonMenuItem` требует класс `active`), значит и
    // подтверждения не будет.
    menu.querySelector<HTMLElement>('.btn-menu-item')!
      .dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    expect(document.querySelector('.popup-peer')).toBeNull()
    expect(terminate).not.toHaveBeenCalled()
  })

  it('язык, сменённый при открытой вкладке, доезжает до кнопки подтверждения', async() => {
    const { managers } = makeManagers()
    const tab = await openTab([current, other], managers)

    // Язык обязан читаться в ТОЧКЕ ПРИМЕНЕНИЯ, а не сниматься один раз на открытии
    // вкладки: попап строится позже. (Перерисовку УЖЕ построенных узлов проверяет
    // `i18nContract.test.ts` — она возможна только для узлов, вставленных В ДОКУМЕНТ:
    // `applyLangPack` обходит `document.querySelectorAll('.i18n')`, а дерево вкладки
    // в этом тесте живёт отдельно от `document`.)
    useI18nStore.setState({ lang: 'ru' })
    await loadLang('ru')

    tab.scrollable.container.querySelector<HTMLElement>('.row[data-hash="2"]')!
      .dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    expect(document.querySelector('.popup-peer .popup-button:not(.popup-close)')!.textContent)
      .toBe('Завершить')
  })

  it('на закрытии вкладки контекстное меню уходит из body', async() => {
    const { managers } = makeManagers()
    const tab = await openTab([current, other], managers)

    // Меню живёт в `document.body`, а НЕ внутри `tab.container` — значит его
    // не снимает ни `container.remove()` базового класса, ни очистка хоста
    // Solid. Единственный, кто может его убрать, — `onCleanup` содержимого,
    // то есть фактический вызов `dispose()` из `onCloseAfterTimeout`.
    expect(document.getElementById('active-sessions-contextmenu')).not.toBeNull()

    ;(tab as unknown as { onCloseAfterTimeout(): void }).onCloseAfterTimeout()

    expect(document.getElementById('active-sessions-contextmenu')).toBeNull()
  })
})
