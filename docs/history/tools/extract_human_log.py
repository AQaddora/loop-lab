#!/usr/bin/env python3
"""Extract every human interaction from Claude Code session transcripts, ready to publish.

The transcripts are JSONL files (one JSON object per line) under ~/.claude/projects/<project>/.
This script reads them and prints only what a human typed or chose:

  prompt     a message the human typed at the start of a turn
  mid-turn   a message the human typed while the agent was still working
  answer     the human's choice in a question the agent asked with fixed options
  choice     the human's choice on a session card ("New session", ...)
  approval   the human approving a permission dialog (computer use)

With --prepared it also prints what the agent itself dispatched on the human's behalf
(session briefs and proposals, workflow launches, subagent prompts).

Every string it prints goes through sanitize() first:
  1. attachments (@"<path>") become "[attached: <what it was>; not published]";
  2. every value in the secret store is replaced: an e-mail-shaped value becomes
     "<owner's Google account>", any other value "[redacted]" (also a 16-character fragment of one);
     so are credentials that are not in the store: OAuth codes and tokens in URL parameters
     (code=, state=, token=, ...), bearer tokens and JWTs;
  3. every other e-mail address becomes "<owner's Google account>" (placeholder domains are kept),
     and a quoted Google Cloud project name ("'name' Google project", "Google project `name`")
     becomes "<owner's Google project>";
  4. Tailscale login links and node ids are removed;
  5. server names and paths are replaced by public aliases: this box's home directory -> "~",
     this box's user name -> "<you>", this box's host name -> "loop-runner", the tailnet name -> "<tailnet>",
     the agent scratchpad -> "<scratchpad>", plus the pairs in the private alias file (--aliases);
  6. IP addresses are omitted ("<ip omitted>"), except loopback, 0.0.0.0, documentation addresses
     and private or shared ranges written as CIDR blocks (for example 10.0.0.0/8 or 100.64.0.0/10).

The private alias file is never part of the repo. One pair per line, separated by a tab:
    <private name><TAB><public alias>
Lines that start with "#" are comments. Matching ignores case.

Usage:
  python3 -I extract_human_log.py [options] LABEL=TRANSCRIPT.jsonl [LABEL=TRANSCRIPT.jsonl ...]
  python3 -I extract_human_log.py [--aliases FILE] --sanitize-file FILE     (print one file, sanitized)

Options:
  --aliases FILE      private alias map (see above)
  --secrets GLOB      env files whose values are redacted; repeatable
                      (default: ~/.config/loop-lab/secrets/*.env)
  --until ISO-TIME    ignore entries after this UTC time, so a re-run reproduces a snapshot
  --format jsonl|md   output format (default: jsonl)
  --prepared          print the dispatched prompts instead of the human interactions
  --host-alias NAME   public alias for this box's host name (default: loop-runner)

Standard library only. Run it with `python3 -I` so nothing outside the standard library is imported.
"""

import argparse
import getpass
import glob
import ipaddress
import json
import os
import re
import socket
import sys

OWNER = "<owner's Google account>"
OWNER_PROJECT = "<owner's Google project>"
REDACTED = "[redacted]"
IP_OMITTED = "<ip omitted>"

# ---------------------------------------------------------------------------------------------
# sanitizing


def load_secrets(patterns):
    """Return a list of secret values (strings) from KEY=VALUE env files. Values are never printed."""
    values = []
    for pattern in patterns:
        for path in sorted(glob.glob(os.path.expanduser(pattern))):
            try:
                with open(path, encoding="utf-8") as fh:
                    lines = fh.read().splitlines()
            except OSError:
                continue
            for line in lines:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                _key, value = line.split("=", 1)
                value = value.strip().strip('"').strip("'")
                if len(value) >= 8:
                    values.append(value)
    # longest first, so a value that contains another is replaced whole
    return sorted(set(values), key=lambda v: (-len(v), v))


