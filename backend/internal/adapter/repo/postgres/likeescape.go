package postgres

import "strings"

// escapeLike экранирует метасимволы LIKE/ILIKE (\ % _) в пользовательском вводе,
// чтобы «%»/«_» из поискового запроса не работали как wildcard'ы (неэффективные
// сканы / лёгкий DoS на больших таблицах). Postgres по умолчанию ESCAPE '\'.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

func escapeLike(s string) string { return likeEscaper.Replace(s) }
