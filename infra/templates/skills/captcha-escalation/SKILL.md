# CAPTCHA Escalation

When `browser_navigate` or `browser_click` returns a `bot_detection_warning`, call the `captcha_solve` tool to attempt automated solving.

## Flow

1. **Call `captcha_solve`** — this tries CapSolver auto-solve if configured, or returns VNC escalation info.

2. **If `captcha_solved: true`** in the response — the CAPTCHA was auto-solved. Call `browser_snapshot` to verify the page advanced, then continue your task.

3. **If `captcha_escalation`** in the response — auto-solve failed or isn't available. Send the user a DM on your primary connected platform:
   - Include the VNC link from `captcha_escalation.vnc_url`
   - If a screenshot is available in `captcha_escalation.screenshot`, describe what you see
   - Explain what you were trying to do and what blocked you
   - Example: "I'm trying to buy tickets on Moshtix but hit a CAPTCHA I can't solve. You can take over the browser here: [VNC link]. Let me know when you're done."

4. **Wait for the user** to reply "done", "finished", "ok", or similar confirmation.

5. **Verify the page advanced** by calling `browser_snapshot` to check if the challenge is gone.

6. **If still blocked**, tell the user and offer the VNC link again.

7. **Once clear**, continue your original task from where you left off.

## Tips

- Don't retry the navigation immediately after escalation — the user needs time to solve it
- If `vnc_url` says "VNC not available", tell the user you can't provide a live browser link and ask them to solve it another way
- For payment pages (Apple Pay, credit card forms), extract the payment URL if visible and send it to the user instead of the VNC link
