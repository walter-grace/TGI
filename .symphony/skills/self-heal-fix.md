# Self-Heal Fix skill

You are fixing an issue detected by the **self-healing monitor system**. The card description contains everything you need: the repo URL, monitor failure output, relevant code paths, and suggested fix.

## Workflow

### Step 0 — Check the board for context

Call `tracker_board_snapshot` first. Check if this issue has already been fixed by another agent (look in Done list for similar cards). If a fix already exists, post a comment saying "Already fixed by card X" and move to **done**.

### Step 1 — Set up the repo

1. Clone the repository from the **Repository** section in the card description.
2. Install dependencies.
3. Create a branch: `git checkout -b self-heal-fix/<short-description>`

### Step 2 — Reproduce the issue

1. Run the failing monitor script listed in the card:
   ```
   bash .self-heal/monitors/<monitor_name>.sh
   ```
2. Confirm it fails with the same error described in the card.
3. If it passes now (issue was transient), post a comment saying "Issue no longer reproduces" and move to **done**.

### Step 3 — Diagnose

1. Read the **Relevant Code** and **Failure Output** sections.
2. Read the actual source files mentioned.
3. Identify the root cause — don't just fix the symptom.

### Step 4 — Fix

1. Make the minimal change needed to fix the root cause.
2. Run the failing monitor again — it must pass.
3. Run the full test suite to ensure no regressions.
4. If the fix requires updating the monitor itself (e.g., the monitor's expectation was wrong), update it too.

### Step 5 — Commit & PR

1. Stage and commit:
   ```
   git add -A
   git commit -m "fix: <what was fixed>

   Detected by self-healing monitor: <monitor_name>
   Failure: <one-line summary of the error>"
   ```
2. Push and create a PR:
   ```
   git push -u origin self-heal-fix/<short-description>
   ```
3. Post the PR link as a comment on the Trello card.

### Step 6 — Verify & complete

1. Run ALL monitors (not just the failing one) to confirm nothing else broke:
   ```
   for monitor in .self-heal/monitors/*.sh; do bash "$monitor"; done
   ```
2. Post a summary comment:
   ```
   ## Fix Applied

   **Root cause:** <explanation>
   **Fix:** <what was changed>
   **Monitor:** <monitor_name> now passes
   **PR:** <link>
   **All monitors passing:** yes/no
   ```
3. Transition to **review**.

## Rules

- **Reproduce first.** Never push a fix without confirming the original failure.
- **Minimal changes.** Fix the issue, nothing else. No drive-by refactors.
- **Monitor must pass.** The specific monitor that detected the issue must pass after your fix.
- **No regressions.** Run the full test suite and all other monitors before completing.
- **Link the PR.** Always post the PR URL on the card so reviewers can find it.
