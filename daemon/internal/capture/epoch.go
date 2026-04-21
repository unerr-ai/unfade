// Package capture provides event capture and writing capabilities.
// epoch.go implements file epoch markers for writer-reader synchronization.
// An epoch is a SHA-256 of the first 64 bytes of a data file — it changes
// if the file is rewritten from the beginning but stays stable for appends.

package capture

import (
	"crypto/sha256"
	"fmt"
	"os"
)

// WriteEpoch writes an epoch marker file (dataFilePath + ".epoch").
// The epoch is SHA-256(first 64 bytes) — changes only if file is rewritten.
func WriteEpoch(dataFilePath string) error {
	f, err := os.Open(dataFilePath)
	if err != nil {
		return err
	}
	defer f.Close()

	buf := make([]byte, 64)
	n, _ := f.Read(buf)
	if n == 0 {
		return nil // Empty file, no epoch needed
	}

	hash := sha256.Sum256(buf[:n])
	epochStr := fmt.Sprintf("%x", hash[:16])

	return os.WriteFile(dataFilePath+".epoch", []byte(epochStr+"\n"), 0644)
}

// ReadEpoch reads the epoch marker for a data file. Returns "" if no marker exists.
func ReadEpoch(dataFilePath string) string {
	data, err := os.ReadFile(dataFilePath + ".epoch")
	if err != nil {
		return ""
	}
	// Trim whitespace/newline
	s := string(data)
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r' || s[len(s)-1] == ' ') {
		s = s[:len(s)-1]
	}
	return s
}
