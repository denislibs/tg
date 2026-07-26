import { useRef } from 'react'
import TgIcon from '../TgIcon'
import patternUrl from '../../assets/pattern.svg'
import { useSettings } from '../../settings'
import { WALLPAPER_PRESETS } from '../../wallpapers'
import { useManagers } from '../../core/hooks/useManagers'
import { SettingsScreen, Section, Row } from './kit'
import s from './ChatWallpaper.module.scss'

export default function ChatWallpaper({ onBack }: { onBack: () => void }) {
  const { wallpaper, wallpaperBlur, customWallpaperMediaId, customWallpaperBlur, update } = useSettings()
  const managers = useManagers()
  const fileRef = useRef<HTMLInputElement>(null)
  const colorRef = useRef<HTMLInputElement>(null)

  // Загрузка фото обоев (tweb background upload): грузим блоб через media-менеджер
  // и сохраняем media_id — фон рисует его по media-токену. Приоритет над пресетом.
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    let width = 0
    let height = 0
    try {
      const bmp = await createImageBitmap(file)
      width = bmp.width
      height = bmp.height
      bmp.close()
    } catch {
      /* размеры необязательны */
    }
    const mediaId = await managers.media.upload({
      blob: file,
      mime: file.type || 'image/jpeg',
      size: file.size,
      width,
      height,
    })
    update({ customWallpaperMediaId: mediaId, customWallpaperBlur: false })
  }

  // Свои обои имеют приоритет — пока задан media_id, пресеты не подсвечиваем.
  const activePreset = !customWallpaperMediaId && wallpaper.kind === 'preset' ? wallpaper.colors.join() : null
  // Тоггл «Размытие» правит размытие активного фона: своих обоев или пресета/фото.
  const blurOn = customWallpaperMediaId ? !!customWallpaperBlur : wallpaperBlur
  const toggleBlur = () =>
    customWallpaperMediaId
      ? update({ customWallpaperBlur: !customWallpaperBlur })
      : update({ wallpaperBlur: !wallpaperBlur })

  return (
    <SettingsScreen title="Chat Background" onBack={onBack}>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
      <input
        ref={colorRef}
        type="color"
        hidden
        onChange={(e) => update({ wallpaper: { kind: 'color', color: e.target.value }, customWallpaperMediaId: undefined })}
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
          onClick={() => update({ wallpaper: { kind: 'default' }, wallpaperBlur: false, customWallpaperMediaId: undefined, customWallpaperBlur: false })}
        />
        <Row
          label="Blurred Image"
          toggle
          checked={blurOn}
          onClick={toggleBlur}
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
              onClick={() => update({ wallpaper: { kind: 'preset', colors: p.colors }, customWallpaperMediaId: undefined })}
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
