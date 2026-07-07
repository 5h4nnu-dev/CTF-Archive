---
title: "Blaster"
description: "A Windows exploitation CTF machine that involves web enumeration to discover RDP credentials, followed by a UAC bypass using CVE-2019-1388 to escalate to SYSTEM."
difficulty: "Easy"
tags: ["Windows", "RDP", "UAC Bypass", "CVE-2019-1388", "WordPress", "IIS"]
date: "2026-07-04"
---

## Overview

Blaster is a Windows-based TryHackMe room that covers alternative exploitation without Metasploit. Enumeration of an IIS web server reveals a WordPress blog with credentials exposed in a comment. RDP access leads to a desktop executable that enables a UAC bypass via the Windows certificate dialog (CVE-2019-1388), granting SYSTEM privileges.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** Web enumeration, WordPress recon, RDP access, Windows UAC bypass (CVE-2019-1388)

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -Pn -oN nmap.txt 10.49.130.99
```

Two open ports were discovered on this Windows machine:

| Port | Service | Version |
|------|---------|---------|
| 80/tcp | HTTP | Microsoft IIS 10.0 |
| 3389/tcp | RDP | Microsoft Terminal Services |

### Web Enumeration

The IIS web server showed a default page. Directory brute-forcing revealed a hidden WordPress site at `/retro`:

```bash
gobuster dir -u http://10.49.130.99 -w /usr/share/wordlists/dirb/common.txt
```

The blog, titled "Retro Fanatics," had posts by user **Wade** about retro games and movies. One post about *Ready Player One* had a revealing comment in the RSS feed:

```
Leaving myself a note here just in case I forget how to spell it: parzival
```

The comment was left by Wade himself. "Parzival" is the avatar name of the protagonist Wade Watts in *Ready Player One* — this was the password.

## Initial Access — RDP

With the discovered credentials, connected via RDP:

```bash
xfreerdp /u:Wade /p:Parzival /v:10.49.130.99
```

### User Flag

Found `user.txt` on Wade's desktop.

## Privilege Escalation — CVE-2019-1388

On the desktop, an executable named `hhupd.exe` was present. This binary is a known vector for **CVE-2019-1388**, a Windows UAC bypass vulnerability in the Hyper-V update installer.

The vulnerability works through the certificate dialog:

1. Right-click `hhupd.exe` and select **Run as administrator**.
2. When the UAC prompt appears, click **"Show information about the publisher's certificate"**.
3. In the certificate dialog, click the link to view the certificate details.
4. Click **"Install Certificate..."** — this opens a help window.
5. In the help window, click **"Save this file to disk"**.
6. When the Save dialog opens, navigate to `C:\Windows\System32\` and select **cmd.exe**.
7. Right-click cmd.exe and select **Open**.

The new command prompt runs as **NT AUTHORITY\SYSTEM**.

```bash
whoami
# nt authority\system
```

### Root Flag

```bash
type C:\Users\Administrator\Desktop\root.txt
```

## Flags

| Flag | Location |
|------|----------|
| User | Wade's desktop |
| Root | `C:\Users\Administrator\Desktop\root.txt` |

## Commands Used

```bash
nmap -sV -sC -Pn -oN nmap.txt <target-ip>
gobuster dir -u http://<target-ip> -w /usr/share/wordlists/dirb/common.txt
xfreerdp /u:Wade /p:Parzival /v:<target-ip>
```

## Lessons Learned

- **Never leave credentials in blog comments or posts**, even as a "reminder." The comment in the RSS feed was publicly accessible and gave away the password.
- **CVE-2019-1388** is a powerful UAC bypass that only requires the attacker to have a GUI session on the target. The certificate dialog's help functionality opens Internet Explorer as SYSTEM, allowing file system navigation and command execution at the highest integrity level.
- **WordPress RSS feeds** expose comment content publicly — always a good place to check during enumeration.
- **Windows UAC bypasses** are a common privilege escalation technique on modern Windows systems. The `hhupd.exe` binary is deliberately included in this room to demonstrate the technique without relying on Metasploit.

## References

- [TryHackMe — Blaster](https://tryhackme.com/room/blaster)
- [CVE-2019-1388 — NVD](https://nvd.nist.gov/vuln/detail/CVE-2019-1388)
- [Microsoft Security Advisory 4524145](https://msrc.microsoft.com/update-guide/vulnerability/CVE-2019-1388)
