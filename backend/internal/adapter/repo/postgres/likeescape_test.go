package postgres

import "testing"

func TestEscapeLike(t *testing.T) {
	cases := map[string]string{
		"hello":      "hello",
		"50%":        `50\%`,
		"a_b":        `a\_b`,
		`back\slash`: `back\\slash`,
		"%_\\":       `\%\_\\`,
	}
	for in, want := range cases {
		if got := escapeLike(in); got != want {
			t.Errorf("escapeLike(%q) = %q, want %q", in, got, want)
		}
	}
}
