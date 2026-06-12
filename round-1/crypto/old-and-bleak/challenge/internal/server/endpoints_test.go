//go:debug rsa1024min=0

package server

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"testing"

	flagutil "github.com/haruulzangi/2026-U18-private/round-1/crypto/old-and-bleak/challenge/internal/flag"
	"github.com/haruulzangi/2026-U18-private/round-1/crypto/old-and-bleak/challenge/internal/keys"
)

func TestEndpointsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	validator, err := flagutil.NewValidator("HZU18{$1-$2}")
	if err != nil {
		t.Fatalf("NewValidator returned error: %v", err)
	}

	application := &App{
		Template:  "HZU18{$1-$2}",
		Validator: validator,
		Keys:      &keys.Manager{Dir: dir},
	}

	getReq := httptest.NewRequest(http.MethodGet, "/get-flag", nil)
	getResp := httptest.NewRecorder()
	application.HandleGetFlag(getResp, getReq)

	if getResp.Code != http.StatusOK {
		t.Fatalf("expected /get-flag to return 200, got %d", getResp.Code)
	}

	var getBody struct {
		Ciphertext string `json:"ciphertext"`
	}
	if err := json.Unmarshal(getResp.Body.Bytes(), &getBody); err != nil {
		t.Fatalf("failed to decode /get-flag response: %v", err)
	}

	postPayload, err := json.Marshal(map[string]string{"ciphertext": getBody.Ciphertext})
	if err != nil {
		t.Fatalf("failed to encode request body: %v", err)
	}

	checkReq := httptest.NewRequest(http.MethodPost, "/check-flag", bytes.NewReader(postPayload))
	checkResp := httptest.NewRecorder()
	application.HandleCheckFlag(checkResp, checkReq)

	if checkResp.Code != http.StatusOK {
		t.Fatalf("expected /check-flag to return 200, got %d body=%s", checkResp.Code, checkResp.Body.String())
	}
}

func TestPublicKeyEndpoint(t *testing.T) {
	dir := t.TempDir()
	validator, err := flagutil.NewValidator("HZU18{$1}")
	if err != nil {
		t.Fatalf("NewValidator returned error: %v", err)
	}

	application := &App{
		Template:  "HZU18{$1}",
		Validator: validator,
		Keys:      &keys.Manager{Dir: dir},
	}

	req := httptest.NewRequest(http.MethodGet, "/public-key", nil)
	resp := httptest.NewRecorder()
	application.HandlePublicKey(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected /public-key to return 200, got %d", resp.Code)
	}

	var body struct {
		PublicKey string `json:"public_key"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode /public-key response: %v", err)
	}

	block, _ := pem.Decode([]byte(body.PublicKey))
	if block == nil {
		t.Fatal("expected PEM-encoded public key")
	}
	publicKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		t.Fatalf("failed to parse public key: %v", err)
	}
	rsaPublicKey, ok := publicKey.(*rsa.PublicKey)
	if !ok {
		t.Fatalf("expected RSA public key, got %T", publicKey)
	}
	if rsaPublicKey.N.BitLen() != keys.DefaultBits {
		t.Fatalf("expected %d-bit RSA public key, got %d", keys.DefaultBits, rsaPublicKey.N.BitLen())
	}
}

func TestCheckFlagRejectsTamperedCiphertext(t *testing.T) {
	dir := t.TempDir()
	privateKey, err := rsa.GenerateKey(rand.Reader, 512)
	if err != nil {
		t.Fatalf("failed to generate RSA key: %v", err)
	}

	validator, err := flagutil.NewValidator("HZU18{$1}")
	if err != nil {
		t.Fatalf("NewValidator returned error: %v", err)
	}

	application := &App{
		Template:  "HZU18{$1}",
		Validator: validator,
		Keys: &keys.Manager{
			Dir:        dir,
			PrivateKey: privateKey,
		},
	}

	ciphertext, err := rsa.EncryptPKCS1v15(rand.Reader, &privateKey.PublicKey, []byte("not-a-flag"))
	if err != nil {
		t.Fatalf("failed to encrypt plaintext: %v", err)
	}

	payload, err := json.Marshal(map[string]string{"ciphertext": base64.RawStdEncoding.EncodeToString(ciphertext)})
	if err != nil {
		t.Fatalf("failed to marshal payload: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/check-flag", bytes.NewReader(payload))
	resp := httptest.NewRecorder()
	application.HandleCheckFlag(resp, req)

	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.Code)
	}
}
