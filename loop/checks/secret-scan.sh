#!/usr/bin/env bash
# loop/checks/secret-scan.sh · the publication guard (specs/prod-loop.md PR-07).
# The repo is public. Run this in CI and before every push.
#
#   loop/checks/secret-scan.sh [--history | --range <rev-range>] [paths...]
#   Private host and user names come from a host-local list, never from the repo:
#   ${SECRET_SCAN_PRIVATE_NAMES:-~/.config/loop-lab/private-names.txt}, one name per line (mode 600).
#   Without that file (e.g. in CI) the private-name rule is skipped; the generic shapes still run.
#
# Scope. Every run reads three things:
#   files    every tracked file plus every untracked, not-ignored file (git ls-files -co --exclude-standard),
#            minus node_modules and lockfiles. The repo path of each file is checked as well as its content.
#   index    the staged copy (git show :<path>) of every tracked file whose working-tree copy differs.
#   commits  every added line, new file path, commit message, author and committer in the commits a push would
#            publish: <upstream>..HEAD, else origin/main..HEAD, else all refs (no remote yet). A merge commit is
#            diffed against its first parent, so lines added while resolving it are read too.
#            --history reads all refs (git log --all). --range <rev-range> reads that range instead.
# Paths narrow all three (a directory inside the repo still respects .gitignore).
# Binary files are read too: every printable run of 6+ bytes (ASCII and UTF-16LE) goes through every rule.
# Compressed content (zip, deflated PNG or PDF streams) is not unpacked.
#
# Output: one line per finding, "<file>:<line> <rule>". It never prints a matched value.
#   <file> is :<path> for a staged copy and <commit>:<path> in history. <line> is 0 for the path itself and
#   @<byte offset> for a printable run in a binary file. A path part that matches a rule is shown as <rule>.
#   PASS   exit 0  no findings
#   FAIL   exit 1  one or more findings
#   ERROR  exit 2  bad usage, no git checkout, no python3, a failed git command, or a bad allowlist line
#
# Rules
#   secret-value         the exact value (8+ chars) of any key in $LOOP_SECRETS_DIR/*.env
#                        (default ~/.config/loop-lab/secrets), printed as "<file>:<line> matches <NAME> from <envfile>"
#   google-oauth-secret  GOCSPX-…           google-api-key  AIza…           github-token  ghp_ gho_ github_pat_ …
#   sk-api-key           sk-…               slack-token     xox[abpr]-…     aws-access-key  AKIA + 16
#   private-key          -----BEGIN … PRIVATE KEY-----                      jwt  eyJ….eyJ…
#   telegram-token       <bot id>:<35 chars>                                tailscale-key  tskey-…
#   keyvalue-secret      KEY=VALUE where KEY names a secret and VALUE looks random (LiveKit API key and secret shape)
#   email                an address outside *.test, *.invalid, *.example, example.com/.org/.net,
#                        noreply@anthropic.com, GitHub noreply (noreply@github.com, *@users.noreply.github.com),
#                        and placeholders in .env.example files. Commit authors and committers are read too,
#                        so a contributor commits with a GitHub noreply address
#   private-name         a host or user name of the holder's own fleet, in any spelling: runs of up to 3 parts
#                        split on - _ . and camelCase are joined and compared. The names come from a
#                        host-local list (never this file: a hash of a short name can be guessed back)
#   fleet-ip, fleet-host an address or host name of this fleet, read at run time from `tailscale status --json`
#                        when the tailscale CLI is there (any path, test files too; generic names such as
#                        localhost are skipped). Nothing about them is stored in this file
#   home-path            /home/<name> or /Users/<name>, except generic names (runner, user, you, …)
#   tailnet              a Tailscale tailnet name (tail + 6 hex) or a *.ts.net host, except the
#                        placeholder tailnets <name>.example.ts.net and <name>.tailnet.ts.net
#   tailscale-id         a Tailscale login link or node id
#   livekit-host         a LiveKit Cloud project host (*.livekit.cloud)
#   cloud-host           an AWS instance host name (ec2-…amazonaws.com, ip-a-b-c-d)
#   ipv4                 an IPv4 host other than loopback, 0.0.0.0/8, the documentation ranges
#                        (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), multicast and reserved space,
#                        the bare base addresses 100.64.0.0 and 169.254.0.0,
#                        wide blocks (x.y.0.0/16 or wider), RFC 1918 network addresses (x.y.z.0), CGNAT and
#                        link-local network addresses written with a prefix, and RFC 1918 hosts inside test files
#                        (tests/, e2e/, *.test.*, *.spec.*). CGNAT (100.64.0.0/10) hosts are flagged everywhere:
#                        Tailscale nodes live there, so a test fixture is allowlisted one value at a time
#   ipv6                 an IPv6 host other than ::, ::1, 2001:db8::/32 (documentation) and ff00::/8 (multicast),
#                        and blocks of /48 or wider. fe80::/10 and fc00::/7 hosts pass only inside test files,
#                        and fd7a:115c:a1e0::/48 (Tailscale) hosts never do. An IPv4-mapped address
#                        (::ffff:…) is judged by the ipv4 rule
#   bytecode             a *.pyc or *.pyo file or a __pycache__/ path (compiled files embed the build machine's paths)
#
# Allowlist for justified false positives: loop/checks/secret-scan.allow (format in its header);
# SECRET_SCAN_ALLOW=<file> points at another one. LOOP_SECRETS_DIR=<dir> points at another secret store.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel 2>/dev/null)" \
  || { echo "secret-scan: ERROR · $here is not inside a git checkout" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "secret-scan: ERROR · python3 not found" >&2; exit 2; }
