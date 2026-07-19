// Иконка звезды Telegram Stars (tweb currencyStarIcon): жёлто-оранжевый
// градиентный «камень». Размер задаётся через size (px), цвет — встроенный.
export default function StarIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <defs>
        <linearGradient id="tg-star-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFD75E" />
          <stop offset="1" stopColor="#F7A02E" />
        </linearGradient>
      </defs>
      <path
        fill="url(#tg-star-grad)"
        d="M12 2.4c.5 0 .95.28 1.17.72l2.45 4.96 5.48.8c.5.07.9.42 1.06.9.15.47.02.99-.34 1.34l-3.96 3.86.94 5.46c.08.49-.12.99-.53 1.28-.4.29-.94.33-1.38.1L12 19.13l-4.9 2.58c-.44.23-.98.19-1.38-.1-.41-.29-.61-.79-.53-1.28l.94-5.46-3.97-3.86c-.35-.35-.48-.87-.33-1.34.15-.48.55-.83 1.06-.9l5.48-.8 2.45-4.96c.22-.44.67-.72 1.17-.72Z"
      />
    </svg>
  )
}
