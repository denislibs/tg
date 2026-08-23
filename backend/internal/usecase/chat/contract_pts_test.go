package chat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// lastFrameOfType — последний кадр ЗАДАННОГО типа для получателя. Нужен там,
// где действие рассылает несколько кадров подряд (платная реакция шлёт ещё и
// баланс звёзд), и «последний вообще» отвечает не на тот вопрос.
// frameCursor — курсор последнего кадра получателя, ГДЕ БЫ ОН НИ ЕХАЛ.
//
// Мест ровно два, и выбирает между ними схема: конструктор с параметром pts
// несёт курсор в теле, конструктор без него — в конверте (см. framePts). Пин на
// само это правило — TestFramePts_LivesWhereSchemaSaysIt; здесь важно лишь то,
// что курсор у кадра есть и равен строке журнала.
func frameCursor(t *testing.T, pub *fakePublisher, userID int64) (int64, bool) {
	t.Helper()
	pub.mu.Lock()
	defer pub.mu.Unlock()
	for i := len(pub.frames) - 1; i >= 0; i-- {
		if pub.frames[i].userID != userID {
			continue
		}
		var env struct {
			Pts *int64 `json:"pts"`
			D   struct {
				Pts *int64 `json:"pts"`
			} `json:"d"`
		}
		if err := json.Unmarshal(pub.frames[i].frame, &env); err != nil {
			t.Fatalf("unmarshal frame: %v", err)
		}
		if env.Pts != nil {
			return *env.Pts, true
		}
		if env.D.Pts != nil {
			return *env.D.Pts, true
		}
		return 0, false
	}
	t.Fatalf("no frame captured for user %d", userID)
	return 0, false
}

func lastFrameOfType(t *testing.T, pub *fakePublisher, userID int64, typ string) map[string]any {
	t.Helper()
	pub.mu.Lock()
	defer pub.mu.Unlock()
	for i := len(pub.frames) - 1; i >= 0; i-- {
		if pub.frames[i].userID != userID {
			continue
		}
		var env struct {
			T string          `json:"t"`
			D json.RawMessage `json:"d"`
		}
		if err := json.Unmarshal(pub.frames[i].frame, &env); err != nil {
			t.Fatalf("unmarshal frame: %v", err)
		}
		if env.T != typ {
			continue
		}
		var d map[string]any
		if err := json.Unmarshal(env.D, &d); err != nil {
			t.Fatalf("unmarshal d: %v", err)
		}
		return d
	}
	t.Fatalf("кадра %q для пользователя %d не было", typ, userID)
	return nil
}

// lastFrameFor decodes the payload (d) of the most recent frame published to
// userID. Fails if no frame was captured for that user.
func lastFrameFor(t *testing.T, pub *fakePublisher, userID int64) map[string]any {
	t.Helper()
	pub.mu.Lock()
	defer pub.mu.Unlock()
	for i := len(pub.frames) - 1; i >= 0; i-- {
		if pub.frames[i].userID != userID {
			continue
		}
		var env struct {
			T string          `json:"t"`
			D json.RawMessage `json:"d"`
		}
		if err := json.Unmarshal(pub.frames[i].frame, &env); err != nil {
			t.Fatalf("unmarshal frame: %v", err)
		}
		var d map[string]any
		if err := json.Unmarshal(env.D, &d); err != nil {
			t.Fatalf("unmarshal d: %v", err)
		}
		return d
	}
	t.Fatalf("no frame captured for user %d", userID)
	return nil
}

// rowPts returns the pts of the last update row appended for userID (the dense
// per-user cursor). Reads the fake update log directly.
func rowPts(t *testing.T, s *store, userID int64) int64 {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	ups := s.updates[userID]
	if len(ups) == 0 {
		t.Fatalf("no update rows for user %d", userID)
	}
	return ups[len(ups)-1].Pts
}

func asInt64(t *testing.T, v any) int64 {
	t.Helper()
	f, ok := v.(float64) // JSON numbers decode to float64
	if !ok {
		t.Fatalf("value %#v is not a number", v)
	}
	return int64(f)
}

// (a) Every logged live frame carries the recipient's per-user pts, and it
// equals the pts of the matching updates row for that recipient.
func TestFramePts_MatchesUpdateRow(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	// new_message: both sender and recipient get a frame carrying their own pts.
	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	for _, uid := range []int64{a, b} {
		d := lastFrameFor(t, pub, uid)
		if got, want := asInt64(t, d["pts"]), rowPts(t, s, uid); got != want {
			t.Fatalf("new_message pts for %d = %d; want row pts %d", uid, got, want)
		}
	}

	// reaction: same invariant on a different update type.
	pub.reset()
	if err := in.React(ctx, chatID, msg.ID, b, "🔥", true); err != nil {
		t.Fatalf("React: %v", err)
	}
	for _, uid := range []int64{a, b} {
		got, ok := frameCursor(t, pub, uid)
		if !ok {
			t.Fatalf("reaction frame for %d missing pts", uid)
		}
		if want := rowPts(t, s, uid); got != want {
			t.Fatalf("reaction pts for %d = %d; want row pts %d", uid, got, want)
		}
	}

	// read/edit/pin/delete also carry pts (spot-check read).
	pub.reset()
	if err := in.MarkRead(ctx, chatID, b, msg.Seq); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	d := lastFrameFor(t, pub, b)
	if got, want := asInt64(t, d["pts"]), rowPts(t, s, b); got != want {
		t.Fatalf("read pts for b = %d; want row pts %d", got, want)
	}
}

