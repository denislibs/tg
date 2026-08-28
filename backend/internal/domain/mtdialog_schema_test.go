package domain

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"testing"
	"time"
)

// Механическая сверка модели ДИАЛОГОВ со схемой TL — тот же сверщик
// (schemaChecker), что у медиа, сущностей, разметки и пиров, те же два
// утверждения:
//
//  1. Лишнего нет: каждый ключ сериализованного объекта — параметр конструктора
//     из схемы либо клиентский параметр из schema_additional_params.json.
//
//  2. Пропущенное названо: обязательные параметры схемы, которых нет в выводе,
//     сверяются с явным списком «нет предмета» ниже.
//
// Модель вложенная (контейнер → dialog → notify_settings → other_sound,
// dialog → peer, dialogFolder → folder), поэтому сверщик обходит её целиком.
//
// Тест не проверяет типы значений и порядок полей — это работа кодека (фаза 2).

// dialogOmittedWithoutSubject — обязательные параметры схемы, которых мы
// сознательно не производим. Каждая строка — утверждение, а не забывчивость.
//
// Необязательные пропуски (dialog.pts, dialog.draft, pFlags.unread_mark,
// pFlags.view_forum_as_messages, peerNotifySettings.ios_sound/android_sound/
// stories_*) сюда попасть не могут по устройству сверщика — он спрашивает
// только про ОБЯЗАТЕЛЬНЫЕ параметры. Они названы в шапке mtdialog.go, и это
// не формальность: на фазе 2 «нет предмета» остаётся бесплатным ровно для них.
var dialogOmittedWithoutSubject = map[string][]string{
	// Непрочитанных голосов в опросах мы не считаем нигде: ни колонки, ни
	// запроса. Параметр ОБЯЗАТЕЛЬНЫЙ, поэтому назван здесь явно: на фазе 2 он
	// станет заглушкой-нулём в потоке (tl-program.md, «нет предмета перестаёт
	// быть бесплатным»), а не полем модели.
	"dialog": {"unread_poll_votes_count"},
}

