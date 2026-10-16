package chat

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Б-9: видеочат с нуля начинает только создатель/админ (tweb topbar.ts:350-361,
// appImManager.ts:2343-2358: звонка нет и права нет → выход). Отказ — ErrForbidden;
// кадр group_call_update {action: "rejected"} шлёт ws-слой только соединению,
// приславшему вход.

// groupCallFramesFor — разобранные group_call_update, доставленные пользователю.
func groupCallFramesFor(t *testing.T, pub *fakePublisher, userID int64) []map[string]any {
	t.Helper()
	pub.mu.Lock()
	defer pub.mu.Unlock()
	var out []map[string]any
	for _, f := range pub.frames {
		if f.userID != userID {
			continue
		}
		var env struct {
			T string         `json:"t"`
			D map[string]any `json:"d"`
		}
		if json.Unmarshal(f.frame, &env) == nil && env.T == "group_call_update" {
			out = append(out, env.D)
		}
	}
	return out
}

func TestJoinGroupCall_NoCall_MemberCannotStart(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()

	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("рядовой начинает видеочат: %v, want ErrForbidden", err)
	}
	if ids, _ := e.calls.Participants(ctx, e.chatID); len(ids) != 0 {
		t.Fatalf("рядовой попал в множество участников: %v", ids)
	}
	// Отказ — ответ транспорта одному соединению (ws), usecase кадров не шлёт:
	// на других устройствах отказанного открытый звонок не должен рушиться.
	if n := len(groupCallFramesFor(t, e.pub, callMember)); n != 0 {
		t.Fatalf("usecase разослал отказ пользователю по всем устройствам: %d кадров", n)
	}
	if n := len(groupCallFramesFor(t, e.pub, callOwner)); n != 0 {
		t.Fatalf("создателю пришло %d кадров group_call_update при чужом отказе", n)
	}
	if n := len(e.chatUpdates(t, callOwner)); n != 0 {
		t.Fatalf("отказ породил chat_update: %d", n)
	}
}

func TestJoinGroupCall_NoCall_AdminStarts(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callOwner); err != nil {
		t.Fatalf("создатель начинает видеочат: %v", err)
	}
	if ids, _ := e.calls.Participants(ctx, e.chatID); len(ids) != 1 || ids[0] != callOwner {
		t.Fatalf("участники = %v, want [создатель]", ids)
	}
	// Админ, назначенный создателем, тоже начинает.
	if err := e.in.PromoteAdmin(ctx, e.chatID, callOwner, callMember, domain.RightPinMessages, nil); err != nil {
		t.Fatalf("PromoteAdmin: %v", err)
	}
	_ = e.in.LeaveGroupCall(ctx, e.chatID, callOwner)
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); err != nil {
		t.Fatalf("админ начинает видеочат: %v", err)
	}
}

func TestJoinGroupCall_ActiveCall_MemberJoins(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	before, err := e.in.JoinGroupCall(ctx, e.chatID, callMember)
	if err != nil {
		t.Fatalf("рядовой входит в идущий видеочат: %v", err)
	}
	if len(before) != 1 || before[0] != callOwner {
		t.Fatalf("участники до входа = %v, want [создатель]", before)
	}
}

func TestJoinGroupCall_LivestreamActive_MemberJoins(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	e.in.SetLivestreams(newFakeLivestreamRepo(), "rtmp://test/live")
	if _, err := e.in.StartLivestream(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); err != nil {
		t.Fatalf("зритель входит при активном эфире: %v", err)
	}
	if ids, _ := e.calls.Participants(ctx, e.chatID); len(ids) != 1 || ids[0] != callMember {
		t.Fatalf("участники = %v, want [зритель]", ids)
	}
}

func TestJoinGroupCall_LivestreamStopped_MemberCannotStart(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	e.in.SetLivestreams(newFakeLivestreamRepo(), "rtmp://test/live")
	if _, err := e.in.StartLivestream(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	if err := e.in.StopLivestream(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("рядовой после конца эфира: %v, want ErrForbidden", err)
	}
}

func TestJoinGroupCall_NotMember_NotFound(t *testing.T) {
	e := newCallEnv(t)
	if _, err := e.in.JoinGroupCall(context.Background(), e.chatID, 99); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("не член чата: %v, want ErrNotFound", err)
	}
	if n := len(groupCallFramesFor(t, e.pub, 99)); n != 0 {
		t.Fatalf("не члену чата отдан кадр: %d", n)
	}
}

