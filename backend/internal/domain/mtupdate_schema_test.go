package domain

import (
	"sort"
	"strings"
	"testing"
	"time"
)

// Механическая сверка модели кадров со схемой TL — зеркало
// `mtmessage_schema_test.go` (тот же `schemaChecker`, те же два утверждения:
// лишнего нет, пропущенное названо).
//
// САМО СООБЩЕНИЕ внутри кадров здесь не сверяется отдельно: его сверяет
// `mtmessage_schema_test.go`, а обход у сверщика рекурсивный — вложенный
// конструктор проверяется тем же проходом.

// updateOmittedWithoutSubject — обязательные параметры кадров, которых мы не
// производим. Каждая строка — утверждение «предмета нет».
var updateOmittedWithoutSubject = map[string][]string{
	// Прочтение вложений: у оригинала кадр несёт ВРЕМЯ прочтения (flags.0?int
	// у общего конструктора и обязательный date у некоторых соседних). У нас
	// момент прочтения вложения не хранится вовсе — есть только факт.
	// Параметр необязательный, поэтому в списке его нет; строка оставлена
	// пустой намеренно, чтобы список существовал и рос осмысленно.
}

// updateCases — по одному экземпляру КАЖДОГО объявленного конструктора.
// Полнота списка проверяется отдельным тестом ниже.
func updateCases() []struct {
	name  string
	value any
} {
	peer := NewPeerUser(7)
	msg := MessageReal{Underscore: MessageTag, ID: 12, PeerID: peer, Date: 1787334148,
		Message: "привет"}
	reactions := NewMessageReactions([]MTReactionCount{
		{Underscore: ReactionCountTag, Reaction: NewReactionEmoji("👍"), Count: 2},
	}, nil)

	return []struct {
		name  string
		value any
	}{
		{"новое сообщение", NewUpdateNewMessage(msg, 41)},
		{"пост канала", NewUpdateNewChannelMessage(msg, 7)},
		{"правка", NewUpdateEditMessage(msg, 42)},
		{"правка поста канала", NewUpdateEditChannelMessage(msg, 8)},
		{"удаление", NewUpdateDeletePeerMessages(peer, []int64{12, 13}, 43)},
		{"прочитал я", NewUpdateReadHistoryInbox(peer, 12, 3, 44)},
		{"прочитали меня", NewUpdateReadHistoryOutbox(peer, 12, 45)},
		{"прочитал я в канале", NewUpdateReadChannelInbox(5, 12, 3, 10)},
		{"прочитали меня в канале", NewUpdateReadChannelOutbox(5, 12)},
		{"прочитано вложение", NewUpdateReadPeerMessagesContents(peer, []int64{12}, 46)},
		{"закрепили", NewUpdatePinnedMessages(peer, []int64{12}, true, 47)},
		{"открепили", NewUpdatePinnedMessages(peer, []int64{12}, false, 48)},
		{"закрепили в канале", NewUpdatePinnedChannelMessages(5, []int64{12}, true, 11)},
		{"реакции", NewUpdateMessageReactions(peer, 12, reactions)},
		{"закрепили диалог", NewUpdateDialogPinned(peer, true)},
		{"открепили диалог", NewUpdateDialogPinned(peer, false)},
		{"диалог в архив", NewUpdateFolderPeers([]FolderPeer{NewFolderPeer(peer, FolderArchive)}, 49)},
		{"диалог из архива", NewUpdateFolderPeers([]FolderPeer{NewFolderPeer(peer, FolderAll)}, 50)},
		{"настройки уведомлений", NewUpdateNotifySettings(peer,
			NewPeerNotifySettings(time.Unix(1787334148, 0), nil, NewNotificationSoundNone()))},
		{"черновик", NewUpdateDraftMessage(peer, func() DraftMessageReal {
			id := int64(12)
			return NewDraftMessage("набросок", nil, &id, time.Unix(1787334148, 0))
		}())},
		{"черновик снят", NewUpdateDraftMessage(peer, NewDraftMessageEmpty())},
		{"печатает в личке", NewUpdateUserTyping(7, SendMessageActionByTag(SendMessageTypingActionTag))},
		{"записывает голосовое", NewUpdateUserTyping(7, SendMessageActionByTag(SendMessageRecordAudioActionTag))},
		{"записывает видео", NewUpdateUserTyping(7, SendMessageActionByTag(SendMessageRecordVideoActionTag))},
		{"отправляет файл", NewUpdateUserTyping(7, SendMessageActionByTag(SendMessageUploadDocumentActionTag))},
		{"отправляет фото", NewUpdateUserTyping(7, SendMessageActionByTag(SendMessageUploadPhotoActionTag))},
		{"отправляет видео", NewUpdateUserTyping(7, SendMessageActionByTag(SendMessageUploadVideoActionTag))},
		{"отправляет аудио", NewUpdateUserTyping(7, SendMessageActionByTag(SendMessageUploadAudioActionTag))},
		{"печатает в группе", NewUpdateChannelUserTyping(5, peer, SendMessageActionByTag(SendMessageTypingActionTag))},
		{"присутствие", NewUpdateUserStatus(7, NewUserStatusOnline(time.Unix(1787334148, 0)))},
		{"карточка пользователя", NewUpdateUserSnapshot(NewUser(7, UserFlags{}))},
	}
}

