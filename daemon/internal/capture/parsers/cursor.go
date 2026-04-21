package parsers

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// CursorParser reads Cursor's ai-code-tracking.db SQLite database in read-only
// mode, extracting conversation summaries and scored commit data.
type CursorParser struct {
	homeDir string
}

func NewCursorParser(homeDir string) *CursorParser {
	return &CursorParser{homeDir: homeDir}
}

func (p *CursorParser) Name() string { return "cursor" }

func (p *CursorParser) Discover() []DataSource {
	dbPath := filepath.Join(p.homeDir, ".cursor", "ai-tracking", "ai-code-tracking.db")
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		return nil
	}
	return []DataSource{{
		Tool:   "cursor",
		Path:   dbPath,
		Format: "sqlite",
	}}
}

func (p *CursorParser) Parse(source DataSource, since time.Time) ([]ConversationTurn, error) {
	db, err := openCursorDB(source.Path)
	if err != nil {
		return nil, nil
	}
	defer db.Close()

	sinceStr := since.Format(time.RFC3339)

	convTurns, err := queryConversationSummaries(db, sinceStr)
	if err != nil {
		return nil, fmt.Errorf("query conversations: %w", err)
	}

	commitTurns, err := queryScoredCommits(db, sinceStr)
	if err != nil {
		return nil, fmt.Errorf("query commits: %w", err)
	}

	return append(convTurns, commitTurns...), nil
}

// Tail uses rowid as a high-water mark to fetch only new rows since
// the last call. The returned int64 is the new max rowid seen.
func (p *CursorParser) Tail(source DataSource, offset int64) ([]ConversationTurn, int64, error) {
	db, err := openCursorDB(source.Path)
	if err != nil {
		return nil, offset, nil
	}
	defer db.Close()

	var turns []ConversationTurn
	newOffset := offset

	convTurns, maxConvRowid, err := tailConversations(db, offset)
	if err == nil {
		turns = append(turns, convTurns...)
		if maxConvRowid > newOffset {
			newOffset = maxConvRowid
		}
	}

	commitTurns, maxCommitRowid, err := tailCommits(db, offset)
	if err == nil {
		turns = append(turns, commitTurns...)
		if maxCommitRowid > newOffset {
			newOffset = maxCommitRowid
		}
	}

	return turns, newOffset, nil
}