def load_aliases(path):
    pairs = []
    if not path:
        return pairs
    with open(os.path.expanduser(path), encoding="utf-8") as fh:
        for raw in fh.read().splitlines():
            if not raw.strip() or raw.lstrip().startswith("#") or "\t" not in raw:
                continue
            private, public = raw.split("\t", 1)
            private, public = private.strip(), public.strip()
            if private:
                pairs.append((private, public))
    return pairs


EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
KEEP_EMAIL_DOMAINS = ("example.com", "example.org", "example.net", ".example", ".invalid", ".test", ".ts.net")
KEEP_EMAIL_LOCAL = ("noreply", "no-reply", "git")

IPV4_RE = re.compile(r"(?<![\w.])(\d{1,3}(?:\.\d{1,3}){3})(/\d{1,2})?(?![\d.]*\d)")
IPV6_RE = re.compile(r"(?<![\w:])((?:[0-9A-Fa-f]{1,4}:){2,7}(?::|[0-9A-Fa-f]{1,4})?(?::[0-9A-Fa-f]{1,4})*)(/\d{1,3})?(?![\w:])")
DOC_NETS = [ipaddress.ip_network(n) for n in ("192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24", "2001:db8::/32")]
SHARED_NET = ipaddress.ip_network("100.64.0.0/10")

TAILNET_RE = re.compile(r"\btail[0-9a-f]{4,10}(?=\.ts\.net\b)")
TS_LINK_RE = re.compile(r"https://login\.tailscale\.com/\S*")
TS_NODE_RE = re.compile(r"\b(?:n[0-9A-Za-z]{6,}CNTRL|nodekey:[0-9a-f]{16,})\b")
SCRATCH_RE = re.compile(r"/tmp/claude-\d+/[^/\s]+/[0-9a-f-]{36}/scratchpad")
ATTACH_RE = re.compile(r'@"([^"\n]+)"|@(/\S+)')
# credentials that never sit in the secret store: OAuth codes and tokens in URLs, bearer tokens, JWTs
QUERY_SECRET_RE = re.compile(r"(?i)([?&](?:code|state|token|access_token|id_token|refresh_token|client_secret|"
                             r"api_key|key|secret|password|sig|signature)=)[^&\s#\"'<>]+")
BEARER_RE = re.compile(r"(?i)(\bBearer\s+)[A-Za-z0-9._~+/=-]{16,}")
JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
# a Google Cloud project id (6-30 chars) named in quotes next to the words "Google project"
_GP_NAME = r"(['\"`])[A-Za-z][A-Za-z0-9-]{4,29}\1"
GPROJECT_RE = re.compile(r"(?i)" + _GP_NAME + r"\s+Google(?:\s+Cloud)?\s+project\b|"
                         r"\bGoogle(?:\s+Cloud)?\s+project\s+" + _GP_NAME.replace("\\1", "\\2"))


def _keep_ip(ip, prefix):
    """Keep addresses that identify no machine: loopback, 0.0.0.0, documentation, and private ranges as CIDR."""
    if ip.is_loopback or ip.is_unspecified:
        return True
    if any(ip.version == net.version and ip in net for net in DOC_NETS):
        return True
    if prefix is None:
        return False
    try:
        net = ipaddress.ip_network(f"{ip}{prefix}", strict=True)
    except ValueError:
        return False
    if net.prefixlen == 0 or net.is_private:
        return True
    return net.version == 4 and net.subnet_of(SHARED_NET)


def _sub_ip(match):
    text, prefix = match.group(1), match.group(2)
    try:
        ip = ipaddress.ip_address(text)
    except ValueError:
        return match.group(0)
    return match.group(0) if _keep_ip(ip, prefix) else IP_OMITTED


def _describe_attachment(path):
    name = os.path.basename(path.rstrip("/"))
    low = name.lower()
    if low.startswith("client_secret") and low.endswith(".json"):
        return "the Google OAuth client file (client_secret_*.json)"
    if low.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic")):
        return "an image"
    if low.endswith(".pdf"):
        return "a PDF file"
    ext = os.path.splitext(low)[1]
    return f"a {ext[1:]} file" if ext else "a file"


