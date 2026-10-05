# SECURITY-HUNT
Load when: weekly rotation, or a change touches messaging, network, storage of keys, or the DOM.
Files: background.js, content-scripts/content.js, options.js, popup.js, content-scripts/probe.js

Hunt for a concrete way a page, another extension, a network answer or a stored value makes
SkipStream do something the user did not ask for. Name who attacks, what they send, and what
happens. A missing hardening step without an attack path is severity low.

- Messages: every `runtime.onMessage` and `window.addEventListener('message')` handler.
  Is the sender or `event.origin`/`event.source` checked before acting? Can a page reach a
  handler that sends keys or deletes data?
- Host checks: a host name tested with `.includes()`, `.indexOf()`, `startsWith` or a regex
  without anchors instead of `new URL(x).hostname ===` (LESSONS 5 Oct, os-140).
- Secrets: a token, key or password sent to a host that comes from a server answer, a page
  or user text without an allowlist (audit H14 pattern).
- DOM: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, attribute URLs that
  can be `javascript:`. The rule is `createElement` + `textContent`.
- Data leaving the browser: a request to a host that PRIVACY.md does not name, or more fields
  than PRIVACY.md lists. The site report must mask tokens (host and path only).
- Storage: keys or logins written to `storage.sync`, to an export without the passphrase, or
  to the cloud.
