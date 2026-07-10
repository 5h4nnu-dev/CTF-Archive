---
title: "c4ptur3-th3-fl4g"
description: "A beginner-friendly CTF challenge covering encoding/decoding, steganography, spectrogram analysis, and file forensics across multiple tasks."
difficulty: "Easy"
tags: ["Steganography", "Forensics", "Cryptography", "Encoding", "Spectrogram", "OSINT"]
date: "2026-07-04"
---

## Overview

c4ptur3-th3-fl4g is a TryHackMe room designed to introduce core CTF skills through a series of progressively challenging tasks. It covers encoding and cipher identification, image steganography, audio spectrogram analysis, and hidden file extraction — all foundational techniques in capture the flag competitions.

## Room Information

- **Platform:** TryHackMe
- **Difficulty:** Easy
- **Skills Learned:** Encoding/decoding identification, steganography (steghide), spectrogram analysis (Audacity), file forensics (binwalk, strings)

## Task 1 — Translation & Shifting

The first task presents 10 encoded strings, each requiring a different decoding technique.

### 1. Leet Speak

```
c4n y0u c4p7u23 7h3 f149?
```

Numbers replace visually similar letters: `4`→a, `0`→o, `7`→t, `3`→e, `9`→g, `2`→z.

**Answer:** `can you capture the flag`

### 2. Binary

```
01101100 01100101 01110100 01110011 ... 01101111 01110101 01110100 00100001
```

Each 8-bit group is an ASCII character.

```bash
echo "01101100 01100101 01110100 01110011 ..." | perl -lape '$_=pack("(B8)*",@F)'
```

**Answer:** `lets try some binary out!`

### 3. Base32

```
MJQXGZJTGIQGS4ZAON2XAZLSEBRW63LNN5XCA2LOEBBVIRRHOM======
```

Trailing `=` padding indicates Base32.

```bash
echo "MJQXGZJTGIQGS4ZAON2XAZLSEBRW63LNN5XCA2LOEBBVIRRHOM======" | base32 -d
```

**Answer:** `base32 is super common in CTF's`

### 4. Base64

```
RWFjaCBCYXNlNjQgZGlnaXQgcmVwcmVzZW50cyBleGFjdGx5IDYgYml0cyBvZiBkYXRhLg==
```

```bash
echo "RWFjaCBCYXNlNjQgZGlnaXQgcmVwcmVzZW50cyBleGFjdGx5IDYgYml0cyBvZiBkYXRhLg==" | base64 -d
```

**Answer:** `Each Base64 digit represents exactly 6 bits of data.`

### 5. Hexadecimal

```
68 65 78 61 64 65 63 69 6d 61 6c 20 6f 72 20 62 61 73 65 31 36 3f
```

```bash
echo "68 65 78 61 64 65 63 69 6d 61 6c 20 6f 72 20 62 61 73 65 31 36 3f" | xxd -r -p
```

**Answer:** `hexadecimal or base16?`

### 6. ROT13

```
Ebgngr zr 13 cynprf!
```

ROT13 shifts letters by 13 positions. The name "ROT13" is a hint — rotating 13 places reveals the original message.

```bash
echo "Ebgngr zr 13 cynprf!" | tr 'A-Za-z' 'N-ZA-Mn-za-m'
```

**Answer:** `Rotate me 13 places!`

### 7. ROT47

```
*@F DA:? >6 C:89E C@F?5 323J C:89E C@F?5 Wcf E:>6DX
```

ROT47 extends ROT13 to include all printable ASCII characters (94 characters, shifted by 47).

**Answer:** `You found me! 2 ez? Too easy? Nah just gettin started`

### 8. Morse Code

```
. .-.. . -.-. --- -- -- ..- -. .. -.-. .- - .. --- -.
```

Dots and dashes representing letters.

**Answer:** `telecommunication encoding`

### 9. Decimal ASCII

```
85 110 112 97 99 107 32 116 104 105 115 32 66 67 68
```

Each number is a decimal ASCII code.

```bash
echo "85 110 112 97 99 107 32 116 104 105 115 32 66 67 68" | awk '{for(i=1;i<=NF;i++) printf "%c", $i}'
```

**Answer:** `Unpack this BCD`

