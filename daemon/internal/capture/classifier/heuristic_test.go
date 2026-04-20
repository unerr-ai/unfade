package classifier

import (
	"testing"
	"time"

	"github.com/unfade-io/unfade-cli/daemon/internal/capture/parsers"
)

func turn(index int, role, content string) parsers.ConversationTurn {
	return parsers.ConversationTurn{
		SessionID:      "test-session",
		ConversationID: "test-conv",
		TurnIndex:      index,
		Role:           role,
		Content:        content,
		Timestamp:      time.Now(),
	}
}

func turnWithMeta(index int, role, content string, meta map[string]any) parsers.ConversationTurn {
	t := turn(index, role, content)
	t.Metadata = meta
	return t
}

// T-096: "No, use DI instead" conversation → HDS > 0.7, confidence: high
func TestClassifyHumanDirected_DI_Rejection(t *testing.T) {
	turns := []parsers.ConversationTurn{
		turn(0, "user", "Refactor the auth module to use dependency injection instead of singletons"),
		turn(1, "assistant", "I'll refactor the auth module. I'll use a singleton pattern for the AuthService class to ensure there's only one instance managing authentication across the application."),
		turn(2, "user", "No, don't use a singleton here — we need DI because of our test setup. The test framework uses isolated containers and singletons break parallel test execution."),
		turn(3, "assistant", "You're right, I'll switch to dependency injection to support your parallel test setup. Here's the refactored version with constructor injection."),
		turn(4, "user", "Good, now add the interface extraction so we can mock it in tests"),
		turn(5, "assistant", "I'll extract an IAuthService interface and update the injection points."),
	}

	signals := Classify(turns)

	if signals.HumanDirectionScore <= 0.7 {
		t.Errorf("HDS = %.3f, want > 0.7 (Human-Directed)", signals.HumanDirectionScore)
	}
	if signals.Confidence != "high" {
		t.Errorf("confidence = %q, want high", signals.Confidence)
	}
	if signals.RejectionCount == 0 {
		t.Error("expected rejection count > 0")
	}
	if !signals.AlternativeEvaluation {
		t.Error("expected alternative evaluation detected (DI instead of singletons)")
	}
	if !signals.DomainInjection {
		t.Error("expected domain injection detected (test framework, parallel execution)")
	}
}

// T-097: Single "Yes, do that" turn → HDS < 0.3, confidence: high
func TestClassifyLLMDirected_SingleAcceptance(t *testing.T) {
	turns := []parsers.ConversationTurn{
		turn(0, "user", "Yes, do that"),
		turn(1, "assistant", "I'll implement the changes as described. Here's the updated code with the new error handling."),
	}

	signals := Classify(turns)

	if signals.HumanDirectionScore >= 0.3 {
		t.Errorf("HDS = %.3f, want < 0.3 (LLM-Directed)", signals.HumanDirectionScore)
	}
	if signals.Confidence != "high" {
		t.Errorf("confidence = %q, want high", signals.Confidence)
	}
	if signals.RejectionCount != 0 {
		t.Errorf("rejection count = %d, want 0", signals.RejectionCount)
	}
}

// T-098: Multi-turn refinement → HDS 0.3-0.7, confidence: low
func TestClassifyCollaborative_MultiTurnRefinement(t *testing.T) {
	turns := []parsers.ConversationTurn{
		turn(0, "user", "Add logging to the service layer"),
		turn(1, "assistant", "I'll add console.log statements to each service method for debugging purposes."),
		turn(2, "user", "Use a proper logging library instead, with log levels for debug, info, warn, error"),
		turn(3, "assistant", "Good point. I'll use winston with configurable log levels. Here's the setup with transport configuration."),
		turn(4, "user", "Make sure to add structured JSON logging for production environments"),
		turn(5, "assistant", "I'll configure JSON format for production and pretty-print for development."),
	}

	signals := Classify(turns)

	if signals.HumanDirectionScore < 0.3 || signals.HumanDirectionScore > 0.7 {
		t.Errorf("HDS = %.3f, want 0.3-0.7 (Collaborative)", signals.HumanDirectionScore)
	}
	if signals.Confidence != "low" {
		t.Errorf("confidence = %q, want low", signals.Confidence)
	}
}

