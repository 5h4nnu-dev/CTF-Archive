---
title: "Towel on the Sunbed"
description: "A Ponzi-style rewards app checks the daily claim cooldown and writes the reward as separate steps. Sending parallel claim requests wins the race, reaches Whale tier, and unlocks the vault flag."
difficulty: "Easy"
tags: ["TryHackMe", "Hacker Holidays", "Web", "Race Condition", "TOCTOU", "Business Logic", "Burp Suite"]
date: "2026-08-03"
---

## Overview

Towel on the Sunbed is the Day 8 room from TryHackMe's Hacker Holidays 2026 series. The target is a small rewards application, "Ponzi Portfolio", where users can register, claim a daily PONZI reward, and open a Whale Vault once their balance reaches 150. The daily claim is supposed to be limited by a 24-hour cooldown, but the check and the write are not atomic. By sending several `/claim` requests in parallel on a fresh session, multiple requests pass the cooldown check before any of them commits the new state.

The local room folder at `/run/media/shannu/KALI/home/shannu/learn/towelOnTheSunBed` was empty at the time of writing, so this walkthrough is based on published writeups and the room description. The flag is corroborated by at least two independent public sources. The post date is inferred from the Hacker Holidays Day 8 release schedule because there was no local completion evidence. Screenshots are credited in References; the diagram is original.

![Diagram of the TOCTOU race condition in the claim flow](/assets/screenshots/towelonthesunbed/race-condition.svg)

## Room Information

| Field | Value |
|-------|-------|
| Platform | TryHackMe — Hacker Holidays 2026, Day 8 |
| Room | Towel on the Sunbed |
| Difficulty | Easy |
| Category | Web / Business Logic |
| App | Ponzi Portfolio — rewards dashboard |
| Vulnerability | Race condition / TOCTOU on daily claim |
| Key endpoints | `/auth/register`, `/claim`, `/dashboard/api/me`, `/vault` |
| Claim reward | +50 PONZI per successful claim |
| Vault threshold | 150 PONZI (Whale tier) |
| Flag | `THM{t0w3l_0n_th3_sunb3d_d0ubl3_sp3nt}` |

## Application Flow

The application presents a simple login/register flow. After creating an account, the dashboard shows a balance, a claim button, and a locked vault.

![Login page for the Ponzi rewards application](/assets/screenshots/towelonthesunbed/login.png)

A normal claim adds 50 PONZI to the balance. After the first claim, the UI reports that the daily reward has already been claimed and the cooldown prevents another claim.

![Dashboard after a normal claim, showing balance and cooldown](/assets/screenshots/towelonthesunbed/claim.png)

From the client-side logic described in public writeups, the important pieces are:

```javascript
WHALE_THRESHOLD = 150
POST /claim   -> +reward PONZI, gated by a 24h cooldown
GET  /vault   -> returns the flag if balance >= 150
GET  /dashboard/api/me -> {balance, tier, canClaim, secondsUntilClaim, ...}
```

One honest claim yields 50, so reaching 150 should take three days. The bug is that "can claim now" is checked before the claim is recorded.

## The Vulnerability — TOCTOU

A time-of-check to time-of-use (TOCTOU) race condition happens when a program checks a condition and later acts on it, but the state can change between those two steps. Here, the server roughly does:

1. Read the account state.
2. Check whether the cooldown has expired / `canClaim` is true.
3. Credit the reward.
4. Write the new cooldown timestamp.

If two requests hit step 2 before either request reaches step 4, both see `canClaim=true`. Both proceed to credit the reward.

This is not a cryptography problem and not an authentication bypass. It is a business-logic concurrency bug: the rule exists, but it is not enforced atomically.

## Exploitation with Burp Suite

The cleanest way to trigger the race is to capture a single `/claim` request for a fresh account, then replay it in parallel.

