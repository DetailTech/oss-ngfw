package tlsutil

import (
	"crypto/tls"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadOrCreateGeneratesUsablePair(t *testing.T) {
	dir := t.TempDir()

	cert, key, selfSigned, err := LoadOrCreate(dir, "", "")
	if err != nil {
		t.Fatalf("LoadOrCreate: %v", err)
	}
	if !selfSigned {
		t.Fatal("expected selfSigned=true when no cert/key provided")
	}
	if cert != filepath.Join(dir, "tls", "cert.pem") || key != filepath.Join(dir, "tls", "key.pem") {
		t.Fatalf("unexpected paths: %s %s", cert, key)
	}

	// The generated pair must load as a TLS keypair.
	if _, err := tls.LoadX509KeyPair(cert, key); err != nil {
		t.Fatalf("generated pair does not load: %v", err)
	}

	// Key file must be 0600 (private material).
	info, err := os.Stat(key)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("key perms = %o, want 600", perm)
	}
}

func TestLoadOrCreateReusesExisting(t *testing.T) {
	dir := t.TempDir()

	cert1, _, _, err := LoadOrCreate(dir, "", "")
	if err != nil {
		t.Fatalf("first LoadOrCreate: %v", err)
	}
	before, err := os.ReadFile(cert1)
	if err != nil {
		t.Fatal(err)
	}

	cert2, _, _, err := LoadOrCreate(dir, "", "")
	if err != nil {
		t.Fatalf("second LoadOrCreate: %v", err)
	}
	after, err := os.ReadFile(cert2)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("expected the certificate to be reused, but it changed")
	}
}

func TestLoadOrCreateUsesProvidedFiles(t *testing.T) {
	cert, key, selfSigned, err := LoadOrCreate(t.TempDir(), "/etc/my/cert.pem", "/etc/my/key.pem")
	if err != nil {
		t.Fatalf("LoadOrCreate: %v", err)
	}
	if selfSigned {
		t.Fatal("expected selfSigned=false when operator supplies cert/key")
	}
	if cert != "/etc/my/cert.pem" || key != "/etc/my/key.pem" {
		t.Fatalf("provided paths not honored: %s %s", cert, key)
	}
}
