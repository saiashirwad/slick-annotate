# Slick Annotate

A VS Code extension for reading code deeply, leaving free-text annotations as you go, and copying them all out at once (typically to paste into a coding agent). Reviewing code and studying it are treated as the same activity.

## Language

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

**Tour**:
A guided walk through part of the codebase, written by an agent to show you something. There is only ever one, and it remembers which step you're on, so you can wander off to read other code and come straight back.
_Avoid_: Walkthrough, guide, lesson

**Step**:
One stop on a tour: at most one piece of code the agent quotes, plus what it says about it. Steps are not annotations; annotations are only ever yours.
_Avoid_: Stop, agent annotation, agent comment

**Ref**:
Another place in the code a step points to, besides its own, worth seeing alongside it.
_Avoid_: Citation, related location, link
