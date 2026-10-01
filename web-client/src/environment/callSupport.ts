// Порт tweb `src/environment/callSupport.ts` (812502980) с Отступлением В7-6.
//
// У tweb `IS_CALL_SUPPORTED = IS_WEBRTC_SUPPORTED`, а тот — это
// `RTCPeerConnection` БЕЗ Firefox (`environment/webrtcSupport.ts`): гейт по UA
// принадлежит их MTProto-звонкам. Звонит у нас свой движок
// (`core/calls/callEngine.ts`), и ему нужны ровно две вещи браузера —
// `RTCPeerConnection` (:209) и `navigator.mediaDevices.getUserMedia` (:183) —
// которые в Firefox есть. Поэтому флаг отвечает на вопрос «потянет ли звонок
// НАШ движок», и перезвон из журнала в Firefox есть (решение пользователя).
// Файла `webrtcSupport.ts` у нас нет: без UA-гейта он совпал бы с этой строкой.
const IS_CALL_SUPPORTED = typeof RTCPeerConnection !== 'undefined' && // Отступление В7-6
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

export default IS_CALL_SUPPORTED