// Сбой хранилища при проверке права — не отказ по праву: создателю не закрывают
// звонок кадром rejected, ошибка идёт наружу как есть.
type failingMemberGroups struct{ GroupRepo }

var errBoom = errors.New("pool timeout")

func (failingMemberGroups) GetMember(context.Context, int64, int64) (domain.Member, error) {
	return domain.Member{}, errBoom
}

func TestJoinGroupCall_StorageErrorIsNotForbidden(t *testing.T) {
	e := newCallEnv(t)
	e.in.groups = failingMemberGroups{e.in.groups}
	_, err := e.in.JoinGroupCall(context.Background(), e.chatID, callOwner)
	if !errors.Is(err, errBoom) || errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("сбой GetMember: %v, want errBoom без ErrForbidden", err)
	}
}

// Рядовой при пустом звонке — отказ не оставляет следов в сторе, и участники
// в идущем звонке видят вход рядового как обычно.
func TestJoinGroupCall_ActiveCall_MemberJoinFansOutOnce(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	e.pub.reset()
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); err != nil {
		t.Fatal(err)
	}
	if got := groupCallFramesFor(t, e.pub, callOwner); len(got) != 1 || got[0]["action"] != "joined" {
		t.Fatalf("создателю о входе рядового: %v", got)
	}
}

// Зритель, вошедший при активном эфире первым, включает call_active (переход 0→1).
func TestJoinGroupCall_LivestreamViewerFirst_AnnouncesCall(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	e.in.SetLivestreams(newFakeLivestreamRepo(), "rtmp://test/live")
	if _, err := e.in.StartLivestream(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	e.clock.advance(10 * time.Second)
	before := len(e.chatUpdates(t, callOwner))
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); err != nil {
		t.Fatal(err)
	}
	if n := len(e.chatUpdates(t, callOwner)); n != before+1 {
		t.Fatalf("первый зритель эфира: chat_update %d -> %d, want +1", before, n)
	}
}

// В-S3 (решение пользователя 2026-10-15): в вещательном канале видеочат открыт
// только создателю/админам, пока нет SFU (В-М17) — даже если звонок идёт.
func TestJoinGroupCall_Broadcast_SubscriberRejected(t *testing.T) {
	i, fg, _ := newLivestreamTestInteractor(t)
	i.SetGroupCalls(newFakeCallStore(newFakeClock()))
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	_ = fg.AddMember(ctx, ch, 8, domain.RoleSubscriber, 0)
	if _, err := i.JoinGroupCall(ctx, ch, 7); err != nil {
		t.Fatalf("создатель канала начинает видеочат: %v", err)
	}
	if _, err := i.JoinGroupCall(ctx, ch, 8); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("подписчик при идущем видеочате канала: %v, want ErrForbidden", err)
	}
	if ids, _ := i.groupCalls.Participants(ctx, ch); len(ids) != 1 || ids[0] != 7 {
		t.Fatalf("участники = %v, want [создатель]", ids)
	}
}

// Зритель эфира канала входит, пока эфир активен (это не mesh), и перестаёт
// входить после его конца.
func TestJoinGroupCall_Channel_LivestreamActive_SubscriberJoins(t *testing.T) {
	i, fg, _ := newLivestreamTestInteractor(t)
	i.SetGroupCalls(newFakeCallStore(newFakeClock()))
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	_ = fg.AddMember(ctx, ch, 8, domain.RoleSubscriber, 0)
	if _, err := i.JoinGroupCall(ctx, ch, 8); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("подписчик без эфира: %v, want ErrForbidden", err)
	}
	if _, err := i.StartLivestream(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}
	if _, err := i.JoinGroupCall(ctx, ch, 8); err != nil {
		t.Fatalf("подписчик при активном эфире: %v", err)
	}
	// Идущий звонок (зритель внутри) эфир не заменяет: после остановки эфира и
	// выхода зрителя новый подписчик — снова отказ.
	_ = fg.AddMember(ctx, ch, 9, domain.RoleSubscriber, 0)
	if err := i.StopLivestream(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}
	if _, err := i.JoinGroupCall(ctx, ch, 9); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("подписчик после конца эфира, зритель ещё внутри: %v, want ErrForbidden", err)
	}
}

