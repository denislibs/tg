// Task 6 (медиа-суперпорт, стадия C): URL медиа — воркер единственный владелец
// (core/managers/mediaManager.ts::downloadMediaURL: скачивание, корзина
// cachedFiles, минт objectURL, публикация rt:media_url). core/mediaCache.ts —
// зеркало. Скан-пин по образцу core/noDuplicateMediaToken.test.ts:
//
//  1) присланный владельцем URL применяет ровно одно место витрины — проектор
//     (client/realtime/storeProjection.ts). Новый вызов applyMediaUrl где-то ещё —
//     второй писатель факта; либо переводи его на проектор, либо осознанно
//     добавляй сюда с обоснованием комментарием ПРЯМО У ВЫЗОВА;
//  2) сброс зеркала (resetMediaUrlMirror) — тоже только проектор, на кадр
//     rt:logging_out: реакция на объявленное намерение, не своя эвристика;
//  3) (порт ленты на императивный DOM) сам ПОХОД к владельцу за URL картинки —
//     `managers.media.downloadMediaURL(...)` — тоже под скан. Причина ниже.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

const ALLOWED = [
  'core/mediaCache.ts', // сам модуль зеркала: определения applyMediaUrl/resetMediaUrlMirror
  'client/realtime/storeProjection.ts', // APPLY[RT.mediaUrl] + сброс на rt:logging_out
  // Task 7: ответ RPC downloadMediaURL на объявленный ЭТИМ ЖЕ хуком пробел.
  // Не второй вывод факта — тот же снимок владельца, доставленный вторым каналом:
  // URL, уже имевшийся у воркера, кадром не объявляется (rt:media_url публикуется
  // только при СОЗДАНИИ URL, а SuperMessagePort не буферизует — поздняя вкладка
  // стартовый бродкаст пропустила), поэтому применить его обязан получатель
  // ответа (норма «владелец отвечает на объявленный пробел всегда»).
  'core/hooks/useMediaUrl.ts',
  // ТО ЖЕ САМОЕ для императивной ленты — ванильная точка входа. Отдельная
  // запись, а не «ещё один потребитель»: это два канала доставки ОДНОГО снимка
  // (React-хук для узлов React, ванильная точка для узлов ленты), а не N
  // независимых писателей.
  'core/media/ensureMediaUrl.ts',
]

// Кто вправе ходить к владельцу за URL напрямую, минуя ensureMediaUrl.
//
// Зачем этот скан отдельно от applyMediaUrl-скана: обход точки входа выглядит
// НЕ как второй вызов applyMediaUrl, а как его ОТСУТСТВИЕ — враппер зовёт
// downloadMediaURL, рисует полученный URL у себя и в зеркало не пишет. Первый
// скан на такое молчит (нарушитель ничего не зовёт), а факт при этом теряется:
// URL, который у воркера УЖЕ БЫЛ, кадром не объявляется, и остальные
// потребители того же id не увидят его никогда. Поэтому пин смотрит и на сам
// поход.
const ALLOWED_DOWNLOAD = [
  'core/managers/mediaManager.ts', // владелец: определение
  'core/media/ensureMediaUrl.ts', // ванильная точка входа (пишет в зеркало)
  'core/hooks/useMediaUrl.ts', // React-точка входа (пишет в зеркало)
  // ── Ниже — ДОЛГ, а не норма: каждый берёт URL «для себя» и в зеркало не
  // пишет, то есть теряет снимок владельца для остальных потребителей того же
  // id. Новых сюда не добавлять — переводить на ensureMediaUrl; эти переводятся
  // при следующем содержательном касании файла (было ТРИ — профиль/история/
  // вьювер; НАХОДКА ФИНАЛЬНОГО РЕВЬЮ ВЕТКИ, Minor, п.5: «профиль»
  // — `core/hooks/useUserProfileData.ts` — сняли, потребитель снесён задачей
  // 5 порта `PeerProfileAvatars` (`grep downloadMediaURL` по файлу — 0
  // попаданий, сам файл — 58 строк); мёртвая запись в allow-list молча
  // разрешала бы вернуть в НЕГО прямой поход мимо `ensureMediaUrl` никем не
  // замеченной. Живых осталось ДВА: история и вьювер (вьювер — два файла,
  // один предмет: полноразмер и «скачать файл»)).
  'core/hooks/useStoryPreviewMedia.ts', // картинка истории
  'components/mediaViewer/base.ts', // полноразмер во вьювере (thumb он ИЗ зеркала читает — cachedMediaUrl)
  'components/mediaViewer/appMediaViewer.ts', // «скачать файл»: URL уходит в <a download>, не в <img>
]

function offendersOf(call: RegExp, allowed: string[] = ALLOWED): string[] {
  return walk(SRC)
    .map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'))
    .filter((rel) => !allowed.includes(rel))
    .filter((rel) => call.test(readFileSync(join(SRC, rel), 'utf8')))
}

// Комментарии про downloadMediaURL рассыпаны по половине дерева — скан ловит
// ВЫЗОВ метода менеджера (`…media.downloadMediaURL(`), а не упоминание: в
// прозе за именем всегда идёт `` ` ``, `:` или пробел, но не `(`.
const DOWNLOAD_CALL = /\.downloadMediaURL\(/

describe('URL медиа: применение и сброс зеркала — по одному месту', () => {
  it('applyMediaUrl(...) зовут только зеркало, проектор и точки входа', () => {
    expect(offendersOf(/\bapplyMediaUrl\(/)).toEqual([])
  })

  it('resetMediaUrlMirror(...) зовут только зеркало и проектор', () => {
    expect(offendersOf(/\bresetMediaUrlMirror\(/)).toEqual([])
  })

  it('allow-list не разбух молча: каждая запись реально касается зеркала', () => {
    for (const rel of ALLOWED) {
      const src = readFileSync(join(SRC, rel), 'utf8')
      expect(src, `${rel}: ожидался вызов applyMediaUrl(...)`).toMatch(/\bapplyMediaUrl\(/)
    }
  })

  it('к владельцу за URL картинки ходят только точки входа (и известный долг)', () => {
    expect(offendersOf(DOWNLOAD_CALL, ALLOWED_DOWNLOAD)).toEqual([])
  })

  it('обе точки входа применяют ответ владельца к зеркалу', () => {
    for (const rel of ['core/media/ensureMediaUrl.ts', 'core/hooks/useMediaUrl.ts']) {
      const src = readFileSync(join(SRC, rel), 'utf8')
      expect(src, `${rel}: ходит к владельцу`).toMatch(DOWNLOAD_CALL)
      expect(src, `${rel}: применяет ответ к зеркалу`).toMatch(/\bapplyMediaUrl\(/)
    }
  })
})
