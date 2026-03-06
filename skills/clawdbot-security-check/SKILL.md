---
name: clawdbot-self-security-audit
description: "Read-only security audit of Clawdbot config: checks gateway exposure, DM policies, credentials, file permissions, and 13 security domains. Use when asked to audit Clawdbot security, check hardening, or find configuration vulnerabilities."
triggers:
  - "run a security check"
  - "audit clawdbot security"
  - "check security hardening"
  - "what vulnerabilities does my clawdbot have"
  - "is my clawdbot secure"
negative_triggers:
  - "audit my smart contracts"
  - "check my code for security bugs"
  - "run a penetration test"
homepage: https://github.com/TheSethRose/Clawdbot-Security-Check
metadata: {"clawdbot":{"emoji":"🔒","os":["darwin","linux"],"requires":{"files":["read"],"tools":["exec","bash"]},"install":[{"id":"read-skill","kind":"skill","name":"clawdbot-self-security-audit","label":"Install security audit skill","bins":["SKILL.md"]}]}}
---

# Clawdbot Self-Security Audit Framework

This skill empowers Clawdbot to audit its own security posture using first-principles reasoning. Rather than relying on a static script, Clawdbot learns the framework and applies it dynamically to detect vulnerabilities, understand their impact, and recommend specific remediations.

> "Security through transparency and self-awareness." — Inspired by Daniel Miessler

## Security Principles

Running an AI agent with shell access requires caution. Focus on three areas:

1. **Who can talk to the bot** — DM policies, group allowlists, channel restrictions
2. **Where the bot is allowed to act** — Network exposure, gateway binding, proxy configs
3. **What the bot can touch** — Tool access, file permissions, credential storage

Start with the smallest access possible and widen it as you gain confidence.

## Trust Hierarchy

| Level | Entity | Trust Model |
|-------|--------|-------------|
| 1 | **Owner** | Full trust — has all access |
| 2 | **AI** | Trust but verify — sandboxed, logged |
| 3 | **Allowlists** | Limited trust — only specified users |
| 4 | **Strangers** | No trust — blocked by default |

## Audit Commands

- `clawdbot security audit` — Standard audit of common issues
- `clawdbot security audit --deep` — Comprehensive audit with all checks
- `clawdbot security audit --fix` — Apply guardrail remediations

## The 13 Security Domains

See [references/audit-checks.md](references/audit-checks.md) for full audit checklists, detection commands, and remediation examples for each domain.

| # | Domain | Severity | Key Config |
|---|--------|----------|------------|
| 1 | Gateway Exposure | Critical | `gateway.bind`, `gateway.auth_token` |
| 2 | DM Policy | High | `dmPolicy`, `allowFrom` |
| 3 | Group Access Control | High | `groupPolicy`, `groups` |
| 4 | Credentials Security | Critical | `~/.clawdbot/credentials/` permissions |
| 5 | Browser Control | High | `browser.remoteControlToken`, `controlUi` |
| 6 | Gateway Bind & Network | High | `gateway.bind`, `trustedProxies`, `tailscale` |
| 7 | Tool Access & Sandboxing | Medium | `restrict_tools`, `mcp_tools`, `workspaceAccess` |
| 8 | File Permissions | Medium | Directory 700, config files 600 |
| 9 | Plugin Trust & Model Hygiene | Medium | `plugins.allowlist`, model selection |
| 10 | Logging & Redaction | Medium | `logging.redactSensitive` |
| 11 | Prompt Injection Protection | Medium | `wrap_untrusted_content`, `mentionGate` |
| 12 | Dangerous Command Blocking | Medium | `blocked_commands` |
| 13 | Secret Scanning Readiness | Medium | `detect-secrets`, `.secrets.baseline` |

## Audit Fix Actions

The `--fix` flag applies these guardrails:

- Changes `groupPolicy` from `open` to `allowlist` for common channels
- Resets `logging.redactSensitive` from `off` to `tools`
- Tightens local permissions: `.clawdbot` directory to `700`, config files to `600`
- Secures state files including credentials and auth profiles

## Priority Checklist

Treat findings in this priority order:

1. **Critical:** Lock down DMs and groups if tools are enabled on open settings
2. **Critical:** Fix public network exposure immediately
3. **High:** Secure browser control with tokens and HTTPS
4. **High:** Correct file permissions for credentials and config
5. **Medium:** Only load trusted plugins
6. **Medium:** Use modern models for bots with tool access

## Access Control Models

### DM Access

| Mode | Description |
|------|-------------|
| `pairing` | Default — unknown senders must be approved via code |
| `allowlist` | Unknown senders blocked without handshake |
| `open` | Public access — requires explicit asterisk in allowlist |
| `disabled` | All inbound DMs ignored |

Slash commands are only available to authorized senders based on channel allowlists. The `/exec` command is a session convenience for operators and does not modify global config.

## Threat Model

| Risk | Mitigation |
|------|------------|
| Shell command execution | `blocked_commands`, `restrict_tools` |
| File and network access | `sandbox`, `workspaceAccess: none/ro` |
| Social engineering / prompt injection | `wrap_untrusted_content`, `mentionGate` |
| Browser session hijacking | Dedicated profile, token auth, HTTPS |
| Credential leakage | `logging.redactSensitive: tools`, env vars |

## Incident Response

### Containment
1. Stop the gateway process — `clawdbot daemon stop`
2. Set gateway.bind to loopback — `"bind": "127.0.0.1"`
3. Disable risky DMs and groups — set to `disabled`

### Rotation
1. Change the gateway auth token — `clawdbot doctor --generate-gateway-token`
2. Rotate browser control and hook tokens
3. Revoke and rotate API keys for model providers

### Review
1. Check gateway logs and session transcripts — `~/.clawdbot/logs/`
2. Review recent config changes — Git history or backups
3. Re-run the security audit — `clawdbot security audit --deep`

## Core Principles

- **Zero modification** — This skill only reads; never changes configuration
- **Defense in depth** — Multiple checks catch different attack vectors
- **Actionable output** — Every finding includes a concrete remediation
- **Extensible design** — New checks integrate naturally

## References

- Official docs: https://docs.clawd.bot/gateway/security
- Original framework: [Daniel Miessler on X](https://x.com/DanielMiessler/status/2015865548714975475)
- Repository: https://github.com/TheSethRose/Clawdbot-Security-Check
- Report vulnerabilities: security@clawd.bot

---

**Remember:** This skill exists to make Clawdbot self-aware of its security posture. Use it regularly, extend it as needed, and never skip the audit.
