package flag

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const (
	placeholderPattern = `\$\d+`
	TokenByteLength    = 8
	TokenEncodedLength = 11
	TokenPattern       = `[A-Za-z0-9_-]{11}`
)

var placeholderRegex = regexp.MustCompile(placeholderPattern)

type Validator struct {
	regex            *regexp.Regexp
	placeholderOrder []string
}

func Generate(template string) (string, error) {
	if template == "" {
		return "", errors.New("template is empty")
	}

	var generateErr error
	seen := make(map[string]string)
	flag := placeholderRegex.ReplaceAllStringFunc(template, func(placeholder string) string {
		if value, ok := seen[placeholder]; ok {
			return value
		}

		var token [TokenByteLength]byte
		if _, err := rand.Read(token[:]); err != nil {
			generateErr = err
			return ""
		}

		value := base64.RawURLEncoding.EncodeToString(token[:])
		seen[placeholder] = value
		return value
	})

	if generateErr != nil {
		return "", generateErr
	}
	return flag, nil
}

func GeneratedLength(template string) int {
	length := len(template)
	for _, match := range placeholderRegex.FindAllStringIndex(template, -1) {
		length += TokenEncodedLength - (match[1] - match[0])
	}
	return length
}

func NewValidator(template string) (*Validator, error) {
	if template == "" {
		return nil, errors.New("template is empty")
	}

	matches := placeholderRegex.FindAllStringIndex(template, -1)
	var builder strings.Builder
	builder.WriteString("^")

	order := make([]string, 0, len(matches))
	last := 0
	for _, match := range matches {
		builder.WriteString(regexp.QuoteMeta(template[last:match[0]]))
		builder.WriteString("(" + TokenPattern + ")")
		order = append(order, template[match[0]:match[1]])
		last = match[1]
	}
	builder.WriteString(regexp.QuoteMeta(template[last:]))
	builder.WriteString("$")

	compiled, err := regexp.Compile(builder.String())
	if err != nil {
		return nil, fmt.Errorf("compile validator: %w", err)
	}

	return &Validator{
		regex:            compiled,
		placeholderOrder: order,
	}, nil
}

func (v *Validator) Match(flag string) bool {
	matches := v.regex.FindStringSubmatch(flag)
	if matches == nil {
		return false
	}

	seen := make(map[string]string, len(v.placeholderOrder))
	for idx, placeholder := range v.placeholderOrder {
		capture := matches[idx+1]
		if previous, ok := seen[placeholder]; ok && previous != capture {
			return false
		}
		seen[placeholder] = capture
	}
	return true
}
