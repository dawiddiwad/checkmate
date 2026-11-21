# Harbor Rentals

Harbor Rentals lets depot staff manage equipment reservations. The Quay and Ridge share the same rental policy. Each preview starts with a small seeded catalog and reservations in several states. The calendar data is synthetic and uses dates in March and April 2027. Use ISO dates. Staff can change the preview data.

## Reservation desk

The browser desk is at `/`. You can filter by depot or reservation status, open a booking, and download CSV. The list and export must use the same filters. The CSV has five columns: ID, customer, asset, depot, and status. Names with punctuation must remain one field. When no reservations match, the desk shows an empty state and disables download.

## API

Endpoints return JSON unless noted. Money values are integer cents. Use the catalog and booking list to choose real preview IDs.

| Endpoint                        | Parameters or body                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/assets`               | Optional `q`, `depot`. Search is case-insensitive and ignores surrounding whitespace.                                                                  |
| `GET /api/bookings`             | Optional `depot`, `status`, `page`, `size`. Filter, sort by ID, then paginate. `total` covers all matches. Pages start at 1.                           |
| `GET /api/bookings/:id`         | Full record, including channel, pickup note, and deposit.                                                                                              |
| `GET /api/bookings/:id/history` | Actions in order, using `booked`, `rescheduled`, `cancelled` and `returned` for those actions.                                                         |
| `GET /api/export`               | Same filters as the desk. Returns CSV.                                                                                                                 |
| `GET /api/availability`         | `asset`, `from`, `to`. Count the remaining stock. Confirmed and checked-out bookings block their rental dates. Cancelled and returned bookings do not. |
| `GET /api/quote`                | `asset`, `from`, `to` and optional `member=true`, `coverage=annual`. Returns `rentalCents` and `depositCents`.                                         |
| `PATCH /api/bookings/:id`       | JSON `{ "from": "...", "to": "..." }`. An optional `note` replaces the pickup note. An omitted note leaves it alone.                                   |
| `POST /api/bookings/:id/cancel` | No body. Cancels a confirmed reservation and returns its full recorded deposit as `refundCents`, regardless of booking channel.                        |

Pickup dates are inclusive. Return dates are exclusive. Valid rental periods are 1–14 days. The catalog lists price per day and deposit. Saturdays and Sundays add 500 cents per day. The member discount is 10% of the regular rental subtotal, rounded to cents. It does not apply to weekend surcharges. Annual coverage waives the deposit at both depots. Only confirmed reservations can be moved or cancelled.
