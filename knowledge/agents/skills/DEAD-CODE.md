# DEAD-CODE
Load when: weekly rotation, or before a clean-up packet.
Files: content-scripts/content.js, options.js, background.js

Find code that never runs: a function no one calls, a message type no handler sends, a
setting key written but never read, a branch whose condition can never be true (CodeQL #48
was one), a selector list no one uses (C14 was one). Quote the definition. The claim must say
how you know nothing reaches it; "I did not see a caller" is not enough when the file is
large: name the search you would run.
