package flag

import (
	"crypto/rsa"
	"encoding/base64"
	"fmt"
	"log"
	"regexp"
)

func init() {
	sample := base64.RawURLEncoding.EncodeToString(make([]byte, TokenByteLength))
	if len(sample) != TokenEncodedLength {
		panic(fmt.Sprintf(
			"flag token length invariant broken: got %d want %d",
			len(sample),
			TokenEncodedLength,
		))
	}

	tokenRegex := regexp.MustCompile("^" + TokenPattern + "$")
	if !tokenRegex.MatchString(sample) {
		panic("flag token pattern does not match generated token encoding")
	}
}

func ValidateFitsModulus(template string, publicKey *rsa.PublicKey) error {
	flagLength := GeneratedLength(template)
	maxPlaintextLength := publicKey.Size() - 11
	if flagLength > maxPlaintextLength {
		return fmt.Errorf(
			"generated flag length %d exceeds RSA PKCS#1 v1.5 limit %d for %d-bit modulus",
			flagLength,
			maxPlaintextLength,
			publicKey.N.BitLen(),
		)
	}

	log.Printf(
		"validated flag length=%d max_pkcs1v15_plaintext=%d modulus_bits=%d",
		flagLength,
		maxPlaintextLength,
		publicKey.N.BitLen(),
	)
	return nil
}
