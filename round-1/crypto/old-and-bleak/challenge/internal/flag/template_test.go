//go:debug rsa1024min=0

package flag

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"regexp"
	"testing"
)

func TestGenerateFlagReusesPlaceholderValues(t *testing.T) {
	flag, err := Generate("HZU18{$1-$2-$1}")
	if err != nil {
		t.Fatalf("Generate returned error: %v", err)
	}

	matches := regexp.MustCompile(`^HZU18\{([A-Za-z0-9_-]{11})-([A-Za-z0-9_-]{11})-([A-Za-z0-9_-]{11})\}$`).FindStringSubmatch(flag)
	if matches == nil {
		t.Fatalf("generated flag did not match expected pattern: %s", flag)
	}
	if matches[1] != matches[3] {
		t.Fatalf("expected repeated placeholder values to match, got %q and %q", matches[1], matches[3])
	}
	if matches[1] == matches[2] {
		t.Fatalf("expected distinct placeholders to produce distinct values")
	}
}

func TestValidatorMatch(t *testing.T) {
	validator, err := NewValidator("HZU18{$1-$2-$1}")
	if err != nil {
		t.Fatalf("NewValidator returned error: %v", err)
	}

	if !validator.Match("HZU18{abcdefghijk-lmnopqrstuv-abcdefghijk}") {
		t.Fatal("expected validator to accept matching flag")
	}
	if validator.Match("HZU18{abcdefghijk-lmnopqrstuv-zzzzzzzzzzz}") {
		t.Fatal("expected validator to reject mismatched repeated placeholder")
	}
	if validator.Match("HZU18{abc xyz abc}") {
		t.Fatal("expected validator to reject invalid token characters")
	}
}

func TestValidateFitsModulus(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 512)
	if err != nil {
		t.Fatalf("failed to generate RSA key: %v", err)
	}

	if err := ValidateFitsModulus("HZU18{$1-$2}", &privateKey.PublicKey); err != nil {
		t.Fatalf("expected short flag template to fit, got %v", err)
	}

	longTemplate := "HZU18{" + string(bytes.Repeat([]byte("a"), 80)) + "}"
	if err := ValidateFitsModulus(longTemplate, &privateKey.PublicKey); err == nil {
		t.Fatal("expected long flag template to exceed modulus limit")
	}
}
