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
One stop on a walk: at most one piece of code the agent quotes, plus what it says about it. Steps are not annotations; annotations are only ever yours.
_Avoid_: Stop, agent annotation, agent comment

**Proposal**:
A step in which the agent says what it intends to change and asks for your approval.
_Avoid_: Plan step, suggestion, change request

**Ref**:
Another place in the code a step points to, besides its own, worth seeing alongside it.
_Avoid_: Citation, related location, link

**Approval**:
Your agreement to a proposal as it currently stands. It carries no meaning of its own beyond that; what a missing approval means is up to your response and the agent.
_Avoid_: Verdict, sign-off, accept

**Response**:
What you write back to the agent on one step of a walk, proposal or not.
_Avoid_: Note, reply, comment, annotation

**Review**:
Every approval and response you've given on the current walk. It belongs to the walk, not to the session.
_Avoid_: Feedback, verdicts, session
