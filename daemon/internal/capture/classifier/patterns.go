package classifier

import (
	"regexp"
	"strings"
)

// --- Rejection / Negation ---

// rejectionWordRe matches short negation words that need word-boundary
// protection to avoid false positives (e.g. "no" inside "know").
var rejectionWordRe = regexp.MustCompile(`(?i)\b(no|nope)\b`)

// rejectionPhrases are long enough to be unambiguous with substring matching.
var rejectionPhrases = []string{
	"don't", "do not", "dont",
	"instead", "not that", "wrong", "incorrect",
	"that won't work", "that wont work",
	"i'd prefer", "id prefer", "i would prefer",
	"not that approach", "wrong direction", "wrong approach",
	"that's not what i", "thats not what i",
	"i disagree", "let's not", "lets not",
	"rather than that",
	"i don't think", "i dont think",
	"won't work", "wont work",
	"please don't", "please dont",
	"that's wrong", "thats wrong",
	"not what i meant", "not what i want",
	"bad approach", "bad idea",
	"won't scale", "wont scale",
	"too complex", "overkill", "unnecessary",
	"i don't want", "i dont want",
	"shouldn't", "should not", "shouldnt",
	"don't use", "do not use", "dont use",
	"not what i need",
	"that's not right", "thats not right",
	"can't use", "cannot use",
	"avoid", "never use",
}

// ContainsRejection returns the number of distinct rejection signals found
// in the content. Multiple patterns in a single message produce a higher count.
func ContainsRejection(content string) int {
	lower := strings.ToLower(content)
	count := 0

	if rejectionWordRe.MatchString(lower) {
		count++
	}

	for _, phrase := range rejectionPhrases {
		if strings.Contains(lower, phrase) {
			count++
			if count >= 4 {
				return count
			}
		}
	}
	return count
}

// --- Acceptance ---

// acceptanceStarts are phrases that indicate agreement when they appear
// at or near the beginning of a user turn.
var acceptanceStarts = []string{
	"yes", "ok", "okay", "sure", "go ahead",
	"looks good", "sounds good", "sounds great",
	"do it", "proceed", "that works", "perfect",
	"great", "awesome", "lgtm", "ship it",
	"approved", "agreed", "fine", "alright",
	"makes sense", "good idea", "nice", "exactly",
	"thanks", "thank you", "cool", "right",
	"good,", "good.", "good!",
}

// StartsWithAcceptance returns true if content begins with an acceptance phrase.
func StartsWithAcceptance(content string) bool {
	lower := strings.ToLower(strings.TrimSpace(content))
	for _, phrase := range acceptanceStarts {
		if strings.HasPrefix(lower, phrase) {
			return true
		}
	}
	return false
}

// IsPureAcceptance returns true if the content is ONLY an acceptance
// (short, no substantive follow-up instruction).
func IsPureAcceptance(content string) bool {
	return StartsWithAcceptance(content) && len(strings.TrimSpace(content)) <= 30
}

// --- Modification after acceptance ---

// modificationPhrases indicate the user is tweaking an accepted suggestion.
var modificationPhrases = []string{
	"but change", "but also", "but add", "but modify", "but update",
	"but remove", "but make",
	"one thing though", "one more thing", "one change",
	"also add", "also include", "also make",
	"actually change", "actually modify", "actually update",
	"small change", "minor tweak", "slight change",
	"with one change", "with one exception",
	"except", "with the addition",
	"also make sure", "but ensure", "also handle",
	"just change", "just update", "just modify",
	"however,", "though,",
}

// ContainsModificationLanguage returns true if the content contains
// phrases indicating a post-acceptance modification.
func ContainsModificationLanguage(content string) bool {
	lower := strings.ToLower(content)
	for _, phrase := range modificationPhrases {
		if strings.Contains(lower, phrase) {
			return true
		}
	}
	return false
}

// --- Alternative evaluation ---

var alternativePhrases = []string{
	"should we use", "which is better", "which one",
	"compare", "trade-off", "tradeoff", "trade off",
	"pros and cons", "advantages and disadvantages",
	"what about", "alternatively",
	"have you considered", "considered using",
	"versus", " vs ", " vs.",
	"or should we", "or could we", "or would it",
	"another option", "other approach", "different approach",
	"which approach", "what approach",
	"between", "evaluate",
	"weigh the options",
	"what if we", "could we instead",
	"is there a better", "is there an alternative",
	"instead of", "rather than",
	"the other option", "option a", "option b",
}

// ContainsAlternativeEvaluation returns true if the content shows
// the user explicitly comparing approaches or evaluating trade-offs.
func ContainsAlternativeEvaluation(content string) bool {
	lower := strings.ToLower(content)
	for _, phrase := range alternativePhrases {
		if strings.Contains(lower, phrase) {
			return true
		}
	}
	return false
}

// --- Course correction ---

var correctionPhrases = []string{
	"actually, let's", "actually let's", "actually lets",
	"actually,", "on second thought",
	"wait, let's", "wait let's", "wait,",
	"scratch that", "scrap that", "discard that",
	"change of plan", "change of direction",
	"let's go back", "lets go back", "go back to",
	"forget that", "forget what i said",
	"let me rethink", "let's rethink",
	"new approach", "different approach", "try a different",
	"start over", "start from scratch",
	"let's pivot", "lets pivot",
	"change direction", "going in a different",
	"never mind", "nevermind",
	"let's try something else", "lets try something else",
	"i changed my mind", "i've changed my mind",
}

// ContainsCourseCorrection returns true if the user is changing
// direction mid-conversation.
func ContainsCourseCorrection(content string) bool {
	lower := strings.ToLower(content)
	for _, phrase := range correctionPhrases {
		if strings.Contains(lower, phrase) {
			return true
		}
	}
	return false
}