// К3: mesh держит не больше domain.GroupCallMaxParticipants участников — сверх
// этого user-quota coturn кончается и pc части пар молча не соединяется. Новичок в
// полный звонок не входит (ErrGroupCallFull, ws отвечает rejected без forbidden),
// участник, уже стоящий в звонке, повторно входит (вторая вкладка, переподключение).
func TestJoinGroupCall_FullCall_Rejected(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	for uid := int64(9001); uid < 9000+domain.GroupCallMaxParticipants; uid++ {
		if _, err := e.calls.Join(ctx, e.chatID, uid, 1000); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); !errors.Is(err, domain.ErrGroupCallFull) {
		t.Fatalf("вход в полный звонок: %v, want ErrGroupCallFull", err)
	}
	if errors.Is(domain.ErrGroupCallFull, domain.ErrForbidden) {
		t.Fatal("полный звонок не должен выглядеть отказом по праву («Видеочат завершён»)")
	}
	ids, _ := e.calls.Participants(ctx, e.chatID)
	if len(ids) != domain.GroupCallMaxParticipants || slices.Contains(ids, callMember) {
		t.Fatalf("участники = %v: новичок попал в полный звонок", ids)
	}
	if n := len(groupCallFramesFor(t, e.pub, callOwner)); n != 1 {
		t.Fatalf("отказ разослан членам чата: %d кадров group_call_update у создателя, want 1 (его вход)", n)
	}
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callOwner); err != nil {
		t.Fatalf("повторный вход участника полного звонка: %v", err)
	}
}

// Зритель эфира (кадр group_call_join с viewer) не mesh: предел участников на него не
// действует, а в списке viewers кадра group_call_update он помечен — клиент не считает его
// участником при проверке предела. Без активного эфира зрителем не стать.
func TestJoinGroupCallAsViewer(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	e.in.SetLivestreams(newFakeLivestreamRepo(), "rtmp://test/live")
	if err := e.in.JoinGroupCallAsViewer(ctx, e.chatID, callMember); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("зритель без эфира: %v, want ErrForbidden", err)
	}
	if _, err := e.in.StartLivestream(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	for uid := int64(9001); uid <= 9000+domain.GroupCallMaxParticipants; uid++ {
		if _, err := e.calls.Join(ctx, e.chatID, uid, 1000); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); !errors.Is(err, domain.ErrGroupCallFull) {
		t.Fatalf("участник в полный звонок: %v, want ErrGroupCallFull", err)
	}
	if err := e.in.JoinGroupCallAsViewer(ctx, e.chatID, callMember); err != nil {
		t.Fatalf("зритель в звонок на пределе: %v", err)
	}
	if err := e.in.JoinGroupCallAsViewer(ctx, e.chatID, 99); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("зритель не из чата: %v, want ErrNotFound", err)
	}
	frames := groupCallFramesFor(t, e.pub, callOwner)
	last := frames[len(frames)-1]
	if v, _ := last["viewers"].([]any); len(v) != 1 || v[0] != float64(callMember) {
		t.Fatalf("viewers в кадре = %v, want [%d]", last["viewers"], callMember)
	}
}

// Призраки (процесс упал, не убрав участников; множество живёт до TTL, пульса у участника
// нет) не запирают звонок на пределе: на отказе по пределу уходят те, у кого нет соединения
// (presence), и вход повторяется один раз. Живые участники остаются.
func TestJoinGroupCall_FullCall_DropsOfflineGhosts(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	online := map[int64]bool{callOwner: true}
	for uid := int64(9001); uid < 9000+domain.GroupCallMaxParticipants; uid++ {
		if _, err := e.calls.Join(ctx, e.chatID, uid, 1000); err != nil {
			t.Fatal(err)
		}
	}
	// без presence предела не обойти
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); !errors.Is(err, domain.ErrGroupCallFull) {
		t.Fatalf("без presence: %v, want ErrGroupCallFull", err)
	}
	e.in.SetPresence(fakePresence{online: online})
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); err != nil {
		t.Fatalf("вход при 4 призраках: %v", err)
	}
	ids, _ := e.calls.Participants(ctx, e.chatID)
	if len(ids) != 2 || !slices.Contains(ids, callOwner) || !slices.Contains(ids, callMember) {
		t.Fatalf("участники = %v, want [создатель, вошедший]: призраки не убраны или убран живой", ids)
	}
	// все пять живы — отказ остаётся отказом
	if err := e.in.LeaveGroupCall(ctx, e.chatID, callMember); err != nil {
		t.Fatal(err)
	}
	for uid := int64(9001); uid < 9000+domain.GroupCallMaxParticipants; uid++ {
		online[uid] = true
		if _, err := e.calls.Join(ctx, e.chatID, uid, 1000); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); !errors.Is(err, domain.ErrGroupCallFull) {
		t.Fatalf("все живы: %v, want ErrGroupCallFull", err)
	}
}
