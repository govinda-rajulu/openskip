# Audit status, 29 Sep 2026

Sources: [AUDIT-1-2026-09-29.md](AUDIT-1-2026-09-29.md) (C, B, O, P, S, W, D findings) and
[AUDIT-2-2026-09-29.md](AUDIT-2-2026-09-29.md) (H1 to H27). Status comes from packet commit
messages and tests, not from a re-audit. Re-read the code before relying on a row.

| Status | Findings |
|---|---|
| Fixed on main (packets A to D, #64) | C1, C2, C4, C6, C8, C10, B1 to B6, O1, O2, P1, S1, S2, W1 to W8, H2, H3, H7, H14, H17, H19, H20, H26, H27 |
| In PR #73 (packet H), not merged | H1, H4, H5, H9 to H13, H15, H16, H18, H21, H22, H24, C5, C9, O3, P2 |
| CodeQL alerts, PR #71 (packet G) | code-scanning fixes, also removes dead SKIP_SELECTORS (C14); alerts 14, 29, 31, 42 dismissed with reasons |
| Partly fixed | C12: 2 of the 5 `console.warn` calls remain on main |
| In the H23 PR (1 Oct), not merged | H23: Firefox data-collection declaration (blocks next AMO upload) |
| In the 1.11.0 release PR (3 Oct) | H23b (technicalAndInteraction optional and checked), D1 (PRIVACY.md), D2 (release doc file counts), X2 (iframe 5 s cutoff), X3 (import replaced history) |
| Found 3 Oct, partly fixed | X1: cross-device sync broken since c89ec20; 1.11.0 links browsers via backup, login in 1.12.0 |
| Deferred, not started | C3, C7, C11, C13, O4, H6, H8, H25 |