func openCursorDB(path string) (*sql.DB, error) {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil, err
	}

	dsn := fmt.Sprintf("file:%s?mode=ro&_journal_mode=WAL", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(1)
	db.SetConnMaxLifetime(30 * time.Second)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func queryConversationSummaries(db *sql.DB, sinceStr string) ([]ConversationTurn, error) {
	if !tableExists(db, "conversation_summaries") {
		return nil, nil
	}

	rows, err := db.Query(`
		SELECT conversationId, title, tldr, overview, summaryBullets,
		       model, mode, updatedAt
		FROM conversation_summaries
		WHERE updatedAt >= ?
		ORDER BY updatedAt ASC`,
		sinceStr,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanConversationRows(rows)
}

func queryScoredCommits(db *sql.DB, sinceStr string) ([]ConversationTurn, error) {
	if !tableExists(db, "scored_commits") {
		return nil, nil
	}

	rows, err := db.Query(`
		SELECT commitHash, branchName, commitMessage, commitDate,
		       linesAdded, linesDeleted,
		       tabLinesAdded, tabLinesDeleted,
		       composerLinesAdded, composerLinesDeleted,
		       humanLinesAdded, humanLinesDeleted,
		       v1AiPercentage, v2AiPercentage
		FROM scored_commits
		WHERE commitDate >= ?
		ORDER BY commitDate ASC`,
		sinceStr,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanCommitRows(rows)
}

func tailConversations(db *sql.DB, afterRowid int64) ([]ConversationTurn, int64, error) {
	if !tableExists(db, "conversation_summaries") {
		return nil, afterRowid, nil
	}

	rows, err := db.Query(`
		SELECT rowid, conversationId, title, tldr, overview, summaryBullets,
		       model, mode, updatedAt
		FROM conversation_summaries
		WHERE rowid > ?
		ORDER BY rowid ASC`,
		afterRowid,
	)
	if err != nil {
		return nil, afterRowid, err
	}
	defer rows.Close()

	var turns []ConversationTurn
	var maxRowid int64

	for rows.Next() {
		var (
			rowid                                                     int64
			convID, title, tldr, overview, bullets, model, mode, date string
		)
		if err := rows.Scan(&rowid, &convID, &title, &tldr, &overview, &bullets, &model, &mode, &date); err != nil {
			continue
		}
		if rowid > maxRowid {
			maxRowid = rowid
		}

		turns = append(turns, conversationSummaryToTurn(convID, title, tldr, overview, bullets, model, mode, date))
	}

	if maxRowid == 0 {
		maxRowid = afterRowid
	}
	return turns, maxRowid, rows.Err()
}

func tailCommits(db *sql.DB, afterRowid int64) ([]ConversationTurn, int64, error) {
	if !tableExists(db, "scored_commits") {
		return nil, afterRowid, nil
	}

	rows, err := db.Query(`
		SELECT rowid, commitHash, branchName, commitMessage, commitDate,
		       linesAdded, linesDeleted,
		       tabLinesAdded, tabLinesDeleted,
		       composerLinesAdded, composerLinesDeleted,
		       humanLinesAdded, humanLinesDeleted,
		       v1AiPercentage, v2AiPercentage
		FROM scored_commits
		WHERE rowid > ?
		ORDER BY rowid ASC`,
		afterRowid,
	)
	if err != nil {
		return nil, afterRowid, err
	}
	defer rows.Close()

	var turns []ConversationTurn
	var maxRowid int64

	for rows.Next() {
		var (
			rowid                                                int64
			hash, branch, message, date                          string
			linesAdded, linesDeleted                             int
			tabAdded, tabDeleted, composerAdded, composerDeleted int
			humanAdded, humanDeleted                             int
			v1Pct, v2Pct                                         float64
		)
		if err := rows.Scan(&rowid, &hash, &branch, &message, &date,
			&linesAdded, &linesDeleted,
			&tabAdded, &tabDeleted, &composerAdded, &composerDeleted,
			&humanAdded, &humanDeleted,
			&v1Pct, &v2Pct); err != nil {
			continue
		}
		if rowid > maxRowid {
			maxRowid = rowid
		}

		turns = append(turns, scoredCommitToTurn(hash, branch, message, date,
			linesAdded, linesDeleted, tabAdded, tabDeleted,
			composerAdded, composerDeleted, humanAdded, humanDeleted,
			v1Pct, v2Pct))
	}

	if maxRowid == 0 {
		maxRowid = afterRowid
	}
	return turns, maxRowid, rows.Err()
}

func scanConversationRows(rows *sql.Rows) ([]ConversationTurn, error) {
	var turns []ConversationTurn
	for rows.Next() {
		var convID, title, tldr, overview, bullets, model, mode, date string
		if err := rows.Scan(&convID, &title, &tldr, &overview, &bullets, &model, &mode, &date); err != nil {
			continue
		}
		turns = append(turns, conversationSummaryToTurn(convID, title, tldr, overview, bullets, model, mode, date))
	}
	return turns, rows.Err()
}

func scanCommitRows(rows *sql.Rows) ([]ConversationTurn, error) {
	var turns []ConversationTurn
	for rows.Next() {
		var (
			hash, branch, message, date                          string
			linesAdded, linesDeleted                             int
			tabAdded, tabDeleted, composerAdded, composerDeleted int
			humanAdded, humanDeleted                             int
			v1Pct, v2Pct                                         float64
		)
		if err := rows.Scan(&hash, &branch, &message, &date,
			&linesAdded, &linesDeleted,
			&tabAdded, &tabDeleted, &composerAdded, &composerDeleted,
			&humanAdded, &humanDeleted,
			&v1Pct, &v2Pct); err != nil {
			continue
		}
		turns = append(turns, scoredCommitToTurn(hash, branch, message, date,
			linesAdded, linesDeleted, tabAdded, tabDeleted,
			composerAdded, composerDeleted, humanAdded, humanDeleted,
			v1Pct, v2Pct))
	}
	return turns, rows.Err()
}

func conversationSummaryToTurn(convID, title, tldr, overview, bullets, model, mode, date string) ConversationTurn {
	content := fmt.Sprintf("Title: %s\nTLDR: %s\nOverview: %s", title, tldr, overview)
	if bullets != "" {
		content += "\nKey Points: " + bullets
	}

	return ConversationTurn{
		SessionID:      convID,
		ConversationID: convID,
		TurnIndex:      0,
		TotalTurns:     1,
		Role:           "summary",
		Content:        content,
		Timestamp:      parseTimestamp(date),
		Metadata: map[string]any{
			"model":       model,
			"model_id":    model,
			"mode":        mode,
			"environment": "cursor",
		},
	}
}

func scoredCommitToTurn(hash, branch, message, date string,
	linesAdded, linesDeleted, tabAdded, tabDeleted,
	composerAdded, composerDeleted, humanAdded, humanDeleted int,
	v1Pct, v2Pct float64) ConversationTurn {

	return ConversationTurn{
		SessionID:      hash,
		ConversationID: "commit-" + branch,
		TurnIndex:      0,
		TotalTurns:     1,
		Role:           "commit",
		Content:        message,
		Timestamp:      parseTimestamp(date),
		GitBranch:      branch,
		Metadata: map[string]any{
			"commit_hash":            hash,
			"lines_added":            linesAdded,
			"lines_deleted":          linesDeleted,
			"tab_lines_added":        tabAdded,
			"tab_lines_deleted":      tabDeleted,
			"composer_lines_added":   composerAdded,
			"composer_lines_deleted": composerDeleted,
			"human_lines_added":      humanAdded,
			"human_lines_deleted":    humanDeleted,
			"v1_ai_percentage":       v1Pct,
			"v2_ai_percentage":       v2Pct,
			"cursor_ai_percentage":   v2Pct,
		},
	}
}

func tableExists(db *sql.DB, table string) bool {
	var name string
	err := db.QueryRow(
		"SELECT name FROM sqlite_master WHERE type='table' AND name=?", table,
	).Scan(&name)
	return err == nil && name == table
}
