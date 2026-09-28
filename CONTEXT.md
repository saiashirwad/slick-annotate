# Tandem

A VS Code extension for reading code deeply: leaving free-text annotations as you go and copying them all out at once (typically to paste into a coding agent), and following walks through the code that an agent writes, answering it as you go. Reviewing code and studying it are treated as the same activity.

## Language

### Annotations

**Annotation**:
A free-text note attached either to a selected range of code or to a whole file.
_Avoid_: Comment, note, remark

**Snippet**:
The exact code that was selected when a range annotation was written, kept with it as it was at that moment.
_Avoid_: Excerpt, quote

**Thread**:
All annotations attached to the same place, in the order they were written.
_Avoid_: Conversation, discussion

**Session**:
Every annotation written since the session was last cleared. There is only ever one.
_Avoid_: Study session, review, batch

### Walks

**Walk**:
A guided walk through part of the codebase, written by an agent to explain something, propose a change, or both. There is only ever one, and it remembers which step you're on, so you can wander off to read other code and come straight back.
_Avoid_: Tour, plan, walkthrough, guide, lesson

**Step**:
One question or decision on a walk: what the agent says, together with the ordered places in code that explain it. Steps are not annotations; annotations are only ever yours.
_Avoid_: Stop, agent annotation, agent comment

**Place**:
A location in code that a step points to, optionally quoting a particular passage. A step may have several places or none; its first place is where focusing it takes you.
_Avoid_: Ref, primary file, citation

**Note**:
Your input on one step: text and, when the walk asks for it, a labeled check. A check means what its label and your text say, not a universal approval or rejection.
_Avoid_: Response, verdict, annotation

**Review**:
All your notes on the current walk. It belongs to the walk, not to the session.
_Avoid_: Feedback, verdicts, session
