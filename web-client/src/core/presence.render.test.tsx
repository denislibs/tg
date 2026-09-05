// ПОДПИСЬ ПРИСУТСТВИЯ ДОЕЗЖАЕТ ДО ЭКРАНА — и потому её сторожит общий пин на выдачу.
//
// Ревью вернуло в `core/presence.ts` символический ключ (`'Lately'` вместо
// «был(а) недавно») в ОБЕ ветки — «недавно» и «времени нет вовсе» — и весь прогон
// остался зелёным: пин `src/test/domKeyLeak.ts` смотрит на DOM, а этих двух веток не
// рендерил ни один тест. Пин не всевидящий, он МАССОВЫЙ: экран без компонентного теста
// он не видит по построению. Этот файл закрывает конкретно `presence.ts` — рендерит обе
// ветки на настоящем экране, где подпись и живёт.
//
// ЗАДАЧА #126 сменила механизм, и проверка сменилась вместе с ним. Подпись больше
// не строка, собранная тернарником `lang === 'ru'`, а УЗЕЛ ядра (`i18n(key)`),
// записанный в `I18n.weakMap`. Поэтому язык здесь переключается тем же входом, что
// в бою (`applyLang` → `I18n.applyServerLangPack`), а не полем `lang` в сторе:
// поле было зеркалом и на текст узла не влияет вовсе. И проверяется сверх текста
// то, чего у строки быть не могло, — что ядро переписывает ТОТ ЖЕ узел.
//
// Экран взят самый дешёвый из тех, что печатают `userStatusLabel`: «Добавить
// участников» (`AddMembersScreen` → `PeerSelector` → `.row-subtitle`). Кандидаты
// приезжают из адресной книги (`managers.contacts.list`), поэтому ни диалогов, ни
// зеркала пиров заводить не нужно.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import I18n from '@lib/langPack'
import { applyLang } from '../test/lang'
import AddMembersScreen from '../components/group/AddMembersScreen'
import { ManagersProvider } from './hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import type { Managers } from '../client/bootstrap'
import type { UserStatus } from './peers/peer'

// Уточка пустого состояния — рантайм tlottie (`LottieSticker.tsx`, Этап 2 плана
// «один движок lottie»): реальный плеер тянет WASM-воркер и canvas, которых под
// happy-dom нет (тот же приём, что в `PeerSelector.test.tsx`).
vi.mock('../components/LottieSticker', () => ({ default: () => null }))

const user = (id: number, name: string) => ({ _: 'user' as const, id, first_name: name })

const managers = {
  contacts: {
    list: vi.fn(async () => [
      { userId: 1, note: '', sharePhone: false, hasCustomPhoto: false, createdAt: '', user: user(1, 'Recently') },
      { userId: 2, note: '', sharePhone: false, hasCustomPhoto: false, createdAt: '', user: user(2, 'Never') },
    ]),
  },
  channels: { search: vi.fn(async () => ({ users: [] })) },
  media: { downloadMediaURL: vi.fn(async () => '') },
} as unknown as Managers

const presence: Record<number, UserStatus> = {
  // Ветка `userStatusRecently` (`presence.ts:41`).
  1: { _: 'userStatusRecently' },
  // Ветка «времени нет вовсе»: `userStatusOffline` с нулевым `was_online` уводит в
  // `lastSeenLabel(0)` (`presence.ts:18`).
  2: { _: 'userStatusOffline', was_online: 0 },
}

const renderScreen = async () => {
  await act(async () => {
    render(
      <ManagersProvider managers={managers}>
        <AddMembersScreen chatId={10} existingIds={[]} onClose={() => {}} onAdded={() => {}} />
      </ManagersProvider>,
    )
  })
}

describe('подпись присутствия на экране «Добавить участников»', () => {
  beforeEach(() => {
    useChatsStore.setState({ presence })
  })
  afterEach(() => {
    cleanup()
    useChatsStore.setState({ presence: {} })
  })

  // Обе ветки обязаны ПОПАСТЬ В DOM — иначе общий пин на выдачу их снова не увидит, а
  // проверка ниже зеленела бы на пустом экране.
  it('обе ветки без времени напечатаны текстом, а не ключом', async () => {
    await renderScreen()
    const subtitles = [...document.querySelectorAll('.row-subtitle')].map((n) => n.textContent)
    expect(subtitles).toEqual(['last seen recently', 'last seen recently'])
    expect(screen.getByText('Recently')).toBeTruthy()
  })

  // Подпись — ИНСТАНС ядра, а не текст. Это и есть то, чего не могла дать прежняя
  // сборка строкой: узел, которого нет в `weakMap`, `applyLangPack` обходит молча.
  it('подпись — узел ядра, записанный в weakMap', async () => {
    await renderScreen()
    const nodes = [...document.querySelectorAll<HTMLElement>('.row-subtitle .i18n')]
    expect(nodes).toHaveLength(2)
    for (const node of nodes) expect(I18n.weakMap.get(node)).toBeDefined()
  })

  // Язык подписи ведёт ЯДРО: смена пакета переписывает ТОТ ЖЕ узел, без пересборки
  // экрана. Прежняя редакция этого теста двигала поле `lang` в сторе — оно зеркало
  // ответа ядра и на текст не влияет; проверка держалась на том, что подпись
  // пересобиралась строкой при перерисовке.
  it('смена языка переписывает те же узлы — их ведёт ядро', async () => {
    await renderScreen()
    const nodes = [...document.querySelectorAll<HTMLElement>('.row-subtitle .i18n')]
    expect(nodes.map((n) => n.textContent)).toEqual(['last seen recently', 'last seen recently'])

    await act(async () => { await applyLang('ru') })

    expect([...document.querySelectorAll('.row-subtitle .i18n')]).toEqual(nodes)
    expect(nodes.map((n) => n.textContent)).toEqual(['был(а) недавно', 'был(а) недавно'])

    await act(async () => { await applyLang('en') })
  })
})