func TestClassifyEmptyConversation(t *testing.T) {
	signals := Classify(nil)

	if signals.HumanDirectionScore != 0.0 {
		t.Errorf("HDS = %.3f, want 0.0 for empty conversation", signals.HumanDirectionScore)
	}
	if signals.Confidence != "high" {
		t.Errorf("confidence = %q, want high", signals.Confidence)
	}
}

func TestClassifySystemOnlyTurns(t *testing.T) {
	turns := []parsers.ConversationTurn{
		turn(0, "system", "You are a helpful assistant"),
		turn(1, "summary", "This conversation was about authentication"),
	}

	signals := Classify(turns)

	if signals.HumanDirectionScore != 0.0 {
		t.Errorf("HDS = %.3f, want 0.0 for system-only turns", signals.HumanDirectionScore)
	}
}

func TestClassifyCourseCorrection(t *testing.T) {
	turns := []parsers.ConversationTurn{
		turn(0, "user", "Implement the cache layer using Redis"),
		turn(1, "assistant", "I'll set up Redis with a connection pool and implement get/set operations with TTL support."),
		turn(2, "user", "Actually, let's use an in-memory LRU cache instead. We don't need Redis for this service, it's overkill for our data volume."),
		turn(3, "assistant", "Good call. I'll implement an in-memory LRU cache with configurable size limits."),
	}

	signals := Classify(turns)

	if !signals.CourseCorrection {
		t.Error("expected course correction detected")
	}
	if signals.HumanDirectionScore <= 0.3 {
		t.Errorf("HDS = %.3f, want > 0.3 for course correction", signals.HumanDirectionScore)
	}
}

func TestClassifyAlternativeEvaluation(t *testing.T) {
	turns := []parsers.ConversationTurn{
		turn(0, "user", "Should we use REST or GraphQL for the new API? What are the trade-offs for our use case?"),
		turn(1, "assistant", "Great question. Here's a comparison for your specific context..."),
		turn(2, "user", "Let's go with GraphQL since we have many nested relationships"),
		turn(3, "assistant", "I'll set up the GraphQL schema and resolvers."),
	}

	signals := Classify(turns)

	if !signals.AlternativeEvaluation {
		t.Error("expected alternative evaluation detected")
	}
}

func TestClassifyModificationAfterAcceptance(t *testing.T) {
	turns := []parsers.ConversationTurn{
		turn(0, "user", "Add input validation to the form"),
		turn(1, "assistant", "I'll add validation using Zod schemas for each form field with error messages."),
		turn(2, "user", "Looks good, but also add real-time validation as the user types, not just on submit"),
		turn(3, "assistant", "I'll add onChange validation handlers alongside the onSubmit validation."),
	}

	signals := Classify(turns)

	if !signals.ModificationAfterAccept {
		t.Error("expected modification after acceptance detected")
	}
}

func TestClassifyModificationViaAcceptanceThenInstruction(t *testing.T) {
	turns := []parsers.ConversationTurn{
		turn(0, "user", "Refactor the database layer"),
		turn(1, "assistant", "I'll restructure the database layer with a repository pattern."),
		turn(2, "user", "Perfect, now also add connection pooling with a max of 20 connections and idle timeout of 30 seconds"),
		turn(3, "assistant", "I'll configure the connection pool with those specific parameters."),
	}

	signals := Classify(turns)

	if !signals.ModificationAfterAccept {
		t.Error("expected modification after acceptance (acceptance + substantive follow-up)")
	}
}

func TestClassifyDomainKnowledgeInjection(t *testing.T) {
	turns := []parsers.ConversationTurn{
		turn(0, "user", "Update the payment processing flow"),
		turn(1, "assistant", "I'll update the payment flow with better error handling and retry logic."),
		turn(2, "user", "Make sure to use our internal PaymentGatewayV2 adapter with the MerchantConfig from the compliance module. The fraud detection service requires the riskScore threshold from our team's SLA document."),
		turn(3, "assistant", "I'll integrate PaymentGatewayV2 with MerchantConfig and add the fraud detection check."),
	}

	signals := Classify(turns)

	if !signals.DomainInjection {
		t.Error("expected domain injection detected (PaymentGatewayV2, MerchantConfig, riskScore, SLA)")
	}
}