export SCAN_ROOT="$root" SCAN_CWD="$PWD" SCAN_ALLOW="${SECRET_SCAN_ALLOW:-$here/secret-scan.allow}"

IFS= read -r -d '' PROG <<'PY' || true
import fnmatch, ipaddress, json, os, re, shutil, subprocess, sys

ROOT = os.environ["SCAN_ROOT"]
CWD = os.environ["SCAN_CWD"]
ALLOW_FILE = os.environ["SCAN_ALLOW"]
HOME = os.path.expanduser("~")
USAGE = "usage: loop/checks/secret-scan.sh [--history | --range <rev-range>] [paths...]"

# Private host and user names of the holder's fleet. They are NOT in this file: a hash of a short name can be
# guessed back, so publishing hashes would publish the names. The list lives only on the holder's machines.
PRIVATE_NAMES_FILE = os.path.expanduser(os.environ.get("SECRET_SCAN_PRIVATE_NAMES", "~/.config/loop-lab/private-names.txt"))


def load_private_names():
    try:
        with open(PRIVATE_NAMES_FILE, encoding="utf-8") as fh:
            names = {re.sub(r"[^a-z0-9]", "", ln.split("#", 1)[0].strip().lower()) for ln in fh}
    except OSError:
        return set()
    return {n for n in names if len(n) >= 3}


PRIVATE_NAMES = load_private_names()

