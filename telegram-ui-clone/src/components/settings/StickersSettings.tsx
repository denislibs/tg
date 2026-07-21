// Настройки → Стикеры и эмодзи: реальный экран вместо мок-строк.
// Зацикливание анимаций (persist в settings-сторе, читает рендер стикеров),
// список установленных наборов с удалением и поиск наборов с установкой
// (GET /sticker-sets, /sticker-sets/search, POST/DELETE install).
import { useEffect, useMemo, useState } from 'react'
import { SettingsScreen, Section, Row, EntryRow } from './kit'
import TgIcon from '../TgIcon'
import { useManagers } from '../../core/hooks/useManagers'
import { useSettingsStore } from '../../settings'
import { useT } from '../../i18n'
import type { StickerSet } from '../../core/managers/stickersManager'

export default function StickersSettings({ onBack }: { onBack: () => void }) {
  const t = useT()
  const managers = useManagers()
  const loopStickers = useSettingsStore((s) => s.loopStickers)
  const update = useSettingsStore((s) => s.update)
  const [mySets, setMySets] = useState<StickerSet[] | null>(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<StickerSet[]>([])

  useEffect(() => {
    let alive = true
    managers.stickers.mySets().then((sets) => { if (alive) setMySets(sets) }, () => { if (alive) setMySets([]) })
    return () => { alive = false }
  }, [managers])

  // Поиск наборов: debounce 300мс, пустой запрос — пустая выдача.
  useEffect(() => {
    const query = q.trim()
    if (!query) {
      setResults([])
      return
    }
    const timer = window.setTimeout(() => {
      managers.stickers.searchSets(query).then(setResults, () => setResults([]))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [q, managers])

  const installedIds = useMemo(() => new Set((mySets ?? []).map((s) => s.id)), [mySets])
  const install = (set: StickerSet) => {
    void managers.stickers.install(set.id).then(
      () => setMySets((prev) => (prev?.some((x) => x.id === set.id) ? prev : [...(prev ?? []), set])),
      () => {},
    )
  }
  const uninstall = (set: StickerSet) => {
    void managers.stickers.uninstall(set.id).then(
      () => setMySets((prev) => (prev ?? []).filter((x) => x.id !== set.id)),
      () => {},
    )
  }

  return (
    <SettingsScreen title="Stickers and Emoji" onBack={onBack} zIndex={50}>
      <Section>
        <Row
          label="Loop Animated Stickers"
          toggle
          checked={loopStickers}
          onClick={() => update({ loopStickers: !loopStickers })}
        />
      </Section>

      <Section caption="My Sticker Sets">
        {(mySets ?? []).map((set) => (
          <EntryRow
            key={set.id}
            left={<TgIcon name="stickers" size={24} color="var(--tg-textSecondary)" />}
            title={set.title}
            sub={`${set.count} ${t('stickers')}`}
            onRemove={() => uninstall(set)}
          />
        ))}
        {mySets != null && mySets.length === 0 && <Row label="No sticker sets installed" />}
      </Section>

      <Section caption="Add Sticker Sets">
        <div style={{ padding: '8px 16px' }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('Search sticker sets')}
            style={{
              width: '100%', height: 40, border: 'none', outline: 'none',
              borderRadius: 12, padding: '0 14px', fontSize: 15, boxSizing: 'border-box',
              background: 'var(--tg-hover)', color: 'var(--tg-textPrimary)', fontFamily: 'inherit',
            }}
          />
        </div>
        {results.map((set) => (
          <Row
            key={set.id}
            icon={<TgIcon name="stickers" size={24} />}
            label={set.title}
            translate={false}
            sublabel={`${set.count} ${t('stickers')}`}
            onClick={installedIds.has(set.id) ? undefined : () => install(set)}
            value={installedIds.has(set.id) ? undefined : t('Add')}
            selected={installedIds.has(set.id)}
          />
        ))}
      </Section>
    </SettingsScreen>
  )
}