func TestClassifyCursorAIPercentage(t *testing.T) {
	turns := []parsers.ConversationTurn{
		turnWithMeta(0, "commit", "Refactor auth module to use DI", map[string]any{
			"cursor_ai_percentage": 25.0,
			"human_lines_added":    75,
			"composer_lines_added": 25,
		}),
	}

	signals := Classify(turns)

	// With only AI% data (25% AI = 75% human), HDS should reflect human authorship.
	if signals.HumanDirectionScore < 0.5 {
		t.Errorf("HDS = %.3f, want >= 0.5 for 25%% AI (mostly human)", signals.HumanDirectionScore)
	}
}

func TestClassifyCursorHighAIPercentage(t *testing.T) {
	turns := []parsers.ConversationTurn{
		turnWithMeta(0, "commit", "Auto-generated migration", map[string]any{
			"cursor_ai_percentage": 90.0,
		}),
	}

	signals := Classify(turns)

	if signals.HumanDirectionScore > 0.3 {
		t.Errorf("HDS = %.3f, want <= 0.3 for 90%% AI (mostly AI-generated)", signals.HumanDirectionScore)
	}
}

func TestClassifyDeterminism(t *testing.T) {
	turns := []parsers.ConversationTurn{
		turn(0, "user", "Implement rate limiting with a token bucket algorithm"),
		turn(1, "assistant", "I'll implement a token bucket rate limiter."),
		turn(2, "user", "Don't use Redis for the counter, use in-memory with atomic operations"),
		turn(3, "assistant", "I'll switch to an in-memory implementation using sync/atomic."),
	}

	first := Classify(turns)
	for i := 0; i < 10; i++ {
		result := Classify(turns)
		if result.HumanDirectionScore != first.HumanDirectionScore {
			t.Fatalf("non-deterministic: run %d HDS=%.3f, run 0 HDS=%.3f",
				i, result.HumanDirectionScore, first.HumanDirectionScore)
		}
		if result.Confidence != first.Confidence {
			t.Fatalf("non-deterministic confidence: run %d=%q, run 0=%q",
				i, result.Confidence, first.Confidence)
		}
	}
}

func TestClassifyHDSRange(t *testing.T) {
	testCases := []struct {
		name  string
		turns []parsers.ConversationTurn
	}{
		{"empty", nil},
		{"single accept", []parsers.ConversationTurn{turn(0, "user", "ok")}},
		{"heavy direction", []parsers.ConversationTurn{
			turn(0, "user", "No, don't use that. Instead of the singleton, use dependency injection with our custom ServiceContainer from the infrastructure module."),
			turn(1, "assistant", "response"),
			turn(2, "user", "Actually, let's also evaluate whether we should use property injection versus constructor injection for the TestHarness adapter."),
			turn(3, "assistant", "response"),
		}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			signals := Classify(tc.turns)
			if signals.HumanDirectionScore < 0.0 || signals.HumanDirectionScore > 1.0 {
				t.Errorf("HDS = %.3f, must be in [0.0, 1.0]", signals.HumanDirectionScore)
			}
			if signals.Confidence != "high" && signals.Confidence != "low" {
				t.Errorf("confidence = %q, must be 'high' or 'low'", signals.Confidence)
			}
		})
	}
}

func TestClassifyVagueOneWordPrompts(t *testing.T) {
	turns := []parsers.ConversationTurn{
		turn(0, "user", "fix it"),
		turn(1, "assistant", "I've fixed the issue by updating the configuration."),
	}

	signals := Classify(turns)

	if signals.HumanDirectionScore > 0.3 {
		t.Errorf("HDS = %.3f, want <= 0.3 for vague one-word prompt", signals.HumanDirectionScore)
	}
}

