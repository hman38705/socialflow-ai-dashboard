# Security Policy

## Supported Versions

We currently support the following versions of SocialFlow AI Dashboard:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please do not report it publicly. Instead, please report it via one of the following methods:

1. **Email**: Send an email to [security@socialflow.ai](mailto:security@socialflow.ai).
2. **GitHub Private Advisory**: If you are a GitHub user, you can use the [Private Vulnerability Reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-alerts/reporting-a-vulnerability-in-a-repository) feature on this repository.

### What to include in your report

Please include as much information as possible to help us reproduce the issue, including:

- A description of the vulnerability.
- Steps to reproduce the issue.
- Potential impact of the vulnerability.
- Any suggested fixes or mitigations.

## Response Timeline

We take security seriously and will respond to your report within 48-72 hours. We will keep you updated on the progress of our investigation and any necessary fixes.

## Disclosure Policy

We follow a coordinated disclosure policy. We ask that you give us a reasonable amount of time to investigate and fix the vulnerability before disclosing it publicly. Once a fix is available, we will publish a security advisory and credit the researcher (if desired).

## Admin Audit Log

Administrative actions that change state are recorded in an audit log so that operators and auditors can reconstruct who did what, and when. The following admin actions must produce an audit entry:

- Creating, updating, or deleting users and their roles or permissions.
- Changing organization or workspace settings, including security and integration configuration.
- Rotating, revoking, or regenerating API keys, tokens, and webhook secrets.
- Enabling, disabling, or modifying audit, retention, or pruning settings.
- Exporting or deleting data in bulk.

### Recorded Fields

Each audit entry records:

- The acting admin's identity (user ID and, where available, email).
- The action performed and the target resource type and identifier.
- A timestamp of when the action occurred.
- The originating request context (such as source IP address and user agent).
- The outcome of the action (success or failure).
- A before/after summary of the changed fields, with sensitive values redacted as described below.

### Redaction Rules

Sensitive values are redacted before an audit entry is stored. Fields whose names indicate credentials or payment data — including `password`, `token`, `cardNumber`, `cvv`, and `secret` — are replaced with the literal string `[REDACTED]`. Redaction is applied recursively to nested objects and arrays so that sensitive values are never persisted in cleartext, even when nested inside request payloads.

### Storage and Retention

Audit entries are stored in the application database alongside other operational records. Retention and pruning of audit entries follow the policy described in [the retention and pruning policy](backend/docs/retention-pruning-policy.md); refer to that document for the authoritative retention windows and pruning behavior.

## Resource Exhaustion Controls

### SSE Ticket Map Cap and TTL Sweep

The SSE ticket store is a bounded in-process structure. It enforces a maximum number of entries (`SSE_TICKET_MAP_CAP`) and expires tickets after a fixed TTL, with a periodic sweep removing expired entries. The default cap and TTL values are configured in the ticket service implementation at [`backend/src/services/SSETicketService.ts`](backend/src/services/SSETicketService.ts) (see also [`backend/src/services/sseTicketService.ts`](backend/src/services/sseTicketService.ts)). The sweep interval timer is unref'd, so it does not keep the process open.
