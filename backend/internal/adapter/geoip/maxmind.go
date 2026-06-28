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
	if r == nil || r.db == nil {
		return ""
	}
	addr := net.ParseIP(ip)
	if addr == nil || addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() {
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

func name(names map[string]string) string {
	if v := strings.TrimSpace(names["ru"]); v != "" {
		return v
	}
	return strings.TrimSpace(names["en"])
}
