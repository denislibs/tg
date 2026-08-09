// Package geoip resolves an IP address to a human-readable place using a MaxMind
// GeoLite2-City database. It satisfies auth.GeoResolver.
package geoip

import (
	"net"
	"strings"

	"github.com/oschwald/geoip2-golang"
)

// Resolver wraps an opened MaxMind .mmdb reader.
type Resolver struct{ db *geoip2.Reader }

// Open loads the GeoLite2-City database at path. The caller owns Close().
func Open(path string) (*Resolver, error) {
	db, err := geoip2.Open(path)
	if err != nil {
		return nil, err
	}
	return &Resolver{db: db}, nil
}

func (r *Resolver) Close() error {
	if r == nil || r.db == nil {
		return nil
	}
	return r.db.Close()
}

// Locate returns "City, Country" (or just one, or "") for an IP. Private,
// loopback and unparseable addresses — and lookups with no data — return "".
// City/country names prefer Russian, falling back to English.
func (r *Resolver) Locate(ip string) string {
	addr := r.publicIP(ip)
	if addr == nil {
		return ""
	}
	rec, err := r.db.City(addr)
	if err != nil {
		return ""
	}
	city := name(rec.City.Names)
	country := name(rec.Country.Names)
	switch {
	case city != "" && country != "":
		return city + ", " + country
	case country != "":
		return country
	default:
		return city
	}
}

// Country returns the ISO 3166-1 alpha-2 code (uppercase) for an IP, or "" when
// it cannot be determined — the country picker on the login screen preselects
// it (Telegram help.getNearestDc.country). Deliberately a Country lookup, not a
// City one: the record is smaller to decode and the endpoint is hit on every
// login-screen open. A GeoLite2-City database serves both.
func (r *Resolver) Country(ip string) string {
	addr := r.publicIP(ip)
	if addr == nil {
		return ""
	}
	rec, err := r.db.Country(addr)
	if err != nil {
		return ""
	}
	if iso := strings.ToUpper(strings.TrimSpace(rec.Country.IsoCode)); iso != "" {
		return iso
	}
	// Гео-запись без страны, но с «страной регистрации» (частый случай у
	// мобильных/спутниковых диапазонов) — она ближе к истине, чем пустой ответ.
	return strings.ToUpper(strings.TrimSpace(rec.RegisteredCountry.IsoCode))
}

// publicIP парсит адрес и отсеивает всё, по чему поиск заведомо бессмысленен
// (закрытый резолвер, мусор, петля, приватная/link-local сеть). nil ⇒ вызывающий
// мягко деградирует в пустой ответ.
func (r *Resolver) publicIP(ip string) net.IP {
	if r == nil || r.db == nil {
		return nil
	}
	addr := net.ParseIP(ip)
	if addr == nil || addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() {
		return nil
	}
	return addr
}

func name(names map[string]string) string {
	if v := strings.TrimSpace(names["ru"]); v != "" {
		return v
	}
	return strings.TrimSpace(names["en"])
}