// allDialogConstructors — по одному экземпляру КАЖДОГО объявленного
// конструктора подсистемы, включая объявленные, но не производимые
// (dialogFolder, folder): их собирают литералом, конструирующих функций у них
// нет.
//
// Новый конструктор без строки здесь просто не был бы сверен со схемой, поэтому
// список продублирован проверкой полноты ниже.
func allDialogConstructors() []any {
	now := time.Unix(1_700_000_000, 0)
	previews := true
	silent := true

	// Полный диалог: закреплён, в архиве, с автоудалением и замьючен на час.
	full := NewDialog(NewPeerChannel(8), 120,
		NewPeerNotifySettings(now.Add(time.Hour), &previews, NewNotificationSoundNone()), true)
	full.ReadInboxMaxID = 118
	full.ReadOutboxMaxID = 117
	full.UnreadCount = 2
	full.UnreadMentionsCount = 1
	full.UnreadReactionsCount = 3
	full.FolderID = 1
	full.TTLPeriod = 86400

	// Пустой диалог: ни одного флага, ни одного необязательного параметра.
	// pFlags обязан исчезнуть, обязательные счётчики и notify_settings —
	// остаться даже нулевыми.
	empty := NewDialog(NewPeerUser(42), 0, NewPeerNotifySettings(time.Time{}, nil, nil), false)

	dialogs := []Dialog{full, empty}
	// Вектор messages наполняет проводной рендерер сообщения из delivery/http:
	// конструктора `message` в домене нет (своя подсистема программы), и тип
	// поля это ВРЕМЕННО признаёт. Здесь достаточно любого объекта — сверщик
	// проверяет конструкторы по ключу `_`, а у сообщения его пока нет вовсе.
	messages := []any{map[string]any{"id": 1, "seq": 120}}
	chats := []Chat{NewChannel(8, "группа", NewChatPhotoEmpty(), now, ChannelFlags{Megagroup: true})}
	users := []UserReal{NewUser(42, UserFlags{})}

	return []any{
		// ── Ссылки на диалог ─────────────────────────────────────────────────
		// Производят их КАДРЫ диалогов (mtupdate.go), но объявлены они здесь, и
		// сверяться обязаны там же, где объявлены.
		NewDialogPeer(NewPeerUser(42)),
		NewNotifyPeer(NewPeerChannel(8)),
		NewFolderPeer(NewPeerUser(42), FolderArchive),
		// «Вернуть из архива» — тот же конструктор с нулевой папкой, а не второй.
		NewFolderPeer(NewPeerUser(42), FolderAll),
		// ── Черновик ─────────────────────────────────────────────────────────
		// «Черновика нет» — ВТОРОЙ конструктор, а не null под тем же ключом.
		func() DraftMessageReal {
			id := int64(12)
			return NewDraftMessage("набросок", nil, &id, now)
		}(),
		NewDraftMessage("без ответа", nil, nil, now),
		NewDraftMessageEmpty(),
		// ── Dialog ───────────────────────────────────────────────────────────
		full,
		empty,
		// Замьючен НАВСЕГДА: срок, а не отдельный флаг (решение Р4).
		NewDialog(NewPeerUser(43), 7,
			NewPeerNotifySettings(time.Unix(MuteUntilForever, 0), nil, NewNotificationSoundDefault()), false),
		// Секретный чат: НАШ параметр вне схемы (решение Р9). Сверщик обязан
		// признавать его штатным механизмом клиентских полей
		// (schema_additional_params.json), а не молча пропускать.
		func() DialogReal {
			d := NewDialog(NewPeerChannel(11), 3, NewPeerNotifySettings(time.Time{}, nil, nil), false)
			d.Secret = true
			return d
		}(),
		// Мьют снят явно: MuteUntilNever — это НОЛЬ, а не отсутствие ключа.
		func() DialogReal {
			d := NewDialog(NewPeerUser(44), 9, PeerNotifySettings{Underscore: PeerNotifySettingsTag}, false)
			zero := MuteUntilNever
			d.NotifySettings.MuteUntil = &zero
			return d
		}(),
		// Строка-папка: объявлена, не производится — поэтому литерал.
		DialogFolder{
			Underscore: DialogFolderTag,
			PFlags:     map[string]bool{"pinned": true},
			Folder: Folder{
				Underscore: FolderTag,
				PFlags:     map[string]bool{"autofill_new_broadcasts": true},
				ID:         1,
				Title:      "Архив",
				Photo:      NewChatPhotoEmpty(),
			},
			Peer:                       NewPeerUser(0),
			TopMessage:                 120,
			UnreadMutedPeersCount:      1,
			UnreadUnmutedPeersCount:    2,
			UnreadMutedMessagesCount:   3,
			UnreadUnmutedMessagesCount: 4,
		},

		// ── PeerNotifySettings ───────────────────────────────────────────────
		// Все переопределения заданы, включая явное silent.
		func() PeerNotifySettings {
			s := NewPeerNotifySettings(now.Add(time.Hour), &previews, NewNotificationSoundDefault())
			s.Silent = &silent
			return s
		}(),
		// Ни одного переопределения: действует настройка типа чата.
		NewPeerNotifySettings(time.Time{}, nil, nil),

		// ── NotificationSound ────────────────────────────────────────────────
		NewNotificationSoundDefault(),
		NewNotificationSoundNone(),

		// ── messages.Dialogs ─────────────────────────────────────────────────
		NewMessagesDialogs(dialogs, messages, chats, users),
		// Список отдан целиком и он пуст: обязательные векторы едут [], а не null.
		NewMessagesDialogs(nil, nil, nil, nil),
		NewMessagesDialogsSlice(42, dialogs, messages, chats, users),
		NewMessagesDialogsSlice(0, nil, nil, nil, nil),
	}
}

func checkDialogsAgainstSchema(t *testing.T, objects []any) (unexpected, omitted []string) {
	t.Helper()

	raw, err := json.Marshal(objects)
	if err != nil {
		t.Fatalf("модель не сериализуется: %v", err)
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("модель не разбирается обратно: %v", err)
	}

	c := &schemaChecker{
		constructors: loadSchemaConstructors(t),
		additional:   loadAdditionalParams(t),
		omittedOK:    dialogOmittedWithoutSubject,
	}
	c.walk(decoded, "dialogs")
	sort.Strings(c.unexpected)
	sort.Strings(c.omitted)
	return c.unexpected, c.omitted
}

func TestDialogs_MatchesSchema(t *testing.T) {
	unexpected, omitted := checkDialogsAgainstSchema(t, allDialogConstructors())
	for _, v := range unexpected {
		t.Errorf("лишнее поле: %s", v)
	}
	for _, v := range omitted {
		t.Errorf("молчаливый пропуск: %s", v)
	}
}

// dialogConstructorTags — все объявленные подсистемой дискриминаторы.
func dialogConstructorTags() []string {
	return []string{
		DialogTag, DialogFolderTag, FolderTag,
		DialogPeerTag, NotifyPeerTag, FolderPeerTag,
		DraftMessageTag, DraftMessageEmptyTag, InputReplyToMessageTag,
		PeerNotifySettingsTag,
		NotificationSoundDefaultTag, NotificationSoundNoneTag,
		MessagesDialogsTag, MessagesDialogsSliceTag,
	}
}

