//go:debug rsa1024min=0

package keys

import (
	"os"
	"path/filepath"
	"testing"
)

func TestManagerRegeneratesInvalidKey(t *testing.T) {
	dir := t.TempDir()
	keyPath := filepath.Join(dir, KeyFileName)
	if err := os.WriteFile(keyPath, []byte("not a key"), 0o600); err != nil {
		t.Fatalf("failed to seed invalid key: %v", err)
	}

	manager := &Manager{Dir: dir}
	key, err := manager.Get()
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if key.N.BitLen() != DefaultBits {
		t.Fatalf("expected %d-bit RSA key, got %d", DefaultBits, key.N.BitLen())
	}
}

func TestManagerRegeneratesMismatchedKeySize(t *testing.T) {
	dir := t.TempDir()
	keyPath := filepath.Join(dir, KeyFileName)

	originalKey, err := generateAndStorePrivateKey(keyPath, DefaultBits)
	if err != nil {
		t.Fatalf("failed to seed key: %v", err)
	}

	manager := &Manager{Dir: dir, Bits: 768}
	key, err := manager.Get()
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}

	if key.N.BitLen() != 768 {
		t.Fatalf("expected 768-bit RSA key, got %d", key.N.BitLen())
	}
	if key.N.Cmp(originalKey.N) == 0 {
		t.Fatal("expected manager to regenerate key when size mismatched")
	}
}
