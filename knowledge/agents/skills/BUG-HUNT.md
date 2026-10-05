# BUG-HUNT
Load when: weekly rotation, or before a release packet.
Files: content-scripts/content.js, background.js, options.js, popup.js

Hunt for behaviour the user would notice: a skip that does not happen, a wrong resume
position, lost history, a setting that does not stick. Each finding names the steps.
These bug shapes were real in this repository (knowledge/LESSONS.md):

- A browser timer called as a method of a plain object (`T.setTimeout(f)`) throws in every
  browser; node:vm does not, so tests stayed green for four releases.
- An `await` between reading state and using it, with no check that the page or video is
  still the same (late answers land on the next episode).
- A `Promise` used as a condition without `await` (always truthy).
- Read-modify-write of one storage object from two places at once (one write is lost).
- Object keys that look like integers are enumerated first, in numeric order.
- A retry helper that retries final answers (406 quota, 4xx) or never retries 429/5xx.
- A `const` read before its line runs (TDZ): the whole page dies on load.
- `fetch` answers used without `r.ok`; missing keys giving `NaN`.
- Listeners and timers added per video and never removed.
- A shown choice that does not come from what the code reads.
