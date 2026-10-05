# Writing rules (ASD-STE100 style)

Identical copy in both repos. Written 5 Oct 2026. Source: Simplified Technical English
(ASD-STE100), "STE-flavoured" mode for prose (github.com/danyuchn/asd-ste100-skill).
Use these rules for README, PRIVACY, TESTING, store text, PR bodies and knowledge files.

## Why

The owner reads every document and has no coding background. Many users read English as a
second language. Short, plain sentences cause fewer mistakes than clever ones.

## Rules

1. Use the active voice. Say who does the action ("SkipStream sends", not "is sent").
2. Write one instruction in one sentence.
3. Keep procedure sentences to 20 words or fewer.
4. Keep description sentences to 25 words or fewer.
5. Do not use semicolons. Make two sentences.
6. Use no more than 3 nouns in a row ("history sync button" is the limit).
7. Use one term for one thing. Do not change the term to sound varied.
8. Use a numbered list for 3 or more steps in a sequence.
9. Keep "may" and "might" when something is not certain. Do not promise what code cannot do.
10. Put the action first in a procedure step ("Click Save", not "The Save button must be clicked").
11. Give the real name of a button or setting, in the same words as the screen.
12. Write numbers as digits with their unit ("20 seconds", "300 videos").

## Terms used in openskip

- **skip times**: the start and end of an intro, recap, credits or preview.
- **source**: a service that gives skip times (IntroDB, TheIntroDB, SkipDB, AniSkip, Anime Skip).
- **resume**: continue a video from the saved position.
- **Settings**: the options page. **popup**: the toolbar window.

## Check before a PR

- Read each sentence once. If it has two actions, split it.
- Search for ";" in the changed prose. There must be none.
- Every claim about the code must match the code. Every claim about data must match PRIVACY.md.
