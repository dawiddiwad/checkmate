# Open PR 27 · Bulk reschedule for depot staff

Depot staff need to move multiple confirmed equipment reservations together.

- The reservation desk links to a bulk form. One line contains the booking ID, new pickup date and new return date.
- `POST /api/bulk-reschedule` accepts JSON `{ "changes": [{ "id": "...", "from": "...", "to": "..." }] }`. A batch has 1–10 distinct bookings.
- A valid batch saves each change and writes a reschedule action to each history. An invalid booking, duplicate booking, or invalid date rejects the whole batch and leaves every booking unchanged.
- The PR shares reservation handling between the desk, bulk flow, and API routes. Existing staff workflows and the rules in `PRODUCT.md` still apply.

Both previews are deployed. Review the change in the PR build and compare with the base build when you need to determine whether an issue is new.