func TestUpdates_MatchSchema(t *testing.T) {
	for _, tc := range updateCases() {
		t.Run(tc.name, func(t *testing.T) {
			unexpected, omitted := checkUpdatesAgainstSchema(t, tc.value)
			for _, s := range unexpected {
				t.Errorf("лишнее: %s", s)
			}
			for _, s := range omitted {
				t.Errorf("пропущено: %s", s)
			}
		})
	}
}

// checkUpdatesAgainstSchema — тот же сверщик, что у медиа, со списком
// подсистемы ПЛЮС уже названными пропусками вложенных конструкторов: кадр несёт
// сообщение целиком, а у сообщения и его медиа «нет предмета» названо один раз
// в OmittedWithoutSubject.
func checkUpdatesAgainstSchema(t *testing.T, value any) (unexpected, omitted []string) {
	t.Helper()

	merged := map[string][]string{}
	for k, v := range OmittedWithoutSubject {
		merged[k] = v
	}
	for k, v := range messageOmittedWithoutSubject {
		merged[k] = append(append([]string{}, merged[k]...), v...)
	}
	for k, v := range updateOmittedWithoutSubject {
		merged[k] = append(append([]string{}, merged[k]...), v...)
	}

	c := &schemaChecker{
		constructors: loadSchemaConstructors(t),
		additional:   loadAdditionalParams(t),
		own:          loadOwnConstructors(t),
		omittedOK:    merged,
	}
	c.walk(roundTripJSON(t, value), "updates")

	sort.Strings(c.unexpected)
	sort.Strings(c.omitted)
	return c.unexpected, c.omitted
}

// Полнота: каждый конструктор, объявленный в mtupdate.go, обязан иметь строку в
// updateCases. Конструктор без строки просто не сверялся бы со схемой — ровно
// тот способ, которым из модели уходили поля.
func TestUpdates_EveryConstructorIsCovered(t *testing.T) {
	declared := []string{
		UpdateNewMessageTag,
		UpdateNewChannelMessageTag,
		UpdateEditMessageTag,
		UpdateEditChannelMessageTag,
		UpdateDeletePeerMessagesTag,
		UpdateReadHistoryInboxTag,
		UpdateReadHistoryOutboxTag,
		UpdateReadChannelInboxTag,
		UpdateReadChannelOutboxTag,
		UpdateReadPeerMessagesContentsTag,
		UpdatePinnedMessagesTag,
		UpdatePinnedChannelMessagesTag,
		UpdateMessageReactionsTag,
		UpdateDialogPinnedTag,
		UpdateFolderPeersTag,
		UpdateNotifySettingsTag,
		UpdateDraftMessageTag,
		UpdateUserTypingTag,
		UpdateChannelUserTypingTag,
		UpdateUserStatusTag,
		UpdateUserSnapshotTag,
		SendMessageTypingActionTag,
		SendMessageRecordAudioActionTag,
		SendMessageRecordVideoActionTag,
		SendMessageUploadDocumentActionTag,
		SendMessageUploadPhotoActionTag,
		SendMessageUploadVideoActionTag,
		SendMessageUploadAudioActionTag,
	}

	covered := map[string]bool{}
	for _, tc := range updateCases() {
		collectPredicates(roundTripJSON(t, tc.value), covered)
	}

	var missing []string
	for _, tag := range declared {
		if !covered[tag] {
			missing = append(missing, tag)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Errorf("конструкторы объявлены, но не сверяются со схемой: %s", strings.Join(missing, ", "))
	}
}

// «Выключено» — отсутствие ключа. У закрепления это не украшение: тот же
// конструктор с опущенным битом и есть «открепили», и появись здесь
// `pinned: false`, кодек TL отверг бы значение — а на JSON-проводе оно проехало
// бы молча.
func TestUpdates_PinnedFlagIsAbsentWhenUnpinned(t *testing.T) {
	unpinned := roundTripJSON(t, NewUpdatePinnedMessages(NewPeerUser(7), []int64{12}, false, 1))
	obj, _ := unpinned.(map[string]any)
	if _, present := obj["pFlags"]; present {
		t.Fatalf("у открепления появился pFlags: %#v", obj)
	}

	pinned := roundTripJSON(t, NewUpdatePinnedMessages(NewPeerUser(7), []int64{12}, true, 1))
	flags, _ := pinned.(map[string]any)["pFlags"].(map[string]any)
	if flags["pinned"] != true {
		t.Fatalf("у закрепления нет бита pinned: %#v", flags)
	}
}

// Пустой вектор остаётся вектором: на проводе TL у него есть шапка со
// счётчиком, и «нет значения» для него невыразимо вовсе.
func TestUpdates_EmptyVectorStaysVector(t *testing.T) {
	obj, _ := roundTripJSON(t, NewUpdateDeletePeerMessages(NewPeerUser(7), nil, 1)).(map[string]any)
	if _, ok := obj["messages"].([]any); !ok {
		t.Fatalf("messages = %#v, а обязан быть вектором", obj["messages"])
	}
}