1. **Create a fresh account.** A used account already has the cooldown committed, so the race window is gone.
2. **Capture the claim request.** Click claim, intercept the `POST /claim` request in Burp Proxy, and drop the browser-initiated request so it does not consume the window.
3. **Send to Repeater and duplicate.** Add the request to a Repeater group and duplicate it around 10 times. You only need three successful claims, but extra parallel requests increase the odds.
4. **Use last-byte sync.** In Repeater group send options, use last-byte synchronization so the requests are released as close together as possible.
5. **Send the group.** Inspect the responses. Some requests may be rejected, but several should return a successful reward.

![Captured claim request in Burp Suite](/assets/screenshots/towelonthesunbed/burp-capture.png)

![Duplicated claim requests in a Burp Repeater group](/assets/screenshots/towelonthesunbed/repeater-group.png)

![Responses showing multiple successful rewards](/assets/screenshots/towelonthesunbed/race-reward.png)

After refreshing the dashboard, the balance should be at or above 150, which upgrades the account to Whale tier and unlocks the vault.

## The Vault

With the threshold reached, request the vault endpoint or open the vault page in the UI:

```bash
curl -s -b cookies.txt http://TARGET:3000/vault
```

The response includes the flag:

```json
{"message":"Welcome to the Whale Vault.","flag":"THM{t0w3l_0n_th3_sunb3d_d0ubl3_sp3nt}","balance":250}
```

![The Whale Vault revealing the flag](/assets/screenshots/towelonthesunbed/vault.png)

## Flag

| Flag | Value |
|------|-------|
| Vault flag | `THM{t0w3l_0n_th3_sunb3d_d0ubl3_sp3nt}` |

## Commands / Workflow Used

| Step | Action | Purpose |
|------|--------|---------|
| 1 | Register a new account | Start with `canClaim=true` and zero balance |
| 2 | Capture `POST /claim` in Burp Proxy | Obtain the exact authenticated claim request |
| 3 | Send to Repeater, duplicate \~10 times | Prepare parallel claim attempts |
| 4 | Enable last-byte sync and send group | Release requests nearly simultaneously to hit the race window |
| 5 | Refresh dashboard / `GET /dashboard/api/me` | Confirm balance reached Whale tier |
| 6 | `GET /vault` | Retrieve the flag |

## Lessons Learned

**Business rules need atomic enforcement.** A cooldown check in application code is not enough if the read and write are separate operations. Use a database transaction, row lock, unique constraint, or atomic compare-and-set.

**Fresh state matters for race testing.** Once the cooldown was written, the window closed. Testing race conditions often requires resetting to the vulnerable precondition.

**Last-byte sync is a practical race primitive.** Burp Repeater's group send with last-byte synchronization makes parallel-request testing easy without writing a custom script.

**"Only once" features are common race targets.** Coupons, sign-up bonuses, votes, withdrawals, invite redemptions, and daily claims should all be tested for idempotency and concurrency.

**The UI is not the authority.** The browser button became disabled after claim, but the server-side endpoint was the real decision point. Always test the API directly.

## References

- [TryHackMe — Towel on the Sunbed (Hacker Holidays 2026, Day 8)](https://tryhackme.com/room/hh-towelonthesunbed-61271709)
- [TryHackMe — Hacker Holidays](https://tryhackme.com/hackerholidays)
- [Kevinovitz — Hh towelonthesunbed 61271709](https://kevinovitz.github.io/TryHackMe_Writeups/hh-towelonthesunbed-61271709/hh-towelonthesunbed-61271709/) — source of the screenshots used in this post
- [Lorenzo Regalado — TryHackMe Hacker Holidays Walkthrough](https://hackernoon.com/tryhackme-hacker-hollidays-walkthrough)
- [PortSwigger — Race conditions](https://portswigger.net/web-security/race-conditions)
- [OWASP — Time-of-check Time-of-use (TOCTOU) Race Condition](https://cwe.mitre.org/data/definitions/367.html)
