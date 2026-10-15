package redis

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
)

func newTestGroupCallStore(t *testing.T) (*GroupCallStore, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	return NewGroupCallStore(goredis.NewClient(&goredis.Options{Addr: mr.Addr()})), mr
}

// Признак перехода приходит из ОДНОГО скрипта: 0→1 при входе первого и 1→0 при
// уходе последнего. Прочие входы и выходы переходом не считаются.
func TestGroupCallStore_TransitionFlags(t *testing.T) {
	s, mr := newTestGroupCallStore(t)
	ctx := context.Background()

	first, err := s.Join(ctx, 5, 1)
	if err != nil || !first {
		t.Fatalf("первый вход: first=%v err=%v", first, err)
	}
	if ttl := mr.TTL(groupCallKey(5)); ttl != groupCallTTL {
		t.Fatalf("TTL звонка = %v, want %v", ttl, groupCallTTL)
	}
	if first, _ := s.Join(ctx, 5, 2); first {
		t.Fatal("второй вход помечен переходом")
	}
	if first, _ := s.Join(ctx, 5, 2); first {
		t.Fatal("повторный вход того же участника помечен переходом")
	}
	if last, _ := s.Leave(ctx, 5, 1); last {
		t.Fatal("выход не последнего помечен переходом")
	}
	if last, _ := s.Leave(ctx, 5, 9); last {
		t.Fatal("выход того, кого в звонке нет, помечен переходом")
	}
	if last, err := s.Leave(ctx, 5, 2); err != nil || !last {
		t.Fatalf("уход последнего: last=%v err=%v", last, err)
	}
	if last, _ := s.Leave(ctx, 5, 2); last {
		t.Fatal("выход из пустого звонка помечен переходом")
	}
	if mr.Exists(groupCallKey(5)) {
		t.Fatal("пустой звонок держит ключ")
	}
}

// Параллельные входы в пустой звонок: переход 0→1 ровно один.
func TestGroupCallStore_ConcurrentJoinFirstExactlyOnce(t *testing.T) {
	s, _ := newTestGroupCallStore(t)
	ctx := context.Background()
	const n = 50
	var wg sync.WaitGroup
	var mu sync.Mutex
	firsts := 0
	for k := int64(1); k <= n; k++ {
		wg.Add(1)
		go func(uid int64) {
			defer wg.Done()
			if first, err := s.Join(ctx, 7, uid); err == nil && first {
				mu.Lock()
				firsts++
				mu.Unlock()
			}
		}(k)
	}
	wg.Wait()
	if firsts != 1 {
		t.Fatalf("переходов 0→1 = %d, want 1", firsts)
	}
	lasts := 0
	for k := int64(1); k <= n; k++ {
		wg.Add(1)
		go func(uid int64) {
			defer wg.Done()
			if last, err := s.Leave(ctx, 7, uid); err == nil && last {
				mu.Lock()
				lasts++
				mu.Unlock()
			}
		}(k)
	}
	wg.Wait()
	if lasts != 1 {
		t.Fatalf("переходов 1→0 = %d, want 1", lasts)
	}
}

// ActiveAmong — один EXISTS на чат; звонок, у которого истёк срок, неактивен
// сам, без снимка (зависших флагов нет).
func TestGroupCallStore_ActiveAmongAndExpiry(t *testing.T) {
	s, mr := newTestGroupCallStore(t)
	ctx := context.Background()
	_, _ = s.Join(ctx, 1, 10)
	_, _ = s.Join(ctx, 3, 10)

	got, err := s.ActiveAmong(ctx, []int64{1, 2, 3})
	if err != nil {
		t.Fatal(err)
	}
	if !got[1] || got[2] || !got[3] || len(got) != 2 {
		t.Fatalf("ActiveAmong = %v, want чаты 1 и 3", got)
	}
	if empty, err := s.ActiveAmong(ctx, nil); err != nil || len(empty) != 0 {
		t.Fatalf("пустой вопрос: %v %v", empty, err)
	}
	mr.FastForward(groupCallTTL + time.Second)
	if got, _ := s.ActiveAmong(ctx, []int64{1, 3}); len(got) != 0 {
		t.Fatalf("после TTL звонки активны: %v", got)
	}
}