class Sanitizer:
    def __init__(self, secrets, aliases, host_alias="loop-runner"):
        self.secrets = secrets
        derived = []
        for value in secrets:
            m = re.match(r"^[a-z]+://([^/:\s]+)", value)
            if m:  # a URL secret: its host and the host's project id are private too
                host = m.group(1)
                derived.append((host, "<LiveKit project host>" if "livekit" in host else REDACTED))
                label = host.split(".")[0]
                lm = re.match(r"^(.+)-([a-z0-9]{6,})$", label)
                if lm and len(label) >= 10:
                    derived.append((label, lm.group(1)))
        self.derived = sorted(set(derived), key=lambda p: -len(p[0]))
        self.windows = []
        for value in secrets:
            if len(value) >= 20 and "@" not in value:
                for i in range(len(value) - 15):
                    w = value[i:i + 16]
                    if re.search(r"\d", w) and re.search(r"[A-Za-z]", w):
                        self.windows.append(w)
        home = os.path.expanduser("~").rstrip("/")
        user = getpass.getuser()
        host = socket.gethostname().split(".")[0]
        paths, words = [], []
        for private, public in aliases:
            (paths if "/" in private else words).append((private, public))
        if home and home != "/":
            paths.append((home, "~"))
        if user and user not in ("root",):
            words.append((user, "<you>"))
        if host and host not in ("localhost",) and host_alias:
            words.append((host, host_alias))
        self.paths = sorted(set(paths), key=lambda p: -len(p[0]))
        self.words = sorted(set(words), key=lambda p: -len(p[0]))

    def _secrets(self, text):
        for value in self.secrets:
            if value in text:
                text = text.replace(value, OWNER if EMAIL_RE.fullmatch(value) else REDACTED)
        for private, public in self.derived:
            text = text.replace(private, public)
        if self.windows:
            marks = [False] * len(text)
            for w in self.windows:
                start = text.find(w)
                while start != -1:
                    for k in range(start, start + len(w)):
                        marks[k] = True
                    start = text.find(w, start + 1)
            if any(marks):
                out, i = [], 0
                while i < len(text):
                    if marks[i]:
                        while i < len(text) and marks[i]:
                            i += 1
                        out.append(REDACTED)
                    else:
                        out.append(text[i])
                        i += 1
                text = "".join(out)
        return text

    @staticmethod
    def _emails(text):
        def sub(m):
            addr = m.group(0)
            local, domain = addr.rsplit("@", 1)
            dl = domain.lower()
            if local.lower() in KEEP_EMAIL_LOCAL or any(dl == d.lstrip(".") or dl.endswith(d if d.startswith(".") else "." + d) for d in KEEP_EMAIL_DOMAINS):
                return addr
            return OWNER
        return EMAIL_RE.sub(sub, text)

    def _aliases(self, text):
        text = SCRATCH_RE.sub("<scratchpad>", text)
        for private, public in self.paths:
            text = re.sub(re.escape(private) + r"(?![A-Za-z0-9_-])", lambda _m, p=public: p, text, flags=re.IGNORECASE)
        text = TAILNET_RE.sub("<tailnet>", text)
        for private, public in self.words:
            text = re.sub(r"(?<![A-Za-z0-9_])" + re.escape(private) + r"(?![A-Za-z0-9_])",
                          lambda _m, p=public: p, text, flags=re.IGNORECASE)
        return text

    def __call__(self, text):
        if not text:
            return text
        text = ATTACH_RE.sub(lambda m: f"[attached: {_describe_attachment(m.group(1) or m.group(2))}; not published]"
                             if "/uploads/" in (m.group(1) or m.group(2) or "") else m.group(0), text)
        text = self._secrets(text)
        text = QUERY_SECRET_RE.sub(lambda m: m.group(1) + REDACTED, text)
        text = BEARER_RE.sub(lambda m: m.group(1) + REDACTED, text)
        text = JWT_RE.sub(REDACTED, text)
        text = self._emails(text)
        text = GPROJECT_RE.sub(OWNER_PROJECT, text)
        text = TS_LINK_RE.sub("<tailscale admin link omitted>", text)
        text = TS_NODE_RE.sub("<node id omitted>", text)
        text = self._aliases(text)
        text = IPV4_RE.sub(_sub_ip, text)
        text = IPV6_RE.sub(_sub_ip, text)
        return self._secrets(text)  # once more: nothing above may re-create a secret, but it costs nothing