GENERIC = [
    ("google-oauth-secret", re.compile(r"GOCSPX-[A-Za-z0-9_-]{10,}")),
    ("google-api-key",      re.compile(r"AIza[0-9A-Za-z_-]{35}")),
    ("github-token",        re.compile(r"(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})")),
    ("sk-api-key",          re.compile(r"(?<![A-Za-z0-9_-])sk-(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}")),
    ("slack-token",         re.compile(r"xox[abpr]-[A-Za-z0-9-]{10,}")),
    ("aws-access-key",      re.compile(r"(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![0-9A-Z])")),
    ("private-key",         re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")),
    ("jwt",                 re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}")),
    ("telegram-token",      re.compile(r"(?<![0-9])[0-9]{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])")),
    ("tailscale-key",       re.compile(r"tskey-[a-z]+-[A-Za-z0-9-]{10,}")),
    ("tailnet",             re.compile(r"(?<![A-Za-z0-9])tail[0-9a-f]{6}(?![A-Za-z0-9])")),
    ("tailscale-id",        re.compile(r"login\.tailscale\.com/a/[A-Za-z0-9]+|(?<![A-Za-z0-9])n[A-Za-z0-9]{6,}CNTRL(?![A-Za-z0-9])")),
    ("livekit-host",        re.compile(r"[A-Za-z0-9-]+\.livekit\.cloud(?![A-Za-z0-9-])")),
    ("cloud-host",          re.compile(r"(?<![A-Za-z0-9-])(?:ec2-[0-9]{1,3}(?:-[0-9]{1,3}){3}\.[A-Za-z0-9.-]*amazonaws\.com|ip-[0-9]{1,3}(?:-[0-9]{1,3}){3})(?![A-Za-z0-9-])")),
]

TS_HOST = re.compile(r"(?<![A-Za-z0-9.-])([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\.ts\.net(?![A-Za-z0-9-])")
TAILNET_PLACEHOLDERS = {"example", "tailnet"}

KV = re.compile(r"(?i)(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]*?(?:secret|api_?key|access_?key|signing_?key|chain_?key|private_?key|token|password|passwd))[\"']?\s*[:=]\s*[\"'`]?([A-Za-z0-9+/=_.-]{12,})")
LIVEKIT_KEY_SHAPE = re.compile(r"API[A-Za-z0-9]{10,}")

EMAIL = re.compile(r"(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})(?![A-Za-z0-9-])")
EMAIL_OK_TLDS = (".test", ".invalid", ".example", ".localhost")
EMAIL_OK_DOMAINS = {"example.com", "example.org", "example.net", "users.noreply.github.com"}
EMAIL_OK_ADDRS = {"noreply@anthropic.com", "noreply@github.com"}   # the second commits GitHub web edits and merges
GIT_SSH_HOSTS = {"github.com", "gitlab.com", "bitbucket.org"}   # git@<host>: an SSH remote, not a mailbox
FILE_TLDS = {"png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "js", "mjs", "cjs", "ts", "tsx", "css", "json", "map", "md"}
PLACEHOLDER_LOCALS = {"owner", "admin", "user", "you", "me", "name", "someone", "email", "test", "your.name", "yourname", "first.last"}
PLACEHOLDER_DOMAINS = {"company.com", "yourcompany.com", "your-company.com", "domain.com", "yourdomain.com", "your-domain.com"}

HOME_PATH = re.compile(r"(?<![A-Za-z0-9_.-])/(?:home|Users)/([A-Za-z0-9._-]+)")
HOME_OK = {"runner", "user", "username", "you", "me", "name", "node", "shared", "yourname", "your-name"}

NET = ipaddress.ip_network
IPV4 = re.compile(r"(?<![0-9A-Za-z.])((?:[0-9]{1,3}\.){3}[0-9]{1,3})(?:/([0-9]{1,2}))?(?![0-9]|\.[0-9])")
IP_ALWAYS_OK = [NET(n) for n in ("0.0.0.0/8", "127.0.0.0/8", "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24",
                                 "224.0.0.0/4", "240.0.0.0/4", "100.64.0.0/32", "169.254.0.0/32")]
IP_RFC1918 = [NET(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")]
IP_SHARED = [NET(n) for n in ("100.64.0.0/10", "169.254.0.0/16")]   # CGNAT (Tailscale nodes) and link-local
# A candidate needs "::" or 8 groups. The lookbehind lets "addr:fd7a:…" through; the lookahead stops at an IPv4 tail.
IPV6 = re.compile(r"(?<![0-9A-Za-z.])([0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7})(?:/([0-9]{1,3}))?(?![0-9A-Za-z:]|\.[0-9])")
IP6_ALWAYS_OK = [NET(n) for n in ("::/128", "::1/128", "2001:db8::/32", "ff00::/8")]
IP6_TEST_OK = [NET(n) for n in ("fe80::/10", "fc00::/7")]
IP6_TAILSCALE = NET("fd7a:115c:a1e0::/48")
TEST_PATH = re.compile(r"(^|/)(tests?|e2e|__tests__|fixtures)/|\.(test|spec)\.[A-Za-z0-9]+$")

WORD = re.compile(r"[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*")
SEP = re.compile(r"[-_.]")
CAMEL = re.compile(r"[A-Z]+[0-9]*(?![a-z])|[A-Z]?[a-z]+[0-9]*|[0-9]+")
GENERIC_HOSTS = {"localhost", "iphone", "ipad", "android", "ubuntu", "debian", "raspberrypi", "macbook", "macbookpro",
                 "macbookair", "imac", "macmini", "desktop", "laptop", "server", "linux", "windows", "runner", "github"}
BYTECODE = re.compile(r"(^|/)__pycache__(/|$)|\.py[co]$")
LOCKFILES = {"package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb",
             "Cargo.lock", "poetry.lock", "Gemfile.lock", "composer.lock", "uv.lock", "Pipfile.lock"}
ASCII_RUN = re.compile(rb"[\x20-\x7e\t]{6,}")
UTF16_RUN = re.compile(rb"(?:[\x20-\x7e]\x00){6,}")

RULES = ({"secret-value", "keyvalue-secret", "email", "private-name", "fleet-ip", "fleet-host", "home-path",
          "ipv4", "ipv6", "bytecode"} | {r for r, _ in GENERIC})
PATH_RULES = {"secret-value", "email", "private-name", "fleet-ip", "fleet-host", "home-path", "tailnet",
              "tailscale-id", "livekit-host", "cloud-host", "ipv4", "ipv6"}
NO_REGEX_ALLOW = {"secret-value", "fleet-ip", "fleet-host", "private-name"}   # a regex would have to spell the value


def tilde(p):
    return "~" + p[len(HOME):] if HOME not in ("", "/") and (p == HOME or p.startswith(HOME + "/")) else p


def die(msg):
    print(f"secret-scan: ERROR · {msg}", file=sys.stderr)
    sys.exit(2)


def note(msg):
    print(f"secret-scan: note · {msg}", file=sys.stderr)


def canon(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())



def name_parts(word):
    return [p.lower() for seg in SEP.split(word) for p in CAMEL.findall(seg)]


def git(*args, ok=(0,)):
    r = subprocess.run(["git", "-C", ROOT, *args], capture_output=True)
    if r.returncode not in ok:
        die(f"git {args[0]} failed (exit {r.returncode})")
    return r


# ---------- inputs ----------

def env_value(rest):
    """The value of a dotenv line after '=': quotes removed, an unquoted ' # comment' cut off."""
    rest = rest.strip()
    if rest[:1] in ("'", '"'):
        q, out, i = rest[0], [], 1
        while i < len(rest):
            c = rest[i]
            if c == "\\" and q == '"' and i + 1 < len(rest) and rest[i + 1] in '"\\':
                out.append(rest[i + 1])
                i += 2
                continue
            if c == q:
                return "".join(out)
            out.append(c)
            i += 1
        return rest[1:]                   # no closing quote on this line
    return re.split(r"\s#", rest, maxsplit=1)[0].rstrip()


def load_secret_values():
    store = os.environ.get("LOOP_SECRETS_DIR") or os.path.join(HOME, ".config/loop-lab/secrets")
    if not os.path.isdir(store):
        note(f"no secret store at {tilde(store)}, exact-value check skipped")
        return []
    values, files = [], 0
    for fn in sorted(os.listdir(store)):
        if fn.startswith(".") or not fn.endswith(".env"):
            continue
        files += 1
        with open(os.path.join(store, fn), encoding="utf-8", errors="replace") as fh:
            for raw in fh:
                s = raw.strip()
                if not s or s.startswith("#"):
                    continue
                m = re.match(r"(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$", s)
                if not m:
                    continue
                v = env_value(m.group(2))
                if len(v) >= 8:
                    values.append((m.group(1), fn, v))
    note(f"exact-value check uses {len(values)} values from {files} env files")
    note(f"private-name check uses {len(PRIVATE_NAMES)} names from a host-local list" if PRIVATE_NAMES else "no host-local private-names list, private-name check skipped")
    return values


def load_fleet():
    """Tailscale addresses and host names of this fleet, read at run time and never stored."""
    ips, names, maxw = set(), set(), 3
    exe = shutil.which("tailscale")
    if not exe:
        note("no tailscale CLI, fleet-ip and fleet-host checks skipped")
        return ips, names, maxw
    try:
        r = subprocess.run([exe, "status", "--json"], capture_output=True, timeout=10)
        st = json.loads(r.stdout or b"{}")
    except Exception:
        note("tailscale status failed, fleet-ip and fleet-host checks skipped")
        return ips, names, maxw
    nodes = [st.get("Self") or {}] + list((st.get("Peer") or {}).values())
    for n in nodes:
        for a in n.get("TailscaleIPs") or []:
            try:
                ips.add(ipaddress.ip_address(a))
            except ValueError:
                pass
        for h in (n.get("HostName") or "", (n.get("DNSName") or "").split(".")[0]):
            c = canon(h)
            if len(c) >= 4 and c not in GENERIC_HOSTS:
                names.add(c)
                maxw = max(maxw, len(name_parts(h)))
    note(f"fleet check uses {len(ips)} addresses and {len(names)} host names from tailscale status")
    return ips, names, maxw


def load_allow():
    path_rules, regexes = [], []
    if not os.path.isfile(ALLOW_FILE):
        return path_rules, regexes
    name = os.path.basename(ALLOW_FILE)
    with open(ALLOW_FILE, encoding="utf-8") as fh:
        for n, raw in enumerate(fh, 1):
            s = re.sub(r"\s+#.*$", "", raw.strip())
            if not s or s.startswith("#"):
                continue
            m = re.fullmatch(r"(\S+):([a-z0-9-]+)", s)
            if m and m.group(2) in RULES:
                if m.group(2) == "secret-value":
                    die(f"{name}:{n} allowlists secret-value, which is never allowed: remove the value instead")
                path_rules.append((m.group(1), m.group(2)))
                continue
            try:
                regexes.append(re.compile(s))
            except re.error:
                die(f"{name}:{n} is neither <path-glob>:<rule> nor a valid regex")
    return path_rules, regexes


# ---------- rules ----------

def email_ok(local, domain, path):
    l, d = local.lower(), domain.lower()
    if f"{l}@{d}" in EMAIL_OK_ADDRS or d in EMAIL_OK_DOMAINS or d.endswith(EMAIL_OK_TLDS):
        return True
    if any(d.endswith("." + x) for x in ("example.com", "example.org", "example.net")):
        return True
    if l == "git" and d in GIT_SSH_HOSTS:
        return True
    if d.rsplit(".", 1)[-1] in FILE_TLDS:   # logo@2x.png and friends
        return True
    if os.path.basename(path).endswith(".env.example") and (l in PLACEHOLDER_LOCALS or d in PLACEHOLDER_DOMAINS):
        return True
    return False


def kv_is_secret(key, val):
    if LIVEKIT_KEY_SHAPE.fullmatch(val) and "key" in key.lower():
        return True
    if len(val) >= 20 and re.search(r"[A-Z]", val) and re.search(r"[a-z]", val) and re.search(r"[0-9]", val):
        return True
    return len(val) >= 32 and re.fullmatch(r"[0-9a-fA-F]+", val) is not None


def ipv4_rule(addr, prefix, path, fleet):
    try:
        ip = ipaddress.IPv4Address(addr)
    except ValueError:
        return None                       # 999.1.1.1, 0x7f… and leading zeros are not addresses
    if ip in fleet:
        return "fleet-ip"
    if any(ip in n for n in IP_ALWAYS_OK):
        return None
    octets = addr.split(".")
    if prefix is not None and int(prefix) <= 16 and octets[2] == "0" and octets[3] == "0":
        return None                       # a /16 or wider block names a range, not a server
    rfc1918 = any(ip in n for n in IP_RFC1918)
    shared = any(ip in n for n in IP_SHARED)
    if octets[3] == "0" and (rfc1918 or (shared and prefix is not None)):
        return None                       # a network address (10.0.0.0, 100.64.0.0/10), not a host
    if rfc1918 and TEST_PATH.search(path):
        return None                       # RFC 1918 hosts used as test fixtures
    return "ipv4"


def ipv6_rule(cand, prefix, path, fleet):
    tries = [cand] + ([cand[1:]] if cand.startswith(":") and not cand.startswith("::") else [])
    for c in tries:
        try:
            ip = ipaddress.IPv6Address(c)
        except ValueError:
            continue
        groups = c.split(":")
        if sum(1 for g in groups if g) < 3 and len(groups[0]) < 4:
            return None                   # a[1::2], x::y: too short to be an address someone wrote down
        if ip in fleet:
            return "fleet-ip"
        if ip.ipv4_mapped is not None:    # ::ffff:c633:6400 is 198.51.100.0: judge it as that IPv4 address
            p4 = None if prefix is None or int(prefix) < 96 else str(int(prefix) - 96)
            return ipv4_rule(str(ip.ipv4_mapped), p4, path, fleet)
        if any(ip in n for n in IP6_ALWAYS_OK):
            return None
        if prefix is not None and int(prefix) <= 48:
            try:
                ipaddress.IPv6Network(f"{ip}/{prefix}", strict=True)
                return None               # a /48 or wider block names a range, not a server
            except ValueError:
                pass
        if ip not in IP6_TAILSCALE and any(ip in n for n in IP6_TEST_OK) and TEST_PATH.search(path):
            return None                   # link-local and ULA hosts used as test fixtures
        return "ipv6"
    return None


class Scanner:
    def __init__(self, values, allow, fleet):
        self.values = values
        self.path_rules, self.regexes = allow
        self.fleet_ips, self.fleet_names, self.maxw = fleet
        self.findings = []
        self.places = set()
        self._names = {}
        self._show = {}

    def allowed(self, path, rule, text, commit=None):
        if rule == "secret-value":
            return False
        keys = [path] + ([f"{commit}:{path}"] if commit else [])
        if any(r == rule and any(fnmatch.fnmatch(k, g) for k in keys) for g, r in self.path_rules):
            return True
        return rule not in NO_REGEX_ALLOW and text is not None and any(rx.search(text) for rx in self.regexes)

    def names(self, text):
        out = []
        for w in WORD.findall(text):
            parts = name_parts(w)
            for i in range(len(parts)):
                acc = ""
                for j in range(i, min(len(parts), i + self.maxw)):
                    acc += parts[j]
                    r = self._names.get(acc)
                    if r is None:
                        r = ("private-name" if acc in PRIVATE_NAMES
                             else "fleet-host" if acc in self.fleet_names else "")
                        self._names[acc] = r
                    if r:
                        out.append((r, acc))
        return out

    def hits(self, path, text, rules=None):
        want = (lambda r: True) if rules is None else rules.__contains__
        out = []   # (rule, matched text, label)
        if want("secret-value"):
            for name, envfile, val in self.values:
                if val in text:
                    out.append(("secret-value", None, f"matches {name} from {envfile}"))
        for rule, rx in GENERIC:
            if want(rule):
                out += [(rule, m.group(0), rule) for m in rx.finditer(text)]
        if want("tailnet"):
            for m in TS_HOST.finditer(text):
                if m.group(1).rsplit(".", 1)[-1].lower() not in TAILNET_PLACEHOLDERS:
                    out.append(("tailnet", m.group(0), "tailnet"))
        if want("keyvalue-secret"):
            for m in KV.finditer(text):
                if kv_is_secret(m.group(1), m.group(2)):
                    out.append(("keyvalue-secret", m.group(0), "keyvalue-secret"))
        if want("email"):
            for m in EMAIL.finditer(text):
                if not email_ok(m.group(1), m.group(2), path):
                    out.append(("email", m.group(0), "email"))
        if want("private-name") or want("fleet-host"):
            out += [(r, t, r) for r, t in self.names(text) if want(r)]
        if want("home-path"):
            for m in HOME_PATH.finditer(text):
                if m.group(1).lower() not in HOME_OK:
                    out.append(("home-path", m.group(0), "home-path"))
        if want("ipv4") or want("fleet-ip"):
            for m in IPV4.finditer(text):
                r = ipv4_rule(m.group(1), m.group(2), path, self.fleet_ips)
                if r and want(r):
                    out.append((r, m.group(0), r))
        if (want("ipv6") or want("fleet-ip")) and ("::" in text or text.count(":") >= 7):
            for m in IPV6.finditer(text):
                r = ipv6_rule(m.group(1), m.group(2), path, self.fleet_ips)
                if r and want(r):
                    out.append((r, m.group(0), r))
        return out

    def add(self, loc, label):
        self.findings.append(f"{loc} {label}")
        self.places.add(loc.rsplit(":", 1)[0])

    def line(self, loc, path, text, commit=None, rules=None):
        seen = set()
        for rule, matched, label in self.hits(path, text, rules):
            if label in seen or self.allowed(path, rule, matched, commit):
                continue
            seen.add(label)
            self.add(loc, label)

    def show(self, path):
        """The repo path as printed: a part that matches a rule is replaced by <rule>, so no value is echoed."""
        s = self._show.get(path)
        if s is None:
            parts = []
            for part in path.split("/"):
                hs = [h for h in self.hits(path, part, PATH_RULES) if not self.allowed(path, h[0], h[1])]
                parts.append(f"<{hs[0][0]}>" if hs else part)
            s = self._show[path] = "/".join(parts)
        return s

    def path(self, where, path, commit=None):
        """Check a repo path itself: the holder asked that repo paths never name the fleet."""
        self.line(f"{where}:0", path, path, commit, PATH_RULES)
        if BYTECODE.search(path) and not self.allowed(path, "bytecode", None, commit):
            self.add(f"{where}:0", "bytecode")


# ---------- scopes ----------

class Blobs:
    """One git cat-file --batch process for every blob the scan reads."""
    def __init__(self):
        self.proc = None

    def get(self, sha):
        if self.proc is None:
            self.proc = subprocess.Popen(["git", "-C", ROOT, "cat-file", "--batch"],
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        self.proc.stdin.write(sha.encode() + b"\n")
        self.proc.stdin.flush()
        head = self.proc.stdout.readline().split()
        if len(head) < 3:
            return None                   # "<sha> missing", e.g. a gitlink
        data = self.proc.stdout.read(int(head[2]))
        self.proc.stdout.read(1)
        return data

    def close(self):
        if self.proc is not None:
            self.proc.stdin.close()
            self.proc.wait()


BLOBS = Blobs()


def excluded(rel):
    parts = rel.split("/")
    return "node_modules" in parts or parts[-1] in LOCKFILES or parts[-1].endswith(".lock")


def scan_data(sc, where, path, data, commit=None):
    """Scan file content. Returns True when it was binary (read as printable runs)."""
    if b"\0" in data[:8192]:
        runs = [(m.start(), m.group(0).decode("ascii")) for m in ASCII_RUN.finditer(data)]
        runs += [(m.start(), m.group(0).decode("utf-16-le")) for m in UTF16_RUN.finditer(data)]
        for off, text in runs:
            sc.line(f"{where}:@{off}", path, text, commit)
        return True
    for n, line in enumerate(data.decode("utf-8", "replace").split("\n"), 1):
        sc.line(f"{where}:{n}", path, line, commit)
    return False


def git_ls(paths):
    r = git("ls-files", "-co", "--exclude-standard", "-z", "--", *paths)
    return [p for p in r.stdout.decode("utf-8", "surrogateescape").split("\0") if p]


def collect(args):
    """(files to read, pathspec inside the repo or None when every path is outside it)."""
    if not args:
        return git_ls([]), []
    out, spec = [], []
    for a in args:
        ap = os.path.normpath(os.path.join(CWD, a))
        if not os.path.lexists(ap):
            die(f"no such path: {tilde(ap)}")
        rel = os.path.relpath(ap, ROOT)
        inside = rel != ".." and not rel.startswith("../")
        if inside:
            spec.append(rel)
        if os.path.isdir(ap) and not os.path.islink(ap):
            if inside:
                out += git_ls([rel])
            else:
                for d, dirs, files in os.walk(ap):
                    dirs[:] = sorted(x for x in dirs if x not in (".git", "node_modules"))
                    out += [os.path.join(d, f) for f in sorted(files)]
        else:
            out.append(rel if inside else ap)
    return out, (spec or None)


def scan_files(sc, files):
    scanned, binaries, seen = 0, [], set()
    for f in files:
        if f in seen or excluded(f):
            continue
        seen.add(f)
        inside = not os.path.isabs(f)
        full = os.path.join(ROOT, f) if inside else f
        shown = sc.show(f) if inside else tilde(f)
        if inside:
            sc.path(shown, f)
        if os.path.islink(full):
            sc.line(f"{shown}:1", f, os.readlink(full))   # a committed symlink publishes its target path
            scanned += 1
            continue
        if not os.path.isfile(full):
            continue                                      # tracked but deleted here: its staged copy is read below
        with open(full, "rb") as fh:
            data = fh.read()
        if scan_data(sc, shown, f, data):
            binaries.append(shown)
        scanned += 1
    return scanned, binaries


def scan_index(sc, spec):
    """Staged copies that differ from the working tree (git show :<path>)."""
    r = git("diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--ignore-submodules", "--", *spec)
    changed = [p for p in r.stdout.decode("utf-8", "surrogateescape").split("\0") if p]
    if not changed:
        return 0
    r = git("--literal-pathspecs", "ls-files", "-s", "-z", "--", *changed)
    n = 0
    for entry in r.stdout.decode("utf-8", "surrogateescape").split("\0"):
        if not entry or "\t" not in entry:
            continue
        meta, path = entry.split("\t", 1)
        mode, sha = meta.split()[:2]
        if mode == "160000" or excluded(path):
            continue
        data = BLOBS.get(sha)
        if data is None:
            continue
        where = ":" + sc.show(path)
        if mode == "120000":
            sc.line(f"{where}:1", path, data.decode("utf-8", "replace"))
        else:
            scan_data(sc, where, path, data)
        n += 1
    return n


def cunquote(s):
    """Undo git's C-style quoting of a path ("a/x\\ty")."""
    if not (len(s) >= 2 and s[0] == s[-1] == '"'):
        return s
    out, b, i = bytearray(), s[1:-1].encode("utf-8", "surrogateescape"), 0
    esc = {ord("n"): 10, ord("t"): 9, ord("r"): 13, ord("a"): 7, ord("b"): 8, ord("f"): 12, ord("v"): 11}
    while i < len(b):
        c = b[i]
        if c == 92 and i + 1 < len(b):
            nx = b[i + 1]
            octal = re.match(rb"[0-7]{1,3}", b[i + 1:i + 4])
            if octal:
                out.append(int(octal.group(0), 8) & 0xFF)
                i += 1 + len(octal.group(0))
                continue
            out.append(esc.get(nx, nx))
            i += 2
            continue
        out.append(c)
        i += 1
    return out.decode("utf-8", "replace")


def diffgit_path(line):
    """The post-image path of a 'diff --git a/P b/P' line (no renames, so both sides are the same path)."""
    rest = line[len("diff --git "):]
    m = re.fullmatch(r'("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*")', rest)
    if m:
        p = cunquote(m.group(2))
        return p[2:] if p.startswith("b/") else p
    k = (len(rest) - 5) // 2
    if rest.startswith("a/") and rest[2 + k:5 + k] == " b/" and rest[2:2 + k] == rest[5 + k:]:
        return rest[5 + k:]
    return None


def resolve_revs(mode, rng):
    """(git log revision args, label, whether this is a whole-history read) or (None, label, False)."""
    if mode == "history":
        return ["--all"], "all refs", True
    if mode == "range":
        return [rng], rng, False
    if git("rev-parse", "--verify", "-q", "HEAD", ok=(0, 1, 128)).returncode != 0:
        return None, "no commits yet", False
    up = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}", ok=(0, 128))
    if up.returncode == 0 and up.stdout.strip():
        u = up.stdout.decode().strip()
        return [f"{u}..HEAD"], f"{u}..HEAD", False
    if git("rev-parse", "--verify", "-q", "refs/remotes/origin/main", ok=(0, 1, 128)).returncode == 0:
        return ["origin/main..HEAD"], "origin/main..HEAD", False
    return ["--all"], "all refs, no remote yet", True


def scan_history(sc, revs, spec):
    fmt = "%x01C %H%n%x01A %an <%ae>%n%x01M %cn <%ce>%n%x01B%n%B%n%x01E"
    cmd = ["git", "-C", ROOT, "-c", "core.quotePath=false", "log", *revs, "-p", "--no-color", "--no-ext-diff",
           "--no-textconv", "--no-renames", "--full-index", "--diff-merges=first-parent",
           "--src-prefix=a/", "--dst-prefix=b/", "--no-show-signature", f"--format={fmt}"]
    if spec:
        cmd += ["--", *spec]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    commits, sha, full, state, path, dpath, blob, newline, msgline = 0, "", "", "head", None, None, None, 0, 0
    seen_blobs = set()
    for raw in proc.stdout:
        line = raw.decode("utf-8", "replace").rstrip("\n")
        if line.startswith("\x01C "):
            full, state, path, dpath, commits = line[3:], "head", None, None, commits + 1
            sha = full[:12]
            continue
        if line.startswith("\x01A ") or line.startswith("\x01M "):
            who = "AUTHOR" if line[1] == "A" else "COMMITTER"
            sc.line(f"{sha}:{who}", who, line[3:], full)
            continue
        if line == "\x01B":
            state, msgline = "msg", 0
            continue
        if line == "\x01E":
            state = "diffhead"
            continue
        if state == "msg":
            msgline += 1
            sc.line(f"{sha}:COMMIT_MSG:{msgline}", "COMMIT_MSG", line, full)
            continue
        if line.startswith("diff --git "):
            state, path, blob = "diffhead", None, None
            dpath = diffgit_path(line)
            if dpath is not None and excluded(dpath):
                dpath = None
            continue
        if state == "diffhead":
            if line.startswith("index "):
                m = re.match(r"index ([0-9a-f]+)\.\.([0-9a-f]+)", line)
                blob = m.group(2) if m and m.group(2).strip("0") else None
                if blob and dpath is not None:
                    sc.path(f"{sha}:{sc.show(dpath)}", dpath, full)     # an added or changed path
            elif line.startswith("Binary files "):
                if blob and dpath is not None and blob not in seen_blobs:
                    seen_blobs.add(blob)
                    data = BLOBS.get(blob)
                    if data is not None:
                        scan_data(sc, f"{sha}:{sc.show(dpath)}", dpath, data, full)
            elif line.startswith("+++ "):
                p = cunquote(line[4:])
                path = None if p == "/dev/null" else (p[2:] if p.startswith("b/") else p)
                if path is not None and excluded(path):
                    path = None
            elif line.startswith("@@ "):
                m = re.match(r"@@ -\S+ \+(\d+)", line)
                newline, state = (int(m.group(1)) if m else 1), "hunk"
            continue
        if state == "hunk":
            if line.startswith("@@ "):
                m = re.match(r"@@ -\S+ \+(\d+)", line)
                newline = int(m.group(1)) if m else newline
            elif line.startswith("+"):
                if path is not None:
                    sc.line(f"{sha}:{sc.show(path)}:{newline}", path, line[1:], full)
                newline += 1
            elif line.startswith(" ") or line == "":
                newline += 1
    rc = proc.wait()
    if rc != 0:
        die(f"git log failed (exit {rc}): history not scanned")
    return commits


def main(argv):
    mode, rng, paths, i = "default", None, [], 0
    while i < len(argv):
        a = argv[i]
        if a in ("-h", "--help"):
            print(USAGE)
            return 0
        if a == "--history":
            if mode == "range":
                die("--history and --range do not go together")
            mode = "history"
        elif a == "--range" or a.startswith("--range="):
            if mode == "history":
                die("--history and --range do not go together")
            if a == "--range":
                i += 1
                if i >= len(argv):
                    die("--range needs a revision range, such as origin/main..HEAD")
                rng = argv[i]
            else:
                rng = a.split("=", 1)[1]
            if not rng or rng.startswith("-"):
                die("--range needs a revision range, such as origin/main..HEAD")
            mode = "range"
        elif a == "--":
            paths += argv[i + 1:]
            break
        elif a.startswith("-"):
            die(f"unknown option {a} ({USAGE})")
        else:
            paths.append(a)
        i += 1

    values, allow, fleet = load_secret_values(), load_allow(), load_fleet()
    sc = Scanner(values, allow, fleet)
    files, spec = collect(paths)
    scanned, binaries = scan_files(sc, files)
    staged = scan_index(sc, spec) if spec is not None else 0

    if spec is None:                      # every path given lies outside the repo: there is no history to read
        if mode != "default":
            die("--history and --range need a path inside the repo (or no path)")
        commits, label = 0, "skipped, no path inside the repo"
    else:
        revs, label, whole = resolve_revs(mode, rng)
        commits = 0
        if revs is not None:
            if git("rev-parse", "--is-shallow-repository").stdout.strip() == b"true":
                note("shallow clone: the history scan sees only the commits fetched here")
            commits = scan_history(sc, revs, spec)
            if whole and not spec and commits == 0 and label != "no commits yet":
                die("history scan read 0 commits although HEAD exists")
            if commits == 0 and not whole:
                label += ", empty"
    BLOBS.close()

    if binaries:
        more = f" (+{len(binaries) - 10} more)" if len(binaries) > 10 else ""
        note(f"binary files read as printable strings: {', '.join(binaries[:10])}{more}")
    summary = (f"scanned {scanned} files ({len(binaries)} binary), {staged} staged copies, "
               f"{commits} commits ({label})")
    for f in sc.findings:
        print(f)
    if sc.findings:
        print(f"secret-scan: FAIL · {len(sc.findings)} findings in {len(sc.places)} places · {summary}")
        return 1
    print(f"secret-scan: PASS · 0 findings · {summary}")
    return 0


try:
    sys.exit(main(sys.argv[1:]))
except SystemExit:
    raise
except BrokenPipeError:
    sys.exit(1)
except Exception as e:                    # never echo a value: report the error type only
    print(f"secret-scan: ERROR · {type(e).__name__}", file=sys.stderr)
    sys.exit(2)
PY

exec python3 -I -c "$PROG" "$@"
