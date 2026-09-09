# Contributing

Thanks for helping improve SF Tech Week MCP.

## Development

1. Install Node.js 22 or newer.
2. Run `npm install`.
3. Run `npm run check` before opening a pull request.
4. Start the local Worker with `npm run start`.

Keep tools read-only unless a proposal clearly documents the new trust and
authorization boundaries. Treat all scraped event fields as untrusted data.
Never replace a Tech Week URL with an inferred or unverified destination URL.
Calendar integrations belong at the calling-agent layer; do not send private
calendar data to this public event-search service.

Do not include secrets, attendee data, private invitations, or access tokens in
issues, tests, fixtures, or pull requests.
