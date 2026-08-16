# Apps Script backend — moved

The backend that receives this site's feedback now lives in one place:

**https://github.com/YAL-PJ/apps-script-backend** → `src/feedback-backend.gs`

The copy that used to sit here was a stale snapshot from 2026-05-24. It had no
error-reporting support at all, and it was never the deployed version — so
editing it changed nothing. Four repos each held a different copy; only one was
live. That is why they were consolidated.

## This site's wiring

- `feedback.js` → `FEEDBACK_ENDPOINT`, posts `{ app: 'converttopdf', ... }`
  to the shared `/exec` URL.

The endpoint URL is stable. To change backend behaviour, edit and deploy from
the canonical repo — do not paste code into the Apps Script editor by hand.
