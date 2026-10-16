# Review dashboard

Express serves the static HTML, JavaScript, and CSS in `public/`. The UI
starts audits, polls worker progress, filters findings by category, and
updates review status. Render untrusted page/model content with `textContent`.

Findings include an annotated screenshot when the optional Playwright browser
runtime can render the affected page. Red outlines mark the matching XPath or
the closest text block found from the issue evidence. Captures are best-effort;
the audit and finding remain available when a page cannot be rendered.
