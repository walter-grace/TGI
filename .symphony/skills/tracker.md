# Tracker skill (generic)

Interact with the source ticket tracker. Works for Trello, Jira, Linear, GitHub, etc.

- **Post comments**: Use `tracker_comment` tool to post progress, plans, and summaries.
- **Transition state**: Use `tracker_transition` to move the ticket (in_progress, review, done, failed, blocked).
- **Checklist**: Use `tracker_add_checklist_item` to add new items when the task requires it. Use `tracker_check_item` to mark items complete — only check an item (checked: true) after you have completed the work for that item. Never check before doing the work.

Always post a plan as a comment before starting work. Post a summary when done.

