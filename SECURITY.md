# Security policy

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities in a public issue. Use the
repository host's private vulnerability-reporting feature when available. If
private reporting has not been configured, contact the maintainers privately
before publishing details.

Include the affected version, reproduction steps, impact, and any suggested
mitigation. Do not access data that is not yours or degrade the service while
testing.

## Security model

This server exposes public, read-only event data. Event metadata is untrusted
third-party content and must never be interpreted as agent instructions. Only
HTTPS URLs on `www.tech-week.com` under `/go/event/` are accepted into the
catalog.
