package chat

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakePhoneCalls — PhoneCallStore в памяти с той же атомарностью Finish, что
// у Redis (MULTI GET+DEL): звонок отдаётся ровно одному вызову.
type fakePhoneCalls struct {
	mu    sync.Mutex
	calls map[string]domain.PhoneCall
}

func newFakePhoneCalls() *fakePhoneCalls {
	return &fakePhoneCalls{calls: map[string]domain.PhoneCall{}}
}

func (f *fakePhoneCalls) Create(_ context.Context, c domain.PhoneCall) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.calls[c.ID]; ok {
		return false, nil
	}
	f.calls[c.ID] = c
	return true, nil
}

func (f *fakePhoneCalls) Get(_ context.Context, id string) (domain.PhoneCall, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.calls[id]
	if !ok {
		return domain.PhoneCall{}, domain.ErrNotFound
	}
	return c, nil
}

func (f *fakePhoneCalls) Accept(_ context.Context, id string, at time.Time) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if c, ok := f.calls[id]; ok && c.AcceptedAt.IsZero() {
		c.AcceptedAt = at
		f.calls[id] = c
		return true, nil
	}
	return false, nil
}

func (f *fakePhoneCalls) Finish(_ context.Context, id string) (domain.PhoneCall, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.calls[id]
	if !ok {
		return domain.PhoneCall{}, domain.ErrNotFound
	}
	delete(f.calls, id)
	return c, nil
}

// backdateAnswer сдвигает момент ответа в прошлое — «разговор длился d».
func (f *fakePhoneCalls) backdateAnswer(id string, d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c := f.calls[id]
	c.AcceptedAt = time.Now().Add(-d)
	f.calls[id] = c
}

const callerID, calleeID = int64(1), int64(2)

func newCallInteractor() (*Interactor, *store, *fakePhoneCalls, *fakePublisher) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	calls := newFakePhoneCalls()
	in.SetPhoneCalls(calls)
	return in, s, calls, pub
}

// relay — кадр сигналинга так, как его разбирает ws/conn.go (JSON → map).
func relay(t *testing.T, in *Interactor, typ string, from, to int64, body string) {
	t.Helper()
	var d map[string]any
	if err := json.Unmarshal([]byte(body), &d); err != nil {
		t.Fatal(err)
	}
	if err := in.RelayCall(context.Background(), typ, from, to, d); err != nil {
		t.Fatalf("RelayCall(%s): %v", typ, err)
	}
}

// callLogs — все строки-логи звонков в сторе.
func callLogs(s *store) []domain.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []domain.Message
	for _, msgs := range s.messages {
		for _, m := range msgs {
			if _, ok := m.Action.(domain.MessageActionPhoneCall); ok {
				out = append(out, m)
			}
		}
	}
	return out
}

func onlyCallLog(t *testing.T, s *store) (domain.Message, domain.MessageActionPhoneCall) {
	t.Helper()
	logs := callLogs(s)
	if len(logs) != 1 {
		t.Fatalf("логов звонка %d, want 1: %+v", len(logs), logs)
	}
	return logs[0], logs[0].Action.(domain.MessageActionPhoneCall)
}

func framesOfType(pub *fakePublisher, userID int64, typ string) int {
	pub.mu.Lock()
	defer pub.mu.Unlock()
	n := 0
	for _, f := range pub.frames {
		var env struct {
			T string `json:"t"`
		}
		if f.userID == userID && json.Unmarshal(f.frame, &env) == nil && env.T == typ {
			n++
		}
	}
	return n
}

func reasonTag(a domain.MessageActionPhoneCall) string {
	if a.Reason == nil {
		return ""
	}
	return a.Reason.Tag()
}