// Полнота: каждый объявленный дискриминатор реально есть в схеме И реально
// участвует в сверке. Иначе конструктор можно было бы завести и забыть.
func TestDialogs_EveryConstructorIsChecked(t *testing.T) {
	seen := map[string]bool{}
	var mark func(v any)
	mark = func(v any) {
		switch x := v.(type) {
		case []any:
			for _, item := range x {
				mark(item)
			}
		case map[string]any:
			if u, ok := x["_"].(string); ok {
				seen[u] = true
			}
			for _, item := range x {
				mark(item)
			}
		}
	}
	raw, err := json.Marshal(allDialogConstructors())
	if err != nil {
		t.Fatalf("сериализация: %v", err)
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("разбор: %v", err)
	}
	mark(decoded)

	ctors := loadSchemaConstructors(t)
	for _, tag := range dialogConstructorTags() {
		if !seen[tag] {
			t.Errorf("конструктор %q не участвует в сверке со схемой", tag)
		}
		if _, ok := ctors[tag]; !ok {
			t.Errorf("конструктора %q нет в схеме", tag)
		}
	}
}

// pFlags несёт только true: «выключено» — это отсутствие ключа. Проверяется на
// всех уровнях вложенности: pFlags есть и у диалога, и у строки-папки, и у
// самой папки.
func TestDialogs_PFlagsNeverFalse(t *testing.T) {
	raw, err := json.Marshal(allDialogConstructors())
	if err != nil {
		t.Fatalf("сериализация: %v", err)
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("разбор: %v", err)
	}
	var check func(v any)
	check = func(v any) {
		switch x := v.(type) {
		case []any:
			for _, item := range x {
				check(item)
			}
		case map[string]any:
			if pf, ok := x["pFlags"]; ok {
				flags, _ := pf.(map[string]any)
				if len(flags) == 0 {
					t.Errorf("%v: пустой pFlags сериализован — должен отсутствовать", x["_"])
				}
				for k, val := range flags {
					if val != true {
						t.Errorf("%v: pFlags[%q] = %v, а «выключено» — это отсутствие ключа", x["_"], k, val)
					}
				}
			}
			for k, item := range x {
				if k != "pFlags" {
					check(item)
				}
			}
		}
	}
	check(decoded)
}

// Числовой id конструктора в докблоке — не украшение: на фазе 2 именно он
// уходит в поток четырьмя байтами, и по нему читающая сторона узнаёт, что
// разбирает. Проверяется механически, потому что глазами не проверяется: при
// написании этого файла один id (`dialog`) был выписан по памяти и оказался
// чужим — прочитать это не смог бы никто.
//
// Проверка нарочно смотрит в исходник подсистемы: докблок — единственное место,
// где id у нас вообще записан.
func TestDialogs_ConstructorIDsMatchSchema(t *testing.T) {
	src, err := os.ReadFile("mtdialog.go")
	if err != nil {
		t.Fatalf("исходник подсистемы не читается: %v", err)
	}

	want := map[string]string{}
	for predicate, ctor := range loadSchemaConstructorIDs(t) {
		n, err := strconv.ParseInt(ctor, 10, 64)
		if err != nil {
			t.Fatalf("id конструктора %q не число: %v", predicate, err)
		}
		want[predicate] = fmt.Sprintf("%08x", uint32(n))
	}

	found := 0
	re := regexp.MustCompile(`(?m)^//\s*([A-Za-z][A-Za-z0-9_.]*)#([0-9a-f]{8})\b`)
	for _, m := range re.FindAllStringSubmatch(string(src), -1) {
		predicate, id := m[1], m[2]
		schemaID, ok := want[predicate]
		if !ok {
			t.Errorf("докблок ссылается на конструктор %q, которого нет в схеме", predicate)
			continue
		}
		found++
		if schemaID != id {
			t.Errorf("%s: id в докблоке #%s, а в схеме #%s", predicate, id, schemaID)
		}
	}
	// Иначе тест «проходил» бы и на файле без единого докблока.
	if found != len(dialogConstructorTags()) {
		t.Errorf("докблоков с id найдено %d, а объявленных конструкторов %d", found, len(dialogConstructorTags()))
	}
}

// loadSchemaConstructorIDs — predicate → числовой id как он записан в схеме.
// Отдельно от loadSchemaConstructors: тому id не нужен, и лишнее поле в его
// структуре сбило бы с толку остальные сверки.
func loadSchemaConstructorIDs(t *testing.T) map[string]string {
	t.Helper()

	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "schema", "schema.json"))
	if err != nil {
		t.Fatalf("схема не читается: %v", err)
	}
	var doc struct {
		API struct {
			Constructors []struct {
				ID        string `json:"id"`
				Predicate string `json:"predicate"`
			} `json:"constructors"`
		} `json:"API"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("схема не разбирается: %v", err)
	}
	out := make(map[string]string, len(doc.API.Constructors))
	for _, c := range doc.API.Constructors {
		out[c.Predicate] = c.ID
	}

	return out
}
