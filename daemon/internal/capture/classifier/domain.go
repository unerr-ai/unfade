package classifier

import (
	"strings"
	"unicode"
)

// stopWords are common English function words filtered out before
// domain vocabulary comparison. Kept small and focused.
var stopWords = map[string]bool{
	"a": true, "an": true, "the": true, "is": true, "are": true,
	"was": true, "were": true, "be": true, "been": true, "being": true,
	"have": true, "has": true, "had": true, "do": true, "does": true,
	"did": true, "will": true, "would": true, "shall": true, "should": true,
	"may": true, "might": true, "must": true, "can": true, "could": true,
	"i": true, "me": true, "my": true, "we": true, "our": true,
	"you": true, "your": true, "he": true, "she": true, "it": true,
	"they": true, "them": true, "their": true, "this": true, "that": true,
	"these": true, "those": true, "here": true, "there": true,
	"and": true, "or": true, "but": true, "if": true, "then": true,
	"so": true, "as": true, "at": true, "by": true, "for": true,
	"in": true, "of": true, "on": true, "to": true, "up": true,
	"with": true, "from": true, "into": true, "not": true, "no": true,
	"what": true, "which": true, "who": true, "when": true, "where": true,
	"how": true, "all": true, "each": true, "some": true, "any": true,
	"just": true, "also": true, "than": true, "too": true, "very": true,
	"about": true, "like": true, "more": true, "use": true, "using": true,
	"need": true, "want": true, "make": true, "get": true, "let": true,
	"think": true, "know": true, "see": true, "look": true, "take": true,
	"give": true, "go": true, "come": true, "try": true, "sure": true,
	"yes": true, "ok": true, "well": true, "now": true, "way": true,
	"because": true, "since": true, "while": true, "after": true, "before": true,
	"code": true, "file": true, "new": true, "one": true, "two": true,
	"add": true, "change": true, "work": true, "good": true, "right": true,
}

// DetectDomainInjection returns true when the user introduces
// domain-specific vocabulary (project terms, architecture patterns,
// infrastructure names) not present in the assistant's prior messages.
//
// priorAssistantContent is the concatenation of all prior assistant
// turn contents in the conversation up to (but not including) the
// user turn being tested.
func DetectDomainInjection(userContent string, priorAssistantContent string) bool {
	userTokens := extractDomainTokens(userContent)
	if len(userTokens) == 0 {
		return false
	}

	assistantTokens := extractDomainTokens(priorAssistantContent)

	novelCount := 0
	for token := range userTokens {
		if !assistantTokens[token] {
			novelCount++
		}
	}

	return novelCount >= 2
}

// extractDomainTokens tokenizes content, removes stop words, and returns
// the set of "interesting" tokens — those likely to be domain-specific.
func extractDomainTokens(content string) map[string]bool {
	words := strings.FieldsFunc(strings.ToLower(content), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' && r != '-' && r != '.'
	})

	tokens := make(map[string]bool)
	for _, w := range words {
		if len(w) < 3 {
			continue
		}
		if stopWords[w] {
			continue
		}
		tokens[w] = true
	}
	return tokens
}
