package parsers

import (
	"bufio"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var userPromptRe = regexp.MustCompile(`^####\s+(.+)$`)

// AiderParser reads .aider.chat.history.md markdown files from registered
// project directories. Extracts user prompts (#### headers) and assistant
// responses (subsequent text blocks).
type AiderParser struct {
	projectPaths []string
}

func NewAiderParser(projectPaths []string) *AiderParser {
	return &AiderParser{projectPaths: projectPaths}
}

func (p *AiderParser) Name() string { return "aider" }

func (p *AiderParser) Discover() []DataSource {
	var sources []DataSource
	for _, dir := range p.projectPaths {
		histPath := filepath.Join(dir, ".aider.chat.history.md")
		if _, err := os.Stat(histPath); err == nil {
			sources = append(sources, DataSource{
				Tool:    "aider",
				Path:    histPath,
				Format:  "markdown",
				Project: dir,
			})
		}
	}
	return sources
}

func (p *AiderParser) Parse(source DataSource, since time.Time) ([]ConversationTurn, error) {
	f, err := os.Open(source.Path)
	if err != nil {
		if os.IsNotExist(err) || os.IsPermission(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("open %s: %w", source.Path, err)
	}
	defer f.Close()

	return parseAiderHistory(f, source.Project, since)
}

func (p *AiderParser) Tail(source DataSource, offset int64) ([]ConversationTurn, int64, error) {
	f, err := os.Open(source.Path)
	if err != nil {
		if os.IsNotExist(err) || os.IsPermission(err) {
			return nil, offset, nil
		}
		return nil, offset, fmt.Errorf("open %s: %w", source.Path, err)
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil, offset, err
	}
	if info.Size() <= offset {
		return nil, offset, nil
	}

	if offset > 0 {
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			return nil, offset, err
		}
	}

	turns, err := parseAiderHistory(f, source.Project, time.Time{})
	if err != nil {
		return nil, offset, err
	}

	newOffset, err := f.Seek(0, io.SeekCurrent)
	if err != nil {
		newOffset = info.Size()
	}

	return turns, newOffset, nil
}

// parseAiderHistory splits the markdown into user/assistant turns based on
// #### headers. Each #### line starts a user turn; text until the next ####
// or end-of-file is the assistant response.
func parseAiderHistory(r io.Reader, project string, since time.Time) ([]ConversationTurn, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	sessionID := stableSessionID(project, "aider")

	type segment struct {
		role    string
		content string
	}
	var segments []segment
	var currentContent strings.Builder
	currentRole := ""

	for scanner.Scan() {
		line := scanner.Text()

		if match := userPromptRe.FindStringSubmatch(line); match != nil {
			// Flush the previous segment.
			if currentRole != "" {
				segments = append(segments, segment{role: currentRole, content: strings.TrimSpace(currentContent.String())})
			}
			currentRole = "user"
			currentContent.Reset()
			currentContent.WriteString(match[1])
			continue
		}

		if currentRole == "user" && !strings.HasPrefix(line, "####") && currentContent.Len() > 0 {
			// First non-header line after a user prompt starts the assistant response.
			if strings.TrimSpace(line) != "" {
				segments = append(segments, segment{role: "user", content: strings.TrimSpace(currentContent.String())})
				currentRole = "assistant"
				currentContent.Reset()
				currentContent.WriteString(line)
				continue
			}
		}

		if currentRole != "" {
			currentContent.WriteString("\n")
			currentContent.WriteString(line)
		}
	}

	// Flush the last segment.
	if currentRole != "" && currentContent.Len() > 0 {
		segments = append(segments, segment{role: currentRole, content: strings.TrimSpace(currentContent.String())})
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	// Build ConversationTurns from segments. Group consecutive user+assistant
	// pairs into conversations.
	var turns []ConversationTurn
	convIdx := 0
	turnIdx := 0

	for _, seg := range segments {
		if seg.content == "" {
			continue
		}

		if seg.role == "user" {
			convIdx++
			turnIdx = 0
		}

		convID := fmt.Sprintf("%s-conv-%d", sessionID, convIdx)
		turns = append(turns, ConversationTurn{
			SessionID:      sessionID,
			ConversationID: convID,
			TurnIndex:      turnIdx,
			Role:           seg.role,
			Content:        seg.content,
			Timestamp:      since, // Aider history doesn't have per-turn timestamps.
			ProjectPath:    project,
		})
		turnIdx++
	}

	// Back-fill TotalTurns per conversation.
	convCounts := make(map[string]int)
	for _, t := range turns {
		convCounts[t.ConversationID]++
	}
	for i := range turns {
		turns[i].TotalTurns = convCounts[turns[i].ConversationID]
	}

	return turns, nil
}

func stableSessionID(project, tool string) string {
	h := sha256.Sum256([]byte(project + ":" + tool))
	return fmt.Sprintf("%s-%x", tool, h[:8])
}
