package chat

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// denyInvites — PrivacyChecker, у которого владельцы из deny запретили звать
// себя в группы (настройка «Кто может приглашать меня в группы»).
type denyInvites struct{ deny map[int64]bool }

func (p denyInvites) Check(_ context.Context, ownerID, _ int64, key domain.PrivacyKey) (bool, error) {
	if key == domain.PrivacyChatInvite && p.deny[ownerID] {
		return false, nil
	}
	return true, nil
}

func (p denyInvites) VisibleMap(_ context.Context, _ int64, ownerIDs []int64, _ domain.PrivacyKey) (map[int64]bool, error) {
	out := map[int64]bool{}
	for _, id := range ownerIDs {
		out[id] = true
	}
	return out, nil
}

// Создание группы спрашивает у каждого позванного то же правило, что и
// добавление в готовую (`AddMember`): у оригинала `messages.createChat`
// пропускает запретивших и отдаёт их в `missing_invitees` ответа
// `messages.invitedUsers`. Прежде создание звало всех в обход настройки.
func TestCreateGroup_PrivacyRestrictedAreMissingInvitees(t *testing.T) {
	fg := newFakeGroupRepo()
	s := newStore()
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.mu.Unlock()
	}
	in := New(fakeTx{}, groupChats{fg}, fakeMsgs{s}, fakeUpdates{s}, nil, fakeMedia{s}, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	in.SetPublisher(&fakePublisher{})
	in.SetPrivacy(denyInvites{deny: map[int64]bool{9: true}})
	ctx := context.Background()

	id, missing, err := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8, 9})
	if err != nil {
		t.Fatal(err)
	}
	if len(missing) != 1 || missing[0] != 9 {
		t.Fatalf("missing = %v, ждали [9]", missing)
	}
	if _, err := fg.GetMember(ctx, id, 9); err == nil {
		t.Fatal("запретивший приглашения оказался в группе")
	}
	if _, err := fg.GetMember(ctx, id, 8); err != nil {
		t.Fatalf("разрешивший не добавлен: %v", err)
	}
	// В служебном «создал(а) группу» — только реально добавленные.
	create, ok := s.messages[id][0].Action.(domain.MessageActionChatCreate)
	if !ok || len(create.Users) != 1 || create.Users[0] != 8 {
		t.Fatalf("group_create users = %#v, ждали [8]", s.messages[id][0].Action)
	}
}
