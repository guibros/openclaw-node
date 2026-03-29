---
id: security
version: 1.0.0
tier: universal
paths: ["**/*"]
priority: 100
tags: ["security", "safety"]
---

# Security Standards

- NEVER hardcode API keys, passwords, tokens, or secrets in source code. Use environment variables or secret managers.
- Validate all external input at system boundaries (user input, API responses, file reads, URL parameters).
- Never use `eval()`, `Function()`, or equivalent dynamic code execution on untrusted input.
- Sanitize data before inserting into SQL queries, HTML templates, shell commands, or file paths. Use parameterized queries and template engines.
- Never log sensitive data (passwords, tokens, PII). Redact or mask before logging.
- Use HTTPS for all external communication. Verify TLS certificates.
- Apply principle of least privilege — request only the permissions and scopes actually needed.
- Never commit `.env` files, private keys, or credential files to version control.
