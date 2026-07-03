---
title: "OhSINT"
description: "An OSINT-focused challenge where you dig through publicly available information to track down a target."
difficulty: "Medium"
tags: ["OSINT", "Reconnaissance", "Social Media"]
date: "2025-06-10"
---

## Initial Information

The challenge provided a single image file. Started by examining the image metadata using **exiftool**:

```bash
exiftool image.jpg
```

Found a creator tag with a username: `OWoodflint`.

## OSINT Gathering

Searched the username across platforms:

- **Twitter**: Found an account with location data
- **GitHub**: Found a repository with personal info
- **WordPress blog**: Revealed the target's BSSID

### Twitter Analysis

The Twitter profile had geolocation enabled. Extracted the coordinates from a posted photo.

### GitHub Recon

Checked the user's GitHub profile and found an email address in commit history:

```bash
git log --all --format='%an %ae'
```

## Putting It Together

The BSSID found on the WordPress blog was cross-referenced with **Wigle.net** to get the exact physical address.

## Final Answers

- **City**: London
- **SSID**: `OWoodflint_WiFi`
- **Email**: `OWoodflint@protonmail.com`
- **Flag**: `THM{OSINT_MASTER}`