func TestGroupCallStore_SnapshotWindow(t *testing.T) {
	s, mr := newTestGroupCallStore(t)
	ctx := context.Background()
	if ok, err := s.ClaimSnapshot(ctx, 4, 5*time.Second); err != nil || !ok {
		t.Fatalf("первый захват окна: ok=%v err=%v", ok, err)
	}
	if ok, _ := s.ClaimSnapshot(ctx, 4, 5*time.Second); ok {
		t.Fatal("окно занято, а второй захват удался")
	}
	if ok, _ := s.ClaimSnapshot(ctx, 5, 5*time.Second); !ok {
		t.Fatal("окно чужого чата заняло окно чата 5")
	}
	mr.FastForward(6 * time.Second)
	if ok, _ := s.ClaimSnapshot(ctx, 4, 5*time.Second); !ok {
		t.Fatal("окно не освободилось через срок")
	}
}

// Очередь отложенных снимков: срок, аренда, закрытие, возврат записи при новом
// переходе во время аренды и подбор записи упавшей реплики.
func TestGroupCallStore_DirtyQueueLease(t *testing.T) {
	s, mr := newTestGroupCallStore(t)
	ctx := context.Background()
	t0 := time.UnixMilli(1_800_000_000_000)
	window, lease := 5*time.Second, 30*time.Second

	_ = s.MarkSnapshotDirty(ctx, 4, t0.Add(window))
	// Повторная пометка с более поздним сроком срок не двигает.
	_ = s.MarkSnapshotDirty(ctx, 4, t0.Add(3*window))

	if ids, _ := s.LeaseDirtySnapshots(ctx, t0.Add(window-time.Millisecond), t0.Add(lease), 10); len(ids) != 0 {
		t.Fatalf("запись взята до срока: %v", ids)
	}
	leaseEnd := t0.Add(window + lease)
	ids, err := s.LeaseDirtySnapshots(ctx, t0.Add(window), leaseEnd, 10)
	if err != nil || len(ids) != 1 || ids[0] != 4 {
		t.Fatalf("аренда в срок: %v err=%v, want [4]", ids, err)
	}
	if again, _ := s.LeaseDirtySnapshots(ctx, t0.Add(window), leaseEnd, 10); len(again) != 0 {
		t.Fatalf("запись в аренде отдана второй реплике: %v", again)
	}

	// Пока арендатор публикует, случился новый переход — запись возвращается к
	// сроку, и закрытие арендатора её не снимает.
	_ = s.MarkSnapshotDirty(ctx, 4, t0.Add(window+2*time.Second))
	if err := s.FinishDirtySnapshot(ctx, 4, leaseEnd, window); err != nil {
		t.Fatal(err)
	}
	if n, _ := mr.ZMembers(groupCallDirtyKey); len(n) != 1 {
		t.Fatalf("новый переход потерян: в очереди %v", n)
	}
	if ok, _ := s.ClaimSnapshot(ctx, 4, window); ok {
		t.Fatal("закрытие не заняло окно снимков")
	}

	// Вторая попытка (тот же чат) проходит нормально и закрывает запись.
	ids, _ = s.LeaseDirtySnapshots(ctx, t0.Add(window+2*time.Second), leaseEnd.Add(time.Second), 10)
	if len(ids) != 1 {
		t.Fatalf("вторая аренда: %v", ids)
	}
	if err := s.FinishDirtySnapshot(ctx, 4, leaseEnd.Add(time.Second), window); err != nil {
		t.Fatal(err)
	}
	if n, _ := mr.ZMembers(groupCallDirtyKey); len(n) != 0 {
		t.Fatalf("закрытая запись осталась: %v", n)
	}

	// Реплика упала, не закрыв: после конца аренды запись подбирает другая.
	_ = s.MarkSnapshotDirty(ctx, 9, t0.Add(window))
	first, _ := s.LeaseDirtySnapshots(ctx, t0.Add(window), t0.Add(window+lease), 10)
	if len(first) != 1 {
		t.Fatalf("аренда упавшей реплики: %v", first)
	}
	if mid, _ := s.LeaseDirtySnapshots(ctx, t0.Add(window+lease-time.Millisecond), t0.Add(2*lease), 10); len(mid) != 0 {
		t.Fatalf("запись подобрана до конца аренды: %v", mid)
	}
	if late, _ := s.LeaseDirtySnapshots(ctx, t0.Add(window+lease), t0.Add(2*lease), 10); len(late) != 1 || late[0] != 9 {
		t.Fatalf("запись упавшей реплики не подобрана: %v", late)
	}
}

