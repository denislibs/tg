// Built-in chat wallpaper presets — each is a 4-colour gradient fed to the
// @twallpaper renderer (same model as Telegram's built-in backgrounds).
export interface WallpaperPreset {
  id: string
  colors: [string, string, string, string]
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  { id: 'day', colors: ['#dbddbb', '#6ba587', '#d5d88d', '#88b884'] },
  { id: 'sunset', colors: ['#fec496', '#dd6cb9', '#962fbf', '#4f5bd5'] },
  { id: 'amber', colors: ['#f0c07a', '#e8a268', '#f5d29b', '#e0b070'] },
  { id: 'ice', colors: ['#9bbbd6', '#a8c5e0', '#cdd9ec', '#b6cae3'] },
  { id: 'lime', colors: ['#c9e29b', '#9fd17a', '#dbe8a0', '#a7d77f'] },
  { id: 'violet', colors: ['#8ea2e0', '#b39ddb', '#c6a8e0', '#9b8ad6'] },
  { id: 'rose', colors: ['#f2b9c4', '#e89bb0', '#f5cdd6', '#eaa9bd'] },
  { id: 'matrix', colors: ['#7a9ec2', '#5b7fa6', '#8fb0cf', '#6b8eb3'] },
  { id: 'sky', colors: ['#aac8ea', '#cfe0f2', '#c2d9ee', '#b3d0ea'] },
  { id: 'candy', colors: ['#f3c4e3', '#d9b8ec', '#f0cdee', '#e3bce8'] },
  { id: 'mint', colors: ['#a8e0d0', '#bfeae0', '#cdeee6', '#b3e6da'] },
  { id: 'dusk', colors: ['#b3a8e0', '#c6bced', '#a89ad6', '#bcb0e8'] },
]

export const DEFAULT_WALLPAPER_ID = 'day'
