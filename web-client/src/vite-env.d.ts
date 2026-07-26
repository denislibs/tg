/// <reference types="vite/client" />

// `@twallpaper/react/css` (package "exports") резолвится в .css-файл, но специфаер без
// расширения не матчит `declare module '*.css'` из vite/client. TS7 native требует явную
// декларацию для side-effect импорта — объявляем пустой модуль (только ради стилей).
declare module '@twallpaper/react/css'
