---
title: "Overheard at Breakfast"
description: "An easy OSINT room from the Hacker Holidays series where a leaked email address in a Discord screenshot pivots to a Gravatar profile that was supposed to be wiped - and the flag hiding in its bio."
difficulty: "Easy"
tags: ["OSINT", "Gravatar", "Email Hashing", "SHA-256", "MD5", "Base64", "Social Media"]
date: "2026-08-05"
---

## Overview

Some rooms hand you an IP address and a brute-force target. This one hands you a screenshot of two strangers chatting over breakfast at the Byte Lotus resort - and asks you to find an account that "nobody was supposed to find." Overheard at Breakfast is a pure OSINT (Open Source Intelligence) room from the Hacker Holidays series: no nmap, no exploit scripts, no shells. Just careful reading of a casual conversation, one leaked email address, a service that maps emails to profiles through cryptographic hashes, and a flag resting in a bio the target thought they had deleted.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Category:** OSINT, Social Media, Hashing
- **Skills Learned:** Conversation analysis, email pivoting, Gravatar hash-based lookups, Base64 decoding

## Enumeration - The Artifact

The only challenge artifact is a zipped PNG: `conversation.png`, a screenshot of a Discord-style direct message exchange. The zip extracts neatly:

![Room introduction](/assets/screenshots/overheardatbreakfast/room_intro.png)

![Room tasks and preview](/assets/screenshots/overheardatbreakfast/room_tasks.png)

![Room metadata](/assets/screenshots/overheardatbreakfast/room_meta.png)

Ruling out the usual image-forensics angles is quick: `file`, `exiftool`, `binwalk` and steganography probing against the PNG turn up nothing interesting. The image is exactly what it claims to be - a screenshot. The puzzle is not in the file format, it's in the **words**.

## Reading the Conversation

Opening the image shows a late-night chat between two guests of the Byte Lotus resort:

![The conversation screenshot](/assets/screenshots/overheardatbreakfast/conversation.png)

One participant is **Ponzi - Influencer**, posting resort content. The other is **Lambo!**, a guest the influencer is trying to tag in future posts. Most of the chat is small talk - resort reviews, weather, vibes - but Lambo drops two critical pieces of information almost in passing:

> "Yeah nowadays I don't really use much social media... Though I'm still out there, I used to use this **free tool that let me upload my profile and link other media accounts**, was neat, until I **wiped everything**. Started with a **G** if I remember correctly."

> "But if anything this is my best way of communication: **lambobytelotushotel@gmail.com**"

That's the entire challenge in two lines:

1. **An email address** - the explicit pivot point.
2. **A tool name** - a *free tool starting with G* where the user uploaded a profile picture and linked other social accounts, believing they had wiped everything.

## Identifying the Tool: Gravatar

"A free tool starting with G that lets you upload a profile and link other media accounts" is a description, not a name - and descriptions are searchable. It points directly at **Gravatar** (Globally Recognized Avatar), the Automattic-owned service that has powered profile avatars across millions of websites for two decades.

Gravatar is interesting from an OSINT angle because of *how* it identifies people: a Gravatar profile is not keyed by email address in plaintext. It is keyed by a **cryptographic hash of the normalized email** (lowercased, whitespace trimmed). Anyone holding an email address can compute the hash and look the profile up - no login, no password reset, no permission required.

That's also why Lambo thought they were safe. They never handed over a profile link, just a memory of a "wiped" tool and an email. Both are enough.

## Hashing the Email

Gravatar has two vintages of hashing: the legacy avatar API uses **MD5**, while the current profile API accepts **SHA-256**. Trying both covers the old and the new generations:

```python
import hashlib

email = 'lambobytelotushotel@gmail.com'.strip().lower()
print('MD5   :', hashlib.md5(email.encode()).hexdigest())
print('SHA256:', hashlib.sha256(email.encode()).hexdigest())
```

```
MD5   : d4a5fc5d3128890778667e24617d7cc0
SHA256: d43faafe9d7f056793bd037b8d6e321acad985c222d83775b10d6539e301e931
```

## The Gravatar Lookup

Gravatar offers a built-in email checker at `gravatar.com/site/check`. Dropping the email in there returns the linked profile URL and avatar hash:

![Gravatar email check](/assets/screenshots/overheardatbreakfast/gravatar_check.png)

Profile URL:
```
https://gravatar.com/<email-hash>
```

