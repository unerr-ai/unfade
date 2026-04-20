package classifier

import (
	"math"
	"regexp"
	"strings"
	"unicode"
)

// Technical identifier patterns — compiled once at package init.
var (
	camelCaseRe  = regexp.MustCompile(`[a-z][a-zA-Z]*[A-Z][a-zA-Z]*`)
	pascalCaseRe = regexp.MustCompile(`[A-Z][a-z]+[A-Z][a-zA-Z]*`)
	snakeCaseRe  = regexp.MustCompile(`[a-z]+_[a-z]+`)
	dottedNameRe = regexp.MustCompile(`[a-zA-Z]+\.[a-zA-Z]{2,}`)
	filePathRe   = regexp.MustCompile(`(?:^|[\s"'(])(?:/[\w.-]+){2,}|[\w.-]+/[\w.-]+`)
	versionRe    = regexp.MustCompile(`\b\d+\.\d+(?:\.\d+)?\b`)
	namespacedRe = regexp.MustCompile(`\w+::\w+`)
	codeTokenRe  = regexp.MustCompile(`[({}\[\]);=>]`)
)

// architectureTerms are lower-cased domain vocabulary terms that indicate
// the user is working at an architectural level rather than making vague requests.
var architectureTerms = []string{
	"dependency injection", "singleton", "factory", "observer", "strategy",
	"middleware", "api", "rest", "graphql", "grpc", "websocket",
	"database", "schema", "migration", "index", "query",
	"cache", "redis", "memcached", "cdn", "queue", "kafka", "rabbitmq",
	"microservice", "monolith", "serverless", "container", "docker", "kubernetes",
	"ci/cd", "pipeline", "deployment", "rollback", "canary",
	"authentication", "authorization", "oauth", "jwt", "session",
	"encryption", "tls", "ssl", "cors", "csrf",
	"load balancer", "reverse proxy", "nginx",
	"orm", "sql", "nosql", "postgresql", "mysql", "mongodb", "sqlite",
	"typescript", "javascript", "python", "golang", "rust", "java",
	"react", "vue", "angular", "next.js", "express", "fastapi", "django",
	"performance", "latency", "throughput", "bottleneck", "optimization",
	"refactor", "abstraction", "interface", "polymorphism", "inheritance",
	"unit test", "integration test", "e2e", "mock", "stub",
	"concurrency", "parallelism", "async", "await", "promise", "goroutine",
	"mutex", "semaphore", "deadlock", "race condition",
	"rate limit", "circuit breaker", "retry", "backoff", "timeout",
	"event sourcing", "cqrs", "saga", "pub/sub", "message bus",
	"repository pattern", "service layer", "domain model", "ddd",
	"dependency", "module", "package", "import", "export",
	"endpoint", "route", "handler", "controller", "resolver",
	"token", "hash", "salt", "credential",
	"log level", "structured logging", "tracing", "metrics",
	"sidecar", "service mesh", "istio", "envoy",
}

// imperativeVerbs indicate directive instructions.
var imperativeVerbs = []string{
	"add", "remove", "change", "modify", "update", "create", "delete",
	"refactor", "implement", "extract", "move", "rename", "replace",
	"fix", "resolve", "configure", "set up", "setup", "initialize",
	"integrate", "connect", "wrap", "unwrap", "inject", "expose",
	"split", "merge", "combine", "separate", "isolate",
	"optimize", "improve", "enhance", "extend", "override",
	"validate", "verify", "ensure", "enforce", "restrict",
	"handle", "catch", "throw", "emit", "dispatch",
	"serialize", "deserialize", "parse", "format", "transform",
	"migrate", "deploy", "build", "test", "benchmark",
}

// ScoreSpecificity analyzes a user prompt and returns a 0.0–1.0 score
// indicating how technically specific and detailed it is.
// 0.0 = generic ("fix this"), 1.0 = detailed technical specification.
func ScoreSpecificity(content string) float64 {
	content = strings.TrimSpace(content)
	if content == "" {
		return 0.0
	}

	lengthScore := scoreLengthFactor(len(content))
	techDensity := scoreTechnicalDensity(content)
	instructionScore := scoreInstructionSpecificity(content)

	composite := lengthScore*0.25 + techDensity*0.45 + instructionScore*0.30
	return clamp(composite, 0.0, 1.0)
}

// scoreLengthFactor returns 0.0 for very short prompts, scaling to 1.0 for
// detailed ones. Uses a sigmoid centered around ~60 usable characters.
func scoreLengthFactor(n int) float64 {
	if n <= 10 {
		return 0.0
	}
	x := float64(n-10) / 150.0
	return clamp(1.0/(1.0+math.Exp(-8.0*(x-0.35))), 0.0, 1.0)
}

// scoreTechnicalDensity counts technical identifiers and architecture terms,
// returning their density relative to total word count.
func scoreTechnicalDensity(content string) float64 {
	words := tokenize(content)
	if len(words) == 0 {
		return 0.0
	}

	techHits := 0

	// Count regex-based technical patterns.
	for _, re := range []*regexp.Regexp{
		camelCaseRe, pascalCaseRe, snakeCaseRe, dottedNameRe,
		filePathRe, versionRe, namespacedRe,
	} {
		techHits += len(re.FindAllString(content, -1))
	}

	// Code-like tokens (braces, arrows, semicolons).
	techHits += len(codeTokenRe.FindAllString(content, -1))

	// Architecture / domain vocabulary.
	lower := strings.ToLower(content)
	for _, term := range architectureTerms {
		if strings.Contains(lower, term) {
			techHits++
		}
	}

	absScore := clamp(float64(techHits)*0.15, 0.0, 1.0)
	density := float64(techHits) / float64(len(words))
	densityScore := clamp(density*3.0, 0.0, 1.0)
	return math.Max(absScore, densityScore)
}

// scoreInstructionSpecificity checks for imperative verbs combined with
// specific technical nouns — the hallmark of a directed instruction versus
// a vague request.
func scoreInstructionSpecificity(content string) float64 {
	lower := strings.ToLower(content)

	verbCount := 0
	for _, verb := range imperativeVerbs {
		if strings.Contains(lower, verb) {
			verbCount++
		}
	}

	hasTechNouns := camelCaseRe.MatchString(content) ||
		pascalCaseRe.MatchString(content) ||
		snakeCaseRe.MatchString(content) ||
		filePathRe.MatchString(content)

	if verbCount == 0 {
		return 0.0
	}

	verbScore := clamp(float64(verbCount)/3.0, 0.0, 1.0)
	if hasTechNouns {
		return clamp(verbScore*1.4, 0.0, 1.0)
	}
	return verbScore * 0.6
}

// tokenize splits content into word tokens, filtering punctuation.
func tokenize(content string) []string {
	fields := strings.FieldsFunc(content, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' && r != '-'
	})
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if len(f) >= 2 {
			out = append(out, f)
		}
	}
	return out
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
