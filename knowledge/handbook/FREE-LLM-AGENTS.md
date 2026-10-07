# Free LLM agents: what makes them answer

Generic lessons from patch-factory packets T1, V1 and V2 (6-7 Oct 2026). Same file in openskip.
Each repo's own records hold the detail; this is the short form.

## Transport before prompts

- Most free-seat failures are format, not judgement: broken or cut-off JSON, a 404 that stops
  the seat, a budget too small. Ask for JSON mode on every call, give reasoning models a low
  effort and room to answer (about 8000 output tokens), and drop a refused optional field once.
- A provider's model list is a catalogue, not an entitlement. A tiny real request is the only
  proof a key can use a model. Treat 404 and 410 as "next model", and remember it for the run.
- Give a refused reply one repair turn that quotes the exact refusal. Never more than one.
- Parse the last balanced JSON object, outside think blocks and code fences, before giving up.

## Answers you can trust

- Make every finding quote a line of the file it cites, then check the quote. A finding whose
  quote is not there is a guess; drop it and count it in the comment.
- Make every verdict cite evidence the job supplied (a run id, an issue number, a path). Drop
  uncited verdicts before counting votes.
- Score agents against an answer key the owner already checked before giving them work that
  writes anything. Give low scorers smaller jobs.

## Load and noise

- Free tiers are shared by every job at once. Run heavy jobs one at a time on a schedule, never
  as a burst of dispatches.
- One comment per job, edited in place; one standing issue per failing workflow, closed by the
  next green run.
- Ask for caveman-style output: short plain words, no filler, fixed length limits.

## Reading results

- A fetch tool can truncate a long page. Count from the API with small pages, and check a
  surprising count twice before building on it.