Or programmatically, the modern v3 API exposes the full profile as JSON:

```bash
curl -s https://api.gravatar.com/v3/profiles/<sha256-of-email> | jq .
```

![The Gravatar profile page](/assets/screenshots/overheardatbreakfast/gravatar_profile.png)

Either route resolves to a live public profile - despite Lambo claiming to have "wiped everything":

- Profile URL: `https://gravatar.com/d43faafe9d7f056793bd037b8d6e321acad`
- Preferred username: `cheerfullysongf28e3c3716`
- Display name: **Lambo**
- Location: **Byte Lotus Hotel**

The location matches the resort named in the conversation. This is unmistakably the same person - the hash-addressable profile outlived its owner's wipe.

## The Prize in the Bio

The profile contains a bio field left by the room creators for exactly this chain of discovery:

"Funny thing about email hashes, they follow you places where you didn't expect. Glad you found the right corner of the internet! Here is your prize: `VEhNe1MzY3JlVF9QcjBmaWwzX0g0c19iMzNuX0lkZW50MWZpM2R9`"

![The Gravatar bio with the prize](/assets/screenshots/overheardatbreakfast/gravatar_bio.png)

That string has the telltale properties of **Base64** encoding: a mix of upper and lowercase letters, digits, possible padding, and a length that's a multiple of 4. Feeding it through a quick decode confirms it:

```bash
echo "VEhNe1MzY3JlVF9QcjBmaWwzX0g0c19iMzNuX0lkZW50MWZpM2R9" | base64 -d
THM{S3creT_Pr0fil3_H4s_b33n_Ident1fi3d}
```

![Decoding with CyberChef](/assets/screenshots/overheardatbreakfast/cyberchef_decode.png)

Base64-encoded flag captured. Room done.

## Commands Used

```bash
# Artifact inspection
unzip conversation.zip            # extract conversation.png
file conversation.png            # confirm it's a genuine screenshot
exiftool conversation.png        # metadata empty - nothing hidden there

# Hash the email straight from the conversation
echo -n "lambobytelotushotel@gmail.com" | md5sum
echo -n "lambobytelotushotel@gmail.com" | sha256sum

# Look up the profile
curl -s https://api.gravatar.com/v3/profiles/d43faafe9d7f056793bd037b8d6e321acad985c222d83775b10d6539e301e931 | jq .

# Decode the prize
echo "VEhNe1MzY3JlVF9QcjBmaWwzX0g0c19iMzNuX0lkZW50MWZpM2R9" | base64 -d
```

## Lessons Learned

- **Reading for clues beats digging for data.** The whole forward | path comes from actually reading the conversation rather than running forensic tooling against the artifact. A screenshot can be a first entity - stop treating it as a binary to beat.
- **Casual conversations are OSINT goldmines.** The owner "leaked" nothing on purpose - a throwaway mention and a friendly "here's how to reach me" did all the work. The most dangerous disclosures sound like small talk.
- **Gravatar is keyed by email hash, not email.** That single design detail converts every email address in your transcripts, source code, or breaches into a possible public profile URL - `gravatar.com/<hash>`. The profile data (name, bio, location, linked social accounts) can be read without ever logging in.
- **Hashes follow you.** MD5/SHA-256 of an email is deterministic math. Wiping a profile does not destroy posts or history - the hash-to-profile mapping and any cached server response can outlive the deletion. "I wiped everything" is not necessarily "I'm gone."
- **Always try both API generations.** Old (MD5) and new (v3 SHA-256) looked up paths co-exist; trying both hashing routes is a two-command check that avoids a dead end.
- **Base64 is everywhere in CTFs.** Random-looking, size-multiple-of-4 strings in bios or comments deserve a `base64 -d` before anything else - it detects clean and decodes clean.

## References

- [TryHackMe - Overheard at Breakfast](https://tryhackme.com/module/overheard-at-breakfast)
- [Gravatar — Globally Recognized Avatar](https://gravatar.com)
- [Gravatar Email Checker](https://gravatar.com/site/check)
- [Gravatar API v3 documentation](https://docs.gravatar.com/api/profiles/)
- [CyberChef — From Base64](https://gchq.github.io/CyberChef/#recipe=From_Base64('A-Za-z0-9%2B/%3D',true,false))
- [OWASP — Guidance on email enumeration](https://owasp.org/www-community/attacks/Information_disclosure_techniques)