// (b) Reactions are absolute: the reaction payload carries the full current
// aggregate (counts), so replaying it from /sync is idempotent by construction.
// The counts in the live frame equal the counts stored in the log payload.
func TestReactionPayload_AbsoluteAndIdempotent(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})

	// countsOf читает АБСОЛЮТНЫЙ агрегат из последнего кадра реакций для a.
	// Агрегат едет конструктором messageReactions — тем же, что внутри самого
	// сообщения; чип — reactionCount с объединением Reaction внутри.
	countsOf := func() map[string]int64 {
		d := lastFrameFor(t, pub, a)
		reactions, ok := d["reactions"].(map[string]any)
		if !ok {
			t.Fatalf("в кадре нет агрегата: %#v", d)
		}
		// Агрегат помечен min: пер-зрительской части в общем теле нет.
		if pf, _ := reactions["pFlags"].(map[string]any); pf["min"] != true {
			t.Fatalf("агрегат кадра не помечен min: %#v", reactions["pFlags"])
		}
		raw, ok := reactions["results"].([]any)
		if !ok {
			t.Fatalf("в агрегате нет вектора results: %#v", reactions)
		}
		out := map[string]int64{}
		for _, e := range raw {
			m := e.(map[string]any)
			r := m["reaction"].(map[string]any)
			out[r["emoticon"].(string)] = asInt64(t, m["count"])
		}
		return out
	}

	// b adds 🔥 → counts {🔥:1}.
	pub.reset()
	if err := in.React(ctx, chatID, msg.ID, b, "🔥", true); err != nil {
		t.Fatalf("React b add: %v", err)
	}
	if c := countsOf(); c["🔥"] != 1 || len(c) != 1 {
		t.Fatalf("after b🔥 counts = %v; want {🔥:1}", c)
	}

	// a adds 👍 → absolute aggregate now {🔥:1, 👍:1}.
	pub.reset()
	if err := in.React(ctx, chatID, msg.ID, a, "👍", true); err != nil {
		t.Fatalf("React a add: %v", err)
	}
	if c := countsOf(); c["🔥"] != 1 || c["👍"] != 1 || len(c) != 2 {
		t.Fatalf("after +a👍 counts = %v; want {🔥:1,👍:1}", c)
	}

	// b removes 🔥 → absolute aggregate now {👍:1} (🔥 gone entirely).
	pub.reset()
	if err := in.React(ctx, chatID, msg.ID, b, "🔥", false); err != nil {
		t.Fatalf("React b remove: %v", err)
	}
	c := countsOf()
	if _, ok := c["🔥"]; ok || c["👍"] != 1 || len(c) != 1 {
		t.Fatalf("after -b🔥 counts = %v; want {👍:1}", c)
	}

	// The counts in the frame match the aggregate persisted to the log payload,
	// so a /sync replay reconstructs exactly the same state (idempotent).
	s.mu.Lock()
	ups := s.updates[a]
	last := ups[len(ups)-1]
	s.mu.Unlock()
	var logPayload map[string]any
	if err := json.Unmarshal(last.Payload, &logPayload); err != nil {
		t.Fatalf("unmarshal log payload: %v", err)
	}
	reactions, _ := logPayload["reactions"].(map[string]any)
	logCounts, ok := reactions["results"].([]any)
	if !ok || len(logCounts) != 1 {
		t.Fatalf("в записи журнала агрегат = %#v; ждали один чип", logPayload["reactions"])
	}
	m := logCounts[0].(map[string]any)
	r := m["reaction"].(map[string]any)
	if r["emoticon"].(string) != "👍" || asInt64(t, m["count"]) != 1 {
		t.Fatalf("чип записи журнала = %#v; ждали 👍:1", m)
	}
}

