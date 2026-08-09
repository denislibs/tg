// src/components/messages/MessageBubbles.tsx
//
// Баррель под-компонентов баблов. Раньше это был один 636-строчный файл; части
// разнесены по bubbleParts/ (P2-1e): primitives (галочки/таймер/геометрия/хвост),
// mediaBubbles (видео-кружок), richBubbles (webpage/factcheck/
// call/geo/contact). Импорт `from './MessageBubbles'` у потребителей
// (MessageRow/VoiceMessage) сохраняется — здесь реэкспорт.
export * from './bubbleParts/primitives'
export * from './bubbleParts/mediaBubbles'
export * from './bubbleParts/richBubbles'
