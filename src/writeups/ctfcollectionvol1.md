---
title: "CTF Collection Vol. 1"
description: "A curated collection of 20 standalone CTF challenges covering base decoding, steganography, forensics, OSINT, cipher breaking, reverse engineering, and packet analysis."
difficulty: "Easy"
tags: ["Steganography", "Forensics", "OSINT", "Reverse Engineering", "Cryptography", "Encoding", "Wireshark"]
date: "2026-07-04"
---

## Overview

CTF Collection Vol. 1 is a TryHackMe room featuring 20 independent challenges that span the core techniques used in capture the flag competitions. Each challenge is self-contained and teaches a specific skill — from simple Base64 decoding to multi-layer steganography, cipher breaking, OSINT, reverse engineering, and packet analysis.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** Encoding/decoding, steganography, EXIF metadata, file forensics, cipher analysis, OSINT, reverse engineering, Wireshark

## Task 1 — Introduction

The room description provides an overview of the 20 challenges ahead. No flag to capture here — just an introduction to the collection.

## Task 2 — Base64 Decode

The file `note1.txt` contains a Base64 encoded string:

```
VEhNe2p1NTdfZDNjMGQzXzdoM19iNDUzfQ==
```

Decoded with `base64`:

```bash
echo "VEhNe2p1NTdfZDNjMGQzXzdoM19iNDUzfQ==" | base64 -d
```

**Flag:** `THM{ju57_d3c0d3_7h3_b453}`

## Task 3 — EXIF Metadata

The image `Find_me_1577975566801.jpg` contains the flag hidden in its metadata. Used `exiftool` to extract it:

```bash
exiftool Find_me_1577975566801.jpg
```

![ExifTool output showing the flag in metadata](/assets/screenshots/ctfcollectionvol-1/exiftool_output.png)

The "Owner Name" EXIF field contained the flag as a plaintext string.

## Task 4 — Steghide Extraction

The image `Extinction_1577976250757.jpg` had a file embedded via `steghide`:

```bash
steghide extract -sf Extinction_1577976250757.jpg
# Passphrase: (blank/Enter)
```

![Extracted final message from steghide](/assets/screenshots/ctfcollectionvol-1/steghide_result.png)

This extracted `Final_message.txt`:

```
It going to be over soon. Sleep my child.

THM{500n3r_0r_l473r_17_15_0ur_7urn}
```

**Flag:** `THM{500n3r_0r_l473r_17_15_0ur_7urn}`

## Task 5 — Hidden Text (CSS/HTML)

A challenge where the flag was hidden using white text on a white background, visible only when highlighted or when inspecting the HTML source. Selecting all text or viewing the page source reveals the flag.

## Task 6 — QR Code

An image containing a QR code. Scanning it with any QR reader (phone camera or online tool) revealed the flag.

![QR code for Task 6](/assets/screenshots/ctfcollectionvol-1/qrcode.png)

**Flag:** `THM{qr_m4k3_l1f3_345y}`

## Task 7 — Reverse Engineering

The binary file `hello_1577977122465.hello` required reverse engineering. Used `strings` to extract readable data:

```bash
strings hello_1577977122465.hello
```

Alternatively, used `radare2` for disassembly:

```bash
r2 -AA hello_1577977122465.hello
# Within r2: pdf @ main
```

The flag was visible in the binary's strings or disassembly output.

## Task 8 — Base58 Decode

```
3agrSy1CewF9v8ukcSkPSYm3oKUoByUpKG4L
```

Base58 is similar to Base64 but uses a 58-character alphabet (excluding similar-looking characters). Decoded with:

```bash
echo "3agrSy1CewF9v8ukcSkPSYm3oKUoByUpKG4L" | base58 -d
```

**Flag:** `THM{17_h45_l3553r_l3773r5}`

## Task 9 — Caesar Cipher

A ROT/Caesar cipher challenge. Brute-forcing all 25 rotations reveals the plaintext:

```bash
python3 -c "
cipher = '<ciphertext>'
for rot in range(26):
    result = ''
    for c in cipher:
        if c.isalpha():
            base = ord('A') if c.isupper() else ord('a')
            result += chr((ord(c) - base + rot) % 26 + base)
        else:
            result += c
    print(f'ROT{rot:02d}: {result}')
"
```

![Caesar cipher decoder on dcode.fr](/assets/screenshots/ctfcollectionvol-1/caesar_decode.png)

## Task 10 — HTML Source Comment

The flag was hidden in an HTML comment (`<!-- ... -->`) in the page source. Viewing the page source revealed it.

![HTML comment containing the flag](/assets/screenshots/ctfcollectionvol-1/html_comment.png)

## Task 11 — Corrupted PNG Repair

The file `spoil_1577979329740.png` had a corrupted header. A valid PNG starts with the magic bytes `89 50 4E 47 0D 0A 1A 0A` (hex). The file header was damaged, preventing it from opening.

Repaired by writing the correct PNG signature:

```bash
printf '\x89\x50\x4E\x47' | dd of=spoil.png bs=1 seek=0 count=4 conv=notrunc
```

After fixing the header, the image opened normally and displayed the flag.

## Task 12 — OSINT / Reddit

A Base64 string decoded to a hint pointing to Reddit:

```
SlVHIE1PU1RfQ1JBWFlfQk9YISEhISEhISEhIApzaXRlOiJyZWRkaXQuY29tIiBpbnRleHQ6IlRITSIgaW50aXRsZToidHJ5aGFja21l"
```