### 10. Multi-Layer Encoding

The longest challenge — a Base64 string that, when decoded, reveals Morse code. The Morse code maps to binary (`-----`=0, `.----`=1), which converts to ASCII. The result is then ROT47 encoded, requiring one final decode.

The local folder contains the exact Base64 payload and the Python decoder for the inner layers:

```python
import base64

with open("txt", "r") as f:
    data = f.read()

decoded = base64.b64decode(data).decode()

morse_map = {"-----": "0", ".----": "1"}
binary = ""
for word in decoded.split():
    if word in morse_map:
        binary += morse_map[word]

text = ""
for i in range(0, len(binary), 8):
    byte = binary[i:i+8]
    if len(byte) == 8:
        text += chr(int(byte, 2))

print(text)
```

Running the decoder outputs a string that requires one final ROT47 decode.

**Answer:** `Let's make this a bit trickier...`

## Task 2 — Spectrograms

The `secretaudio_1559007588454.wav` file contains a hidden message encoded as a spectrogram — a visual representation of audio frequencies over time.

Opened the file in **Audacity**, switched the view to **Spectrogram** mode. The visual pattern revealed text written into the frequency spectrum.

**Answer:** `Super Secret Message`

## Task 3 — Steganography

![stegosteg_1559008553457.jpg](/assets/screenshots/capturetheflag/stegosteg_1559008553457.jpg)

The `stegosteg_1559008553457.jpg` image contained hidden data. Used `steghide` to extract it:

```bash
steghide extract -sf stegosteg_1559008553457.jpg
# Passphrase: (blank/Enter)
```

This extracted `steganopayload2248.txt`:

```
SpaghettiSteg
```

**Answer:** `SpaghettiSteg`

## Task 4 — Security Through Obscurity

![meme_1559010886025.jpg](/assets/screenshots/capturetheflag/meme_1559010886025.jpg)

The `meme_1559010886025.jpg` image contained additional hidden content. Running `strings` on the file or extracting embedded archives revealed a hidden PNG image.

```bash
binwalk meme_1559010886025.jpg
```

Extracting the embedded files yielded `hackerchat.png`. Inspecting this image further using `strings` or hex analysis revealed hidden text appended to the file.

**Answers:**
- First filename: `hackerchat.png`
- Hidden text: `AHH_YOU_FOUND_ME!`

## Summary

| Task | Technique | Tools |
|------|-----------|-------|
| Leet | 1337 speak | Manual decode |
| Binary | 8-bit ASCII | `perl`, `CyberChef` |
| Base32 | Base32 decode | `base32 -d` |
| Base64 | Base64 decode | `base64 -d` |
| Hex | Hex to ASCII | `xxd -r -p` |
| ROT13 | Caesar 13 | `tr` |
| ROT47 | Extended rotation | `CyberChef` |
| Morse | Morse code | Online decoder |
| Decimal ASCII | ASCII codes | `awk` |
| Multi-layer | Base64→Morse→Binary→ASCII→ROT47 | Python, CyberChef |
| Spectrogram | Audio frequency analysis | Audacity |
| Steganography | Image steganography | `steghide` |
| File forensics | File carving, strings | `binwalk`, `strings` |

## Lessons Learned

- **Encoding identification** is pattern recognition: trailing `=` means Base64 or Base32; only `A-Z` and `2-7` means Base32; dots and dashes mean Morse; hex uses `0-9A-F`.
- **Multi-layer encoding** requires peeling one layer at a time — each output tells you what the next encoding is.
- **Steghide** can embed files in JPEG images even without a passphrase. Always try an empty passphrase first.
- **Spectrograms** are a common way to hide text in audio — visual patterns in frequency space can encode messages that are inaudible to the ear.
- **Binwalk** and **strings** are essential for file forensics — many CTF challenges hide files within other files.

## References

- [TryHackMe — c4ptur3-th3-fl4g](https://tryhackme.com/room/c4ptur3th3fl4g)
- [CyberChef](https://gchq.github.io/CyberChef/)
- [Audacity](https://www.audacityteam.org/)
- [Steghide](http://steghide.sourceforge.net/)
- [Binwalk](https://github.com/ReFirmLabs/binwalk)