func TestClassifyLongDetailedConversation(t *testing.T) {
	turns := []parsers.ConversationTurn{
		turn(0, "user", "Implement a WebSocket server for real-time notifications using the ws library with heartbeat detection"),
		turn(1, "assistant", "I'll set up a WebSocket server with the ws library."),
		turn(2, "user", "Don't use the default JSON serialization — use our custom MessagePackEncoder from the shared/encoding module for bandwidth optimization"),
		turn(3, "assistant", "I'll integrate MessagePackEncoder for serialization."),
		turn(4, "user", "Add connection multiplexing with our ChannelRouter pattern. Each client subscribes to specific event channels instead of receiving everything."),
		turn(5, "assistant", "I'll implement channel-based routing with subscription management."),
		turn(6, "user", "Make sure to handle reconnection with exponential backoff. Use the ReconnectPolicy from our infra/resilience package with the default 3-retry configuration."),
		turn(7, "assistant", "I'll add reconnection logic using ReconnectPolicy."),
		turn(8, "user", "Good, but also add metrics emission via our OpenTelemetry setup — track connection count, message throughput, and reconnection rate"),
		turn(9, "assistant", "I'll add OTel metrics instrumentation."),
	}

	signals := Classify(turns)

	if signals.HumanDirectionScore < 0.7 {
		t.Errorf("HDS = %.3f, want >= 0.7 for long, directed conversation", signals.HumanDirectionScore)
	}
	if !signals.DomainInjection {
		t.Error("expected domain injection for project-specific terms")
	}
}

// --- Pattern detection unit tests ---

func TestContainsRejection(t *testing.T) {
	tests := []struct {
		input   string
		wantMin int
	}{
		{"No, that's wrong", 2},
		{"don't use singletons", 1},
		{"instead of that approach", 1},
		{"yes, do that", 0},
		{"the system is working fine", 0},
		{"I know this pattern", 0},
	}

	for _, tt := range tests {
		count := ContainsRejection(tt.input)
		if count < tt.wantMin {
			t.Errorf("ContainsRejection(%q) = %d, want >= %d", tt.input, count, tt.wantMin)
		}
	}
}

func TestContainsAlternativeEvaluation(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"Should we use REST or GraphQL?", true},
		{"What are the trade-offs?", true},
		{"use dependency injection instead of singletons", true},
		{"implement the function", false},
		{"fix the bug", false},
	}

	for _, tt := range tests {
		got := ContainsAlternativeEvaluation(tt.input)
		if got != tt.want {
			t.Errorf("ContainsAlternativeEvaluation(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestContainsCourseCorrection(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"Actually, let's use a different approach", true},
		{"On second thought, let's try Redis", true},
		{"Scratch that, use PostgreSQL", true},
		{"Add error handling", false},
		{"Yes, proceed", false},
	}

	for _, tt := range tests {
		got := ContainsCourseCorrection(tt.input)
		if got != tt.want {
			t.Errorf("ContainsCourseCorrection(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestIsPureAcceptance(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"yes", true},
		{"ok", true},
		{"Looks good", true},
		{"Sure, go ahead", true},
		{"Yes, but also add comprehensive error handling with retry logic and circuit breaker pattern", false},
		{"No, change the approach", false},
	}

	for _, tt := range tests {
		got := IsPureAcceptance(tt.input)
		if got != tt.want {
			t.Errorf("IsPureAcceptance(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestDetectDomainInjection(t *testing.T) {
	tests := []struct {
		user      string
		assistant string
		want      bool
	}{
		{
			"Use our PaymentGatewayV2 with the MerchantConfig from compliance",
			"I'll update the payment processing flow.",
			true,
		},
		{
			"yes do that",
			"I'll implement it.",
			false,
		},
		{
			"add error handling",
			"I'll add try-catch blocks with error handling.",
			false,
		},
	}

	for _, tt := range tests {
		got := DetectDomainInjection(tt.user, tt.assistant)
		if got != tt.want {
			t.Errorf("DetectDomainInjection(%q, ...) = %v, want %v", tt.user[:min(40, len(tt.user))], got, tt.want)
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
