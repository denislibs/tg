// @ts-nocheck — вендорено из tweb 1:1 (островок tlottie); типы проверяются в апстриме
// Минимальный тип-shim из tweb helpers/liteMode: LottiePlayer принимает
// liteModeKey как непрозрачный ключ и (на этапе 1) лишь пробрасывает его —
// реального lite-mode гейтинга (через настройки) пока нет. Полная версия
// tweb завязана на solid-store настроек и переносится позже.
export type LiteModeKey = string;