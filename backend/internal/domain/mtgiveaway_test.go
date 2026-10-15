package domain

import "testing"

// stars - ОБЩАЯ сумма розыгрыша (tweb chat/giveaway.tsx:199). В итогах -
// сколько роздано победителям, остальные места - unclaimed_count; личный приз
// (stars_prize) есть только у победителя и равен его доле.
func TestGiveawayInfo_StarsUnit(t *testing.T) {
	g := GiveawayInfo{
		PrizeKind: "stars", Stars: 100, WinnersCount: 3, Status: "active",
		PeerID: ToPeerID(1, true),
	}
	if m, ok := g.ToMedia(7).(*MessageMediaGiveaway); !ok || m.Stars != 100 || m.Quantity != 3 {
		t.Fatalf("идущий: %+v", g.ToMedia(7))
	}

	g.Status = "finished"
	g.WinnerIDs = []int64{5} // участник один из трёх мест
	res, ok := g.ToMedia(7).(*MessageMediaGiveawayResults)
	if !ok {
		t.Fatalf("итоги: %T", g.ToMedia(7))
	}
	if res.WinnersCount != 1 || res.UnclaimedCount != 2 || res.Stars != 33 {
		t.Fatalf("итоги: winners=%d unclaimed=%d stars=%d; want 1/2/33 (100/3 победителю)", res.WinnersCount, res.UnclaimedCount, res.Stars)
	}

	g.IWon = true
	st, ok := g.ToState().(*GiveawayStateResults)
	if !ok || st.StarsPrize != 33 || st.WinnersCount != 1 {
		t.Fatalf("победитель: %+v", g.ToState())
	}
	g.IWon = false
	if st, _ := g.ToState().(*GiveawayStateResults); st.StarsPrize != 0 {
		t.Fatalf("у проигравшего stars_prize = %d, want 0", st.StarsPrize)
	}
}

// Крайние случаи итогов: без победителей stars остаётся общей суммой (форма
// остаётся звёздной), unclaimed - все места; у premium stars нет.
func TestGiveawayInfo_ResultsEdges(t *testing.T) {
	g := GiveawayInfo{PrizeKind: "stars", Stars: 300, WinnersCount: 3, Status: "finished", PeerID: ToPeerID(1, true)}
	res := g.ToMedia(1).(*MessageMediaGiveawayResults)
	if res.WinnersCount != 0 || res.UnclaimedCount != 3 || res.Stars != 300 {
		t.Fatalf("без победителей: %+v", res)
	}
	if st := g.ToState().(*GiveawayStateResults); st.StarsPrize != 0 || st.WinnersCount != 0 {
		t.Fatalf("состояние без победителей: %+v", st)
	}

	p := GiveawayInfo{PrizeKind: "premium", Months: 3, WinnersCount: 2, Status: "finished", WinnerIDs: []int64{9}, PeerID: ToPeerID(1, true)}
	pr := p.ToMedia(1).(*MessageMediaGiveawayResults)
	if pr.Stars != 0 || pr.Months != 3 || pr.WinnersCount != 1 || pr.UnclaimedCount != 1 {
		t.Fatalf("premium: %+v", pr)
	}
}
