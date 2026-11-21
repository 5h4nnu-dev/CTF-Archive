---
title: "The Brochure"
description: "A Byte Lotus resort brochure contains no exploit and no hidden payload — just two deliberate clues. Follow the hotel's Instagram account, inspect who it follows, collect three Base64 fragments from the concierge's posts, join them, and decode the flag."
difficulty: "Easy"
tags: ["TryHackMe", "Hacker Holidays", "OSINT", "SOCMINT", "Instagram", "Base64", "Metadata", "Information Disclosure"]
date: "2026-07-29"
---

## Overview

The Brochure is the Day 0 warmup for TryHackMe's Hacker Holidays 2026 series. It is an OSINT room, not an exploitation room: you receive a resort brochure and are asked to find a flag by following clues that were left in public view.

The brochure points at an Instagram account for the Byte Lotus Resort. The account's posts are deliberately uninteresting, but its following list reveals a second account belonging to the concierge named in the brochure. That account has three posts, each carrying one piece of a Base64 string. Join the pieces in the right order, decode them, and the flag appears.

![Diagram of the OSINT trail from brochure to flag](/assets/screenshots/thebrochure/osint-chain.svg)

The local room folder contained three files: `thebrochure.png`, `attachments-1784426010065.zip`, and `flag`. The ZIP contains only an identically sized copy of the PNG, so there is no extra payload to unpack. The flag file is dated 29 July 2026 at 00:11, shortly after the task ZIP was downloaded at 23:49 on 28 July; that is the basis for the post date.

The brochure image is taken directly from the local room folder. The other screenshots come from published writeups credited in References.

## Room Information

| Field | Value |
|-------|-------|
| Platform | TryHackMe — Hacker Holidays 2026, Day 0 |
| Room | The Brochure |
| Difficulty | Easy |
| Category | OSINT / SOCMINT |
| Points | 30 |
| Task | \"What is the flag?\" |
| Provided files | `thebrochure.png`, `attachments-1784426010065.zip`, `flag` |
| Key accounts | `@thebytelotusresort`, `@veratheconcierge` |
| Main technique | Follow public social connections, split-string recovery, Base64 decoding |
| Flag | `THM{V3r@s_aCC0unt_h4s_b33n_f0und!}` |

The room's storyline says the brochure's hero photo has an \"unmistakable AI fingerprint\" and that the account behind it leads somewhere the hotel never intended. That framing matters: the challenge wants you to treat the image as a starting point for investigation, not as a file to reverse engineer.

## Enumeration — Inspecting the Provided File

The first step with any downloaded task file is to identify it and check whether it contains hidden data.

```bash
file thebrochure.png
```

```text
thebrochure.png: PNG image data, 726 x 934, 8-bit/color RGBA, non-interlaced
```

The supplied ZIP is just a delivery wrapper:

```bash
unzip -l attachments-1784426010065.zip
```

```text
  Length      Date    Time    Name
---------  ---------- -----    ----
  1153790  2026-07-19 07:22   thebrochure.png
---------                     -------
  1153790                     1 file
```

The file inside has the same size as the loose PNG, so nothing is hidden in the archive.

The local PNG was also checked for embedded metadata and strings. `strings -n 6 thebrochure.png` returned only compressed image data, and a chunk-level inspection found only the standard PNG chunks: `IHDR`, `sRGB`, `gAMA`, `pHYs`, multiple `IDAT` chunks, and `IEND`. There are no `tEXt`, `iTXt`, or `zTXt` chunks carrying notes or a secret. One published writeup mentions a hash-like \"Special Instructions\" field in a metadata viewer, but the local file provides no usable value, so the visible contents are the real lead.

![The Byte Lotus brochure supplied by the room](/assets/screenshots/thebrochure/brochure-local.png)

Two lines in the brochure carry the whole challenge:

- \"Find us on Instagram… or not.\"
- \"Concierge Vera can assist you with further information.\"

The first line gives the platform and hints that the account is not going to be handed to you directly. The second gives a name that becomes useful later. This is typical of beginner OSINT: the clues are plain text, but you have to decide which ones matter.

![Metadata check of the brochure image](/assets/screenshots/thebrochure/metadata-check.webp)

## Initial Access — Following the OSINT Trail

### Finding the Resort Account

Searching Instagram for the resort name from the brochure leads to `@thebytelotusresort`.

![The Byte Lotus Resort Instagram profile](/assets/screenshots/thebrochure/resort-instagram-profile.webp)

The account has only two posts: the same brochure and a resort photograph. Neither caption contains a flag or an obvious pointer. Checking comments and the page source does not add anything either.

This is where many people stop. The useful move is to examine the account's **connections**, not just its content.

### Pivoting Through the Following List

The resort follows exactly one account: `@veratheconcierge`.

![The resort account following Vera the concierge](/assets/screenshots/thebrochure/resort-following-vera.webp)

That name matches the concierge mentioned in the brochure, so the connection is clearly intentional. In OSINT terms this is **relationship mapping**: a public follow, mention, tagged photo, or shared username can link a bland corporate identity to a more personal one.

The \"or not\" phrase in the brochure now makes sense. The resort's own profile does not advertise Vera in its posts; the connection is only visible in the social graph.

### Collecting the Fragments

Vera's account has three posts using the same sunset image. Each post contains a short Base64-looking string.

