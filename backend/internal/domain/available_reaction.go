package domain

// AvailableReaction — доступная реакция (Telegram messages.getAvailableReactions).
// Роли-файлы лежат в media; клиент рисует чип из Center (или Static, если центра
// нет — tweb reaction.ts:817) и проигрывает Select с Around при выборе.
// ID роли 0 — файла для неё нет.
type AvailableReaction struct {
	Emoji    string `json:"emoji"`
	Title    string `json:"title"`
	Position int    `json:"position"`
	Premium  bool   `json:"premium"`
	Inactive bool   `json:"inactive"`

	StaticMediaID   int64 `json:"static_media_id,omitempty"`
	AppearMediaID   int64 `json:"appear_media_id,omitempty"`
	SelectMediaID   int64 `json:"select_media_id,omitempty"`
	ActivateMediaID int64 `json:"activate_media_id,omitempty"`
	EffectMediaID   int64 `json:"effect_media_id,omitempty"`
	AroundMediaID   int64 `json:"around_media_id,omitempty"`
	CenterMediaID   int64 `json:"center_media_id,omitempty"`
}
