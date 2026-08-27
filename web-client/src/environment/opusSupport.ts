// Порт tweb `src/environment/opusSupport.ts:1-4` — играет ли платформа ogg/opus
// сама. Единственный вопрос гейта: нужна ли конвертация голосового в wav перед
// подачей в `<audio>` (`core/audio/mediaPlaybackController.ts::ensureSrc`, аналог
// tweb `apiFileManager.ts:670`).
//
// Считается ОДИН РАЗ на импорте, как у оригинала: ответ `canPlayType` за жизнь
// вкладки не меняется, а решение нужно на каждом голосовом бабле.
//
// Кто сюда попадает сегодня (август 2026): WebKit получил Ogg-контейнер только в
// Safari 18.4 (macOS 15.4 / iOS 18.4, март 2025) — до того ни Vorbis, ни Opus в
// ogg не играли ни одной версией. Chrome и Firefox умеют всегда.
const audio = document.createElement('audio')

// Выражение оригинала сохранено дословно (`.replace(/no/, '')` — его страховка от
// древних движков, отвечавших строкой «no»): '' → false, 'maybe'/'probably' → true.
const IS_OPUS_SUPPORTED = !!(audio.canPlayType && audio.canPlayType('audio/ogg;').replace(/no/, ''))

export default IS_OPUS_SUPPORTED
