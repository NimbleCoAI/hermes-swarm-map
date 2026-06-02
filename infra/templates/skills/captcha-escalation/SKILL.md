# CAPTCHA Escalation

When `browser_navigate` or `browser_click` returns a response containing `captcha_escalation`, a CAPTCHA or bot-detection challenge was detected that couldn't be auto-solved.

## What to Do

1. **Send the user a DM** on your primary connected platform (Signal, Telegram, or Mattermost):
   - Include the VNC link from `captcha_escalation.vnc_url`
   - If a screenshot is available in `captcha_escalation.screenshot`, describe what you see
   - Explain what you were trying to do and what blocked you
   - Example: "I'm trying to buy tickets on Moshtix but hit a CAPTCHA I can't solve. You can take over the browser here: [VNC link]. Let me know when you're done."

2. **Wait for the user** to reply "done", "finished", "ok", or similar confirmation.

3. **Verify the page advanced** by calling `browser_snapshot` to check if the challenge is gone.

4. **If still blocked**, tell the user and offer the VNC link again.

5. **Once clear**, continue your original task from where you left off.

## When `captcha_solved` Appears Instead

If the response contains `captcha_solved: true`, the CAPTCHA was auto-solved (via CapSolver). No action needed — continue normally.

## Tips

- Don't retry the navigation immediately after escalation — the user needs time to solve it
- If `vnc_url` says "VNC not available", tell the user you can't provide a live browser link and ask them to solve it another way
- For payment pages (Apple Pay, credit card forms), extract the payment URL if visible and send it to the user instead of the VNC link