// Состоявшийся звонок: лог кладёт СЕРВЕР, от звонящего, в их личный чат, с
// длительностью, посчитанной от ответа (а не присланной клиентом), и оба
// получают его обычным new_message. Повторный call_end от второй стороны
// второго лога не даёт.
func TestPhoneCall_AnsweredHangup_OneLogForBoth(t *testing.T) {
	in, s, calls, pub := newCallInteractor()
	ctx := context.Background()

	relay(t, in, "call_request", callerID, calleeID, `{"call_id":"c1","video":true}`)
	relay(t, in, "call_accept", calleeID, callerID, `{"call_id":"c1"}`)
	calls.backdateAnswer("c1", 42*time.Second+300*time.Millisecond)
	pub.reset()

	// Клиентская «длительность» серверу не указ.
	relay(t, in, "call_end", callerID, calleeID, `{"call_id":"c1","reason":"hangup","duration":999}`)
	relay(t, in, "call_end", calleeID, callerID, `{"call_id":"c1","reason":"hangup"}`)

	msg, act := onlyCallLog(t, s)
	if msg.SenderID != callerID || msg.Type != "call" || msg.Text != "" {
		t.Fatalf("лог: sender=%d type=%q text=%q", msg.SenderID, msg.Type, msg.Text)
	}
	chatID, _ := in.CreatePrivateChat(ctx, callerID, calleeID)
	if msg.ChatID != chatID {
		t.Fatalf("лог не в личном чате сторон: %d, want %d", msg.ChatID, chatID)
	}
	if reasonTag(act) != domain.PhoneCallDiscardReasonHangupTag || act.Duration == nil || *act.Duration != 42 || !act.PFlags["video"] {
		t.Fatalf("исход: reason=%s duration=%v pFlags=%v, want Hangup 42 video", reasonTag(act), act.Duration, act.PFlags)
	}
	for _, uid := range []int64{callerID, calleeID} {
		if n := framesOfType(pub, uid, "new_message"); n != 1 {
			t.Fatalf("new_message у %d: %d, want 1", uid, n)
		}
		log, err := in.CallLog(ctx, uid, 0, 40)
		if err != nil || len(log) != 1 || log[0].Message.ID != msg.ID {
			t.Fatalf("журнал звонков %d: %+v err=%v", uid, log, err)
		}
	}
	// call_end доходит собеседнику; второй call_end — уже вне звонка (его
	// кончила первая сторона), реле его не несёт (Telegram CALL_ALREADY_DECLINED).
	if framesOfType(pub, calleeID, "call_end") != 1 || framesOfType(pub, callerID, "call_end") != 0 {
		t.Fatalf("call_end: адресату %d (want 1), звонящему %d (want 0)",
			framesOfType(pub, calleeID, "call_end"), framesOfType(pub, callerID, "call_end"))
	}
}

// Каждый исход — ровно одно сообщение с причиной и длительностью по серверу.
func TestPhoneCall_Outcomes(t *testing.T) {
	type step struct {
		typ      string
		from, to int64
		body     string
	}
	req := step{"call_request", callerID, calleeID, `{"call_id":"x","video":false}`}
	acc := step{"call_accept", calleeID, callerID, `{"call_id":"x"}`}
	cases := []struct {
		name     string
		steps    []step
		talked   time.Duration // >0 — ответ сдвигается в прошлое
		reason   string
		duration *int
	}{
		{"звонящий отменил до ответа", []step{req, {"call_end", callerID, calleeID, `{"call_id":"x","reason":"hangup"}`}}, 0, domain.PhoneCallDiscardReasonMissedTag, nil},
		{"у звонящего истекло ожидание", []step{req, {"call_end", callerID, calleeID, `{"call_id":"x","reason":"missed"}`}}, 0, domain.PhoneCallDiscardReasonMissedTag, nil},
		{"адресат отклонил", []step{req, {"call_decline", calleeID, callerID, `{"call_id":"x","reason":"declined"}`}}, 0, domain.PhoneCallDiscardReasonBusyTag, nil},
		{"адресат занят", []step{req, {"call_decline", calleeID, callerID, `{"call_id":"x","reason":"busy"}`}}, 0, domain.PhoneCallDiscardReasonBusyTag, nil},
		{"у адресата истёк звонок", []step{req, {"call_decline", calleeID, callerID, `{"call_id":"x","reason":"missed"}`}}, 0, domain.PhoneCallDiscardReasonMissedTag, nil},
		{"обрыв связи после ответа", []step{req, acc, {"call_end", calleeID, callerID, `{"call_id":"x","reason":"disconnect"}`}}, 7 * time.Second, domain.PhoneCallDiscardReasonDisconnectTag, ptr(7)},
		{"ответили и сразу положили", []step{req, acc, {"call_end", callerID, calleeID, `{"call_id":"x"}`}}, 0, domain.PhoneCallDiscardReasonHangupTag, ptr(0)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in, s, calls, _ := newCallInteractor()
			for i, st := range tc.steps {
				if i == len(tc.steps)-1 && tc.talked > 0 {
					calls.backdateAnswer("x", tc.talked+100*time.Millisecond)
				}
				relay(t, in, st.typ, st.from, st.to, st.body)
			}
			msg, act := onlyCallLog(t, s)
			if msg.SenderID != callerID {
				t.Fatalf("лог от %d, want звонящего %d", msg.SenderID, callerID)
			}
			if reasonTag(act) != tc.reason {
				t.Fatalf("причина %q, want %q", reasonTag(act), tc.reason)
			}
			switch {
			case tc.duration == nil && act.Duration != nil:
				t.Fatalf("у несостоявшегося звонка duration=%d", *act.Duration)
			case tc.duration != nil && (act.Duration == nil || *act.Duration != *tc.duration):
				t.Fatalf("duration=%v, want %d", act.Duration, *tc.duration)
			}
			if _, err := calls.Get(context.Background(), "x"); err == nil {
				t.Fatal("звонок остался в сторе после конца")
			}
		})
	}
}

