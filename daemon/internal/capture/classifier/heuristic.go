package classifier

import (
	"strings"

	"github.com/unfade-io/unfade-cli/daemon/internal/capture/parsers"
)

// Signal weights from Section 5.2 of the architecture document.
const (
	weightRejection    = 0.20
	weightModification = 0.15
	weightSpecificity  = 0.15
	weightLength       = 0.10
	weightDomain       = 0.15
	weightAlternative  = 0.10
	weightCorrection   = 0.10
	weightAIPercent    = 0.05
)

// Classify takes an ordered slice of ConversationTurns for a single
// conversation and computes DirectionSignals with a composite Human
// Direction Score (HDS). Deterministic, no network calls, no LLM.
func Classify(turns []parsers.ConversationTurn) parsers.DirectionSignals {
	userTurns, assistantTurns := partitionRoles(turns)

	if len(userTurns) == 0 {
		aiPct, hasAI := extractAIPercentage(turns)
		if hasAI {
			score := 1.0 - clamp(aiPct/100.0, 0.0, 1.0)
			return parsers.DirectionSignals{
				HumanDirectionScore: score,
				Confidence:          confidence(score),
			}
		}
		return parsers.DirectionSignals{Confidence: "high"}
	}

	// --- Compute each signal ---

	rejCount, rejSignal := computeRejection(userTurns, assistantTurns)
	modSignal := computeModification(userTurns, assistantTurns)
	specSignal := computeSpecificity(userTurns)
	lengthSignal := computeLength(userTurns)
	domainDetected, domainSignal := computeDomain(userTurns, assistantTurns)
	altDetected, altSignal := computeAlternative(userTurns)
	corrDetected, corrSignal := computeCorrection(userTurns)

	// --- Weighted sum ---

	type weightedSignal struct {
		value  float64
		weight float64
	}
	signals := []weightedSignal{
		{rejSignal, weightRejection},
		{modSignal, weightModification},
		{specSignal, weightSpecificity},
		{lengthSignal, weightLength},
		{domainSignal, weightDomain},
		{altSignal, weightAlternative},
		{corrSignal, weightCorrection},
	}

	aiPct, hasAI := extractAIPercentage(turns)
	if hasAI {
		aiSignal := 1.0 - clamp(aiPct/100.0, 0.0, 1.0)
		signals = append(signals, weightedSignal{aiSignal, weightAIPercent})
	}

	var num, den float64
	highSignalCount := 0
	for _, s := range signals {
		num += s.value * s.weight
		den += s.weight
		if s.value > 0.5 {
			highSignalCount++
		}
	}

	hds := 0.0
	if den > 0 {
		hds = num / den
	}

	// Signal reinforcement: when multiple independent signals co-occur,
	// the converging evidence is stronger than the linear sum suggests.
	if highSignalCount >= 4 {
		hds *= 1.15
	} else if highSignalCount >= 3 {
		hds *= 1.08
	}
	hds = clamp(hds, 0.0, 1.0)

	return parsers.DirectionSignals{
		RejectionCount:          rejCount,
		ModificationAfterAccept: modSignal > 0,
		PromptSpecificity:       specSignal,
		DomainInjection:         domainDetected,
		AlternativeEvaluation:   altDetected,
		CourseCorrection:        corrDetected,
		HumanDirectionScore:     hds,
		Confidence:              confidence(hds),
	}
}

// --- Signal computation functions ---

// computeRejection counts distinct rejection pattern matches across all
// user turns that follow an assistant turn.
func computeRejection(userTurns, assistantTurns []indexedTurn) (int, float64) {
	totalMatches := 0
	assistantSet := turnIndexSet(assistantTurns)

	for _, ut := range userTurns {
		if !hasPriorAssistant(ut.index, assistantSet) {
			continue
		}
		matches := ContainsRejection(ut.content)
		totalMatches += matches
	}

	var signal float64
	switch {
	case totalMatches == 0:
		signal = 0.0
	case totalMatches == 1:
		signal = 0.4
	case totalMatches == 2:
		signal = 0.7
	default:
		signal = 1.0
	}
	return totalMatches, signal
}

// computeModification detects two patterns:
// (a) A user turn that starts with acceptance AND has substantive follow-up.
// (b) A pure acceptance turn followed (after an assistant response) by a
//
//	substantive user turn with modification language.
func computeModification(userTurns, assistantTurns []indexedTurn) float64 {
	assistantSet := turnIndexSet(assistantTurns)

	for i, ut := range userTurns {
		// Pattern (a): acceptance + instruction in one turn.
		if StartsWithAcceptance(ut.content) && len(strings.TrimSpace(ut.content)) > 25 {
			if hasPriorAssistant(ut.index, assistantSet) {
				return 1.0
			}
		}

		// Pattern (b): pure acceptance → assistant → modification.
		if IsPureAcceptance(ut.content) && i+1 < len(userTurns) {
			next := userTurns[i+1]
			if hasPriorAssistant(next.index, assistantSet) && ContainsModificationLanguage(next.content) {
				return 1.0
			}
		}
	}
	return 0.0
}

