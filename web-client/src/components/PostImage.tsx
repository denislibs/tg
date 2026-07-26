// A stylized stand-in for the channel post photo (dim restaurant scene).
export default function PostImage() {
  return (
    <svg viewBox="0 0 460 300" width="100%" style={{ display: 'block' }} preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="room" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2b5e" />
          <stop offset="0.5" stopColor="#241a3d" />
          <stop offset="1" stopColor="#120d20" />
        </linearGradient>
        <radialGradient id="glow" cx="0.5" cy="0.25" r="0.7">
          <stop offset="0" stopColor="#5b7bd6" stopOpacity="0.55" />
          <stop offset="1" stopColor="#5b7bd6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="table" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f1ea" />
          <stop offset="1" stopColor="#d8d2c4" />
        </linearGradient>
      </defs>

      <rect width="460" height="300" fill="url(#room)" />
      <rect width="460" height="300" fill="url(#glow)" />

      {/* back chairs */}
      <rect x="150" y="60" width="120" height="120" rx="16" fill="#e9e4da" opacity="0.85" />
      <rect x="280" y="70" width="120" height="120" rx="16" fill="#cfc8bb" opacity="0.7" />

      {/* figure */}
      <g>
        <ellipse cx="250" cy="120" rx="34" ry="38" fill="#caa98c" />
        <path d="M205 300 q5 -130 45 -150 q40 20 45 150 z" fill="#1c1c22" />
        {/* raised arm */}
        <path d="M285 175 q40 -25 38 -70 l18 2 q4 60 -44 90 z" fill="#1c1c22" />
        <ellipse cx="332" cy="98" rx="13" ry="16" fill="#caa98c" />
      </g>

      {/* table */}
      <rect x="0" y="235" width="460" height="65" fill="url(#table)" />
      <ellipse cx="110" cy="262" rx="48" ry="16" fill="#c9923f" opacity="0.85" />
      <rect x="200" y="222" width="14" height="40" rx="4" fill="#cfe3ef" opacity="0.85" />
      <rect x="224" y="218" width="14" height="44" rx="4" fill="#cfe3ef" opacity="0.85" />
    </svg>
  )
}
