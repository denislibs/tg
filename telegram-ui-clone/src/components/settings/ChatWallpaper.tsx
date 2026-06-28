import { useRef } from 'react'
import { Box, useTheme } from '@mui/material'
import TgIcon from '../TgIcon'
import patternUrl from '../../assets/pattern.svg'
import { useSettings } from '../../settings'
import { WALLPAPER_PRESETS } from '../../wallpapers'
import { SettingsScreen, Section, Row } from './kit'

export default function ChatWallpaper({ onBack }: { onBack: () => void }) {
  const tg = useTheme().tg
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
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 0.5,
          px: 1.25,
          pt: 0.5,
        }}
      >
        {WALLPAPER_PRESETS.map((p) => {
          const selected = activePreset === p.colors.join()
          return (
            <Box
              key={p.id}
              onClick={() => update({ wallpaper: { kind: 'preset', colors: p.colors } })}
              sx={{
                position: 'relative',
                aspectRatio: '3 / 4',
                borderRadius: '10px',
                cursor: 'pointer',
                overflow: 'hidden',
                background: `linear-gradient(150deg, ${p.colors[0]}, ${p.colors[1]}, ${p.colors[2]}, ${p.colors[3]})`,
                outline: selected ? `2.5px solid ${tg.accent}` : 'none',
                outlineOffset: '-2.5px',
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  backgroundImage: `url("${patternUrl}")`,
                  backgroundSize: '180px',
                  mixBlendMode: 'overlay',
                  opacity: 0.55,
                }}
              />
              {selected && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: tg.accent,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <TgIcon name="check" size={17} color="#fff" />
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    </SettingsScreen>
  )
}
