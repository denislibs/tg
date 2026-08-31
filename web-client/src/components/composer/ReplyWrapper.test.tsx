// ПЛАШКА ПЕРЕСЫЛКИ: надпись — ФОРМА ЧИСЛА, а не «надпись плюс (N)».
//
// Пин заведён финальным ревью волны i18n. До него плашка держала три плоских
// ключа (`Chat.Accessory.Forward.One`/`.Many`/`.Hidden`) и склеивала счётчик
// скобками сама, а у оригинала обе надписи — формы числа со счётчиком ВНУТРИ
// строки (`input.ts:4517`, `i18n(showSender ? 'Chat.Accessory.Forward' :
// 'Chat.Accessory.Hidden', [length])`). По-русски это разница между «Переслать
// сообщения (3)» и «Переслать 3 сообщения», а на снятом имени отправителя
// признак «без имени» пропадал совсем: ветка жила только при count === 1.
//
// Проверяется РУССКИЙ: у английского обе формы отличаются одним словом, и «(3)»
// рядом со строкой от формы числа на глаз почти не отличается — на английском
// прежний вариант выглядел правдоподобно и потому дожил до финального ревью.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import { applyLang } from '@/test/lang'
import type { ForwardBar } from '../Composer'
import ReplyWrapper from './ReplyWrapper'

const bar = (count: number, dropAuthor: boolean): ForwardBar => ({
  sourcePeerId: 1 as ForwardBar['sourcePeerId'],
  msgIds: Array.from({ length: count }, (_, i) => i + 1),
  count,
  text: 'превью',
  hasCaption: false,
  dropAuthor,
  dropCaption: false,
})

function renderBar(forward: ForwardBar) {
  return render(
    <ReplyWrapper
      reply={null}
      editing={null}
      forward={forward}
      onCancelReply={() => {}}
      onCancelEdit={() => {}}
      onCancelForward={() => {}}
      onOpenForwardMenu={() => {}}
      bodyRef={{ current: null }}
    />,
  )
}

const title = () => document.querySelector('.reply-title')!.textContent

describe('плашка пересылки печатает число формой языка', () => {
  afterEach(async() => {
    cleanup()
    await applyLang('en')
  })

  it('три сообщения по-русски — «Переслать 3 сообщения», а не «сообщения (3)»', async() => {
    await applyLang('ru')
    renderBar(bar(3, false))

    expect(title()).toBe('Переслать 3 сообщения')
  })

  it('одно сообщение берёт форму единицы', async() => {
    await applyLang('ru')
    renderBar(bar(1, false))

    expect(title()).toBe('Переслать 1 сообщение')
  })

  it('со снятым именем отправителя признак «без имён» есть и на множестве', async() => {
    await applyLang('ru')
    renderBar(bar(3, true))

    expect(title()).toBe('Переслать 3 сообщения (без имён отправителей)')
  })

  it('английский — тот же ключ оригинала, форма множества со счётчиком', async() => {
    renderBar(bar(3, true))

    expect(screen.getByText("Forward 3 Messages (senders' names hidden)")).toBeTruthy()
  })
})