// Отказ по правилу «кто может мне звонить»: звонок не заводится, лога нет,
// звонящему — call_decline reason=privacy, адресату — ничего.
func TestPhoneCall_PrivacyDeclineLeavesNoLog(t *testing.T) {
	in, s, calls, pub := newCallInteractor()
	in.SetPrivacy(callPrivacy{denyCalls: true})

	relay(t, in, "call_request", callerID, calleeID, `{"call_id":"p","video":false}`)
	relay(t, in, "call_end", callerID, calleeID, `{"call_id":"p"}`)

	if logs := callLogs(s); len(logs) != 0 {
		t.Fatalf("лог у запрещённого звонка: %+v", logs)
	}
	if _, err := calls.Get(context.Background(), "p"); err == nil {
		t.Fatal("запрещённый звонок заведён")
	}
	if framesOfType(pub, callerID, "call_decline") != 1 || framesOfType(pub, calleeID, "call_request") != 0 {
		t.Fatal("ожидали privacy-отказ звонящему и тишину у адресата")
	}
}

// Правило «кто может мне писать» лог звонка не режет: звонки разрешены —
// значит, и их лог ложится (служебное сообщение рождает сервер).
func TestPhoneCall_MessagePrivacyDoesNotBlockLog(t *testing.T) {
	in, s, _, _ := newCallInteractor()
	in.SetPrivacy(callPrivacy{denyMessages: true})

	relay(t, in, "call_request", callerID, calleeID, `{"call_id":"m"}`)
	relay(t, in, "call_decline", calleeID, callerID, `{"call_id":"m","reason":"declined"}`)

	onlyCallLog(t, s)
}

// Посторонний не кончает и не принимает чужой звонок.
func TestPhoneCall_StrangerCannotTouchCall(t *testing.T) {
	in, s, calls, _ := newCallInteractor()
	const stranger = int64(3)

	relay(t, in, "call_request", callerID, calleeID, `{"call_id":"s"}`)
	relay(t, in, "call_accept", stranger, callerID, `{"call_id":"s"}`)
	relay(t, in, "call_accept", callerID, calleeID, `{"call_id":"s"}`) // звонящий сам себе не отвечает
	relay(t, in, "call_end", stranger, callerID, `{"call_id":"s"}`)

	c, err := calls.Get(context.Background(), "s")
	if err != nil || c.Answered() {
		t.Fatalf("звонок: %+v err=%v — want живой и без ответа", c, err)
	}
	if logs := callLogs(s); len(logs) != 0 {
		t.Fatalf("посторонний положил лог: %+v", logs)
	}
}

// Повтор call_request с тем же call_id не перезаписывает звонок.
func TestPhoneCall_RepeatedRequestKeepsCall(t *testing.T) {
	in, _, calls, _ := newCallInteractor()
	relay(t, in, "call_request", callerID, calleeID, `{"call_id":"r","video":true}`)
	relay(t, in, "call_request", calleeID, callerID, `{"call_id":"r","video":false}`)
	c, err := calls.Get(context.Background(), "r")
	if err != nil || c.CallerID != callerID || !c.Video {
		t.Fatalf("звонок перезаписан: %+v err=%v", c, err)
	}
}

// Без стора состояния (нет Redis) сигналинг ходит, лог не кладётся.
func TestPhoneCall_NoStoreStillRelays(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	relay(t, in, "call_request", callerID, calleeID, `{"call_id":"n"}`)
	relay(t, in, "call_end", callerID, calleeID, `{"call_id":"n"}`)
	if framesOfType(pub, calleeID, "call_end") != 1 {
		t.Fatal("call_end не переадресован")
	}
	if logs := callLogs(s); len(logs) != 0 {
		t.Fatalf("лог без стора: %+v", logs)
	}
}

// callPrivacy — правило звонков и правило сообщений по отдельности.
type callPrivacy struct{ denyCalls, denyMessages bool }

func (p callPrivacy) Check(_ context.Context, _, _ int64, key domain.PrivacyKey) (bool, error) {
	switch key {
	case domain.PrivacyCalls:
		return !p.denyCalls, nil
	case domain.PrivacyMessages:
		return !p.denyMessages, nil
	}
	return true, nil
}

func (p callPrivacy) VisibleMap(_ context.Context, _ int64, ids []int64, _ domain.PrivacyKey) (map[int64]bool, error) {
	out := map[int64]bool{}
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}

func (p callPrivacy) ViewUsers(ctx context.Context, viewerID int64, users []domain.UserReal) {
	viewUsersVia(ctx, p, viewerID, users)
}