Decoding gives instructions to search Reddit for a specific post about "THM" with title "tryhackme" on the TryHackMe subreddit, where the flag was posted.

**Flag:** `THM{50c14l_4cc0un7_15_p4r7_0f_051n7}`

## Task 13 — Brainfuck

A string encoded in Brainfuck (esoteric programming language). Decoded using an online Brainfuck interpreter or `dcode.fr`:

```
++++++++++[>+>+++>+++++++>++++++++++<<<<-]>>>++++++++++++++.------------.+.++++++++.
```

**Flag:** revealed after decoding the Brainfuck instructions.

## Task 14 — XOR Cipher

A hex string encrypted with XOR. Required XOR decryption with the correct key. The hint "Check the HINT and let's let the magic do the work" pointed to using an XOR brute-force or known-plaintext approach.

![XOR decryption result](/assets/screenshots/ctfcollectionvol-1/xor_decode.png)

## Task 15 — Binwalk

An image file (`hell.jpg`) contained embedded files. Used `binwalk` to analyze and extract:

![Hell image with embedded data](/assets/screenshots/ctfcollectionvol-1/hell_image.jpg)

```bash
binwalk -e hell.jpg
```

![Binwalk output showing embedded files](/assets/screenshots/ctfcollectionvol-1/binwalk_output.png)

Extracted files included `hello_there.txt` containing the flag.

## Task 16 — Image Plane Analysis (StegSolve)

An image that appeared blank or solid black contained hidden text visible only when analyzing specific bit planes. Used **StegSolve** to cycle through bit planes and reveal the hidden message.

![StegSolve interface for bit plane analysis](/assets/screenshots/ctfcollectionvol-1/stegsolve.png)

## Task 17 — QR Code → SoundCloud

A QR code that, when scanned, redirected to a SoundCloud audio track. Playing the audio track revealed the flag spoken or displayed in the track description.

## Task 18 — Wayback Machine OSINT

Required using the **Wayback Machine** (web.archive.org) to view an old version of a website. The flag was present on the archived page but had been removed from the live version.

![Wayback Machine snapshot showing the flag](/assets/screenshots/ctfcollectionvol-1/wayback_machine.png)

## Task 19 — Vigenère Cipher

A ciphertext encoded with the Vigenère cipher. Required identifying the key and decoding twice:

```bash
# Decode with Vigenère using the identified key
```

![Vigenère cipher decoder on dcode.fr](/assets/screenshots/ctfcollectionvol-1/vigenere_decode.png)

## Task 20 — Decimal to Hex to ASCII

A series of decimal numbers that needed conversion to hexadecimal, then to ASCII:

```python
decimals = [84, 72, 77, ...]
hex_values = [hex(d) for d in decimals]
flag = ''.join(chr(d) for d in decimals)
```

![Python hex conversion](/assets/screenshots/ctfcollectionvol-1/python_hex.png)

## Task 21 — Wireshark Packet Analysis

A `.pcap` file containing network traffic. Opened in **Wireshark** and analyzed for the flag — typically found in a packet payload, an HTTP request, or a protocol-specific field.

![Wireshark search for the flag in packet details](/assets/screenshots/ctfcollectionvol-1/wireshark.png)

## Flags

| Task | Technique | Flag |
|------|-----------|------|
| 2 | Base64 | `THM{ju57_d3c0d3_7h3_b453}` |
| 3 | EXIF metadata | |
| 4 | Steghide | `THM{500n3r_0r_l473r_17_15_0ur_7urn}` |
| 6 | QR code | `THM{qr_m4k3_l1f3_345y}` |
| 8 | Base58 | `THM{17_h45_l3553r_l3773r5}` |
| 12 | OSINT / Reddit | `THM{50c14l_4cc0un7_15_p4r7_0f_051n7}` |

## Tools Used

```bash
base64 -d
exiftool
steghide
strings
r2 (radare2)
base58 -d
printf + dd (PNG repair)
binwalk -e
stegsolve
wireshark
```

## Lessons Learned

- **Base encodings** are identifiable by their character sets: Base64 has `A-Za-z0-9+/=`; Base32 has `A-Z2-7=`; Base58 omits similar-looking characters.
- **EXIF metadata** is a common hiding place for flags — always check image metadata with `exiftool`.
- **Steghide** extracts embedded files from JPEG images, often without requiring a passphrase.
- **PNG corruption** is often just a damaged header — knowing magic bytes lets you repair the file.
- **OSINT** challenges frequently use Reddit, the Wayback Machine, and SoundCloud as data sources.
- **Brainfuck** and other esoteric languages appear regularly in CTFs — recognize them by their pattern of `+<>[].,-`.
- **Wireshark** analysis is essential for finding flags hidden in network traffic.

## References

- [TryHackMe — CTF Collection Vol. 1](https://tryhackme.com/room/ctfcollectionvol1)
- [CyberChef](https://gchq.github.io/CyberChef/)
- [StegSolve](https://github.com/zardus/ctf-tools/blob/master/stegsolve/README.md)
- [Wayback Machine](https://web.archive.org/)
- [dcode.fr — Cipher Identifier](https://www.dcode.fr/cipher-identifier)
- [PNG File Format](http://www.libpng.org/pub/png/spec/1.2/PNG-Structure.html)
