package domain

import "testing"

func TestBoostThreshold(t *testing.T) {
	cases := map[int]int{0: 0, 1: 1, 2: 3, 3: 6, 4: 10, 5: 15}
	for level, want := range cases {
		if got := BoostThreshold(level); got != want {
			t.Errorf("BoostThreshold(%d) = %d, want %d", level, got, want)
		}
	}
	if BoostThreshold(-3) != 0 {
		t.Errorf("negative level must be 0")
	}
}

func TestBoostLevelFor(t *testing.T) {
	cases := []struct {
		boosts            int
		level, curr, next int
	}{
		{0, 0, 0, 1},
		{1, 1, 1, 3},
		{2, 1, 1, 3},
		{3, 2, 3, 6},
		{5, 2, 3, 6},
		{6, 3, 6, 10},
		{10, 4, 10, 15},
	}
	for _, c := range cases {
		level, curr, next := BoostLevelFor(c.boosts)
		if level != c.level || curr != c.curr || next != c.next {
			t.Errorf("BoostLevelFor(%d) = (%d,%d,%d), want (%d,%d,%d)",
				c.boosts, level, curr, next, c.level, c.curr, c.next)
		}
	}
}
