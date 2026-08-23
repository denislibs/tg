package domain

import "strings"

// Перевод строки выборки историй (StoryRecord) в конструктор схемы —
// ЕДИНСТВЕННОЕ место, где история получает проводную форму. Приём тот же, что у
// диалога (`DialogRecord.ToDialog`) и сообщения (`messagewire.go`): вычисляемые
// части приезжают аргументом, а не собираются здесь заново.
//
// Разбор и решения — docs/readiness/tl-stories-analysis.md.

// ToStoryItem переводит строку выборки в конструктор `storyItem`.
//
// `owner` — история принадлежит ЗРИТЕЛЮ. От этого зависит ровно один параметр:
// аудитория (`privacy`) едет только автору, как и у оригинала.
//
// Вложение (`Media`) приезжает на строке уже собранным — тем же приёмом, каким
// `DialogRecord` получает последнее сообщение: ступень строит read-модель,
// которая одна умеет ходить за метаданными файла.
func (r StoryRecord) ToStoryItem(owner bool) StoryItemReal {
	item := StoryItemReal{
		Underscore: StoryItemTag,
		PFlags:     StoryPrivacyPFlags(r.Privacy),
		ID:         int(r.ID),
		Date:       r.CreatedAt.Unix(),
		ExpireDate: r.ExpiresAt.Unix(),
		Caption:    r.Caption,
		Media:      r.Media,
		MediaAreas: r.MediaAreas,
		Views:      storyViewsOf(r),
		Viewed:     r.Viewed,
	}
	setPFlag(&item.PFlags, "pinned", r.Pinned)
	setPFlag(&item.PFlags, "edited", r.Edited)
	if r.FwdFrom != nil {
		h := NewStoryFwdHeader(NewPeer(PeerID(r.FwdFrom.AuthorID)), int(r.FwdFrom.StoryID))
		item.FwdFrom = &h
	}
	// Личная реакция — параметр САМОЙ истории, а не поле внутри агрегата:
	// тело истории одно на всех получателей.
	if r.MyReaction != "" {
		item.SentReaction = NewReactionEmoji(r.MyReaction)
	}
	if owner {
		item.Privacy = StoryPrivacyRules(r.Privacy, r.AllowIDs)
	}
	return item
}

// storyViewsOf собирает `storyViews` — общий (не пер-зрительский) агрегат.
//
// Возвращает nil, когда рассказывать нечего: ни просмотров, ни реакций. У
// оригинала `views` тоже необязателен, и «ноль просмотров» там выражается
// отсутствием параметра, а не нулём внутри объекта.
func storyViewsOf(r StoryRecord) *StoryViews {
	if r.ReactionsCount == 0 && len(r.Reactions) == 0 {
		return nil
	}
	v := NewStoryViews(0, reactionCountsOf(r.Reactions), r.ReactionsCount)
	return &v
}

// reactionCountsOf переводит плоскую разбивку репозитория в чипы схемы — те же
// `reactionCount` с `chosen_order`, которыми едут реакции сообщения. Второй
// формы одного предмета на проводе не остаётся.
func reactionCountsOf(in []ReactionCount) []MTReactionCount {
	if len(in) == 0 {
		return nil
	}
	out := make([]MTReactionCount, 0, len(in))
	for _, rc := range in {
		out = append(out, NewReactionCount(NewReactionEmoji(rc.Emoji), rc.Count, rc.Mine))
	}
	return out
}

// StoryMediaKind — вид вложения истории для сборки ступени.
//
// У сообщения вид приезжает своим столбцом (`messages.type`), у истории такого
// столбца нет: строка `stories` знает только номер файла. Поэтому вид выводится
// из mime — и это не догадка, а ровно тот вывод, который УЖЕ делает клиент
// (`useStoryPreviewMedia`: `mime.startsWith('video/')`), только теперь один раз
// на сервере и без отдельного запроса меты на каждую историю.
func StoryMediaKind(src MediaSource) string {
	switch {
	case src.Animated:
		return "gif"
	case strings.HasPrefix(src.Mime, "video/"):
		return "video"
	case strings.HasPrefix(src.Mime, "image/"):
		return "photo"
	}
	return ""
}

// BuildStoryMedia собирает вложение истории ступенью. Вид выводится из самого
// файла (см. StoryMediaKind), спойлеров у историй нет.
func BuildStoryMedia(mediaID int64, src MediaSource) MessageMedia {
	src.MediaID = mediaID
	src.Kind = StoryMediaKind(src)
	return BuildMessageMedia(src)
}
