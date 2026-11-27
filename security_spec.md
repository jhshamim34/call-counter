# Security Specification — Call Counter

## 1. Data Invariants
1. Every document in `/callCounters/{userId}` belongs strictly to a single verified user (`request.auth.uid == userId` and `request.auth.token.email_verified == true`).
2. Document IDs `{userId}` must match `^[a-zA-Z0-9_\-]+$` and stay within 1–128 characters.
3. All seven counter fields (`totalCallsAttempted`, `connectCall`, `activeCall`, `followupCall`, `busy`, `switchedOff`, `callNotReceived`) must be non-negative integers bounded between `0` and `100000000`.
4. `userId` and `createdAt` are immutable after document creation.
5. `createdAt` on create and `updatedAt` on create/update must equal `request.time`.
6. Collection listing (`list`) and document deletion (`delete`) are explicitly denied.

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Create**: `request.auth == null` writing to `/callCounters/user123`.
2. **Unverified Email**: `request.auth.token.email_verified == false` writing to `/callCounters/user123`.
3. **Cross-User Read**: User A (`uid: "userA"`) reading `/callCounters/userB`.
4. **Cross-User Write**: User A (`uid: "userA"`) writing `/callCounters/userB`.
5. **Identity Spoofing**: User A creating `/callCounters/userA` with `userId: "userB"`.
6. **Ghost Field / Shadow Update**: Updating `/callCounters/userA` with an extra field `{ isAdmin: true }`.
7. **Collection Scraping (`list`)**: Authenticated user listing `/callCounters`.
8. **Negative Counter Poisoning**: Setting `busy: -5`.
9. **Type Poisoning**: Setting `connectCall: "999"` (string instead of integer) or `1.5` (float).
10. **Immutable Field Tampering**: Updating `createdAt` or `userId` on an existing document.
11. **Client Timestamp Forgery**: Creating or updating with a forged `updatedAt` not equal to `request.time`.
12. **ID Poisoning**: Accessing `/callCounters/bad$id!with*invalid@chars` or >128 chars.