// computeSpecificity returns the average specificity score across all
// user turns, weighted slightly toward longer (more substantive) turns.
func computeSpecificity(userTurns []indexedTurn) float64 {
	if len(userTurns) == 0 {
		return 0.0
	}

	var total float64
	var weight float64
	for _, ut := range userTurns {
		score := ScoreSpecificity(ut.content)
		w := 1.0
		if len(ut.content) > 50 {
			w = 1.5
		}
		total += score * w
		weight += w
	}
	if weight == 0 {
		return 0.0
	}
	return total / weight
}

// computeLength maps the number of substantive user turns (>20 chars)
// to a 0.0–1.0 signal.
func computeLength(userTurns []indexedTurn) float64 {
	substantive := 0
	for _, ut := range userTurns {
		if len(strings.TrimSpace(ut.content)) > 20 {
			substantive++
		}
	}
	switch {
	case substantive <= 1:
		return 0.0
	case substantive == 2:
		return 0.2
	case substantive <= 4:
		return 0.4
	case substantive <= 6:
		return 0.7
	default:
		return 1.0
	}
}

// computeDomain checks whether any user turn introduces domain-specific
// vocabulary not present in prior assistant messages. Requires at least
// one prior assistant turn — the first user message has nothing to compare
// against so domain injection is meaningless there.
func computeDomain(userTurns, assistantTurns []indexedTurn) (bool, float64) {
	var priorAssistantContent strings.Builder

	aIdx := 0
	for _, ut := range userTurns {
		for aIdx < len(assistantTurns) && assistantTurns[aIdx].index < ut.index {
			priorAssistantContent.WriteString(assistantTurns[aIdx].content)
			priorAssistantContent.WriteString(" ")
			aIdx++
		}

		if priorAssistantContent.Len() == 0 {
			continue
		}

		if DetectDomainInjection(ut.content, priorAssistantContent.String()) {
			return true, 1.0
		}
	}
	return false, 0.0
}

// computeAlternative checks whether any user turn contains alternative
// evaluation language (comparing approaches, evaluating trade-offs).
func computeAlternative(userTurns []indexedTurn) (bool, float64) {
	for _, ut := range userTurns {
		if ContainsAlternativeEvaluation(ut.content) {
			return true, 1.0
		}
	}
	return false, 0.0
}

// computeCorrection checks whether any user turn contains course
// correction language (changing direction mid-conversation).
func computeCorrection(userTurns []indexedTurn) (bool, float64) {
	for _, ut := range userTurns {
		if ContainsCourseCorrection(ut.content) {
			return true, 1.0
		}
	}
	return false, 0.0
}

// --- Helper types and functions ---

// indexedTurn pairs content with its original turn index in the conversation.
type indexedTurn struct {
	index   int
	content string
}

// partitionRoles splits turns into user and assistant groups, preserving
// their original TurnIndex for ordering. Skips system/summary/commit roles
// for the main analysis (commit data is used only for AI percentage).
func partitionRoles(turns []parsers.ConversationTurn) (users, assistants []indexedTurn) {
	for _, t := range turns {
		switch t.Role {
		case "user":
			users = append(users, indexedTurn{index: t.TurnIndex, content: t.Content})
		case "assistant":
			assistants = append(assistants, indexedTurn{index: t.TurnIndex, content: t.Content})
		}
	}
	return
}

// turnIndexSet builds a set of turn indices for O(1) lookup.
func turnIndexSet(turns []indexedTurn) map[int]bool {
	s := make(map[int]bool, len(turns))
	for _, t := range turns {
		s[t.index] = true
	}
	return s
}

// hasPriorAssistant returns true if any assistant turn has an index
// strictly less than the given user turn index.
func hasPriorAssistant(userIndex int, assistantIndices map[int]bool) bool {
	for idx := range assistantIndices {
		if idx < userIndex {
			return true
		}
	}
	return false
}

// extractAIPercentage looks for Cursor-specific AI percentage in commit
// metadata. Returns the percentage and whether it was found.
func extractAIPercentage(turns []parsers.ConversationTurn) (float64, bool) {
	for _, t := range turns {
		if t.Metadata == nil {
			continue
		}

		for _, key := range []string{"cursor_ai_percentage", "v2_ai_percentage"} {
			if v, ok := t.Metadata[key]; ok {
				switch pct := v.(type) {
				case float64:
					return pct, true
				case int:
					return float64(pct), true
				}
			}
		}
	}
	return 0, false
}

func confidence(hds float64) string {
	if hds <= 0.2 || hds >= 0.8 {
		return "high"
	}
	return "low"
}
