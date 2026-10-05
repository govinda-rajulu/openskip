# PERF-HUNT
Load when: weekly rotation, or a report of a slow page or battery drain.
Files: content-scripts/content.js

The content script runs in every frame of every page (`<all_urls>`, `all_frames`).
Anything it does in a frame with no video is waste multiplied by the number of frames.

- MutationObservers on `document` or `body` with `subtree: true`, and what each mutation costs
  (audit H8).
- Intervals and polling that keep running when no video is attached, the tab is hidden or the
  site is switched off.
- Layout-forcing calls (`getBoundingClientRect`, `offsetParent`, `querySelectorAll` over the
  whole page) inside per-mutation or per-frame work without a floor.
- Work repeated for every `timeupdate` that could run once per video.
