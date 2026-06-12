package server

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"

	flagutil "github.com/haruulzangi/2026-U18-private/round-1/crypto/old-and-bleak/challenge/internal/flag"
	"github.com/haruulzangi/2026-U18-private/round-1/crypto/old-and-bleak/challenge/internal/keys"
)

type App struct {
	Template  string
	Validator *flagutil.Validator
	Keys      *keys.Manager
}

type ciphertextResponse struct {
	Ciphertext string `json:"ciphertext"`
}

type ciphertextRequest struct {
	Ciphertext string `json:"ciphertext"`
}

type publicKeyResponse struct {
	PublicKey string `json:"public_key"`
}

func (a *App) Register(mux *http.ServeMux) {
	mux.HandleFunc("/public-key", a.HandlePublicKey)
	mux.HandleFunc("/get-flag", a.HandleGetFlag)
	mux.HandleFunc("/check-flag", a.HandleCheckFlag)
}

func (a *App) HandlePublicKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	publicKey, err := a.Keys.PublicPEM()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to load public key")
		return
	}

	writeJSON(w, http.StatusOK, publicKeyResponse{
		PublicKey: publicKey,
	})
}

func (a *App) HandleGetFlag(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	privateKey, err := a.Keys.Get()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to load key")
		return
	}

	flag, err := flagutil.Generate(a.Template)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to generate flag")
		return
	}
	logf("generated flag=%q", flag)

	ciphertext, err := rsa.EncryptPKCS1v15(rand.Reader, &privateKey.PublicKey, []byte(flag))
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to encrypt flag")
		return
	}

	writeJSON(w, http.StatusOK, ciphertextResponse{
		Ciphertext: base64.RawStdEncoding.EncodeToString(ciphertext),
	})
}

func (a *App) HandleCheckFlag(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	defer r.Body.Close()
	body := http.MaxBytesReader(w, r.Body, 1<<20)

	var req ciphertextRequest
	if err := json.NewDecoder(body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Ciphertext) == "" {
		writeJSONError(w, http.StatusBadRequest, "ciphertext is required")
		return
	}

	ciphertext, err := base64.RawStdEncoding.DecodeString(req.Ciphertext)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid ciphertext encoding")
		return
	}

	privateKey, err := a.Keys.Get()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to load key")
		return
	}

	plaintext, err := rsa.DecryptPKCS1v15(rand.Reader, privateKey, ciphertext)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "ciphertext did not decrypt correctly")
		return
	}

	if !a.Validator.Match(string(plaintext)) {
		writeJSONError(w, http.StatusBadRequest, "flag did not match template")
		return
	}

	w.WriteHeader(http.StatusOK)
}
