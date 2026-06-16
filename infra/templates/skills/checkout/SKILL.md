---
name: checkout
description: Use when asked to buy or purchase something online (tickets, products, bookings) where the flow may need a human for a captcha, a 2FA/SMS code, or a final charge confirmation. Drives an online checkout end-to-end with human-in-the-loop escalation over chat.
version: 1.0.0
author: NimbleCo
license: MIT
metadata:
  hermes:
    tags: [purchase, checkout, browser, human-in-the-loop, tickets]
    related_skills: [captcha-cascade]
---

# Checkout — human-in-the-loop purchasing

Drive an online purchase to completion using the Camofox browser tools, escalating to
the human over chat whenever you hit something you cannot (or must not) do alone.

## Resume check — DO THIS FIRST, EVERY TURN

Before anything else, call `check_pending_escalation`.
- If it returns `status: "found"`, you are resuming. The user's most recent message is the
  answer to `prompt`. Apply it:
  - `code_request` → the message is the code; type it into the page and continue.
  - `confirmation` → continue to submit/charge ONLY if the reply is affirmative (yes / confirm
    / y / yep). Anything else → abort: do not submit, tell the user nothing was charged.
  - `link_handoff` → an affirmative ("done") means the user finished the step; re-read the
    page and continue.
- Re-orient by reading the live browser tab (it is still open from before). Use the browser
  read tools to see the current page state, then proceed from where you left off.
- If it returns `status: "none"`, this is a fresh request — start at step 1.

## The flow

1. **Locate** the item/event (navigate, search).
2. **Select** options — quantity, tier, seats, date.
3. **Fill** purchaser details. Retrieve stored details/payment info via the approved
   credential path (the swarm-tool proxy / `~/.hermes` credential files) — NEVER hardcode or
   ask the user to paste raw card numbers in chat.
4. **Captcha?** Use the `captcha_solve` tool (captcha-cascade). If it cannot solve and returns
   a VNC URL, escalate it: `escalate_to_human(kind="link_handoff", prompt="Please solve the
   captcha here, then reply DONE", payload={"url": <vnc_url>})` and END YOUR TURN.
5. **Need an SMS / 2FA / emailed code?** `escalate_to_human(kind="code_request",
   prompt="Reply with the verification code <site> just sent you")` and END YOUR TURN.
6. **Reach the order review.** Read the exact line items and total from the page.
7. **Confirm the charge — ALWAYS.** `escalate_to_human(kind="confirmation", prompt="Confirm
   this purchase", payload={"line_items": [...], "total": "$NN.NN"})` and END YOUR TURN.
8. **Submit only on an affirmative confirmation.** Never click final pay/submit without having
   received `kind=confirmation` answered affirmatively this purchase.
9. **Report** the outcome: success + confirmation number, or the reason it stopped.

## Hard rules

- **Never submit payment without an affirmative `confirmation` escalation for THIS purchase.**
  This is non-negotiable — it is the one guaranteed human gate.
- After any `escalate_to_human` call, END YOUR TURN. Do not poll, sleep, or loop waiting for a
  reply — the reply arrives as a new message and you resume via the Resume check above.
- On timeout (the user does not reply and a later turn finds no pending escalation but an
  unfinished checkout), report honestly: "timed out waiting for you — nothing was charged."
- Never expose raw credentials or full card numbers in chat.

## Moshtix (worked example, instance #1)

Moshtix ticketing is the first target. Capture concrete selectors/flow notes here as you learn
them (event search → ticket-type select → quantity → checkout → captcha → code → review →
confirm). Treat anything site-specific as notes under this section; the flow above is the
reusable core.
