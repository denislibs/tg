package demoseed

import (
	"context"
	"testing"
)

// demoUsers — «юзернейм → id» для всех, кого поминают спеки демо-контента:
// список пользователей стенда живёт в postgres.SeedDemo, а сиду важно только,
// что каждый упомянутый им автор существует.
func demoUsers() map[string]int64 {
	users := map[string]int64{}
	add := func(name string) {
		if name == "" {
			return
		}
		if _, ok := users[name]; !ok {
			users[name] = int64(len(users) + 1)
		}
	}
	for _, c := range channels {
		add(c.creator)
		if c.discussion != nil {
			for _, cm := range c.discussion.comments {
				add(cm.author)
			}
		}
	}
	for _, g := range groups {
		add(g.creator)
		for _, name := range g.members {
			add(name)
		}
		for _, name := range g.lateJoin {
			add(name)
		}
		for _, r := range g.script {
			add(r.author)
		}
	}
	return users
}

// channelWithDiscussion — единственный канал спеки, у которого заведено
// обсуждение: без него футер комментариев не появляется ни под одним постом.
func channelWithDiscussion(t *testing.T) channelSpec {
	t.Helper()
	var found []channelSpec
	for _, c := range channels {
		if c.discussion != nil {
			found = append(found, c)
		}
	}
	if len(found) != 1 {
		t.Fatalf("каналов с обсуждением в спеке: %d, ожидался ровно 1", len(found))
	}
	return found[0]
}

func TestSeed_DiscussionLinkedToChannel(t *testing.T) {
	f := newFakeChat()
	seed(context.Background(), f, nil, demoUsers())

	spec := channelWithDiscussion(t)
	ch := f.chatByTitle(spec.title)
	if ch == nil {
		t.Fatalf("канал %q не создан", spec.title)
	}
	if len(f.discussion) != 1 {
		t.Fatalf("привязок канал↔обсуждение: %d, ожидалась 1", len(f.discussion))
	}
	groupID := f.discussion[ch.id]
	if groupID == 0 {
		t.Fatalf("у канала %q нет привязанной группы обсуждения", spec.title)
	}
	g := f.chats[groupID]
	if g.typ != "group" {
		t.Fatalf("обсуждение %q имеет тип %q, ожидался group", g.title, g.typ)
	}
	if g.title != spec.discussion.title {
		t.Fatalf("название группы обсуждения %q, ожидалось %q", g.title, spec.discussion.title)
	}
	if g.creator != ch.creator {
		t.Fatalf("группу обсуждения завёл %d, а канал — %d", g.creator, ch.creator)
	}

	// Привязка обязана состояться ДО постов: зеркало (корень треда) рождается
	// на вставке поста, и у канала с обсуждением зеркало есть у КАЖДОГО поста,
	// а не только у прокомментированных.
	for idx, p := range spec.posts {
		text, _ := compose(p.body)
		post := f.postByText(ch.id, text)
		if post == nil {
			t.Fatalf("пост %d канала %q не найден", idx, spec.title)
		}
		if f.mirrorOfPost(post.id) == 0 {
			t.Fatalf("у поста %d канала %q нет зеркала в группе обсуждения", idx, spec.title)
		}
	}
}

func TestSeed_CommentsAttachedToTheirPosts(t *testing.T) {
	f := newFakeChat()
	users := demoUsers()
	seed(context.Background(), f, nil, users)

	spec := channelWithDiscussion(t)
	ch := f.chatByTitle(spec.title)
	if ch == nil {
		t.Fatalf("канал %q не создан", spec.title)
	}

	// Ожидаемое: индекс поста → комментарии (текст + автор) в порядке спеки.
	type want struct {
		text   string
		author int64
	}
	expected := map[int][]want{}
	for _, cm := range spec.discussion.comments {
		expected[cm.post] = append(expected[cm.post], want{cm.text, users[cm.author]})
	}

	for postIdx, wants := range expected {
		text, _ := compose(spec.posts[postIdx].body)
		post := f.postByText(ch.id, text)
		if post == nil {
			t.Fatalf("пост %d канала %q не найден", postIdx, spec.title)
		}
		got := f.commentsOn(post.id)
		if len(got) != len(wants) {
			t.Fatalf("пост %d: комментариев %d, ожидалось %d", postIdx, len(got), len(wants))
		}
		for i, w := range wants {
			if got[i].text != w.text {
				t.Fatalf("пост %d, комментарий %d: текст %q, ожидался %q", postIdx, i, got[i].text, w.text)
			}
			if got[i].senderID != w.author {
				t.Fatalf("пост %d, комментарий %d: автор %d, ожидался %d", postIdx, i, got[i].senderID, w.author)
			}
			if got[i].chatID != f.discussion[ch.id] {
				t.Fatalf("пост %d, комментарий %d лёг в чат %d, а не в группу обсуждения", postIdx, i, got[i].chatID)
			}
		}
	}

	// Футер поста рисует стек последних комментаторов (RecentRepliersLimit = 3),
	// поэтому хотя бы у одного поста комментаторов должно быть три разных —
	// иначе стек на стенде не проверить.
	maxAuthors := 0
	for postIdx := range expected {
		text, _ := compose(spec.posts[postIdx].body)
		post := f.postByText(ch.id, text)
		seen := map[int64]bool{}
		for _, m := range f.commentsOn(post.id) {
			seen[m.senderID] = true
		}
		if len(seen) > maxAuthors {
			maxAuthors = len(seen)
		}
	}
	if maxAuthors < 3 {
		t.Fatalf("максимум разных комментаторов на посте: %d, для стека аватарок нужно ≥3", maxAuthors)
	}
}

// Сид идемпотентен по чату автора: повторный прогон не должен ни создавать
// вторую группу обсуждения, ни дублировать комментарии.
func TestSeed_RerunCreatesNothing(t *testing.T) {
	f := newFakeChat()
	users := demoUsers()
	ctx := context.Background()
	seed(ctx, f, nil, users)

	chats, msgs, links := len(f.chats), len(f.msgOrder), len(f.discussion)
	if chats == 0 || msgs == 0 || links == 0 {
		t.Fatalf("первый прогон пуст: чатов %d, сообщений %d, привязок %d", chats, msgs, links)
	}

	seed(ctx, f, nil, users)

	if got := len(f.chats); got != chats {
		t.Fatalf("после повторного прогона чатов %d, было %d", got, chats)
	}
	if got := len(f.msgOrder); got != msgs {
		t.Fatalf("после повторного прогона сообщений %d, было %d", got, msgs)
	}
	if got := len(f.discussion); got != links {
		t.Fatalf("после повторного прогона привязок обсуждения %d, было %d", got, links)
	}
}
