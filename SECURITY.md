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

## Resource Exhaustion Controls

### SSE Ticket Map Cap and TTL Sweep

The SSE ticket store is a bounded in-process structure. It enforces a maximum number of entries (`SSE_TICKET_MAP_CAP`) and expires tickets after a fixed TTL, with a periodic sweep removing expired entries. The default cap and TTL values are configured in the ticket service implementation at [`backend/src/services/SSETicketService.ts`](backend/src/services/SSETicketService.ts) (see also [`backend/src/services/sseTicketService.ts`](backend/src/services/sseTicketService.ts)). The sweep interval timer is unref'd, so it does not keep the process open.
