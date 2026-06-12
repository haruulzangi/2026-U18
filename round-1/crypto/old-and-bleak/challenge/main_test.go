package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/haruulzangi/2026-U18-private/round-1/crypto/old-and-bleak/challenge/internal/keys"
)

func TestStaticHandlerServesExistingFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "style.css"), []byte("body{color:red;}"), 0o644); err != nil {
		t.Fatalf("failed to write test asset: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<h1>index</h1>"), 0o644); err != nil {
		t.Fatalf("failed to write index file: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/style.css", nil)
	resp := httptest.NewRecorder()
	newStaticHandler(dir).ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
	if body := resp.Body.String(); body != "body{color:red;}" {
		t.Fatalf("unexpected body %q", body)
	}
}

func TestStaticHandlerFallsBackToIndex(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<h1>fallback</h1>"), 0o644); err != nil {
		t.Fatalf("failed to write index file: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/missing/route", nil)
	resp := httptest.NewRecorder()
	newStaticHandler(dir).ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
	body, err := io.ReadAll(resp.Result().Body)
	if err != nil {
		t.Fatalf("failed to read body: %v", err)
	}
	if string(body) != "<h1>fallback</h1>" {
		t.Fatalf("unexpected fallback body %q", string(body))
	}
}

func TestRSAKeyBitsOrDefault(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    int
		wantErr bool
	}{
		{name: "default", raw: "", want: keys.DefaultBits},
		{name: "trimmed", raw: " 768 ", want: 768},
		{name: "nonnumeric", raw: "abc", wantErr: true},
		{name: "zero", raw: "0", wantErr: true},
		{name: "negative", raw: "-512", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := rsaKeyBitsOrDefault(tc.raw)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("expected %d, got %d", tc.want, got)
			}
		})
	}
}