// (d) new_message and read frames carry the recipient's authoritative unread,
// and it matches the value persisted for that member.
func TestUnread_AuthoritativeInFrames(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	memberUnread := func(uid int64) int64 {
		s.mu.Lock()
		defer s.mu.Unlock()
		return int64(s.members[chatID][uid].unread)
	}

	// Два сообщения от a → счётчик b растёт в БАЗЕ до 1, потом до 2.
	//
	// В КАДРЕ его нет ни у кого, включая получателя: у конструктора
	// updateNewMessage такого параметра в схеме нет, а поле рядом с ним было
	// последним, что осталось вне конструктора. Клиент считает +1 сам — ровно
	// как оригинал; авторитетное значение приезжает строкой диалога и кадром
	// прочтения (см. ниже, там still_unread_count проверяется).
	for want := int64(1); want <= 2; want++ {
		pub.reset()
		if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "m"}); err != nil {
			t.Fatalf("Send: %v", err)
		}
		if got := memberUnread(b); got != want {
			t.Fatalf("db unread for b = %d; want %d", got, want)
		}
		db := lastFrameFor(t, pub, b)
		if _, ok := db["unread"]; ok {
			t.Fatalf("кадр не должен нести unread; получили %v", db["unread"])
		}
		da := lastFrameFor(t, pub, a)
		if _, ok := da["unread"]; ok {
			t.Fatalf("кадр не должен нести unread; получили %v", da["unread"])
		}
	}

	// b reads everything → read frame carries unread=0, matching the DB.
	pub.reset()
	last := s.chatSeq[chatID]
	if err := in.MarkRead(ctx, chatID, b, last); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	// Читателю уходит updateReadHistoryInbox — единственный из двух
	// конструкторов прочтения, который несёт счётчик: непрочитанное МОЁ.
	db := lastFrameFor(t, pub, b)
	if db["_"] != domain.UpdateReadHistoryInboxTag {
		t.Fatalf("кадр читателю = %v; want %s", db["_"], domain.UpdateReadHistoryInboxTag)
	}
	if got := asInt64(t, db["still_unread_count"]); got != 0 {
		t.Fatalf("read unread for b = %d; want 0", got)
	}
	if got := memberUnread(b); got != 0 {
		t.Fatalf("db unread for b after read = %d; want 0", got)
	}
}

// client_msg_id rides along in the new_message echo so the sender can match the
// echo to its optimistic bubble (same key as the ack).
func TestNewMessageEcho_CarriesClientMsgID(t *testing.T) {
	in, _ := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi", ClientMsgID: "opt-42"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	d := lastFrameFor(t, pub, a)
	msg, _ := d["message"].(map[string]any)
	if got, _ := msg["random_id"].(string); got != "opt-42" {
		t.Fatalf("echo random_id = %q; want opt-42", got)
	}
}

// (a2) Курсор живого кадра лежит там, где велит СХЕМА, — и это не вкусовщина.
//
// У updateNewMessage `pts` — параметр конструктора, значит он внутри тела. У
// updateMessageReactions параметра pts нет вовсе: у оригинала такие кадры едут
// в контейнере updates, и порядок им задаёт seq КОНТЕЙНЕРА. Дописать pts в
// такое тело значило бы завести на конструкторе поле, которого в схеме нет, —
// на проводе TL оно сдвинуло бы разбор всех последующих полей.
func TestFramePts_LivesWhereSchemaSaysIt(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	// Конструктор С параметром pts: курсор ВНУТРИ тела, конверт его не дублирует.
	// Прочтение взято потому, что оно идёт тем же строителем кадра, что и
	// реакция, — разводит их именно схема, а не разные пути публикации.
	pub.reset()
	if err := in.MarkRead(ctx, chatID, b, msg.Seq); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	body := lastFrameOfType(t, pub, b, "read")
	if body["pts"] == nil {
		t.Fatalf("у кадра прочтения курсор не в теле: %#v", body)
	}
	if env := envelopePts(t, pub, b); env != nil {
		t.Fatalf("курсор кадра прочтения продублирован в конверте: %d", *env)
	}

	// Конструктор БЕЗ параметра pts: курсор в КОНВЕРТЕ, тела он не касается.
	pub.reset()
	if err := in.React(ctx, chatID, msg.ID, b, "🔥", true); err != nil {
		t.Fatalf("React: %v", err)
	}
	body = lastFrameOfType(t, pub, a, "reaction")
	if _, stray := body["pts"]; stray {
		t.Fatalf("курсор попал в тело конструктора без параметра pts: %#v", body)
	}
	env := envelopePts(t, pub, a)
	if env == nil {
		t.Fatal("курсор кадра реакций не поехал вовсе: клиент не сдвинет курсор и уйдёт в догон")
	}
	if want := rowPts(t, s, a); *env != want {
		t.Fatalf("курсор в конверте = %d; строка журнала = %d", *env, want)
	}

	// Само правило читается из схемы, а не из списка имён рядом с ней.
	if !domain.UpdateDeclaresPts(domain.UpdateNewMessageTag) {
		t.Error("updateNewMessage объявляет pts параметром — схема говорит иначе")
	}
	if domain.UpdateDeclaresPts(domain.UpdateMessageReactionsTag) {
		t.Error("у updateMessageReactions параметра pts в схеме нет")
	}
}

// envelopePts — курсор из КОНВЕРТА последнего кадра получателя (nil — его там нет).
func envelopePts(t *testing.T, pub *fakePublisher, userID int64) *int64 {
	t.Helper()
	pub.mu.Lock()
	defer pub.mu.Unlock()
	for i := len(pub.frames) - 1; i >= 0; i-- {
		if pub.frames[i].userID != userID {
			continue
		}
		var env struct {
			Pts *int64 `json:"pts"`
		}
		if err := json.Unmarshal(pub.frames[i].frame, &env); err != nil {
			t.Fatalf("unmarshal frame: %v", err)
		}
		return env.Pts
	}
	t.Fatalf("no frame captured for user %d", userID)
	return nil
}
