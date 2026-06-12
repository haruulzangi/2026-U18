package keys

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
)

const KeyFileName = "rsa_private.pem"
const DefaultBits = 512

type Manager struct {
	Dir        string
	Bits       int
	PrivateKey *rsa.PrivateKey
	mu         sync.Mutex
}

func (k *Manager) Get() (*rsa.PrivateKey, error) {
	k.mu.Lock()
	defer k.mu.Unlock()

	if k.PrivateKey != nil {
		return k.PrivateKey, nil
	}

	if err := os.MkdirAll(k.Dir, 0o700); err != nil {
		return nil, fmt.Errorf("create key directory: %w", err)
	}

	keyPath := filepath.Join(k.Dir, KeyFileName)
	privateKey, err := loadPrivateKey(keyPath, k.bits())
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Printf("regenerating RSA key after load failure: %v", err)
		}
		privateKey, err = generateAndStorePrivateKey(keyPath, k.bits())
		if err != nil {
			return nil, err
		}
	}

	k.PrivateKey = privateKey
	return k.PrivateKey, nil
}

func (k *Manager) PublicPEM() (string, error) {
	privateKey, err := k.Get()
	if err != nil {
		return "", err
	}

	publicDER, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		return "", fmt.Errorf("marshal public key: %w", err)
	}

	return string(pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: publicDER,
	})), nil
}

func (k *Manager) PublicBase64DER() (string, error) {
	privateKey, err := k.Get()
	if err != nil {
		return "", err
	}

	publicDER, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		return "", fmt.Errorf("marshal public key: %w", err)
	}

	return base64.RawStdEncoding.EncodeToString(publicDER), nil
}

func (k *Manager) bits() int {
	if k.Bits <= 0 {
		return DefaultBits
	}
	return k.Bits
}

func loadPrivateKey(path string, expectedBits int) (*rsa.PrivateKey, error) {
	pemBytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("invalid PEM file")
	}

	if block.Type != "RSA PRIVATE KEY" {
		return nil, fmt.Errorf("unexpected PEM type %q", block.Type)
	}

	privateKey, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}

	if privateKey.N.BitLen() != expectedBits {
		return nil, fmt.Errorf("unexpected RSA key size %d", privateKey.N.BitLen())
	}

	return privateKey, nil
}

func generateAndStorePrivateKey(path string, bits int) (*rsa.PrivateKey, error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, bits)
	if err != nil {
		return nil, fmt.Errorf("generate private key: %w", err)
	}

	pemBlock := &pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	}

	if err := os.WriteFile(path, pem.EncodeToMemory(pemBlock), 0o600); err != nil {
		return nil, fmt.Errorf("write private key: %w", err)
	}

	return privateKey, nil
}
