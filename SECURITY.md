# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues or pull requests.**

Instead, use [GitHub's private vulnerability reporting](https://github.com/unerr-ai/unfade/security/advisories/new).

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Impact assessment

### Response Timeline

- **Acknowledgment:** Within 72 hours
- **Status update:** Within 1 week
- **Fix target:** Within 30 days for critical issues

## Threat Model

Unfade is a **local-first** tool. All data stays on your machine. There are no cloud services, no accounts, no network calls.

### In Scope

- Local file permission issues on `.unfade/` directory
- Path traversal in file operations
- Command injection in shell hook capture
- Malicious JSONL event file parsing

### Out of Scope

- Issues requiring physical access to the machine
- Vulnerabilities in third-party dependencies (report upstream)

## Disclosure

We follow coordinated disclosure. Credit is given to reporters in release notes.
