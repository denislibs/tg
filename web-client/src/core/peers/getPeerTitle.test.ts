// Сборка имени пира на клиенте — то, чем закрывается долг шага C:
// `display_name` убран с провода целиком, и без ФОЛБЭКОВ узел остался бы
// пустым навсегда (`docs/readiness/port-divergences.md:95`). Правило фолбэка
// портировано дословно — `components/wrappers/getPeerTitle.ts:63`.
import { describe, expect, it } from 'vitest'

import type { Chat, User } from './peer'
import {
  AUTHOR_HIDDEN_SHORT,
  AUTHOR_HIDDEN_TITLE,
  DELETED_ACCOUNT_SHORT,
  DELETED_ACCOUNT_TITLE,
  getPeerTitle,
  getUserTitle,
  limitSymbols,
} from './getPeerTitle'
import { HIDDEN_PEER_ID } from './peerId'

const user = (over: Partial<Extract<User, { _: 'user' }>> = {}): User => ({ _: 'user', id: 2, ...over })

describe('имя пользователя', () => {
  it('склеивается из first_name и last_name', () => {
    expect(getUserTitle(user({ first_name: 'Аня', last_name: 'Петрова' }))).toBe('Аня Петрова')
  })

  it('onlyFirstName берёт фамилию только когда имени нет', () => {
    expect(getUserTitle(user({ first_name: 'Аня', last_name: 'Петрова' }), { onlyFirstName: true })).toBe('Аня')
    expect(getUserTitle(user({ last_name: 'Петрова' }), { onlyFirstName: true })).toBe('Петрова')
  })

  it('username вместо имени — с собачкой', () => {
    expect(getUserTitle(user({ first_name: 'Аня', username: 'anna' }), { username: true })).toBe('@anna')
  })

  // Ровно порядок оригинала: пусто → (нет карточки ИЛИ pFlags.deleted) ?
  // «Удалённый аккаунт» : username.
  it('без имени падает на username', () => {
    expect(getUserTitle(user({ username: 'anna' }))).toBe('anna')
  })

  it('удалённый аккаунт — фолбэк, а не пустой узел', () => {
    expect(getUserTitle(user({ username: 'anna', pFlags: { deleted: true } }))).toBe(DELETED_ACCOUNT_TITLE)
    expect(getUserTitle(user({ pFlags: { deleted: true } }), { onlyFirstName: true })).toBe(DELETED_ACCOUNT_SHORT)
  })

  // Карточка ещё не доехала — это ТОТ ЖЕ фолбэк, что у удалённого (`!user`
  // первым в условии оригинала), а не пустая строка молча.
  it('карточки нет — тот же фолбэк', () => {
    expect(getUserTitle(undefined)).toBe(DELETED_ACCOUNT_TITLE)
  })

  it('userEmpty — тоже «карточки нет»', () => {
    expect(getUserTitle({ _: 'userEmpty', id: 2 })).toBe(DELETED_ACCOUNT_TITLE)
  })
})

describe('имя чата', () => {
  const channel: Chat = {
    _: 'channel', id: 42, title: 'Наша команда', username: 'team',
    photo: { _: 'chatPhotoEmpty' }, date: 0,
  }

  it('берёт title', () => {
    expect(getPeerTitle({ peerId: -42, peer: channel })).toBe('Наша команда')
  })

  it('username вместо title', () => {
    expect(getPeerTitle({ peerId: -42, peer: channel, username: true })).toBe('@team')
  })

  it('onlyFirstName режет по первому слову', () => {
    expect(getPeerTitle({ peerId: -42, peer: channel, onlyFirstName: true })).toBe('Наша')
  })

  // У чата фолбэка «Удалённый аккаунт» НЕТ — он про пользователя. Ветвление
  // идёт по КЛЮЧУ (он известен всегда), а не по карточке (её может не быть),
  // иначе оба вида пира получили бы один и тот же фолбэк.
  it('карточки чата нет — пустая строка, а не «Удалённый аккаунт»', () => {
    expect(getPeerTitle({ peerId: -42, peer: undefined })).toBe('')
    expect(getPeerTitle({ peerId: 2, peer: undefined })).toBe(DELETED_ACCOUNT_TITLE)
  })
})

describe('скрытый автор пересылки', () => {
  it('HIDDEN_PEER_ID имеет собственный фолбэк', () => {
    expect(getPeerTitle({ peerId: HIDDEN_PEER_ID, peer: undefined })).toBe(AUTHOR_HIDDEN_TITLE)
    expect(getPeerTitle({ peerId: HIDDEN_PEER_ID, peer: undefined, onlyFirstName: true })).toBe(AUTHOR_HIDDEN_SHORT)
  })
})

describe('limitSymbols', () => {
  it('режет с многоточием только когда длиннее предела', () => {
    expect(limitSymbols('Короткое', 20)).toBe('Короткое')
    expect(limitSymbols('Очень длинное название чата', 5)).toBe('Очень…')
  })
})