![Vera the concierge's Instagram profile with three posts](/assets/screenshots/thebrochure/vera-instagram-profile.webp)

Reading the posts from left to right gives:

```text
VEhNe1YzckBzX2FD   (left)
QzB1bnRfaDRzX2Iz   (middle)
M25fZjB1bmQhfQ==   (right)
```

![The three Base64 fragments from Vera's posts](/assets/screenshots/thebrochure/vera-base64-fragments.webp)

The `==` padding on the third fragment is the giveaway. Base64 encodes three bytes into four characters and uses `=` or `==` at the end to pad incomplete groups. A string that ends in `==`, uses uppercase and lowercase letters, digits, `+`, and `/`, and has a length divisible by four is almost certainly Base64.

The pieces must be joined in display order. Reversing them or sorting them arbitrarily produces a different string and no meaningful plaintext.

![How the three fragments join and decode](/assets/screenshots/thebrochure/base64-split.svg)

### Decoding the String

The combined string is:

```text
VEhNe1YzckBzX2FDQzB1bnRfaDRzX2IzM25fZjB1bmQhfQ==
```

It can be decoded locally in a terminal:

```bash
echo 'VEhNe1YzckBzX2FDQzB1bnRfaDRzX2IzM25fZjB1bmQhfQ==' | base64 -d
```

```text
THM{V3r@s_aCC0unt_h4s_b33n_f0und!}
```

The same result comes from CyberChef with the \"From Base64\" operation.

![CyberChef decoding the combined Base64 string](/assets/screenshots/thebrochure/base64-decode.webp)

Base64 is an encoding, not encryption. It exists so binary data can survive systems that only handle text safely; anyone can reverse it instantly. Seeing Base64 in a CTF is a cue to decode, not a security boundary.

## Privilege Escalation

There is no privilege escalation in The Brochure. The room provides no target machine, no shell, and no Linux or Windows account to escalate. The only transition is from reading a public brochure to discovering a second public social account through the hotel's following list. Any writeup claiming root access or a second system flag for this room would be describing a different challenge.

## Flags

| Source | Value |
|--------|-------|
| Decoded Base64 from Vera's three Instagram posts | `THM{V3r@s_aCC0unt_h4s_b33n_f0und!}` |
| Local `flag` note (contains a transcription error) | `THM{V3r@s_aCC0unt_h4s_is3n_f0und!}` |

The local `flag` file differs by one token: it says `is3n`, while the decoded challenge data says `b33n`. The Base64 string is reproduced in several independent writeups and decodes deterministically to `b33n`, so that is the value to submit. I am treating the local `is3n` version as a typo rather than replacing verified challenge evidence with a mistyped note.

## Commands Used

| Command | Purpose |
|---------|---------|
| `file thebrochure.png` | Identify the supplied image format and dimensions |
| `unzip -l attachments-1784426010065.zip` | Confirm the ZIP contains only the brochure PNG |
| `strings -n 6 thebrochure.png` | Check for readable text embedded in the image |
| `identify -verbose thebrochure.png` | Inspect PNG properties and confirm dimensions, colours, and alpha |
| Python PNG chunk walker | Verify there are no `tEXt`/`iTXt`/`zTXt` metadata chunks with hidden notes |
| `echo '<combined string>' \| base64 -d` | Decode the joined Base64 fragments into the flag |

No exploitation commands were needed. The investigation was performed through the brochure and public Instagram profiles.

## Lessons Learned

**Read the artifact before running tools.** The flag was in the visible text and public social connections. Metadata checks were worth doing, but they were a dead end. Beginner OSINT rooms often reward careful reading more than fancy tooling.

**A profile's connections are part of the evidence.** The resort's posts were empty of clues; its following list was not. In real investigations, follows, tags, replies, old usernames, and linked accounts can reveal relationships that an organisation never meant to publish.

**Split strings are a common CTF pattern.** Putting one fragment in each of three posts forces the solver to enumerate the whole profile and preserve order. The `==` padding makes the encoding easy to recognise once the pieces are together.

**Base64 is not encryption.** It changes representation, not confidentiality. Recognise it by its alphabet and padding, then decode it with `base64 -d`, CyberChef, or any equivalent tool.

**Order matters.** The fragments only produce a valid flag when read left to right, matching the order of the posts. Always record where a fragment came from before decoding.

**Verify notes against primary evidence.** The local `flag` file contained `is3n`, but the Base64 output and multiple independent writeups agreed on `b33n`. When notes conflict with reproducible evidence, keep both in the writeup and explain which one is authoritative.

**Public does not mean harmless.** A fictional hotel losing a flag through a concierge's public posts is a small-scale model of a real privacy problem: employees' social accounts can expose information that the organisation's own pages never publish.

## References

- [TryHackMe — The Brochure (Hacker Holidays 2026, Day 0)](https://tryhackme.com/room/hh-thebrochure-081f3e36)
- [TryHackMe — Hacker Holidays](https://tryhackme.com/hackerholidays)
- [Talal Ahmed — The Brochure | TryHackMe Room Writeup](https://ta1al.com/blog/the-brochure-tryhackme-writeup/) — source of the social-media and decoding screenshots
- [KMB — The Brochure: A walkthrough of THM Hacker Holidays — Day 0](https://kmb.hashnode.dev/the-brochure-a-walkthrough-of-thm-hacker-holidays-day-0)
- [Kevinovitz — Hh thebrochure 081f3e36](https://kevinovitz.github.io/TryHackMe_Writeups/hh-thebrochure-081f3e36/hh-thebrochure-081f3e36/)
- [Dhanush N — Hacker Holidays 2026: The Brochure (Day 0)](https://infosecwriteups.com/hacker-holidays-2026-the-brochure-day-0-walkthrough-4aa288b21ec1)
- [CyberChef — From Base64](https://gchq.github.io/CyberChef/)
- [Wikipedia — Base64](https://en.wikipedia.org/wiki/Base64)