# ---------------------------------------------------------------------------------------------
# reading transcripts

SYSREM_RE = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)
MIDTURN_RE = re.compile(r"The user sent a new message while you were working:\s*(.*?)\s*(?:This is how Claude Code surfaces|$)", re.S)
CHOSE_RE = re.compile(r'^The user chose "([^"]+)"')


def _text_blocks(content):
    if isinstance(content, str):
        return [content]
    out = []
    for block in content or []:
        if isinstance(block, dict) and block.get("type") == "text":
            out.append(block.get("text", ""))
    return out


def _tool_result_text(block):
    content = block.get("content")
    if isinstance(content, list):
        return "\n".join(x.get("text", "") for x in content if isinstance(x, dict) and x.get("type") == "text")
    return content if isinstance(content, str) else ""


def _clean_human_text(text):
    text = SYSREM_RE.sub("", text)
    m_name = re.search(r"<command-name>(.*?)</command-name>", text, re.S)
    if m_name:
        m_args = re.search(r"<command-args>(.*?)</command-args>", text, re.S)
        text = (m_name.group(1).strip() + " " + (m_args.group(1).strip() if m_args else "")).strip()
    return text.strip("\n").rstrip()


def read_transcript(label, path, until=None):
    """Yield raw (unsanitized) interaction records from one transcript."""
    tool_uses = {}  # tool_use id -> (name, input)
    with open(path, encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            ts = entry.get("timestamp") or ""
            etype = entry.get("type")
            if etype == "assistant":
                for block in (entry.get("message") or {}).get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        tool_uses[block.get("id")] = (block.get("name"), block.get("input") or {}, ts, lineno)
                continue
            if until and ts and ts > until:
                continue
            if etype == "attachment":
                att = entry.get("attachment") or {}
                if att.get("type") == "queued_command" and (att.get("origin") or {}).get("kind") == "human":
                    text = _clean_human_text(att.get("prompt") or "")
                    if text:
                        yield {"ts": att.get("timestamp") or ts, "session": label, "kind": "mid-turn",
                               "text": text, "line": lineno, "uuid": entry.get("uuid")}
                continue
            if etype != "user" or entry.get("isCompactSummary") or entry.get("isMeta"):
                continue
            message = entry.get("message") or {}
            content = message.get("content")
            if (entry.get("origin") or {}).get("kind") == "human":
                text = _clean_human_text("\n\n".join(t for t in _text_blocks(content) if not t.lstrip().startswith("<system-reminder>")))
                if text:
                    yield {"ts": ts, "session": label, "kind": "prompt", "text": text, "line": lineno,
                           "uuid": entry.get("uuid")}
            if not isinstance(content, list):
                continue
            for block in content:
                if not (isinstance(block, dict) and block.get("type") == "tool_result"):
                    continue
                name, tinput, _uts, _uline = tool_uses.get(block.get("tool_use_id"), (None, {}, "", 0))
                rtext = _tool_result_text(block)
                for m in MIDTURN_RE.finditer(rtext or ""):
                    msg = _clean_human_text(m.group(1))
                    if msg:
                        yield {"ts": ts, "session": label, "kind": "mid-turn", "text": msg, "line": lineno,
                               "uuid": entry.get("uuid")}
                if name == "AskUserQuestion" and (rtext or "").startswith("Your questions have been answered"):
                    result = entry.get("toolUseResult") or {}
                    answers = result.get("answers") or {}
                    for q in (result.get("questions") or tinput.get("questions") or []):
                        question = q.get("question", "")
                        if question in answers:
                            options = [{"label": o.get("label", ""), "description": o.get("description", "")}
                                       for o in q.get("options") or []]
                            yield {"ts": ts, "session": label, "kind": "answer", "text": str(answers[question]),
                                   "question": question, "options": options, "line": lineno,
                                   "uuid": entry.get("uuid")}
                elif name == "mcp__ccd_session__start_session":
                    m = CHOSE_RE.match(rtext or "")
                    if m:
                        title = tinput.get("title") or ""
                        yield {"ts": ts, "session": label, "kind": "choice",
                               "text": f'[session card "{title}": chose "{m.group(1)}"]', "line": lineno,
                               "uuid": entry.get("uuid")}
                elif name == "mcp__computer-use__request_access":
                    try:
                        granted = json.loads(rtext).get("granted") or []
                    except (ValueError, AttributeError):
                        granted = []
                    if granted:
                        apps = ", ".join(g.get("displayName", "?") for g in granted)
                        yield {"ts": ts, "session": label, "kind": "approval",
                               "text": f"[approval dialog: granted computer-use access to {apps}]", "line": lineno,
                               "uuid": entry.get("uuid")}
                elif name == "mcp__computer-use__request_full_control" and "approved" in (rtext or "")[:80].lower():
                    yield {"ts": ts, "session": label, "kind": "approval",
                           "text": "[approval dialog: approved full-screen control]", "line": lineno,
                           "uuid": entry.get("uuid")}


def read_prepared(label, path, until=None):
    """Yield the prompts the agent dispatched: session briefs and proposals, workflows, subagents."""
    with open(path, encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            ts = entry.get("timestamp") or ""
            if entry.get("type") != "assistant" or (until and ts and ts > until):
                continue
            for block in (entry.get("message") or {}).get("content") or []:
                if not (isinstance(block, dict) and block.get("type") == "tool_use"):
                    continue
                name, tinput = block.get("name"), block.get("input") or {}
                if name == "mcp__ccd_session__start_session" and tinput.get("prompt"):
                    yield {"ts": ts, "session": label, "kind": "brief" if tinput.get("proposal_id") else "proposal",
                           "title": tinput.get("title", ""), "text": tinput.get("prompt", ""),
                           "background": tinput.get("background", ""), "line": lineno}
                elif name == "Workflow":
                    script = tinput.get("script") or ""
                    m = re.search(r"name:\s*'([^']+)'", script)
                    d = re.search(r"description:\s*'([^']+)'", script)
                    yield {"ts": ts, "session": label, "kind": "workflow",
                           "title": (m.group(1) if m else os.path.basename(tinput.get("scriptPath", ""))),
                           "text": d.group(1) if d else "",
                           "args": json.dumps(tinput.get("args"), sort_keys=True) if tinput.get("args") else "",
                           "line": lineno}
                elif name == "Agent":
                    yield {"ts": ts, "session": label, "kind": "subagent", "title": tinput.get("description", ""),
                           "text": tinput.get("prompt", ""), "line": lineno}


# ---------------------------------------------------------------------------------------------
# output


def _norm(text):
    return re.sub(r"\s+", " ", text).strip().lower()


def dedupe(records):
    seen_uuid, seen_text, out = set(), set(), []
    for r in sorted(records, key=lambda r: (r["ts"], r["session"], r["line"])):
        key = (r["session"], r["kind"], _norm(r["text"]), r.get("question", ""))
        # a forked session repeats its parent's entries with the same uuid: count each one once
        ukey = (r.get("uuid"), r["kind"], _norm(r["text"]), r.get("question", "")) if r.get("uuid") else None
        if (ukey and ukey in seen_uuid) or key in seen_text:
            continue
        if ukey:
            seen_uuid.add(ukey)
        seen_text.add(key)
        out.append(r)
    return out


def md_escape_line(line):
    """Escape what Markdown would otherwise hide or restyle: "<" (HTML tags) and a leading # > - * +."""
    line = line.replace("<", "\\<")
    if re.match(r"^(#|>|[-*+]\s)", line):
        line = "\\" + line
    return line


PASTE_RE = re.compile(r'<pasted_content id="[^"]*">\n?(.*?)\n?</pasted_content id="[^"]*">', re.S)


def _prose(chunk):
    """Escaped prose lines; a line followed by another non-empty line ends in a hard break."""
    lines = [md_escape_line(x.rstrip()) for x in chunk.strip("\n").split("\n")]
    return [x + ("\\" if x.strip() and i + 1 < len(lines) and lines[i + 1].strip() else "")
            for i, x in enumerate(lines)]


def md_quote(text):
    """Render one message as a Markdown blockquote; pasted terminal output becomes a code block."""
    out, pos = [], 0
    for m in PASTE_RE.finditer(text):
        out.extend(_prose(text[pos:m.start()]))
        out.append("[pasted]")
        out.append("```text")
        out.extend(m.group(1).split("\n"))
        out.append("```")
        pos = m.end()
    out.extend(_prose(text[pos:]))
    # drop empty lines at the edges, keep the rest as ">" lines
    while out and not out[0].strip():
        out.pop(0)
    while out and not out[-1].strip():
        out.pop()
    return "\n".join(("> " + x) if x.strip() else ">" for x in out)


def render_md(records):
    parts = []
    for i, r in enumerate(records, 1):
        hhmmss = r["ts"][11:19] if len(r["ts"]) >= 19 else r["ts"]
        parts.append(f"### H{i:02d} · {hhmmss} UTC · {r['session']} · {r['kind']}\n")
        if r["kind"] == "answer":
            parts.append(f"Asked by the agent: {r['question']}  ")
            parts.append("Options: " + " / ".join(
                f"`{o['label']}`" + (f" ({md_escape_line(o['description'])})" if o.get("description") else "")
                for o in r.get("options", [])) + "\n")
        parts.append(md_quote(r["text"]) + "\n")
    return "\n".join(parts)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("transcripts", nargs="*", help="LABEL=PATH (or PATH) of a transcript JSONL file")
    ap.add_argument("--aliases", default=None)
    ap.add_argument("--secrets", action="append", default=None)
    ap.add_argument("--until", default=None)
    ap.add_argument("--format", choices=("jsonl", "md"), default="jsonl")
    ap.add_argument("--prepared", action="store_true")
    ap.add_argument("--host-alias", default="loop-runner")
    ap.add_argument("--sanitize-file", default=None)
    args = ap.parse_args(argv)

    secrets = load_secrets(args.secrets or ["~/.config/loop-lab/secrets/*.env"])
    if not args.aliases:
        print("extract_human_log: no --aliases file given; only the built-in rules apply", file=sys.stderr)
    clean = Sanitizer(secrets, load_aliases(args.aliases), args.host_alias)

    if args.sanitize_file:
        with open(args.sanitize_file, encoding="utf-8") as fh:
            sys.stdout.write(clean(fh.read()))
        return 0
    if not args.transcripts:
        ap.error("give at least one LABEL=PATH transcript")

    records = []
    for spec in args.transcripts:
        label, path = spec.split("=", 1) if "=" in spec else (os.path.basename(spec)[:8], spec)
        reader = read_prepared if args.prepared else read_transcript
        records.extend(reader(label, os.path.expanduser(path), args.until))
    records = dedupe(records) if not args.prepared else sorted(records, key=lambda r: (r["ts"], r["session"], r["line"]))

    for r in records:
        for key in ("text", "question", "background", "title", "args"):
            if key in r and isinstance(r[key], str):
                r[key] = clean(r[key])
        if "options" in r:
            r["options"] = [{k: clean(v) for k, v in o.items()} for o in r["options"]]
        r.pop("uuid", None)

    if args.format == "md":
        sys.stdout.write(render_md(records))
    else:
        for r in records:
            sys.stdout.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
