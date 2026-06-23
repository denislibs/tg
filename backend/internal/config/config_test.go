package config

import "testing"

func TestLoad_Defaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("HTTP_ADDR", "")
	t.Setenv("DEV_OTP_CODE", "")

	c, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.HTTPAddr != ":8080" {
		t.Errorf("HTTPAddr default = %q, want :8080", c.HTTPAddr)
	}
	if c.DevOTPCode != "12345" {
		t.Errorf("DevOTPCode default = %q, want 12345", c.DevOTPCode)
	}
	if c.DatabaseURL != "postgres://localhost/db" {
		t.Errorf("DatabaseURL = %q", c.DatabaseURL)
	}
}

func TestLoad_MissingDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when DATABASE_URL is empty")
	}
}

func TestLoad_MinioDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	c, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.MinioEndpoint != "localhost:9000" || c.MinioBucket != "media" {
		t.Errorf("minio defaults wrong: %+v", c)
	}
	if c.MinioUseSSL {
		t.Error("MinioUseSSL should default to false")
	}
}
