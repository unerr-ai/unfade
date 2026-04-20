package classifier

import (
	"testing"
)

// T-099: Generic "fix bug" → low score, detailed technical spec → high score
func TestScoreSpecificityGenericVsDetailed(t *testing.T) {
	generic := ScoreSpecificity("fix bug")
	if generic > 0.3 {
		t.Errorf("generic prompt 'fix bug' scored %.3f, want <= 0.3", generic)
	}

	detailed := ScoreSpecificity(
		"Refactor the AuthService to use constructor-based dependency injection " +
			"with an IAuthProvider interface. The JwtTokenService should be injected " +
			"via the constructor, not resolved from a static ServiceLocator. Update " +
			"the unit tests in auth_service_test.ts to use a MockAuthProvider that " +
			"implements the same interface.",
	)
	if detailed < 0.6 {
		t.Errorf("detailed technical spec scored %.3f, want >= 0.6", detailed)
	}

	if generic >= detailed {
		t.Errorf("generic (%.3f) should score lower than detailed (%.3f)", generic, detailed)
	}
}

func TestScoreSpecificityEmpty(t *testing.T) {
	if score := ScoreSpecificity(""); score != 0.0 {
		t.Errorf("empty string scored %.3f, want 0.0", score)
	}
}

func TestScoreSpecificityShortVague(t *testing.T) {
	vague := []string{
		"yes",
		"do it",
		"fix this",
		"ok",
		"help",
		"looks good",
	}
	for _, s := range vague {
		score := ScoreSpecificity(s)
		if score > 0.3 {
			t.Errorf("vague prompt %q scored %.3f, want <= 0.3", s, score)
		}
	}
}

func TestScoreSpecificityTechnicalTerms(t *testing.T) {
	techHeavy := ScoreSpecificity(
		"Add a PostgreSQL migration that creates an index on users.email " +
			"with a UNIQUE constraint, then update the UserRepository.findByEmail " +
			"method to leverage the new index.",
	)
	if techHeavy < 0.5 {
		t.Errorf("tech-heavy prompt scored %.3f, want >= 0.5", techHeavy)
	}
}

func TestScoreSpecificityCodeIdentifiers(t *testing.T) {
	withCode := ScoreSpecificity(
		"Update the handleRequest function in src/server/router.ts to use " +
			"async/await instead of .then() chains. The fetchUserData call on " +
			"line 45 should use try/catch with our custom ApiError class.",
	)
	if withCode < 0.5 {
		t.Errorf("prompt with code identifiers scored %.3f, want >= 0.5", withCode)
	}
}

func TestScoreSpecificityArchitecturePatterns(t *testing.T) {
	archPrompt := ScoreSpecificity(
		"Implement the repository pattern with dependency injection for the " +
			"database layer. Use an interface for the data access and a concrete " +
			"implementation for PostgreSQL.",
	)
	if archPrompt < 0.5 {
		t.Errorf("architecture-pattern prompt scored %.3f, want >= 0.5", archPrompt)
	}
}

func TestScoreSpecificityMediumPrompt(t *testing.T) {
	medium := ScoreSpecificity("Add error handling to the API endpoint with proper HTTP status codes")
	low := ScoreSpecificity("fix it")

	if medium <= low {
		t.Errorf("medium prompt (%.3f) should score higher than low (%.3f)", medium, low)
	}
}

func TestScoreSpecificityRange(t *testing.T) {
	inputs := []string{
		"",
		"ok",
		"fix the bug in auth",
		"Add rate limiting with a sliding window to the /api/login endpoint using Redis sorted sets",
		"Refactor the AuthService to use constructor-based DI with IAuthProvider interface, update JwtTokenService injection via constructor not static ServiceLocator, update unit tests in auth_service_test.ts to use MockAuthProvider implementing the same interface, ensure the PostgreSQL connection pool maxSize is set to 20 and idleTimeout to 30000ms in the config module",
	}

	for _, input := range inputs {
		score := ScoreSpecificity(input)
		if score < 0.0 || score > 1.0 {
			t.Errorf("ScoreSpecificity(%q) = %.3f, must be in [0.0, 1.0]", input[:min(40, len(input))], score)
		}
	}
}

func TestScoreSpecificityMonotonic(t *testing.T) {
	short := ScoreSpecificity("fix bug")
	medium := ScoreSpecificity("Fix the null pointer exception in the user registration handler when email is missing")
	long := ScoreSpecificity(
		"Fix the NullPointerException in UserRegistrationHandler.handleRequest() " +
			"at line 47 of src/handlers/registration.ts. The issue occurs when " +
			"the email field is missing from the request body. Add a Zod schema " +
			"validation check before accessing req.body.email, and return a " +
			"400 Bad Request with a structured error response following our " +
			"ApiError convention from shared/errors.ts.",
	)

	if short > medium {
		t.Errorf("short (%.3f) should not exceed medium (%.3f)", short, medium)
	}
	if medium > long {
		t.Errorf("medium (%.3f) should not exceed long (%.3f)", medium, long)
	}
}

func TestTokenize(t *testing.T) {
	tokens := tokenize("Add error_handling to the AuthService.login method")
	if len(tokens) == 0 {
		t.Fatal("expected tokens")
	}

	has := func(s string) bool {
		for _, tok := range tokens {
			if tok == s {
				return true
			}
		}
		return false
	}

	if !has("error_handling") {
		t.Error("expected 'error_handling' token (underscore preserved)")
	}
	if !has("AuthService") {
		t.Error("expected 'AuthService' token")
	}
}
