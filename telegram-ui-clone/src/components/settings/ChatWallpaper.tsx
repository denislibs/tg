import { useRef } from 'react'
import TgIcon from '../TgIcon'
import patternUrl from '../../assets/pattern.svg'
import { useSettings } from '../../settings'
import { WALLPAPER_PRESETS } from '../../wallpapers'
import { SettingsScreen, Section, Row } from './kit'
import s from './ChatWallpaper.module.scss'

export default function ChatWallpaper({ onBack }: { onBack: () => void }) {
  const { wallpaper, wallpaperBlur, update } = useSettings()
  const fileRef = useRef<HTMLInputElement>(null)
  const colorRef = useRef<HTMLInputElement>(null)

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => update({ wallpaper: { kind: 'image', src: String(reader.result) } })
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const activePreset = wallpaper.kind === 'preset' ? wallpaper.colors.join() : null

  return (
    <SettingsScreen title="Chat Background" onBack={onBack}>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
      <input
        ref={colorRef}
        type="color"
        hidden
        onChange={(e) => update({ wallpaper: { kind: 'color', color: e.target.value } })}
      />

      <Section>
        <Row
          icon={<TgIcon name="cameraadd" size={24} />}
          label="Upload Image"
          onClick={() => fileRef.current?.click()}
        />
        <Row icon={<TgIcon name="colorize" size={24} />} label="Set a Color" onClick={() => colorRef.current?.click()} />
        <Row
          icon={<TgIcon name="rotate" size={24} />}
          label="Reset to Default"
          onClick={() => update({ wallpaper: { kind: 'default' }, wallpaperBlur: false })}
        />
        <Row
          label="Blurred Image"
          toggle
          checked={wallpaperBlur}
          onClick={() => update({ wallpaperBlur: !wallpaperBlur })}
        />
      </Section>

      {/* preset grid */}
      <div className={s.grid}>
        {WALLPAPER_PRESETS.map((p) => {
          const selected = activePreset === p.colors.join()
          return (
            <div
              key={p.id}
              className={s.tile}
              data-selected={selected || undefined}
              onClick={() => update({ wallpaper: { kind: 'preset', colors: p.colors } })}
              style={{ background: `linear-gradient(150deg, ${p.colors[0]}, ${p.colors[1]}, ${p.colors[2]}, ${p.colors[3]})` }}
            >
              <div className={s.pattern} style={{ backgroundImage: `url("${patternUrl}")` }} />
              {selected && (
                <div className={s.check}>
                  <TgIcon name="check" size={17} color="#fff" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </SettingsScreen>
  )
}