// Предел партии: за тик берётся не больше limit записей.
func TestGroupCallStore_LeaseRespectsLimit(t *testing.T) {
	s, _ := newTestGroupCallStore(t)
	ctx := context.Background()
	t0 := time.UnixMilli(1_800_000_000_000)
	for id := int64(1); id <= 5; id++ {
		_ = s.MarkSnapshotDirty(ctx, id, t0)
	}
	got, _ := s.LeaseDirtySnapshots(ctx, t0, t0.Add(time.Minute), 3)
	if len(got) != 3 {
		t.Fatalf("партия = %d, want 3", len(got))
	}
	rest, _ := s.LeaseDirtySnapshots(ctx, t0, t0.Add(time.Minute), 10)
	if len(rest) != 2 {
		t.Fatalf("остаток = %d, want 2", len(rest))
	}
}

// JoinIfActive не открывает пустой звонок: ключ не создаётся, участник не пишется.
func TestJoinIfActive_EmptySet_NoAdd(t *testing.T) {
	s, mr := newTestGroupCallStore(t)
	ctx := context.Background()

	joined, err := s.JoinIfActive(ctx, 5, 1)
	if err != nil || joined {
		t.Fatalf("вход в пустой звонок: joined=%v err=%v, want false", joined, err)
	}
	if mr.Exists(groupCallKey(5)) {
		t.Fatal("отказанный вход создал ключ звонка")
	}
	if ids, _ := s.Participants(ctx, 5); len(ids) != 0 {
		t.Fatalf("участники после отказа = %v", ids)
	}
}

// В идущий звонок JoinIfActive входит, продлевает TTL и перехода 0→1 не даёт.
func TestJoinIfActive_ActiveSet_JoinsAndExtendsTTL(t *testing.T) {
	s, mr := newTestGroupCallStore(t)
	ctx := context.Background()
	if first, _ := s.Join(ctx, 5, 1); !first {
		t.Fatal("первый вход не помечен переходом")
	}
	mr.FastForward(time.Hour)

	joined, err := s.JoinIfActive(ctx, 5, 2)
	if err != nil || !joined {
		t.Fatalf("вход в идущий звонок: joined=%v err=%v", joined, err)
	}
	if ttl := mr.TTL(groupCallKey(5)); ttl != groupCallTTL {
		t.Fatalf("TTL после входа = %v, want %v (продление)", ttl, groupCallTTL)
	}
	if ids, _ := s.Participants(ctx, 5); len(ids) != 2 {
		t.Fatalf("участники = %v, want двое", ids)
	}
	// Повторный вход того же участника — не дубль.
	if joined, _ := s.JoinIfActive(ctx, 5, 2); !joined {
		t.Fatal("повторный вход отклонён")
	}
	if ids, _ := s.Participants(ctx, 5); len(ids) != 2 {
		t.Fatalf("участники после повтора = %v, want двое", ids)
	}
}

// Параллельно: последний выходит, не-админы входят через JoinIfActive. Сам
// скрипт атомарен, так что итог один из двух: вошли в непустой звонок (хозяин
// ещё внутри) либо отказ; множества «только не-админ» после выхода хозяина нет.
func TestJoinIfActive_RaceWithLastLeave(t *testing.T) {
	for round := 0; round < 200; round++ {
		s, _ := newTestGroupCallStore(t)
		ctx := context.Background()
		const owner = int64(1)
		_, _ = s.Join(ctx, 9, owner)

		var wg sync.WaitGroup
		results := make([]bool, 4)
		wg.Add(1 + len(results))
		start := make(chan struct{})
		var lastLeft bool
		go func() {
			defer wg.Done()
			<-start
			lastLeft, _ = s.Leave(ctx, 9, owner)
		}()
		for k := range results {
			go func(k int) {
				defer wg.Done()
				<-start
				results[k], _ = s.JoinIfActive(ctx, 9, int64(100+k))
			}(k)
		}
		close(start)
		wg.Wait()

		ids, _ := s.Participants(ctx, 9)
		anyJoined := false
		for _, j := range results {
			anyJoined = anyJoined || j
		}
		// Если хозяин вышел последним, никто из вошедших не мог войти позже него:
		// вошедшие после выхода получили бы отказ, а до него — остались в множестве
		// и сделали бы выход хозяина не «последним».
		if lastLeft && len(ids) != 0 {
			t.Fatalf("round %d: хозяин вышел последним, но в звонке %v", round, ids)
		}
		if !lastLeft && !anyJoined && len(ids) != 0 {
			t.Fatalf("round %d: никто не вошёл, а множество %v", round, ids)
		}
		for k, j := range results {
			in := false
			for _, id := range ids {
				in = in || id == int64(100+k)
			}
			if j != in {
				t.Fatalf("round %d: joined[%d]=%v, но в множестве %v", round, k, j, ids)
			}
		}
	}
}
