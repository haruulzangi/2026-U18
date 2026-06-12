//go:debug rsa1024min=0

package main

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	flagutil "github.com/haruulzangi/2026-U18-private/round-1/crypto/old-and-bleak/challenge/internal/flag"
	"github.com/haruulzangi/2026-U18-private/round-1/crypto/old-and-bleak/challenge/internal/keys"
	"github.com/haruulzangi/2026-U18-private/round-1/crypto/old-and-bleak/challenge/internal/server"
)

const (
	defaultPort = "3000"
)

func main() {
	flagTemplate := strings.TrimSpace(os.Getenv("FLAG_TEMPLATE"))
	if flagTemplate == "" {
		log.Fatal("FLAG_TEMPLATE environment variable must be set")
	}

	keyPath := strings.TrimSpace(os.Getenv("KEY_PATH"))
	if keyPath == "" {
		log.Fatal("KEY_PATH environment variable must be set")
	}

	keyBits, err := rsaKeyBitsOrDefault(os.Getenv("RSA_KEY_BITS"))
	if err != nil {
		log.Fatalf("invalid RSA_KEY_BITS: %v", err)
	}

	validator, err := flagutil.NewValidator(flagTemplate)
	if err != nil {
		log.Fatalf("invalid FLAG_TEMPLATE: %v", err)
	}

	keys := &keys.Manager{
		Dir:  keyPath,
		Bits: keyBits,
	}
	privateKey, err := keys.Get()
	if err != nil {
		log.Fatalf("failed to initialize RSA key: %v", err)
	}
	if err := flagutil.ValidateFitsModulus(flagTemplate, &privateKey.PublicKey); err != nil {
		log.Fatal(err)
	}

	application := &server.App{
		Template:  flagTemplate,
		Validator: validator,
		Keys:      keys,
	}

	mux := http.NewServeMux()
	application.Register(mux)
	mux.Handle("/", newStaticHandler("static"))

	server := &http.Server{
		Addr:    ":" + portOrDefault(os.Getenv("PORT")),
		Handler: mux,
	}

	log.Printf("listening on http://0.0.0.0%s", server.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func newStaticHandler(root string) http.Handler {
	fileServer := http.FileServer(http.Dir(root))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Clean(r.URL.Path)
		if path == "." || path == "/" {
			fileServer.ServeHTTP(w, r)
			return
		}

		candidate := filepath.Join(root, strings.TrimPrefix(path, "/"))
		if info, err := os.Stat(candidate); err == nil {
			if info.IsDir() {
				indexPath := filepath.Join(candidate, "index.html")
				if _, err := os.Stat(indexPath); err == nil {
					fileServer.ServeHTTP(w, r)
					return
				}
			} else {
				fileServer.ServeHTTP(w, r)
				return
			}
		}

		indexPath := filepath.Join(root, "index.html")
		if _, err := os.Stat(indexPath); err != nil {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, indexPath)
	})
}

func portOrDefault(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return defaultPort
	}
	for _, ch := range value {
		if ch < '0' || ch > '9' {
			return defaultPort
		}
	}
	return value
}

func rsaKeyBitsOrDefault(raw string) (int, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return keys.DefaultBits, nil
	}

	bits, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("must be a positive integer: %w", err)
	}
	if bits <= 0 {
		return 0, fmt.Errorf("must be a positive integer")
	}
	return bits, nil
}
