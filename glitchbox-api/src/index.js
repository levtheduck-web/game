import { DurableObject } from "cloudflare:workers";

// The OAuth client the ID tokens must be minted for.
const CLIENT_ID = "292202234478-kdcu37vvdogpttpksc6acg85ljavkfj6.apps.googleusercontent.com";
const ALLOWED_ORIGINS = [
  "https://glitchbox-games.github.io",
  "https://levtheduck-web.github.io",
  "http://localhost:8095",
  "http://127.0.0.1:8095",
];
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
// Friend-code alphabet: no 0/O/1/I/L to avoid confusion. Same style as the room codes.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;
const ROOM_LEN = 4;              // game-room codes are shorter — typed by hand mid-session
const ROOM_MAX_PLAYERS = 16;     // party games seat up to sixteen; 1v1 games ask for 2
const INVITE_TTL = 10 * 60 * 1000; // a game invite goes stale after 10 minutes
const ONLINE_WINDOW = 90 * 1000;   // "online" = seen within 90s (hub polls every ~20s)
const SAVE_MAX_BYTES = 512 * 1024; // per game-save cap — a colony snapshot is a few KB
const GUEST_KEEP = 30 * 86400000;  // guests unseen for a month drop out of the list
// A guest's device id, minted in their browser (glitchbox-menu.js / index.html).
const GID_RE = /^g[a-z0-9]{8,24}$/;
const GAME_RE = /^[a-z0-9-]{1,60}\.html$/i;
function guestName(gid) { return "Guest " + String(gid).slice(-4).toUpperCase(); }
const ROOM_RE = /^[A-Z0-9]{3,8}$/;
// GLITCHBOX doesn't record which games people played or for how long. It only knows what
// someone is playing right now (for friends' Join button and for moderation) and keeps a
// count of how many people visited each day, with no names attached (`day_stats`).
// Token trades between friends. The wallet lives in each browser, so these caps are what
// stop an edited wallet from flooding everyone else's.
const TRADE_MAX = 500, TRADE_DAY_SEND = 1000, TRADE_DAY_RECV = 2000;
const TRADE_KEEP = 30 * 86400000;
// "Mozilla/5.0 (X11; CrOS x86_64 …)" → "Chromebook". Only the rough kind of device is kept.
function deviceKind(ua) {
  const s = String(ua || "");
  if (!s) return "";
  if (!/[/;(]/.test(s)) return s.slice(0, 20);   // already a kind
  if (/CrOS/.test(s)) return "Chromebook";
  if (/iPad/.test(s)) return "iPad";
  if (/iPhone|iPod/.test(s)) return "iPhone";
  if (/Android/.test(s)) return /Mobile/.test(s) ? "Android phone" : "Android tablet";
  if (/Windows/.test(s)) return "Windows PC";
  if (/Macintosh|Mac OS X/.test(s)) return "Mac";
  if (/Linux/.test(s)) return "Linux PC";
  return "Other";
}
// IP addresses are never stored. Each one becomes a scrambled network code ("net:" + 16 hex)
// that still matches itself, so network bans work, but can't be turned back into the address.
const NET_RE = /^net:[0-9a-f]{16}$/;
const RAW_IP_RE = /^[0-9a-f.:]{3,64}$/i;
function utcDay(t) { return new Date(t).toISOString().slice(0, 10); }
// The relay games — what "Party Animal" counts, and the only games a friend can be joined in.
const MP_FILES = ["rocket-roadster.html", "haymaker.html", "car-mechanic.html", "bomb-squad.html", "heist-crew.html", "imposter.html", "most-likely-to.html", "rhyme-bomb.html", "scrawl.html", "gridlock.html",
  "blast-radius.html", "quoridor.html", "fib-factory.html", "spaceship-mp.html", "frontline.html"];
// "Dave Smith" → "Dave S." — leaderboards are seen by people who aren't your friends.
function shortName(n) {
  const w = String(n || "Player").trim().split(/\s+/);
  return w.length > 1 ? w[0] + " " + w[w.length - 1].charAt(0).toUpperCase() + "." : w[0];
}
function newerVersion(a, b) { return String(a || "").localeCompare(String(b || ""), undefined, { numeric: true }) >= 0; }

// ── small helpers ──
function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}
function b64urlEncode(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlEncodeStr(str) {
  return b64urlEncode(new TextEncoder().encode(str));
}
function b64urlDecodeStr(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
}
function makeCode(len) {
  const n = len || CODE_LEN;
  const rnd = new Uint8Array(n);
  crypto.getRandomValues(rnd);
  let s = "";
  for (const b of rnd) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}
// Length-independent, early-exit-free string compare, for the owner claim code.
function constantEq(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
// The arcade answers to exactly ONE account. Set it once with
//   npx wrangler secret put OWNER_EMAIL
// and that Google address is the owner on every request, forever. It lives in a
// secret rather than this (public) repo, and while it is set the claim code is
// dead — nobody else can take ownership, whatever they know.
function ownerPin(env) { return String((env && env.OWNER_EMAIL) || "").toLowerCase(); }

// An avatar chosen from the hub's icon grid, stored in `picture` as "icon:<id>".
function isIcon(p) { return /^icon:[a-z0-9-]{1,24}$/.test(String(p || "")); }
// Public view of another user — never leaks email.
// Public view of another user — never leaks email, real name or a Google photo (only arcade icons).
function pub(u) {
  return u ? { sub: u.sub, name: u.name, picture: isIcon(u.picture) ? u.picture : "" } : null;
}
// SQL for a public avatar column: arcade icons only — a Google photo is a face, and faces identify.
const PUB_PIC = "CASE WHEN u.picture LIKE 'icon:%' THEN u.picture ELSE '' END";

// ── nametags ── `users.name` is the player's chosen NAMETAG, which is all anyone else ever sees.
// The Google account name lives in `real_name`, for the owner console only.
const TAG_A = ["Neon","Pixel","Turbo","Cosmic","Shadow","Glitch","Hyper","Retro","Laser","Mega","Ultra","Rocket","Frost","Blaze","Thunder","Sneaky","Lucky","Wild","Atomic","Cyber","Electric","Silent","Fuzzy","Crimson"];
const TAG_B = ["Fox","Wolf","Tiger","Panda","Falcon","Ninja","Dragon","Shark","Otter","Raccoon","Comet","Viper","Golem","Phantom","Wizard","Pilot","Racer","Llama","Yeti","Kraken","Moose","Badger","Gecko","Bandit"];
const TAG_BLOCK = ["admin","owner","moderator","staff","glitchbox","official","system","support",
  "fuck","shit","bitch","cunt","nigg","fag","dick","cock","pussy","porn","sex","rape","nazi","hitler","whore","slut","retard","penis","vagina","anal","boob","kill yourself","kys"];
function randomTag() { const r = n => Math.floor(Math.random() * n); return TAG_A[r(TAG_A.length)] + TAG_B[r(TAG_B.length)] + (10 + r(90)); }
// Returns the cleaned tag, or throws a 400 the hub shows to the player as-is.
function cleanTag(raw) {
  const t = String(raw || "").replace(/\s+/g, " ").trim();
  if (t.length < 3 || t.length > 16) throw new HttpError(400, "Nametags are 3 to 16 characters.");
  if (!/^[A-Za-z0-9 _.\-]+$/.test(t)) throw new HttpError(400, "Use letters, numbers, spaces, _ - and . only.");
  if (!/[A-Za-z]/.test(t)) throw new HttpError(400, "Put at least one letter in it.");
  const flat = t.toLowerCase().replace(/[^a-z0-9]/g, "");
  const leet = flat.replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t");
  if (TAG_BLOCK.some(w => { const k = w.replace(/[^a-z]/g, ""); return flat.includes(k) || leet.includes(k); })) throw new HttpError(400, "That nametag isn't allowed — pick another.");
  if (/^player\s*\d*$/i.test(t)) throw new HttpError(400, "Make it yours — not just \"Player\".");
  return t;
}
// A nametag that contains your real first/last name or email name would defeat the point.
function looksLikeRealName(tag, realName, email) {
  const flat = String(tag).toLowerCase().replace(/[^a-z]/g, "");
  const parts = String(realName || "").toLowerCase().split(/[^a-z]+/).concat([String(email || "").toLowerCase().split("@")[0].replace(/[^a-z]/g, "")]);
  return parts.some(w => w && w.length >= 3 && flat.includes(w));
}

// NOTE: errors thrown from a Durable Object RPC method lose custom properties
// (only `message` crosses the boundary), so we encode the status INTO the message
// as "<status>:<text>" and parse it back out in the Worker router.
class HttpError extends Error {
  constructor(status, msg) { super(status + ":" + msg); this.status = status; }
}

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS users (
        sub TEXT PRIMARY KEY, email TEXT, name TEXT, picture TEXT,
        code TEXT, created INTEGER, last_seen INTEGER)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS friends (
        a TEXT, b TEXT, created INTEGER, PRIMARY KEY (a, b))`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS requests (
        from_sub TEXT, to_sub TEXT, created INTEGER, PRIMARY KEY (from_sub, to_sub))`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS blocks (
        blocker TEXT, blocked TEXT, created INTEGER, PRIMARY KEY (blocker, blocked))`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT, reporter TEXT, reported TEXT,
        reason TEXT, created INTEGER)`);
      // Game invites: "come play <game> with me in room <room>". One live invite per
      // (sender, recipient, game) — re-inviting refreshes the existing row.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS invites (
        from_sub TEXT, to_sub TEXT, game TEXT, room TEXT, created INTEGER,
        PRIMARY KEY (from_sub, to_sub, game))`);
      // Cloud game saves: one slot per (player, game). `box` is the opaque JSON
      // the game's own save() produced — the backend never interprets it.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS saves (
        sub TEXT, game TEXT, box TEXT, updated INTEGER,
        PRIMARY KEY (sub, game))`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`);
      // Owner gifts waiting to be banked. The wallet lives in each player's browser,
      // so a gift only sits here until their hub picks it up and acks it.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS gifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, sub TEXT, tokens INTEGER,
        games TEXT, icons TEXT, note TEXT, created INTEGER)`);
      // Defensive: add `code` column if this DO predates the friend-code feature.
      try { this.sql.exec("ALTER TABLE users ADD COLUMN code TEXT"); } catch (e) { /* already there */ }
      // …and the moderation columns, for a DO that predates the admin console.
      try { this.sql.exec("ALTER TABLE users ADD COLUMN banned INTEGER"); } catch (e) { /* already there */ }
      try { this.sql.exec("ALTER TABLE users ADD COLUMN ban_reason TEXT"); } catch (e) { /* already there */ }
      // Google tells us whether it vouches for the address; the owner pin insists on it.
      try { this.sql.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER"); } catch (e) { /* already there */ }
      // Timed bans lift themselves; `playing` is what game page the player last pinged from.
      try { this.sql.exec("ALTER TABLE users ADD COLUMN ban_until INTEGER"); } catch (e) { /* already there */ }
      try { this.sql.exec("ALTER TABLE users ADD COLUMN playing TEXT"); } catch (e) { /* already there */ }
      try { this.sql.exec("ALTER TABLE users ADD COLUMN playing_at INTEGER"); } catch (e) { /* already there */ }
      // Every owner action, newest first in the console's Log tab.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS admin_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, action TEXT, target TEXT, detail TEXT)`);
      this.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_code ON users(code)");
      // Guests have no account, so they're tracked by a random device id their browser
      // keeps. `ip` is the last address they pinged from — what an IP ban matches.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS guests (
        gid TEXT PRIMARY KEY, label TEXT, ip TEXT, ua TEXT, created INTEGER, last_seen INTEGER,
        playing TEXT, playing_at INTEGER, banned INTEGER, ban_reason TEXT, ban_until INTEGER)`);
      // Network bans: catch a guest who simply clears their browser to get a new id.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS ip_bans (
        ip TEXT PRIMARY KEY, reason TEXT, until INTEGER, created INTEGER, label TEXT)`);
      // One-shot deliveries picked up by the next ping: kicks and pop-up messages.
      // `who` is "u:<sub>" or "g:<gid>".
      this.sql.exec(`CREATE TABLE IF NOT EXISTS pending (
        id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT, kind TEXT, text TEXT, created INTEGER)`);
      // In-game gifts (e.g. Idle Universe energy). Unlike `pending`, these wait for a ping
      // from that exact game, so the hub or another game can't swallow them.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS game_gifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT, game TEXT, amount REAL, note TEXT, created INTEGER)`);
      try { this.sql.exec("ALTER TABLE users ADD COLUMN last_ip TEXT"); } catch (e) { /* already there */ }
      // Which version of the terms this player agreed to, and when — the record of consent.
      try { this.sql.exec("ALTER TABLE users ADD COLUMN tos_version TEXT"); } catch (e) { /* already there */ }
      try { this.sql.exec("ALTER TABLE users ADD COLUMN tos_at INTEGER"); } catch (e) { /* already there */ }
      // Guests agree to the terms too (once per browser); their ping reports the version.
      try { this.sql.exec("ALTER TABLE guests ADD COLUMN tos_version TEXT"); } catch (e) { /* already there */ }
      try { this.sql.exec("ALTER TABLE users ADD COLUMN last_ua TEXT"); } catch (e) { /* already there */ }
      // The multiplayer room a player is in right now (so friends can join them),
      // "mod" for moderators, and the "hide what I'm playing from friends" switch.
      try { this.sql.exec("ALTER TABLE users ADD COLUMN room TEXT"); } catch (e) { /* already there */ }
      try { this.sql.exec("ALTER TABLE users ADD COLUMN role TEXT"); } catch (e) { /* already there */ }
      try { this.sql.exec("ALTER TABLE users ADD COLUMN hide_activity INTEGER"); } catch (e) { /* already there */ }
      // Ban appeals. `who` is "u:<sub>" or "g:<gid>"; `ip` lets an accepted appeal lift a network ban.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS appeals (
        id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT, name TEXT, ip TEXT, text TEXT, created INTEGER,
        status TEXT, reply TEXT, decided_at INTEGER)`);
      // Which browsers (guest device ids) each account has signed in from. A ban on either
      // side follows the link: a banned device can't sign in to a fresh Google account,
      // and a banned account's browser can't play on as a guest or under a second account.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS device_links (
        sub TEXT, gid TEXT, seen INTEGER, PRIMARY KEY (sub, gid))`);
      this.sql.exec("CREATE INDEX IF NOT EXISTS idx_device_links_gid ON device_links(gid)");
      // Best score per player per game, for games that report one. `low` = lower is better (golf).
      this.sql.exec(`CREATE TABLE IF NOT EXISTS scores (
        game TEXT, sub TEXT, score REAL, low INTEGER, at INTEGER, PRIMARY KEY (game, sub))`);
      // Owner-run contests. kind "score" = best GLITCHBOX.score() posted inside the window;
      // kind "time" = most minutes played (game "*" = anywhere in the arcade). When one ends,
      // settleContests() pays the prizes through the gifts table and records the winners.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS contests (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, game TEXT, kind TEXT, low INTEGER,
        starts INTEGER, ends INTEGER, prizes TEXT, prize_game TEXT, note TEXT,
        status TEXT, winners TEXT, created INTEGER)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS contest_scores (
        cid INTEGER, sub TEXT, score REAL, at INTEGER, PRIMARY KEY (cid, sub))`);
      // Nametags: `name` becomes the chosen tag; the Google name moves to `real_name` (owner-only).
      try { this.sql.exec("ALTER TABLE users ADD COLUMN real_name TEXT"); } catch (e) { /* already there */ }
      try { this.sql.exec("ALTER TABLE users ADD COLUMN tag_set INTEGER"); } catch (e) { /* already there */ }
      try { this.sql.exec("ALTER TABLE users ADD COLUMN tag_at INTEGER"); } catch (e) { /* already there */ }
      // One-time move for accounts made before nametags: keep the Google name privately and give
      // everyone a random tag until they choose their own (the hub asks them on their next visit).
      for (const u of this.sql.exec("SELECT sub, name FROM users WHERE real_name IS NULL").toArray()) {
        this.sql.exec("UPDATE users SET real_name = ?, name = ?, tag_set = 0 WHERE sub = ?", u.name || "", this.freeTag(), u.sub);
      }
      // How many players and guests visited each day (UTC). Just the numbers, nobody's name.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS day_stats (day TEXT PRIMARY KEY, players INTEGER, guests INTEGER)`);
      // A moderator's ban only happens once the owner approves it. `who` is "u:<sub>" or "g:<gid>";
      // status is open / approved / denied.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS ban_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT, name TEXT, reason TEXT, hours INTEGER,
        by_sub TEXT, by_name TEXT, created INTEGER, status TEXT, decided_at INTEGER)`);
      // Tokens sent between friends. Kept a month, for the daily caps and the owner console.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT, from_sub TEXT, to_sub TEXT, tokens INTEGER, created INTEGER)`);
      this.sql.exec("CREATE INDEX IF NOT EXISTS idx_trades_from ON trades(from_sub, created)");
      this.sql.exec("CREATE INDEX IF NOT EXISTS idx_trades_to ON trades(to_sub, created)");
      // A gift from another player (a trade) carries their nametag; owner gifts leave it empty.
      try { this.sql.exec("ALTER TABLE gifts ADD COLUMN from_name TEXT"); } catch (e) { /* already there */ }
      // Ensure a signing secret exists.
      const row = this.sql.exec("SELECT v FROM meta WHERE k='secret'").toArray()[0];
      if (!row) {
        const rnd = new Uint8Array(32);
        crypto.getRandomValues(rnd);
        this.secret = b64urlEncode(rnd);
        this.sql.exec("INSERT INTO meta (k, v) VALUES ('secret', ?)", this.secret);
      } else {
        this.secret = row.v;
      }
      // The key that scrambles IP addresses into network codes. Separate from the session secret.
      if (!this.metaGet("netsalt")) {
        const rnd = new Uint8Array(32);
        crypto.getRandomValues(rnd);
        this.metaSet("netsalt", b64urlEncode(rnd));
      }
      await this.privacyMigrate();
      // 2026-10-13 (later): play history is no longer kept at all. Drop what was there.
      if (!this.metaGet("privacy2")) {
        try {
          this.sql.exec("DROP TABLE IF EXISTS activity");
          this.sql.exec("DROP TABLE IF EXISTS play_days");
          this.metaSet("privacy2", String(Date.now()));
        } catch (e) { console.error("dropping play history failed, will retry:", e && e.stack || e); }
      }
    });
  }

  // One-time cleanup (2026-10-13) for data stored before the privacy changes: scramble saved
  // IP addresses, cut browser strings down to the kind of device, drop Google photos, take
  // emails and addresses out of the console log. Codes are worked out first, then every write happens in one transaction, so a
  // failure leaves the old data untouched (and the API still starts) and it retries next time.
  async privacyMigrate() {
    if (this.metaGet("privacy1")) return;
    try {
      const users = this.sql.exec("SELECT sub, last_ip, last_ua FROM users").toArray();
      const guests = this.sql.exec("SELECT gid, ip, ua FROM guests").toArray();
      const appeals = this.sql.exec("SELECT id, ip FROM appeals").toArray();
      const bans = this.sql.exec("SELECT ip, reason, until, created, label FROM ip_bans").toArray();
      const logIps = this.sql.exec("SELECT id, detail FROM admin_log WHERE action IN ('ban-ip', 'unban-ip')").toArray()
        .map(l => ({ id: l.id, m: /^([0-9a-f.:]{3,64})(.*)$/is.exec(String(l.detail || "")) })).filter(l => l.m && !NET_RE.test(l.m[1]));
      const nets = {};
      for (const ip of [...users.map(u => u.last_ip), ...guests.map(g => g.ip), ...appeals.map(a => a.ip), ...bans.map(b => b.ip), ...logIps.map(l => l.m[1])])
        if (ip && !(ip in nets)) nets[ip] = await this.netOf(ip);
      const net = ip => (ip ? nets[ip] : ip);
      this.ctx.storage.transactionSync(() => {
        for (const u of users) this.sql.exec("UPDATE users SET last_ip = ?, last_ua = ? WHERE sub = ?", net(u.last_ip), deviceKind(u.last_ua), u.sub);
        for (const g of guests) this.sql.exec("UPDATE guests SET ip = ?, ua = ? WHERE gid = ?", net(g.ip), deviceKind(g.ua), g.gid);
        for (const a of appeals) this.sql.exec("UPDATE appeals SET ip = ? WHERE id = ?", net(a.ip), a.id);
        this.sql.exec("DELETE FROM ip_bans");
        for (const b of bans)
          this.sql.exec("INSERT OR REPLACE INTO ip_bans (ip, reason, until, created, label) VALUES (?, ?, ?, ?, ?)",
            net(b.ip), b.reason, b.until, b.created, b.label);
        for (const l of logIps) this.sql.exec("UPDATE admin_log SET detail = ? WHERE id = ?", net(l.m[1]) + l.m[2], l.id);
        for (const l of this.sql.exec("SELECT id, target FROM admin_log WHERE target LIKE '%<%@%>%'").toArray())
          this.sql.exec("UPDATE admin_log SET target = ? WHERE id = ?", String(l.target).replace(/\s*<[^>]*@[^>]*>/g, ""), l.id);
        this.sql.exec("UPDATE users SET picture = '' WHERE picture IS NOT NULL AND picture NOT LIKE 'icon:%'");
        this.metaSet("privacy1", String(Date.now()));
      });
    } catch (e) {
      console.error("privacy cleanup failed, will retry on the next start:", e && e.stack || e);
    }
  }

  // IP address → network code. Empty stays empty; a code passes through unchanged.
  async netOf(ip) {
    const s = String(ip || "").trim();
    if (!s || NET_RE.test(s)) return s;
    if (!this.netKey) this.netKey = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(this.metaGet("netsalt")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", this.netKey, new TextEncoder().encode(s.toLowerCase())));
    return "net:" + [...sig.slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async hmac(msg) {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(this.secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
    return b64urlEncode(new Uint8Array(sig));
  }

  async makeSession(sub) {
    const payload = b64urlEncodeStr(JSON.stringify({ sub, exp: Date.now() + SESSION_TTL }));
    return payload + "." + (await this.hmac(payload));
  }

  async verifySession(token, allowBanned) {
    if (!token) throw new HttpError(401, "no session");
    const [payload, sig] = token.split(".");
    if (!payload || !sig) throw new HttpError(401, "bad session");
    if ((await this.hmac(payload)) !== sig) throw new HttpError(401, "bad signature");
    let data;
    try { data = JSON.parse(b64urlDecodeStr(payload)); } catch { throw new HttpError(401, "bad payload"); }
    if (!data.exp || data.exp < Date.now()) throw new HttpError(401, "session expired");
    // One check here covers every authenticated endpoint: a banned account can hold a
    // valid session token and still do nothing with it.
    // (Appeals are the one thing a banned account may still do.)
    const ban = allowBanned ? null : this.activeBan(this.userOf(data.sub));
    if (ban) throw new HttpError(403, ban);
    return data.sub;
  }

  userOf(sub) {
    return this.sql.exec(
      "SELECT sub, email, name, picture, code, created, banned, ban_reason, ban_until, email_verified, tos_version, tos_at, role, hide_activity, tag_set FROM users WHERE sub = ?",
      sub).toArray()[0] || null;
  }

  tagTaken(tag, notSub) {
    return !!this.sql.exec("SELECT 1 FROM users WHERE LOWER(name) = LOWER(?) AND sub != ?", tag, notSub || "").toArray()[0];
  }
  freeTag() { for (let i = 0; i < 30; i++) { const t = randomTag(); if (!this.tagTaken(t)) return t; } return "Player" + Date.now().toString(36).slice(-5); }

  // A few unused suggestions for the picker's 🎲 button.
  async tagIdeas(token) { await this.verifySession(token, true); const out = new Set(); for (let i = 0; i < 40 && out.size < 6; i++) { const t = randomTag(); if (!this.tagTaken(t)) out.add(t); } return { ideas: [...out] }; }

  async setTag(token, raw) {
    const me = await this.verifySession(token);
    // The owner can wear any nametag at all — no word list, no real-name check, no cooldown, even one
    // someone else has (they get a random tag and pick again). Only markup and blank tags are refused.
    if (this.isOwnerSub(me)) {
      const t = String(raw || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 24) throw new HttpError(400, "1 to 24 characters.");
      const holder = this.sql.exec("SELECT sub, name FROM users WHERE LOWER(name) = LOWER(?) AND sub != ?", t, me).toArray()[0];
      if (holder) { const nt = this.freeTag(); this.sql.exec("UPDATE users SET name = ?, tag_set = 0 WHERE sub = ?", nt, holder.sub); this.log("tag-reset", holder.sub, "owner took " + holder.name + " → " + nt); }
      this.sql.exec("UPDATE users SET name = ?, tag_set = 1, tag_at = ? WHERE sub = ?", t, Date.now(), me);
      return { ok: true, name: t };
    }
    const tag = cleanTag(raw);
    const u = this.sql.exec("SELECT name, real_name, email, tag_at FROM users WHERE sub = ?", me).toArray()[0];
    if (!u) throw new HttpError(404, "no such user");
    if (u.name === tag) { this.sql.exec("UPDATE users SET tag_set = 1 WHERE sub = ?", me); return { ok: true, name: tag }; }
    if (u.tag_at && Date.now() - u.tag_at < 20000) throw new HttpError(429, "Slow down — you can change your nametag again in a few seconds.");
    if (looksLikeRealName(tag, u.real_name, u.email)) throw new HttpError(400, "That looks like your real name — the point is to keep it private. Pick something else.");
    if (this.tagTaken(tag, me)) throw new HttpError(409, "Someone already has that nametag.");
    this.sql.exec("UPDATE users SET name = ?, tag_set = 1, tag_at = ? WHERE sub = ?", tag, Date.now(), me);
    return { ok: true, name: tag };
  }

  // The 403 message for a banned user, or null. Format "banned:<until>:<reason>",
  // where <until> is empty for a permanent ban. An expired timed ban is lifted here.
  activeBan(u) {
    if (!u || !u.banned) return null;
    if (u.ban_until && u.ban_until <= Date.now()) {
      this.sql.exec("UPDATE users SET banned = NULL, ban_reason = NULL, ban_until = NULL WHERE sub = ?", u.sub);
      return null;
    }
    return "banned:" + (u.ban_until || "") + ":" + (u.ban_reason || "");
  }

  log(action, targetSub, detail, actor) {
    const u = targetSub && targetSub !== "*" ? this.userOf(targetSub) : null;
    const target = targetSub === "*" ? "everyone" : u ? u.name + (u.code ? " #" + u.code : "") : (targetSub || "");
    this.sql.exec("INSERT INTO admin_log (at, action, target, detail) VALUES (?, ?, ?, ?)",
      Date.now(), action, target, (String(detail || "") + (actor ? " (by " + actor + ")" : "")).trim().slice(0, 300));
    this.sql.exec("DELETE FROM admin_log WHERE id <= (SELECT MAX(id) FROM admin_log) - 500");
  }

  // Arcade-wide switches, kept in `meta` as JSON. Both are public (see health()).
  metaJson(k) { try { return JSON.parse(this.metaGet(k) || "null"); } catch { return null; } }
  announcement() {
    const a = this.metaJson("announce");
    return a && a.text && (!a.until || a.until > Date.now()) ? a : null;
  }
  maintenance() { const m = this.metaJson("maintenance"); return m && m.on ? m : null; }
  // Games the owner switched off, "every open page reload" stamp, guest lock-out.
  disabledGames() { const d = this.metaJson("disabled"); return Array.isArray(d) ? d : []; }
  reloadStamp() { return Number(this.metaGet("reload")) || 0; }
  guestsLocked() { return this.metaGet("guestsLocked") === "1"; }
  featured() { const f = this.metaGet("featured"); return f && GAME_RE.test(f) ? f : null; }
  switches() {
    return { announce: this.announcement(), maintenance: this.maintenance(), disabled: this.disabledGames(),
             reload: this.reloadStamp(), guestsLocked: this.guestsLocked(), featured: this.featured() };
  }

  // The 403 for a banned network, or null. Same "banned:<until>:<reason>" shape as an
  // account ban so every client already knows how to show it.
  ipBan(ip) {
    if (!ip) return null;
    const b = this.sql.exec("SELECT ip, reason, until FROM ip_bans WHERE ip = ?", ip).toArray()[0];
    if (!b) return null;
    if (b.until && b.until <= Date.now()) { this.sql.exec("DELETE FROM ip_bans WHERE ip = ?", ip); return null; }
    return "banned:" + (b.until || "") + ":" + (b.reason || "");
  }
  guestOf(gid) { return this.sql.exec("SELECT * FROM guests WHERE gid = ?", gid).toArray()[0] || null; }
  guestBan(g) {
    if (!g || !g.banned) return null;
    if (g.ban_until && g.ban_until <= Date.now()) {
      this.sql.exec("UPDATE guests SET banned = NULL, ban_reason = NULL, ban_until = NULL WHERE gid = ?", g.gid);
      return null;
    }
    return "banned:" + (g.ban_until || "") + ":" + (g.ban_reason || "");
  }
  // The ban on this browser, or null: either the device itself is banned, or some
  // other account that signed in on it is. The owner's own account never counts.
  deviceBan(gid, exceptSub) {
    if (!GID_RE.test(String(gid || ""))) return null;
    const gb = this.guestBan(this.guestOf(gid));
    if (gb) return gb;
    const subs = this.sql.exec("SELECT sub FROM device_links WHERE gid = ? AND sub != ?", gid, exceptSub || "").toArray();
    for (const r of subs) {
      if (this.isOwnerSub(r.sub)) continue;
      const b = this.activeBan(this.userOf(r.sub));
      if (b) return b;
    }
    return null;
  }
  linkDevice(sub, gid) {
    if (!sub || !GID_RE.test(String(gid || ""))) return;
    this.sql.exec(`INSERT INTO device_links (sub, gid, seen) VALUES (?, ?, ?)
      ON CONFLICT(sub, gid) DO UPDATE SET seen = excluded.seen`, sub, gid, Date.now());
  }
  // Put a device's ban on the account that just showed up on it, so signing in from
  // another browser afterwards doesn't get them out of it either.
  carryBan(sub, ban) {
    const m = /^banned:(\d*):([\s\S]*)$/.exec(ban || "");
    if (!m || !this.userOf(sub)) return;
    this.sql.exec("UPDATE users SET banned = 1, ban_reason = ?, ban_until = ? WHERE sub = ?",
      m[2] || null, m[1] ? +m[1] : null, sub);
    this.log("ban", sub, "automatic: signed in on a banned device" + (m[1] ? "" : " (permanent)") + (m[2] ? " — " + m[2] : ""), "");
  }

  // Unbanning has to lift the whole web a ban spread across: the accounts and browsers
  // linked through device_links. Otherwise a still-banned browser (or second account)
  // re-bans the person the moment they come back. Start is "u:<sub>" or "g:<gid>".
  // Returns how many extra accounts/devices it cleared besides the start.
  liftLinkedBans(start) {
    const seen = new Set([start]), queue = [start];
    let lifted = 0;
    while (queue.length && seen.size < 60) {
      const cur = queue.shift();
      const next = cur[0] === "u"
        ? this.sql.exec("SELECT gid FROM device_links WHERE sub = ?", cur.slice(2)).toArray().map(r => "g:" + r.gid)
        : this.sql.exec("SELECT sub FROM device_links WHERE gid = ?", cur.slice(2)).toArray().map(r => "u:" + r.sub);
      for (const n of next) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    for (const w of seen) {
      if (w === start) continue;
      const id = w.slice(2);
      if (w[0] === "u") {
        const u = this.userOf(id);
        if (u && u.banned) { this.sql.exec("UPDATE users SET banned = NULL, ban_reason = NULL, ban_until = NULL WHERE sub = ?", id); lifted++; }
      } else {
        const g = this.guestOf(id);
        if (g && g.banned) {
          this.sql.exec("UPDATE guests SET banned = NULL, ban_reason = NULL, ban_until = NULL WHERE gid = ?", id);
          if (g.ip) this.sql.exec("DELETE FROM ip_bans WHERE ip = ? AND label = ?", g.ip, g.label || guestName(g.gid));
          lifted++;
        }
      }
    }
    return lifted;
  }

  // Hand over (and forget) whatever kicks and messages are waiting for `who`.
  takePending(who) {
    const rows = this.sql.exec("SELECT id, kind, text FROM pending WHERE who = ? ORDER BY id", who).toArray();
    if (rows.length) this.sql.exec("DELETE FROM pending WHERE who = ?", who);
    const kick = rows.filter(r => r.kind === "kick").pop();
    return { kick: kick ? (kick.text || "") : null,
             messages: rows.filter(r => r.kind === "msg").map(r => r.text) };
  }
  // In-game gifts waiting for `who` in `game`; handed over once.
  takeGameGifts(who, game) {
    if (!game) return [];
    const rows = this.sql.exec("SELECT id, amount, note FROM game_gifts WHERE who = ? AND game = ? ORDER BY id", who, game).toArray();
    if (rows.length) this.sql.exec("DELETE FROM game_gifts WHERE who = ? AND game = ?", who, game);
    return rows.map(r => ({ amount: r.amount, note: r.note || "" }));
  }

  // ── owner / admin ──
  // The owner is one account, recorded once in `meta` and never inferred from the
  // request, so nothing a client sends can promote itself.
  metaGet(k) { const r = this.sql.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0]; return r ? r.v : null; }
  metaSet(k, v) {
    this.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
  }
  ownerSub() { return this.metaGet("owner"); }
  // Single source of truth for "is this account the owner", used by both the
  // /api/me verdict and every admin endpoint. With OWNER_EMAIL set, the answer is
  // recomputed from the pinned address on every call — a stale `meta.owner` row,
  // a leaked claim code or a hand-edited client can't survive this check.
  // email_verified is only trusted to *reject*: NULL means "signed in before this
  // column existed", which must not lock the real owner out of their own arcade.
  isOwnerSub(sub) {
    if (!sub) return false;
    const pin = ownerPin(this.env);
    if (!pin) return !!this.ownerSub() && this.ownerSub() === sub;
    const u = this.userOf(sub);
    return !!u && String(u.email || "").toLowerCase() === pin && u.email_verified !== 0;
  }
  // Public health, deliberately a boolean and nothing more: the pinned address
  // itself never leaves the Worker. The same flag already ships to every signed-in
  // client via /api/me — having it here is what makes "did OWNER_EMAIL actually
  // reach the Durable Object?" answerable without an owner session, which is the
  // one question a locked-out owner cannot otherwise ask.
  health() {
    // `privacy` = both 2026-10-13 cleanups have run: stored IPs, devices and photos were
    // scrubbed, and the old play history was deleted.
    return { ok: true, service: "glitchbox-api", ownerPinned: !!ownerPin(this.env),
             privacy: !!this.metaGet("privacy1") && !!this.metaGet("privacy2"), ...this.switches() };
  }

  // Diagnostic companion to isOwnerSub: same two conditions, reported separately.
  ownerCheck(sub) {
    if (!ownerPin(this.env)) return null;
    const u = this.userOf(sub);
    if (!u) return { emailMatches: false, emailVerified: false, email: "" };
    return { emailMatches: String(u.email || "").toLowerCase() === ownerPin(this.env),
             emailVerified: u.email_verified !== 0,
             // The server's copy of the caller's own address — which is the one the pin
             // is compared against, and can drift from the client's cached currentUser.
             email: String(u.email || "") };
  }

  isModSub(sub) { const u = sub && this.userOf(sub); return !!u && u.role === "mod"; }
  // Owner or moderator. Moderators get the console's people tools with limits (see
  // each method) and never see real names, emails, network codes, devices or play history.
  async requireStaff(token) {
    const me = await this.verifySession(token);
    if (this.isOwnerSub(me)) return { me, owner: true, actor: "" };
    if (this.isModSub(me)) return { me, owner: false, actor: this.userOf(me).name };
    throw new HttpError(403, "not the owner");
  }
  // A moderator can't act on the owner or another moderator.
  modCanTouch(st, sub) {
    if (st.owner) return;
    if (this.isOwnerSub(sub) || this.isModSub(sub)) throw new HttpError(403, "moderators can't do that to the owner or another moderator");
  }

  async requireOwner(token) {
    const me = await this.verifySession(token);
    if (!this.isOwnerSub(me)) throw new HttpError(403, "not the owner");
    return me;
  }
  // Assign a unique friend code if the user doesn't have one yet.
  ensureCode(sub) {
    const u = this.userOf(sub);
    if (u && u.code) return u.code;
    for (let i = 0; i < 12; i++) {
      const code = makeCode();
      const taken = this.sql.exec("SELECT 1 FROM users WHERE code = ?", code).toArray()[0];
      if (!taken) { this.sql.exec("UPDATE users SET code = ? WHERE sub = ?", code, sub); return code; }
    }
    throw new HttpError(500, "could not allocate code");
  }
  isFriend(x, y) {
    return !!this.sql.exec("SELECT 1 FROM friends WHERE a = ? AND b = ?", x, y).toArray()[0];
  }
  isBlockedBetween(x, y) {
    return !!this.sql.exec(
      "SELECT 1 FROM blocks WHERE (blocker = ? AND blocked = ?) OR (blocker = ? AND blocked = ?)",
      x, y, y, x).toArray()[0];
  }

  // ── game saves ──
  // Deliberately dumb storage: the payload is whatever a game's save() returned,
  // stored verbatim. A per-save cap keeps one runaway game from filling the DO.
  async saveGame(token, game, box) {
    const me = await this.verifySession(token);
    const g = String(game || "").slice(0, 64);
    if (!g) throw new HttpError(400, "no game");
    const raw = JSON.stringify(box === undefined ? null : box);
    if (raw.length > SAVE_MAX_BYTES) throw new HttpError(413, "save too large");
    this.sql.exec(
      `INSERT INTO saves (sub, game, box, updated) VALUES (?, ?, ?, ?)
       ON CONFLICT(sub, game) DO UPDATE SET box=excluded.box, updated=excluded.updated`,
      me, g, raw, Date.now());
    return { ok: true };
  }

  async loadGame(token, game) {
    const me = await this.verifySession(token);
    const row = this.sql.exec("SELECT box, updated FROM saves WHERE sub = ? AND game = ?",
      me, String(game || "")).toArray()[0];
    if (!row) return { box: null };
    let box = null;
    try { box = JSON.parse(row.box); } catch { /* corrupt row reads as "no save" */ }
    return { box, updated: row.updated };
  }

  async deleteGame(token, game) {
    const me = await this.verifySession(token);
    this.sql.exec("DELETE FROM saves WHERE sub = ? AND game = ?", me, String(game || ""));
    return { ok: true };
  }

  // Every game this player has a save for — lets the hub show "CONTINUE" badges.
  async listSaves(token) {
    const me = await this.verifySession(token);
    return {
      saves: this.sql.exec(
        "SELECT game, updated, LENGTH(box) AS bytes FROM saves WHERE sub = ? ORDER BY updated DESC",
        me).toArray(),
    };
  }

  // Pick-your-icon avatar: an "icon:<id>" token, or "" for none. Google photos are never kept.
  async setAvatar(token, picture) {
    const me = await this.verifySession(token);
    const p = String(picture || "");
    if (p !== "" && !isIcon(p)) throw new HttpError(400, "bad avatar");
    this.sql.exec("UPDATE users SET picture = ? WHERE sub = ?", p, me);
    return { ok: true, picture: p };
  }

  // ── endpoints ──
  async login(idToken, ip, devInfo, gid) {
    ip = await this.netOf(ip);
    let info;
    if (devInfo) info = devInfo;     // local tests only — see the router
    else {
      const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken || ""));
      if (!r.ok) throw new HttpError(401, "invalid Google token");
      info = await r.json();
    }
    if (info.aud !== CLIENT_ID) throw new HttpError(401, "token audience mismatch");
    if (!info.sub) throw new HttpError(401, "no subject");
    const now = Date.now();
    const existing = this.userOf(info.sub);
    const prevSeen = existing ? (this.sql.exec("SELECT last_seen FROM users WHERE sub = ?", info.sub).toArray()[0] || {}).last_seen : 0;
    // Signing in again must not hand a banned account a fresh session.
    const ban = this.activeBan(existing);
    if (ban) throw new HttpError(403, ban);
    // A banned network can't sign in its way out — except the owner, who is never locked out.
    const pinned = ownerPin(this.env) && String(info.email || "").toLowerCase() === ownerPin(this.env);
    const nb = !pinned && this.ipBan(ip);
    if (nb) throw new HttpError(403, nb);
    // A banned browser can't sign its way out with a different Google account.
    const owner = pinned || this.isOwnerSub(info.sub);
    const db = !owner && this.deviceBan(gid, info.sub);
    if (db) { if (existing) this.carryBan(info.sub, db); throw new HttpError(403, db); }
    // The Google photo is never kept: a player's avatar is an arcade icon or nothing.
    const picture = isIcon(existing && existing.picture) ? existing.picture : "";
    this.sql.exec(
      `INSERT INTO users (sub, email, name, real_name, tag_set, picture, created, last_seen)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT(sub) DO UPDATE SET email=excluded.email, real_name=excluded.real_name,
         picture=excluded.picture, last_seen=excluded.last_seen`,
      info.sub, info.email || "", this.freeTag(), info.name || info.email || "",
      picture, now, now);
    if (ip) this.sql.exec("UPDATE users SET last_ip = ? WHERE sub = ?", ip, info.sub);
    this.countDay("u", prevSeen, now);
    if (!existing) this.sql.exec("UPDATE users SET created = ? WHERE sub = ?", now, info.sub);
    this.sql.exec("UPDATE users SET email_verified = ? WHERE sub = ?",
      String(info.email_verified) === "false" ? 0 : 1, info.sub);
    // With OWNER_EMAIL pinned, that account is the owner the moment it signs in —
    // and re-pointing (not just filling a blank) means a previous claim-code owner
    // is demoted rather than left sitting in the row.
    const pin = ownerPin(this.env);
    if (pin && String(info.email || "").toLowerCase() === pin && String(info.email_verified) !== "false") {
      if (this.ownerSub() !== info.sub) this.metaSet("owner", info.sub);
    }
    this.ensureCode(info.sub);
    this.linkDevice(info.sub, gid);
    const session = await this.makeSession(info.sub);
    const profile = this.userOf(info.sub);
    return { sessionToken: session, profile, created: profile.created, isNew: !existing };
  }

  async state(token, ip) {
    ip = await this.netOf(ip);
    this.settleContests();
    const me = await this.verifySession(token);
    const now = Date.now();
    if (!this.isOwnerSub(me)) { const nb = this.ipBan(ip); if (nb) throw new HttpError(403, nb); }
    const prev = this.sql.exec("SELECT playing, playing_at, last_seen FROM users WHERE sub = ?", me).toArray()[0];
    this.countDay("u", prev && prev.last_seen, now);
    if (this.hubOverridden(prev, "", now)) this.sql.exec("UPDATE users SET last_seen = ? WHERE sub = ?", now, me);
    else {
      this.sql.exec("UPDATE users SET last_seen = ?, playing = '', playing_at = ?, room = '' WHERE sub = ?", now, now, me);
    }
    if (ip) this.sql.exec("UPDATE users SET last_ip = ? WHERE sub = ?", ip, me);
    if (!this.userOf(me).code) this.ensureCode(me);
    // Sweep stale invites so nobody is offered a room that has long since emptied.
    this.sql.exec("DELETE FROM invites WHERE created < ?", now - INVITE_TTL);
    const profile = this.userOf(me); // self — includes email + code
    // Friends see what you're playing (and can join your room) unless you hid it.
    const friends = this.sql.exec(
      `SELECT u.sub, u.name, ${PUB_PIC} AS picture, (u.last_seen > ?) AS online,
              CASE WHEN u.last_seen > ? AND u.playing_at > ? AND NOT IFNULL(u.hide_activity, 0) THEN u.playing ELSE NULL END AS playing,
              CASE WHEN u.last_seen > ? AND u.playing_at > ? AND NOT IFNULL(u.hide_activity, 0) THEN u.room ELSE NULL END AS room
       FROM friends f JOIN users u ON u.sub = f.b WHERE f.a = ? ORDER BY online DESC, u.name`,
      now - ONLINE_WINDOW, now - ONLINE_WINDOW, now - ONLINE_WINDOW, now - ONLINE_WINDOW, now - ONLINE_WINDOW, me).toArray()
      .map(f => ({ ...f, room: f.room && MP_FILES.includes(f.playing) ? f.room : null }));
    const incoming = this.sql.exec(
      `SELECT u.sub, u.name, ${PUB_PIC} AS picture, r.created FROM requests r
       JOIN users u ON u.sub = r.from_sub WHERE r.to_sub = ? ORDER BY r.created DESC`, me).toArray();
    const outgoing = this.sql.exec(
      `SELECT u.sub, u.name, ${PUB_PIC} AS picture, r.created FROM requests r
       JOIN users u ON u.sub = r.to_sub WHERE r.from_sub = ? ORDER BY r.created DESC`, me).toArray();
    const blocked = this.sql.exec(
      `SELECT u.sub, u.name, ${PUB_PIC} AS picture FROM blocks bl
       JOIN users u ON u.sub = bl.blocked WHERE bl.blocker = ? ORDER BY u.name`, me).toArray();
    const invitesIn = this.sql.exec(
      `SELECT i.game, i.room, i.created, u.sub, u.name, ${PUB_PIC} AS picture FROM invites i
       JOIN users u ON u.sub = i.from_sub WHERE i.to_sub = ? ORDER BY i.created DESC`, me).toArray();
    const invitesOut = this.sql.exec(
      `SELECT i.game, i.room, i.created, u.sub, u.name, ${PUB_PIC} AS picture FROM invites i
       JOIN users u ON u.sub = i.to_sub WHERE i.from_sub = ? ORDER BY i.created DESC`, me).toArray();
    const gifts = this.sql.exec(
      "SELECT id, tokens, games, icons, note, created, IFNULL(from_name, '') AS \"from\" FROM gifts WHERE sub = ? ORDER BY id", me).toArray()
      .map(g => ({ ...g, games: JSON.parse(g.games || "[]"), icons: JSON.parse(g.icons || "[]") }));
    return { profile, friends, incoming, outgoing, blocked, invitesIn, invitesOut, gifts,
             ...this.switches(), ...this.takePending("u:" + me),
             // `ownerPinned` lets the console explain *why* a non-owner can't claim.
             // The address itself is never sent — knowing it isn't the client's business.
             isOwner: this.isOwnerSub(me), isMod: !this.isOwnerSub(me) && this.isModSub(me),
             alerts: this.isOwnerSub(me) || this.isModSub(me) ? this.alerts() : null,
             ownerPinned: !!ownerPin(this.env),
             // Why the pin rejected *this* caller. Both facts are about the caller's own
             // row and neither reveals the pinned address, but together they turn a
             // locked-out owner's "it just doesn't work" into one readable line.
             ownerCheck: this.ownerCheck(me) };
  }

  // Cheap "am I still allowed in?" for game pages, which don't poll /api/me. A banned
  // session fails inside verifySession with 403 "banned:<reason>".
  // Works signed out too, so a guest's game page still learns about maintenance.
  // Guests ping with their device id (`gid`), which is how the owner can see, kick
  // and ban them. Kicks and pop-up messages ride back on the answer.
  async ping(token, game, gid, ip, ua, tos, room) {
    ip = await this.netOf(ip);
    ua = deviceKind(ua);
    const out = { ok: true, ...this.switches() };
    const g = GAME_RE.test(String(game || "")) ? String(game) : "";
    const now = Date.now();
    if (token) {
      const me = await this.verifySession(token);
      out.isOwner = this.isOwnerSub(me);
      if (!out.isOwner) { const nb = this.ipBan(ip); if (nb) throw new HttpError(403, nb); }
      if (GID_RE.test(String(gid || ""))) {
        this.linkDevice(me, gid);
        const db = !out.isOwner && this.deviceBan(gid, me);
        if (db) { this.carryBan(me, db); throw new HttpError(403, db); }
      }
      const prev = this.sql.exec("SELECT playing, playing_at, last_seen FROM users WHERE sub = ?", me).toArray()[0];
      const keep = this.hubOverridden(prev, g, now);
      this.countDay("u", prev && prev.last_seen, now);
      this.sql.exec("UPDATE users SET last_seen = ?, playing = ?, playing_at = ?, last_ip = COALESCE(?, last_ip), last_ua = COALESCE(?, last_ua) WHERE sub = ?",
        now, keep ? prev.playing : g, keep ? prev.playing_at : now, ip || null, ua || null, me);
      if (!keep) {
        const rm = String(room || "").toUpperCase();
        this.sql.exec("UPDATE users SET room = ? WHERE sub = ?", ROOM_RE.test(rm) && MP_FILES.includes(g) ? rm : "", me);
      }
      return { ...out, ...this.takePending("u:" + me), gameGifts: this.takeGameGifts("u:" + me, g) };
    }
    const nb = this.ipBan(ip);
    if (nb) throw new HttpError(403, nb);
    if (!GID_RE.test(String(gid || ""))) return out;
    const gprev = this.guestOf(gid);
    const gkeep = this.hubOverridden(gprev, g, now);
    this.countDay("g", gprev && gprev.last_seen, now);
    if (Math.random() < 0.02) this.prune(now);
    this.sql.exec(
      `INSERT INTO guests (gid, ip, ua, created, last_seen, playing, playing_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(gid) DO UPDATE SET ip = excluded.ip, ua = excluded.ua, last_seen = excluded.last_seen,
         playing = excluded.playing, playing_at = excluded.playing_at`,
      gid, ip || "", ua, now, now, gkeep ? gprev.playing : g, gkeep ? gprev.playing_at : now);
    if (/^[0-9a-z.-]{1,32}$/i.test(String(tos || "")))
      this.sql.exec("UPDATE guests SET tos_version = ? WHERE gid = ?", String(tos), gid);
    const ban = this.deviceBan(gid);
    if (ban) throw new HttpError(403, ban);
    out.guest = guestName(gid);
    return { ...out, ...this.takePending("g:" + gid), gameGifts: this.takeGameGifts("g:" + gid, g) };
  }

  // What someone is playing right now. The hub pings too, so with the hub and a game open in two tabs a hub ping would
  // flip them back to "in the hub" every few seconds. A game that pinged in the last
  // 20s wins; once its tab closes (or hides — hidden tabs don't ping) the hub takes over.
  hubOverridden(prev, game, now) {
    return game === "" && !!prev && !!prev.playing && now - (prev.playing_at || 0) < 20000;
  }
  // Count a visitor once per day: their first check-in on a new UTC day adds 1 to that day's
  // players or guests. No name, no game, no time is kept with it.
  countDay(kind, prevSeen, now) {
    if (prevSeen && utcDay(prevSeen) === utcDay(now)) return;
    this.sql.exec(`INSERT INTO day_stats (day, players, guests) VALUES (?, ?, ?)
      ON CONFLICT(day) DO UPDATE SET players = players + excluded.players, guests = guests + excluded.guests`,
      utcDay(now), kind === "u" ? 1 : 0, kind === "g" ? 1 : 0);
  }
  // Housekeeping now and then: old trades, old daily counts, answered ban requests.
  prune(now) {
    this.sql.exec("DELETE FROM trades WHERE created < ?", now - TRADE_KEEP);
    this.sql.exec("DELETE FROM day_stats WHERE day < ?", utcDay(now - 90 * 86400000));
    this.sql.exec("DELETE FROM ban_requests WHERE status != 'open' AND decided_at < ?", now - 30 * 86400000);
  }

  // The player ticked "I agree" on the terms screen.
  async acceptTos(token, version) {
    const me = await this.verifySession(token);
    const v = String(version || "").slice(0, 32);
    if (!/^[0-9a-z.-]{1,32}$/i.test(v)) throw new HttpError(400, "bad terms version");
    // Never move backwards: an old cached page posting an older version mustn't undo
    // a newer agreement (that is what kept re-asking people on every refresh).
    const cur = (this.userOf(me) || {}).tos_version;
    if (cur && String(cur).localeCompare(v, undefined, { numeric: true }) >= 0) return { ok: true, tos_version: cur };
    this.sql.exec("UPDATE users SET tos_version = ?, tos_at = ? WHERE sub = ?", v, Date.now(), me);
    return { ok: true, tos_version: v };
  }

  // The hub banked these gifts; drop them so no other device banks them again.
  async claimGifts(token, ids) {
    const me = await this.verifySession(token);
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, 200))
      this.sql.exec("DELETE FROM gifts WHERE sub = ? AND id = ?", me, Number(id) || 0);
    return { ok: true };
  }

  // Send tokens to a friend. The sender's hub has already taken them out of its wallet (and
  // puts them back if this fails); they reach the friend as a gift their hub banks.
  async trade(token, to, amount) {
    const me = await this.verifySession(token);
    const n = Math.trunc(Number(amount) || 0);
    if (n < 1) throw new HttpError(400, "Send at least 1 token.");
    if (n > TRADE_MAX) throw new HttpError(400, "You can send up to " + TRADE_MAX + " tokens at a time.");
    const u = this.userOf(String(to || ""));
    if (!u || u.sub === me) throw new HttpError(404, "That player isn't on your friends list.");
    if (!this.isFriend(me, u.sub)) throw new HttpError(403, "You can only send tokens to friends.");
    if (this.isBlockedBetween(me, u.sub)) throw new HttpError(403, "You can't send tokens to that player.");
    if (this.activeBan(u)) throw new HttpError(403, "That player is banned right now.");
    const now = Date.now(), since = now - 86400000;
    const sum = (col, sub) => this.sql.exec(`SELECT IFNULL(SUM(tokens), 0) AS n FROM trades WHERE ${col} = ? AND created > ?`, sub, since).toArray()[0].n;
    const sent = sum("from_sub", me);
    if (sent + n > TRADE_DAY_SEND)
      throw new HttpError(429, "You can send " + TRADE_DAY_SEND + " tokens a day. " + Math.max(0, TRADE_DAY_SEND - sent) + " left today.");
    if (sum("to_sub", u.sub) + n > TRADE_DAY_RECV)
      throw new HttpError(429, u.name + " has been sent all the tokens they can get today. Try tomorrow.");
    const from = this.userOf(me).name;
    this.sql.exec("INSERT INTO trades (from_sub, to_sub, tokens, created) VALUES (?, ?, ?, ?)", me, u.sub, n, now);
    this.sql.exec("INSERT INTO gifts (sub, tokens, games, icons, note, created, from_name) VALUES (?, ?, '[]', '[]', '', ?, ?)",
      u.sub, n, now, from);
    return { ok: true, to: u.name, tokens: n, leftToday: TRADE_DAY_SEND - sent - n };
  }

  // ══ ADMIN ══ Everything below answers only to the owner account.

  // One-time claim. The code is a Worker secret (`wrangler secret put ADMIN_CLAIM`), so
  // it never ships in the page, and the claim can only ever fire once.
  async adminClaim(token, code) {
    const me = await this.verifySession(token);
    if (ownerPin(this.env)) throw new HttpError(403, "this arcade is pinned to an owner account");
    if (this.ownerSub() === me) return { ok: true, already: true };
    if (this.ownerSub()) throw new HttpError(403, "owner already claimed");
    const secret = String((this.env && this.env.ADMIN_CLAIM) || "");
    if (!secret) throw new HttpError(503, "owner claim is not configured");
    if (!constantEq(String(code || ""), secret)) throw new HttpError(403, "bad claim code");
    this.metaSet("owner", me);
    return { ok: true };
  }

  async adminOverview(token) {
    const st = await this.requireStaff(token);
    const now = Date.now();
    const n = (q, ...a) => this.sql.exec(q, ...a).toArray()[0].n;
    return {
      counts: {
        players:     n("SELECT COUNT(*) AS n FROM users"),
        online:      n("SELECT COUNT(*) AS n FROM users WHERE last_seen > ?", now - ONLINE_WINDOW),
        newToday:    n("SELECT COUNT(*) AS n FROM users WHERE created > ?", now - 86400000),
        banned:      n("SELECT COUNT(*) AS n FROM users WHERE banned"),
        friendships: Math.floor(n("SELECT COUNT(*) AS n FROM friends") / 2),
        requests:    n("SELECT COUNT(*) AS n FROM requests"),
        invites:     n("SELECT COUNT(*) AS n FROM invites"),
        reports:     n("SELECT COUNT(*) AS n FROM reports"),
        saves:       n("SELECT COUNT(*) AS n FROM saves"),
        guestsOnline: n("SELECT COUNT(*) AS n FROM guests WHERE last_seen > ?", now - ONLINE_WINDOW),
        guestsToday: n("SELECT COUNT(*) AS n FROM guests WHERE last_seen > ?", now - 86400000),
        ipBans:      n("SELECT COUNT(*) AS n FROM ip_bans"),
        appeals:     n("SELECT COUNT(*) AS n FROM appeals WHERE status = 'open'"),
        mods:        n("SELECT COUNT(*) AS n FROM users WHERE role = 'mod'"),
      },
      isOwner: st.owner,
      topGames: this.sql.exec(
        "SELECT game, COUNT(*) AS players FROM saves GROUP BY game ORDER BY players DESC LIMIT 10").toArray(),
      recent: this.sql.exec(
        "SELECT sub, name, created FROM users ORDER BY created DESC LIMIT 8").toArray(),
      // Who is on right now, and where: '' = the hub, else the game file they pinged from.
      live: this.sql.exec(
        `SELECT u.sub, u.name, ${PUB_PIC} AS picture, u.last_seen, CASE WHEN u.playing_at > ? THEN u.playing ELSE '' END AS playing
         FROM users u WHERE u.last_seen > ? ORDER BY u.last_seen DESC LIMIT 50`,
        now - ONLINE_WINDOW, now - ONLINE_WINDOW).toArray(),
      liveGuests: this.sql.exec(
        `SELECT gid, label, last_seen, CASE WHEN playing_at > ? THEN playing ELSE '' END AS playing
         FROM guests WHERE last_seen > ? AND (banned IS NULL OR banned = 0) ORDER BY last_seen DESC LIMIT 50`,
        now - ONLINE_WINDOW, now - ONLINE_WINDOW).toArray().map(x => ({ ...x, name: x.label || guestName(x.gid) })),
      ...this.switches(),
    };
  }

  async adminPlayers(token, q, limit) {
    const st = await this.requireStaff(token);
    const term = "%" + String(q || "").toLowerCase() + "%";
    const lim = Math.min(200, Math.max(1, Number(limit) || 100));
    return {
      owner: this.ownerSub(),
      players: this.sql.exec(
        `SELECT u.sub, u.name, u.real_name, u.tag_set, u.email, u.picture, u.code, u.created, u.last_seen,
                u.banned, u.ban_reason, u.ban_until, u.tos_version, u.tos_at, u.role,
                CASE WHEN u.playing_at > ? THEN u.playing ELSE NULL END AS playing,
                (SELECT COUNT(*) FROM friends f WHERE f.a = u.sub)      AS friends,
                (SELECT COUNT(*) FROM saves s   WHERE s.sub = u.sub)    AS saves,
                (SELECT COUNT(*) FROM reports r WHERE r.reported = u.sub) AS reports,
                (SELECT COUNT(*) FROM gifts g   WHERE g.sub = u.sub)    AS gifts
         FROM users u
         WHERE ? = '%%' OR LOWER(u.name) LIKE ? OR (? AND (LOWER(IFNULL(u.real_name,'')) LIKE ? OR LOWER(u.email) LIKE ?)) OR LOWER(u.code) LIKE ?
         ORDER BY u.last_seen DESC LIMIT ?`,
        Date.now() - ONLINE_WINDOW, term, term, st.owner ? 1 : 0, term, term, term, lim).toArray()
        // Moderators search by nametag or friend code only, and never see an email, a real
        // name or anyone's friend/save/gift counts.
        .map(p => st.owner ? p : { sub: p.sub, name: p.name, tag_set: p.tag_set, picture: isIcon(p.picture) ? p.picture : "",
          code: p.code, created: p.created, last_seen: p.last_seen, banned: p.banned, ban_reason: p.ban_reason, ban_until: p.ban_until,
          role: p.role, playing: p.playing, reports: p.reports, isOwner: this.isOwnerSub(p.sub) }),
    };
  }

  async adminReports(token) {
    await this.requireStaff(token);
    return {
      reports: this.sql.exec(
        `SELECT r.id, r.reason, r.created,
                a.sub AS reporter_sub, a.name AS reporter, b.sub AS reported_sub,
                b.name AS reported, b.banned
         FROM reports r
         LEFT JOIN users a ON a.sub = r.reporter
         LEFT JOIN users b ON b.sub = r.reported
         ORDER BY r.created DESC LIMIT 100`).toArray(),
    };
  }

  async adminBan(token, sub, banned, reason, hours) {
    const st = await this.requireStaff(token), me = st.me;
    if (!sub || sub === me) throw new HttpError(400, "you can't ban yourself");
    const u = this.userOf(sub);
    if (!u) throw new HttpError(404, "no such player");
    this.modCanTouch(st, sub);
    // A moderator's ban is only a request: nothing happens until the owner approves it.
    if (!st.owner) {
      if (!banned) throw new HttpError(403, "Only the owner can lift a ban.");
      return this.requestBan(st, "u:" + sub, u.name, reason, hours);
    }
    const h = Math.max(0, Math.min(24 * 365, Number(hours) || 0));
    this.banUser(sub, !!banned, h, banned ? String(reason || "").slice(0, 200) : null, "");
    return { ok: true, sub, banned: !!banned };
  }
  // Apply (or lift) a ban on an account. `note` is added to the log line.
  banUser(sub, banned, h, why, note) {
    this.sql.exec("UPDATE users SET banned = ?, ban_reason = ?, ban_until = ? WHERE sub = ?",
      banned ? 1 : null, why, banned && h ? Date.now() + h * 3600000 : null, sub);
    const also = banned ? 0 : this.liftLinkedBans("u:" + sub);
    this.log(banned ? "ban" : "unban", sub, (banned ? (h ? "for " + h + "h" : "permanent") + (why ? " — " + why : "")
      : also ? "also lifted " + also + " linked account/device ban" + (also > 1 ? "s" : "") : "") + (note || ""));
    // A ban should also stop anything already in flight, and settles any request to ban them.
    if (banned) {
      this.sql.exec("UPDATE ban_requests SET status = 'approved', decided_at = ? WHERE who = ? AND status = 'open'", Date.now(), "u:" + sub);
      this.sql.exec("DELETE FROM invites WHERE from_sub = ? OR to_sub = ?", sub, sub);
      this.sql.exec("DELETE FROM requests WHERE from_sub = ? OR to_sub = ?", sub, sub);
    }
  }

  // ── ban requests ── a moderator asks, the owner approves or denies.
  requestBan(st, who, name, reason, hours) {
    const h = Math.min(24, Math.max(1, Number(hours) || 24));   // moderators ask for a day at most
    const why = String(reason || "").slice(0, 200), now = Date.now();
    const open = this.sql.exec("SELECT id FROM ban_requests WHERE who = ? AND status = 'open'", who).toArray()[0];
    if (open) this.sql.exec("UPDATE ban_requests SET reason = ?, hours = ?, by_sub = ?, by_name = ?, created = ? WHERE id = ?",
      why, h, st.me, st.actor, now, open.id);
    else this.sql.exec(`INSERT INTO ban_requests (who, name, reason, hours, by_sub, by_name, created, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`, who, name, why, h, st.me, st.actor, now);
    this.log("ban-request", who[0] === "u" ? who.slice(2) : "", (who[0] === "g" ? name + " " : "") + "for " + h + "h" +
      (why ? " — " + why : "") + " (waiting for the owner)", st.actor);
    return { ok: true, pending: true };
  }
  async adminBanRequests(token) {
    await this.requireStaff(token);
    return { requests: this.sql.exec(
      `SELECT id, who, name, reason, hours, by_name, created, status, decided_at FROM ban_requests
       ORDER BY (status = 'open') DESC, id DESC LIMIT 100`).toArray()
      .map(r => ({ ...r, kind: r.who.indexOf("u:") === 0 ? "player" : "guest" })) };
  }
  async adminBanDecide(token, id, approve) {
    const me = await this.requireOwner(token);
    const r = this.sql.exec("SELECT * FROM ban_requests WHERE id = ?", Number(id) || 0).toArray()[0];
    if (!r) throw new HttpError(404, "no such ban request");
    if (r.status !== "open") throw new HttpError(409, "that request was already answered");
    if (approve) {
      const note = r.by_name ? " (asked for by " + r.by_name + ")" : "";
      if (r.who.indexOf("u:") === 0) {
        if (!this.userOf(r.who.slice(2))) throw new HttpError(404, "that account is gone");
        this.banUser(r.who.slice(2), true, r.hours, r.reason || "", note);
      } else {
        const g = this.guestOf(r.who.slice(2));
        if (!g) throw new HttpError(404, "that guest is gone");
        this.banGuest(g, true, r.hours, r.reason || "", false, me, note, "");
      }
    } else this.log("ban-request-denied", r.who.indexOf("u:") === 0 ? r.who.slice(2) : "", (r.who[0] === "g" ? r.name + " " : "") +
      (r.by_name ? "asked for by " + r.by_name : ""));
    this.sql.exec("UPDATE ban_requests SET status = ?, decided_at = ? WHERE id = ?", approve ? "approved" : "denied", Date.now(), r.id);
    return { ok: true };
  }

  async adminDeletePlayer(token, sub) {
    const me = await this.requireOwner(token);
    if (!sub || sub === me) throw new HttpError(400, "you can't delete yourself");
    if (!this.userOf(sub)) throw new HttpError(404, "no such player");
    this.log("delete", sub, "");
    this.erase(sub);
    return { ok: true, sub };
  }
  // Every trace of an account. Shared by the owner's Delete and the player's own.
  erase(sub) {
    for (const q of [
      "DELETE FROM friends WHERE a = ? OR b = ?",
      "DELETE FROM requests WHERE from_sub = ? OR to_sub = ?",
      "DELETE FROM blocks WHERE blocker = ? OR blocked = ?",
      "DELETE FROM invites WHERE from_sub = ? OR to_sub = ?",
      "DELETE FROM reports WHERE reporter = ? OR reported = ?",
    ]) this.sql.exec(q, sub, sub);
    for (const q of ["DELETE FROM saves WHERE sub = ?", "DELETE FROM gifts WHERE sub = ?", "DELETE FROM scores WHERE sub = ?", "DELETE FROM contest_scores WHERE sub = ?"])
      this.sql.exec(q, sub);
    this.sql.exec("DELETE FROM ban_requests WHERE who = ?", "u:" + sub);
    this.sql.exec("DELETE FROM trades WHERE from_sub = ? OR to_sub = ?", sub, sub);
    this.sql.exec("DELETE FROM pending WHERE who = ?", "u:" + sub);
    this.sql.exec("DELETE FROM game_gifts WHERE who = ?", "u:" + sub);
    this.sql.exec("DELETE FROM appeals WHERE who = ?", "u:" + sub);
    this.sql.exec("DELETE FROM users WHERE sub = ?", sub);
  }

  // Queue tokens and/or unlocks for one player, or for every player with sub "*".
  // Negative tokens take them away. Games and icons are ids the hub already knows;
  // the shape is checked here, and the hub ignores any id it doesn't recognise.
  async adminGift(token, sub, tokens, games, icons, note) {
    await this.requireOwner(token);
    const n = Math.trunc(Number(tokens) || 0);
    if (Math.abs(n) > 1000000) throw new HttpError(400, "keep it under a million tokens");
    const ids = (v, re) => [...new Set((Array.isArray(v) ? v : []).map(String).filter(x => re.test(x)))].slice(0, 200);
    const g = ids(games, /^[a-z0-9-]{1,60}\.html$/i), ic = ids(icons, /^[a-z0-9-]{1,24}$/);
    const msg = String(note || "").trim().slice(0, 120);
    // A note on its own is a message from the owner.
    if (!n && !g.length && !ic.length && !msg) throw new HttpError(400, "that gift is empty");
    let targets;
    if (sub === "*") targets = this.sql.exec("SELECT sub FROM users WHERE banned IS NULL OR banned = 0").toArray().map(r => r.sub);
    else if (sub && this.userOf(sub)) targets = [sub];
    else throw new HttpError(404, "no such player");
    const now = Date.now(), gj = JSON.stringify(g), ij = JSON.stringify(ic);
    for (const t of targets)
      this.sql.exec("INSERT INTO gifts (sub, tokens, games, icons, note, created) VALUES (?, ?, ?, ?, ?, ?)",
        t, n, gj, ij, msg, now);
    const what = [n ? n + " tokens" : "", g.length ? g.length + " games" : "", ic.length ? ic.length + " icons" : ""].filter(Boolean);
    this.log(what.length ? "gift" : "message", sub, (what.join(", ") + (msg ? ' "' + msg + '"' : "")).trim());
    return { ok: true, players: targets.length };
  }

  // Banner across the top of every hub. Empty text takes it down.
  async adminAnnounce(token, text, hours, tone) {
    await this.requireOwner(token);
    const t = String(text || "").trim().slice(0, 240);
    const h = Math.max(0, Math.min(24 * 30, Number(hours) || 0));
    const a = t ? { id: Date.now(), text: t, tone: ["info", "warn", "party"].includes(tone) ? tone : "info",
                    until: h ? Date.now() + h * 3600000 : 0 } : null;
    this.metaSet("announce", JSON.stringify(a));
    this.log(t ? "announce" : "announce-off", "", t ? t + (h ? " (" + h + "h)" : "") : "");
    return { ok: true, announce: a };
  }

  // Closes the arcade to everyone but the owner (hub overlay; game pages bounce).
  async adminMaintenance(token, on, text) {
    await this.requireOwner(token);
    const m = on ? { on: true, text: String(text || "").trim().slice(0, 240), since: Date.now() } : null;
    this.metaSet("maintenance", JSON.stringify(m));
    this.log(on ? "maintenance-on" : "maintenance-off", "", m ? m.text : "");
    return { ok: true, maintenance: m };
  }

  // ── guests ──
  async adminGuests(token) {
    const st = await this.requireStaff(token), me = st.me;
    const now = Date.now();
    this.sql.exec("DELETE FROM guests WHERE last_seen < ? AND (banned IS NULL OR banned = 0)", now - GUEST_KEEP);
    this.sql.exec("DELETE FROM ip_bans WHERE until AND until <= ?", now);
    const myIp = (this.sql.exec("SELECT last_ip FROM users WHERE sub = ?", me).toArray()[0] || {}).last_ip || "";
    // Who else is behind the same address — a guest sharing a network with a player
    // is often that player, signed out.
    const byIp = {};
    for (const u of this.sql.exec("SELECT name, last_ip FROM users WHERE last_ip IS NOT NULL AND last_ip != ''").toArray())
      (byIp[u.last_ip] = byIp[u.last_ip] || []).push(u.name);
    const banned = new Set(this.sql.exec("SELECT ip FROM ip_bans").toArray().map(r => r.ip));
    const guests = this.sql.exec(
      `SELECT gid, label, ip, ua, created, last_seen, banned, ban_reason, ban_until, tos_version,
              CASE WHEN playing_at > ? THEN playing ELSE NULL END AS playing
       FROM guests ORDER BY last_seen DESC LIMIT 200`, now - ONLINE_WINDOW).toArray()
      .map(g => ({ ...g, name: g.label || guestName(g.gid), online: g.last_seen > now - ONLINE_WINDOW,
                   sameAsYou: !!myIp && g.ip === myIp, ipBanned: banned.has(g.ip), alsoOnIp: byIp[g.ip] || [] }));
    if (!st.owner)   // moderators: no addresses, no network bans
      return { guests: guests.map(g => ({ ...g, ip: "", ua: "", tos_version: "", alsoOnIp: [], sameAsYou: false })), myIp: "", ipBans: [], guestsLocked: this.guestsLocked() };
    return { guests, myIp, ipBans: this.sql.exec("SELECT ip, reason, until, created, label FROM ip_bans ORDER BY created DESC").toArray(),
             guestsLocked: this.guestsLocked() };
  }

  // Ban a guest's device; `ip` also bans the network they're on. The owner's own
  // network is refused — that would ban everyone at your house but you.
  async adminGuestBan(token, gid, banned, reason, hours, alsoIp) {
    const st = await this.requireStaff(token), me = st.me;
    const g = this.guestOf(String(gid || ""));
    if (!g) throw new HttpError(404, "no such guest");
    if (!st.owner) {
      if (alsoIp) throw new HttpError(403, "only the owner can ban a network");
      if (!banned) throw new HttpError(403, "Only the owner can lift a ban.");
      return this.requestBan(st, "g:" + g.gid, g.label || guestName(g.gid), reason, hours);
    }
    const h = Math.max(0, Math.min(24 * 365, Number(hours) || 0));
    this.banGuest(g, !!banned, h, banned ? String(reason || "").slice(0, 200) : null, alsoIp, me, "", st.actor);
    return { ok: true };
  }
  banGuest(g, banned, h, why, alsoIp, me, note, actor) {
    const until = banned && h ? Date.now() + h * 3600000 : null;
    const name = g.label || guestName(g.gid);
    if (banned && alsoIp && g.ip) {
      const mine = (this.sql.exec("SELECT last_ip FROM users WHERE sub = ?", me).toArray()[0] || {}).last_ip;
      if (mine && mine === g.ip) throw new HttpError(400, "that guest is on your own network — ban the device only");
    }
    this.sql.exec("UPDATE guests SET banned = ?, ban_reason = ?, ban_until = ? WHERE gid = ?", banned ? 1 : null, why, until, g.gid);
    if (banned) this.sql.exec("UPDATE ban_requests SET status = 'approved', decided_at = ? WHERE who = ? AND status = 'open'", Date.now(), "g:" + g.gid);
    if (banned && alsoIp && g.ip)
      this.sql.exec(`INSERT INTO ip_bans (ip, reason, until, created, label) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason, until = excluded.until, created = excluded.created, label = excluded.label`,
        g.ip, why, until, Date.now(), name);
    // Unbanning the device also lifts a network ban that came with it.
    if (!banned && g.ip) this.sql.exec("DELETE FROM ip_bans WHERE ip = ? AND label = ?", g.ip, name);
    if (!banned) this.liftLinkedBans("g:" + g.gid);
    this.log(banned ? "ban-guest" : "unban-guest", "", name + (banned ? (alsoIp ? " + network" : "") +
      (h ? " for " + h + "h" : " permanent") + (why ? " — " + why : "") : "") + (note || ""), actor);
  }

  async adminIpBan(token, ip, banned, reason, hours) {
    const me = await this.requireOwner(token);
    // A network code from the console, or an address typed by hand (scrambled before it's kept).
    const raw = String(ip || "").trim().slice(0, 64);
    if (!NET_RE.test(raw) && !RAW_IP_RE.test(raw)) throw new HttpError(400, "that isn't an IP address or network code");
    const addr = await this.netOf(raw);
    if (banned) {
      const mine = (this.sql.exec("SELECT last_ip FROM users WHERE sub = ?", me).toArray()[0] || {}).last_ip;
      if (mine && mine === addr) throw new HttpError(400, "that's your own network");
      const h = Math.max(0, Math.min(24 * 365, Number(hours) || 0));
      this.sql.exec(`INSERT INTO ip_bans (ip, reason, until, created, label) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason, until = excluded.until, created = excluded.created`,
        addr, String(reason || "").slice(0, 200), h ? Date.now() + h * 3600000 : null, Date.now(), "");
    } else this.sql.exec("DELETE FROM ip_bans WHERE ip = ?", addr);
    this.log(banned ? "ban-ip" : "unban-ip", "", addr + (banned && reason ? " — " + reason : ""));
    return { ok: true };
  }

  async adminGuestLabel(token, gid, label) {
    await this.requireOwner(token);
    const l = String(label || "").trim().slice(0, 40);
    this.sql.exec("UPDATE guests SET label = ? WHERE gid = ?", l || null, String(gid || ""));
    return { ok: true };
  }

  // Everything the console's View panel shows about one player or guest: where they
  // are right now and their details. There's no play history to show: none is kept.
  async adminView(token, target) {
    const st = await this.requireStaff(token);
    const t = String(target || ""), now = Date.now();
    let who;
    if (t.indexOf("u:") === 0) {
      const u = this.sql.exec(
        `SELECT sub, name, real_name, email, picture, code, created, last_seen, playing, playing_at, last_ip AS ip, last_ua AS ua,
                banned, ban_reason, ban_until, tos_version, tos_at, role,
                (SELECT COUNT(*) FROM friends f WHERE f.a = users.sub) AS friends,
                (SELECT COUNT(*) FROM saves s WHERE s.sub = users.sub) AS saves,
                (SELECT COUNT(*) FROM reports r WHERE r.reported = users.sub) AS reports
         FROM users WHERE sub = ?`, t.slice(2)).toArray()[0];
      if (!u) throw new HttpError(404, "no such player");
      who = { kind: "player", ...u };
    } else if (t.indexOf("g:") === 0) {
      const g = this.guestOf(t.slice(2));
      if (!g) throw new HttpError(404, "no such guest");
      who = { kind: "guest", ...g, name: g.label || guestName(g.gid) };
    } else throw new HttpError(400, "bad target");
    who.online = !!who.last_seen && who.last_seen > now - ONLINE_WINDOW;
    who.playing = who.online && who.playing_at > now - ONLINE_WINDOW ? (who.playing || "") : null;
    if (who.kind === "player") who.isMod = who.role === "mod";
    // Moderators get what they need to deal with a problem: nametag, icon, friend code, what
    // they're playing right now, reports and bans. No real name, email, network or device.
    if (!st.owner) {
      for (const k of ["real_name", "email", "ip", "ua", "friends", "saves", "tos_version", "tos_at"]) delete who[k];
      return { who, trades: [], now };
    }
    const trades = who.kind === "player" ? this.sql.exec(
      `SELECT t.tokens, t.created, t.from_sub, t.to_sub, a.name AS from_name, b.name AS to_name FROM trades t
       LEFT JOIN users a ON a.sub = t.from_sub LEFT JOIN users b ON b.sub = t.to_sub
       WHERE (t.from_sub = ? OR t.to_sub = ?) AND t.created > ? ORDER BY t.created DESC LIMIT 30`,
      who.sub, who.sub, now - 7 * 86400000).toArray() : [];
    return { who, trades, now };
  }

  // Kick: boot someone back to the hub with a message. Not a ban — they can come
  // straight back. target "u:<sub>", "g:<gid>", or "*" for everyone online but you.
  async adminKick(token, target, reason) {
    const st = await this.requireStaff(token), me = st.me;
    if (!st.owner && target === "*") throw new HttpError(403, "only the owner can kick everyone");
    if (/^u:/.test(String(target || ""))) this.modCanTouch(st, String(target).slice(2));
    const why = String(reason || "").trim().slice(0, 160);
    const now = Date.now();
    let whos;
    if (target === "*") {
      whos = this.sql.exec("SELECT sub FROM users WHERE last_seen > ? AND sub != ?", now - ONLINE_WINDOW, me).toArray().map(r => "u:" + r.sub)
        .concat(this.sql.exec("SELECT gid FROM guests WHERE last_seen > ?", now - ONLINE_WINDOW).toArray().map(r => "g:" + r.gid));
    } else {
      const t = String(target || "");
      if (t === "u:" + me) throw new HttpError(400, "you can't kick yourself");
      if (!(/^u:/.test(t) && this.userOf(t.slice(2))) && !(/^g:/.test(t) && this.guestOf(t.slice(2))))
        throw new HttpError(404, "nobody by that id");
      whos = [t];
    }
    for (const w of whos) this.sql.exec("INSERT INTO pending (who, kind, text, created) VALUES (?, 'kick', ?, ?)", w, why, now);
    this.sql.exec("DELETE FROM pending WHERE created < ?", now - 86400000);
    const label = target === "*" ? "everyone online" : this.whoName(target);
    this.log("kick", "", label + (why ? " — " + why : ""), st.actor);
    return { ok: true, kicked: whos.length };
  }

  // A pop-up on someone's screen right now — works mid-game and for guests.
  async adminPopup(token, target, text) {
    const st = await this.requireStaff(token), me = st.me;
    if (!st.owner && target === "*") throw new HttpError(403, "only the owner can message everyone");
    const t = String(text || "").trim().slice(0, 200);
    if (!t) throw new HttpError(400, "type a message first");
    const now = Date.now();
    let whos;
    if (target === "*") {
      whos = this.sql.exec("SELECT sub FROM users WHERE last_seen > ? AND sub != ?", now - ONLINE_WINDOW, me).toArray().map(r => "u:" + r.sub)
        .concat(this.sql.exec("SELECT gid FROM guests WHERE last_seen > ? AND (banned IS NULL OR banned = 0)", now - ONLINE_WINDOW).toArray().map(r => "g:" + r.gid));
    } else whos = [String(target || "")];
    for (const w of whos) this.sql.exec("INSERT INTO pending (who, kind, text, created) VALUES (?, 'msg', ?, ?)", w, t, now);
    this.log("popup", "", (target === "*" ? "everyone online" : this.whoName(target)) + ' "' + t + '"', st.actor);
    return { ok: true, sent: whos.length };
  }
  // Gift something inside a game — today, Idle Universe energy. target "u:<sub>",
  // "g:<gid>", or "*" for every player and every guest seen this month. It waits
  // until they next open that game, then lands within a ping (a few seconds).
  async adminGameGift(token, target, game, amount, note) {
    await this.requireOwner(token);
    const GAME_GIFTS = ["idle-universe.html"];
    const gm = String(game || "");
    if (!GAME_GIFTS.includes(gm)) throw new HttpError(400, "that game can't take gifts");
    const n = Number(amount);
    if (!isFinite(n) || n <= 0 || n > 1e300) throw new HttpError(400, "pick an amount above zero");
    const msg = String(note || "").trim().slice(0, 120);
    const now = Date.now();
    let whos;
    if (target === "*") {
      whos = this.sql.exec("SELECT sub FROM users WHERE banned IS NULL OR banned = 0").toArray().map(r => "u:" + r.sub)
        .concat(this.sql.exec("SELECT gid FROM guests WHERE last_seen > ? AND (banned IS NULL OR banned = 0)", now - GUEST_KEEP).toArray().map(r => "g:" + r.gid));
    } else {
      const t = String(target || "");
      if (!(/^u:/.test(t) && this.userOf(t.slice(2))) && !(/^g:/.test(t) && this.guestOf(t.slice(2))))
        throw new HttpError(404, "nobody by that id");
      whos = [t];
    }
    for (const w of whos)
      this.sql.exec("INSERT INTO game_gifts (who, game, amount, note, created) VALUES (?, ?, ?, ?, ?)", w, gm, n, msg, now);
    this.log("game-gift", "", (target === "*" ? "everyone" : this.whoName(target)) + " · " + n + " in " + gm + (msg ? ' "' + msg + '"' : ""));
    return { ok: true, sent: whos.length };
  }
  whoName(t) {
    t = String(t || "");
    if (t.indexOf("u:") === 0) { const u = this.userOf(t.slice(2)); return u ? u.name : t; }
    if (t.indexOf("g:") === 0) { const g = this.guestOf(t.slice(2)); return g ? (g.label || guestName(g.gid)) : t; }
    return t;
  }

  // Every open hub and game reloads on its next ping — for pushing an update out.
  async adminReloadAll(token) {
    await this.requireOwner(token);
    this.metaSet("reload", String(Date.now()));
    this.log("reload-all", "", "");
    return { ok: true };
  }

  // Switch individual games off (and back on). Off games can't be opened by anyone
  // but the owner, and players already in one are sent back to the hub.
  async adminGames(token, disabled) {
    await this.requireOwner(token);
    const list = [...new Set((Array.isArray(disabled) ? disabled : []).map(String).filter(x => GAME_RE.test(x)))].slice(0, 200);
    const before = this.disabledGames();
    this.metaSet("disabled", JSON.stringify(list));
    const off = list.filter(x => !before.includes(x)), on = before.filter(x => !list.includes(x));
    this.log("games", "", [off.length ? "off: " + off.join(", ") : "", on.length ? "on: " + on.join(", ") : ""].filter(Boolean).join(" · "));
    return { ok: true, disabled: list };
  }

  async adminGuestsLock(token, on) {
    await this.requireOwner(token);
    this.metaSet("guestsLocked", on ? "1" : "0");
    this.log(on ? "guests-off" : "guests-on", "", "");
    return { ok: true, guestsLocked: !!on };
  }

  // ── alerts ── what the owner/moderators' hub watches to pop a notification.
  alerts() {
    const one = q => this.sql.exec(q).toArray()[0];
    return { reports: one("SELECT COUNT(*) AS n FROM reports").n, lastReport: one("SELECT IFNULL(MAX(id), 0) AS n FROM reports").n,
             appeals: one("SELECT COUNT(*) AS n FROM appeals WHERE status = 'open'").n,
             lastAppeal: one("SELECT IFNULL(MAX(id), 0) AS n FROM appeals").n,
             banRequests: one("SELECT COUNT(*) AS n FROM ban_requests WHERE status = 'open'").n,
             lastBanRequest: one("SELECT IFNULL(MAX(id), 0) AS n FROM ban_requests").n };
  }

  // ── moderators ── owner only.
  // A rude or real-name nametag: swap it for a random one and make them pick again.
  async adminResetTag(token, sub) {
    const st = await this.requireStaff(token);
    const u = this.userOf(sub);
    if (!u) throw new HttpError(404, "no such player");
    if (!st.owner && (this.isOwnerSub(sub) || u.role === "mod")) throw new HttpError(403, "moderators can't reset staff nametags");
    const tag = this.freeTag();
    this.sql.exec("UPDATE users SET name = ?, tag_set = 0 WHERE sub = ?", tag, sub);
    this.log("tag-reset", sub, (st.actor ? st.actor + ": " : "") + u.name + " → " + tag);
    return { ok: true, name: tag };
  }

  async adminSetMod(token, sub, on) {
    const me = await this.requireOwner(token);
    if (!this.userOf(sub)) throw new HttpError(404, "no such player");
    if (sub === me) throw new HttpError(400, "you're already the owner");
    this.sql.exec("UPDATE users SET role = ? WHERE sub = ?", on ? "mod" : null, sub);
    this.log(on ? "mod-add" : "mod-remove", sub, "");
    return { ok: true };
  }

  // ── appeals ── a banned player (or guest) asks to be let back in.
  async appeal(token, gid, ip, text) {
    ip = await this.netOf(ip);
    const t = String(text || "").trim().slice(0, 500);
    if (t.length < 5) throw new HttpError(400, "write a little more about why you should be unbanned");
    let who, name, banned;
    if (token) {
      const me = await this.verifySession(token, true), u = this.userOf(me);
      if (!u) throw new HttpError(404, "no such player");
      who = "u:" + me; name = u.name; banned = !!this.activeBan(u) || !!this.ipBan(ip);
    } else if (GID_RE.test(String(gid || ""))) {
      const g = this.guestOf(gid);
      who = "g:" + gid; name = g ? (g.label || guestName(gid)) : guestName(gid); banned = !!this.guestBan(g) || !!this.ipBan(ip);
    } else throw new HttpError(400, "sign in, or appeal from the device that was banned");
    if (!banned) throw new HttpError(400, "you aren't banned right now");
    if (this.sql.exec("SELECT 1 FROM appeals WHERE who = ? AND status = 'open'", who).toArray()[0])
      throw new HttpError(409, "your appeal is already waiting for an answer");
    // Guest ids are free to make, so on a banned network one open appeal per address
    // — otherwise anyone there could flood the queue by inventing new ids.
    // (Signed-in players are real Google accounts, so two of them on one network may both appeal.)
    if (who[0] === "g" && ip && this.sql.exec("SELECT 1 FROM appeals WHERE ip = ? AND who LIKE 'g:%' AND status = 'open'", ip).toArray()[0])
      throw new HttpError(409, "an appeal from your network is already waiting for an answer");
    const last = this.sql.exec("SELECT decided_at FROM appeals WHERE who = ? ORDER BY id DESC LIMIT 1", who).toArray()[0];
    if (last && last.decided_at && Date.now() - last.decided_at < 86400000)
      throw new HttpError(429, "you can appeal again a day after your last answer");
    this.sql.exec("INSERT INTO appeals (who, name, ip, text, created, status) VALUES (?, ?, ?, ?, ?, 'open')",
      who, name, ip || "", t, Date.now());
    return { ok: true };
  }
  async appealStatus(token, gid) {
    let who;
    if (token) who = "u:" + (await this.verifySession(token, true));
    else if (GID_RE.test(String(gid || ""))) who = "g:" + gid;
    else return { appeal: null };
    return { appeal: this.sql.exec("SELECT status, reply, created, decided_at FROM appeals WHERE who = ? ORDER BY id DESC LIMIT 1", who).toArray()[0] || null };
  }
  async adminAppeals(token) {
    const st = await this.requireStaff(token);
    const rows = this.sql.exec("SELECT id, who, name, ip, text, created, status, reply, decided_at FROM appeals ORDER BY (status = 'open') DESC, id DESC LIMIT 100").toArray();
    return { appeals: rows.map(a => {
      let ban = null;
      if (a.who.indexOf("u:") === 0) { const u = this.userOf(a.who.slice(2)); if (u && u.banned) ban = { reason: u.ban_reason, until: u.ban_until }; }
      else { const g = this.guestOf(a.who.slice(2)); if (g && g.banned) ban = { reason: g.ban_reason, until: g.ban_until }; }
      const net = a.ip && this.sql.exec("SELECT reason, until FROM ip_bans WHERE ip = ?", a.ip).toArray()[0];
      return { ...a, ip: st.owner ? a.ip : "", ban, networkBan: net ? { reason: st.owner ? net.reason : "", until: net.until } : null,
               kind: a.who.indexOf("u:") === 0 ? "player" : "guest" };
    }) };
  }
  async adminAppealDecide(token, id, accept, reply) {
    const st = await this.requireStaff(token);
    const a = this.sql.exec("SELECT * FROM appeals WHERE id = ?", Number(id) || 0).toArray()[0];
    if (!a) throw new HttpError(404, "no such appeal");
    if (a.status !== "open") throw new HttpError(409, "that appeal was already answered");
    const r = String(reply || "").trim().slice(0, 300);
    let note = "";
    if (accept && !st.owner) throw new HttpError(403, "Only the owner can lift a ban. You can still turn the appeal down.");
    if (accept) {
      if (a.who.indexOf("u:") === 0) {
        this.modCanTouch(st, a.who.slice(2));
        this.sql.exec("UPDATE users SET banned = NULL, ban_reason = NULL, ban_until = NULL WHERE sub = ?", a.who.slice(2));
      } else this.sql.exec("UPDATE guests SET banned = NULL, ban_reason = NULL, ban_until = NULL WHERE gid = ?", a.who.slice(2));
      this.liftLinkedBans(a.who);
      if (a.ip && this.sql.exec("SELECT 1 FROM ip_bans WHERE ip = ?", a.ip).toArray()[0]) {
        if (st.owner) this.sql.exec("DELETE FROM ip_bans WHERE ip = ?", a.ip);
        else note = " — their network is still banned (only the owner can lift that)";
      }
    }
    this.sql.exec("UPDATE appeals SET status = ?, reply = ?, decided_at = ? WHERE id = ?", accept ? "accepted" : "rejected", r, Date.now(), a.id);
    this.log(accept ? "appeal-accept" : "appeal-reject", "", a.name + (r ? ' — "' + r + '"' : ""), st.actor);
    return { ok: true, note };
  }

  // ── featured game ── the big banner at the top of the hub.
  async adminFeatured(token, file) {
    await this.requireOwner(token);
    const f = String(file || "");
    this.metaSet("featured", GAME_RE.test(f) ? f : "");
    this.log("featured", "", f || "(default)");
    return { ok: true, featured: this.featured() };
  }

  // ── stats ── the Stats tab: visitors per day (players and guests, just counts, UTC days)
  // and new accounts, for the last 30 days.
  async adminStats(token) {
    await this.requireOwner(token);
    const now = Date.now(), from = now - 30 * 86400000;
    const counts = {};
    for (const r of this.sql.exec("SELECT day, players, guests FROM day_stats WHERE day >= ?", utcDay(from)).toArray()) counts[r.day] = r;
    const ups = {};
    for (const u of this.sql.exec("SELECT created FROM users WHERE created > ?", from).toArray()) ups[utcDay(u.created)] = (ups[utcDay(u.created)] || 0) + 1;
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = utcDay(now - i * 86400000), c = counts[d] || {};
      days.push({ day: d, players: c.players || 0, guests: c.guests || 0, signups: ups[d] || 0 });
    }
    const n = (q, ...a) => this.sql.exec(q, ...a).toArray()[0].n;
    return { days, totals: { players: n("SELECT COUNT(*) AS n FROM users WHERE last_seen > ?", from),
                             guests: n("SELECT COUNT(*) AS n FROM guests WHERE last_seen > ?", from) } };
  }

  // ── badges ── earned from what a player has done; worked out fresh each time.
  badgesFor(sub) {
    const now = Date.now(), u = this.userOf(sub);
    if (!u) return [];
    const one = (q, ...a) => this.sql.exec(q, ...a).toArray()[0].n;
    const friends = one("SELECT COUNT(*) AS n FROM friends WHERE a = ?", sub);
    const saves = one("SELECT COUNT(*) AS n FROM saves WHERE sub = ?", sub);
    const scores = one("SELECT COUNT(*) AS n FROM scores WHERE sub = ?", sub);
    return [
      ["social", "👥", "Social", "Have 3 friends", friends >= 3],
      ["popular", "🌟", "Popular", "Have 10 friends", friends >= 10],
      ["saver", "💾", "Saver", "Make a cloud save", saves >= 1],
      ["scorer", "🏆", "On the Board", "Post a high score", scores >= 1],
      ["veteran", "🎂", "Veteran", "Be a member for 30 days", now - (u.created || now) >= 30 * 86400000],
    ].map(([id, e, name, desc, got]) => ({ id, e, name, desc, got: !!got }));
  }

  // ── profiles ── yours, a friend's, or anyone's for the owner and moderators.
  async profile(token, sub) {
    const me = await this.verifySession(token);
    const target = sub || me, self = target === me;
    const staff = this.isOwnerSub(me) || this.isModSub(me);
    if (!self && !staff && !this.isFriend(me, target)) throw new HttpError(403, "you can only see your friends' profiles");
    const u = this.userOf(target);
    if (!u) throw new HttpError(404, "no such player");
    const now = Date.now();
    // "Hide my activity" holds for moderators too; only the owner sees past it.
    const hidden = !!u.hide_activity && !self && !this.isOwnerSub(me);
    const row = this.sql.exec("SELECT last_seen, playing, playing_at FROM users WHERE sub = ?", target).toArray()[0] || {};
    const online = row.last_seen > now - ONLINE_WINDOW;
    return {
      sub: target, name: u.name, picture: self ? u.picture : pub(u).picture, created: u.created, self,
      friends: this.sql.exec("SELECT COUNT(*) AS n FROM friends WHERE a = ?", target).toArray()[0].n,
      badges: this.badgesFor(target), hidden, online,
      playing: hidden || !online || !(row.playing_at > now - ONLINE_WINDOW) ? null : (row.playing || ""),
      scores: hidden ? [] : this.sql.exec("SELECT game, score, low, at FROM scores WHERE sub = ? ORDER BY at DESC LIMIT 10", target).toArray(),
    };
  }
  async setPrivacy(token, hide) {
    const me = await this.verifySession(token);
    this.sql.exec("UPDATE users SET hide_activity = ? WHERE sub = ?", hide ? 1 : 0, me);
    return { ok: true, hide: !!hide };
  }

  // ── scores + leaderboards ──
  async postScore(token, game, score, low) {
    const me = await this.verifySession(token);
    const g = String(game || ""), n = Number(score);
    if (!GAME_RE.test(g) || !isFinite(n) || Math.abs(n) > 1e12) throw new HttpError(400, "bad score");
    const cur = this.sql.exec("SELECT score, low FROM scores WHERE game = ? AND sub = ?", g, me).toArray()[0];
    const better = !cur || (low ? n < cur.score : n > cur.score);
    if (better) this.sql.exec(
      `INSERT INTO scores (game, sub, score, low, at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(game, sub) DO UPDATE SET score = excluded.score, low = excluded.low, at = excluded.at`,
      g, me, n, low ? 1 : 0, Date.now());
    const now = Date.now();
    for (const c of this.sql.exec("SELECT id, low FROM contests WHERE status = 'live' AND kind = 'score' AND game = ? AND starts <= ? AND ends > ?", g, now, now).toArray()) {
      const cl = !!c.low;
      if (!!low !== cl) continue;   // a game reporting the other direction isn't this contest's score
      const ce = this.sql.exec("SELECT score FROM contest_scores WHERE cid = ? AND sub = ?", c.id, me).toArray()[0];
      if (!ce || (cl ? n < ce.score : n > ce.score))
        this.sql.exec(`INSERT INTO contest_scores (cid, sub, score, at) VALUES (?, ?, ?, ?)
          ON CONFLICT(cid, sub) DO UPDATE SET score = excluded.score, at = excluded.at`, c.id, me, n, now);
    }
    return { ok: true, best: better ? n : cur.score, newBest: better };
  }
  // High scores for one game. Public, so only nametags and icons. With no game (or "*"), the list
  // of games that have scores, so the hub can offer them.
  async leaderboard(game) {
    const g = String(game || "*");
    if (g === "*") return { game: "*", games: this.sql.exec("SELECT DISTINCT game FROM scores ORDER BY game").toArray().map(r => r.game), scores: [] };
    if (!GAME_RE.test(g)) throw new HttpError(400, "unknown game");
    const dir = this.sql.exec("SELECT low FROM scores WHERE game = ? GROUP BY low ORDER BY COUNT(*) DESC LIMIT 1", g).toArray()[0];
    const low = dir && dir.low;
    const scores = this.sql.exec(
      `SELECT s.sub, s.score, s.at, u.name, ${PUB_PIC} AS picture FROM scores s JOIN users u ON u.sub = s.sub
       WHERE s.game = ? AND s.low = ? AND NOT IFNULL(u.banned, 0) ORDER BY s.score ${low ? "ASC" : "DESC"} LIMIT 10`, g, low ? 1 : 0).toArray();
    return { game: g, scores, low: !!low };
  }

  // ── contests ──
  contestRow(c) {
    return { id: c.id, title: c.title, game: c.game, kind: c.kind, low: !!c.low, starts: c.starts, ends: c.ends,
             prizes: JSON.parse(c.prizes || "[]"), prizeGame: c.prize_game || "", note: c.note || "", status: c.status,
             winners: c.winners ? JSON.parse(c.winners) : null };
  }
  // Ranked entrants (best first). Banned players and the owner never place.
  standings(c, limit) {
    let list;
    if (c.kind === "score") {
      list = this.sql.exec(`SELECT sub, score, at FROM contest_scores WHERE cid = ? ORDER BY score ${c.low ? "ASC" : "DESC"}, at ASC`, c.id).toArray();
    } else list = [];   // "most time played" contests ended when play time stopped being recorded
    const out = [];
    for (const x of list) {
      const u = this.userOf(x.sub);
      if (!u || u.banned || this.isOwnerSub(x.sub)) continue;
      out.push({ sub: x.sub, name: u.name, picture: pub(u).picture, score: x.score });
      if (out.length >= (limit || 10)) break;
    }
    return out;
  }
  // Pay out every contest whose clock ran out. Called from /api/me and /api/contests,
  // so it runs within seconds of the end as long as anyone has the hub open.
  settleContests() {
    const now = Date.now();
    for (const c of this.sql.exec("SELECT * FROM contests WHERE status = 'live' AND ends <= ?", now).toArray()) this.awardContest(c);
  }
  awardContest(c) {
    const prizes = JSON.parse(c.prizes || "[]");
    const top = this.standings(c, Math.max(1, prizes.length));
    const places = ["1st", "2nd", "3rd", "4th", "5th"];
    const winners = top.slice(0, prizes.length).map((w, i) => ({ ...w, place: i + 1, tokens: prizes[i] || 0, game: i === 0 ? (c.prize_game || "") : "" }));
    for (const w of winners)
      this.sql.exec("INSERT INTO gifts (sub, tokens, games, icons, note, created) VALUES (?, ?, ?, ?, ?, ?)",
        w.sub, w.tokens, JSON.stringify(w.game ? [w.game] : []), "[]",
        ("🏆 " + places[w.place - 1] + " place — " + c.title).slice(0, 120), Date.now());
    this.sql.exec("UPDATE contests SET status = 'done', winners = ?, ends = MIN(ends, ?) WHERE id = ?", JSON.stringify(winners), Date.now(), c.id);
    this.log("contest-end", "", c.title + (winners.length ? " — won by " + winners.map(w => w.name).join(", ") : " — no entries"), "");
    return winners;
  }
  // Public list: live contests with standings (and where you stand), plus recent results.
  async contests(token) {
    this.settleContests();
    let me = "";
    if (token) { try { me = await this.verifySession(token); } catch (e) { me = ""; } }
    const live = this.sql.exec("SELECT * FROM contests WHERE status = 'live' ORDER BY ends").toArray().map(c => {
      const all = this.standings(c, 200);
      const i = all.findIndex(x => x.sub === me);
      return { ...this.contestRow(c), standings: all.slice(0, 10), entrants: all.length,
               mine: i === -1 ? null : { rank: i + 1, score: all[i].score } };
    });
    const past = this.sql.exec("SELECT * FROM contests WHERE status = 'done' ORDER BY ends DESC LIMIT 10").toArray().map(c => this.contestRow(c));
    return { live, past, now: Date.now() };
  }
  async adminContestCreate(token, b) {
    await this.requireOwner(token);
    b = b || {};
    const title = String(b.title || "").trim().slice(0, 80);
    if (!title) throw new HttpError(400, "give the contest a name");
    if (b.kind === "time") throw new HttpError(400, "GLITCHBOX doesn't track play time any more, so contests are best-score only.");
    const kind = "score";
    const game = String(b.game || "");
    if (!GAME_RE.test(game)) throw new HttpError(400, "pick a game");
    const hours = Number(b.hours);
    if (!(hours >= 0.05 && hours <= 24 * 30)) throw new HttpError(400, "a contest runs between 3 minutes and 30 days");
    const prizes = (Array.isArray(b.prizes) ? b.prizes : []).slice(0, 5).map(x => Math.max(0, Math.min(100000, Math.trunc(Number(x) || 0))));
    while (prizes.length && !prizes[prizes.length - 1]) prizes.pop();
    const pg = String(b.prizeGame || "");
    if (!prizes.length && !pg) throw new HttpError(400, "add a prize");
    if (!prizes.length) prizes.push(0);
    if (pg && !GAME_RE.test(pg)) throw new HttpError(400, "unknown prize game");
    const now = Date.now();
    this.sql.exec(`INSERT INTO contests (title, game, kind, low, starts, ends, prizes, prize_game, note, status, created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?)`, title, game, kind, kind === "score" && b.low ? 1 : 0,
      now, now + hours * 3600000, JSON.stringify(prizes), pg || null, String(b.note || "").trim().slice(0, 200), now);
    this.log("contest", "", title + " · " + (kind === "time" ? "most played" : "best score") + " · " + game + " · " + hours + "h · prizes " + prizes.join("/"), "");
    return { ok: true, ...(await this.contests(token)) };
  }
  // End now (pays out) or cancel (nobody wins).
  async adminContestEnd(token, id, cancel) {
    await this.requireOwner(token);
    const c = this.sql.exec("SELECT * FROM contests WHERE id = ? AND status = 'live'", Number(id) || 0).toArray()[0];
    if (!c) throw new HttpError(404, "that contest isn't running");
    if (cancel) {
      this.sql.exec("DELETE FROM contests WHERE id = ?", c.id);
      this.sql.exec("DELETE FROM contest_scores WHERE cid = ?", c.id);
      this.log("contest-cancel", "", c.title, "");
    } else this.awardContest(c);
    return { ok: true, ...(await this.contests(token)) };
  }

  // ── your data ── everything GLITCHBOX keeps about you, and a way to erase it.
  async myData(token) {
    const me = await this.verifySession(token);
    const u = this.sql.exec(
      `SELECT sub, name AS nametag, real_name AS google_name, email, picture, code, created, last_seen, last_ip AS network_code, last_ua AS device,
              tos_version, tos_at, hide_activity, role, playing FROM users WHERE sub = ?`, me).toArray()[0];
    const names = q => this.sql.exec(q, me).toArray();
    return {
      account: u,
      tokensSent: names(`SELECT u.name AS "to", t.tokens, t.created FROM trades t LEFT JOIN users u ON u.sub = t.to_sub WHERE t.from_sub = ? ORDER BY t.created DESC`),
      tokensReceived: names(`SELECT u.name AS "from", t.tokens, t.created FROM trades t LEFT JOIN users u ON u.sub = t.from_sub WHERE t.to_sub = ? ORDER BY t.created DESC`),
      friends: names("SELECT u.name FROM friends f JOIN users u ON u.sub = f.b WHERE f.a = ?").map(r => r.name),
      blocked: names("SELECT u.name FROM blocks b JOIN users u ON u.sub = b.blocked WHERE b.blocker = ?").map(r => r.name),
      reportsYouMade: names("SELECT u.name AS about, r.reason, r.created FROM reports r LEFT JOIN users u ON u.sub = r.reported WHERE r.reporter = ?"),
      reportsAboutYou: this.sql.exec("SELECT COUNT(*) AS n FROM reports WHERE reported = ?", me).toArray()[0].n,
      saves: names("SELECT game, updated, LENGTH(box) AS bytes FROM saves WHERE sub = ?"),
      scores: names("SELECT game, score, at FROM scores WHERE sub = ?"),
      appeals: this.sql.exec("SELECT text, created, status, reply FROM appeals WHERE who = ?", "u:" + me).toArray(),
    };
  }
  async deleteMe(token, confirm) {
    const me = await this.verifySession(token);
    if (String(confirm || "") !== "DELETE") throw new HttpError(400, "type DELETE to confirm");
    if (this.isOwnerSub(me)) throw new HttpError(400, "the owner account can't delete itself");
    const u = this.userOf(me);
    this.log("self-delete", "", (u && u.name) || "");
    this.erase(me);
    return { ok: true };
  }
  async guestData(gid) {
    if (!GID_RE.test(String(gid || ""))) throw new HttpError(400, "no guest id");
    const g = this.guestOf(gid);
    return { guest: g ? { name: guestName(gid), network_code: g.ip, device: g.ua, created: g.created, last_seen: g.last_seen,
                           tos_version: g.tos_version, banned: !!g.banned } : null };
  }
  async guestForget(gid) {
    if (!GID_RE.test(String(gid || ""))) throw new HttpError(400, "no guest id");
    const g = this.guestOf(gid);
    if (g && g.banned) throw new HttpError(403, "a banned device can't be forgotten — appeal the ban instead");
    this.sql.exec("DELETE FROM guests WHERE gid = ?", gid);
    for (const t of ["pending", "appeals", "game_gifts", "ban_requests"]) this.sql.exec("DELETE FROM " + t + " WHERE who = ?", "g:" + gid);
    return { ok: true };
  }

  async adminLog(token) {
    await this.requireStaff(token);
    return { log: this.sql.exec("SELECT id, at, action, target, detail FROM admin_log ORDER BY id DESC LIMIT 200").toArray() };
  }

  async adminDismissReport(token, id) {
    const st = await this.requireStaff(token);
    this.log("dismiss-report", "", "#" + (Number(id) || 0), st.actor);
    this.sql.exec("DELETE FROM reports WHERE id = ?", Number(id) || 0);
    return { ok: true };
  }

  // ── game invites ──
  // Invite a friend into a multiplayer room. The room code is minted here so both
  // players are guaranteed to land in the same room without typing anything.
  // `wantRoom` lets a game that's already sitting in a room invite people into *that*
  // room (otherwise the friend would join an empty one while the host waits elsewhere).
  async invite(token, otherSub, game, wantRoom) {
    const me = await this.verifySession(token);
    const g = String(game || "").trim();
    if (!g || g.length > 64 || !/^[a-z0-9-]+\.html$/i.test(g)) throw new HttpError(400, "unknown game");
    if (!otherSub || otherSub === me) throw new HttpError(400, "invalid target");
    if (!this.isFriend(me, otherSub)) throw new HttpError(403, "You can only invite friends.");
    if (this.isBlockedBetween(me, otherSub)) throw new HttpError(403, "Unable to invite this player.");
    const asked = String(wantRoom || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    // Reuse the room from a still-fresh invite so a double-click doesn't split the two
    // players across two rooms; otherwise mint a new one.
    const existing = this.sql.exec(
      "SELECT room, created FROM invites WHERE from_sub = ? AND to_sub = ? AND game = ?",
      me, otherSub, g).toArray()[0];
    const now = Date.now();
    const room = (asked.length >= 3 && asked.length <= 8) ? asked
      : (existing && now - existing.created < INVITE_TTL) ? existing.room
      : makeCode(ROOM_LEN);
    this.sql.exec(
      `INSERT INTO invites (from_sub, to_sub, game, room, created) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(from_sub, to_sub, game) DO UPDATE SET room=excluded.room, created=excluded.created`,
      me, otherSub, g, room, now);
    return { ...(await this.state(token)), message: "Invite sent.", room, game: g };
  }

  // Accept: hand the room back to the client so it can open the game, then clear the
  // invite (and any mirror invite the two players sent each other for the same game).
  async inviteAccept(token, fromSub, game) {
    const me = await this.verifySession(token);
    const row = this.sql.exec(
      "SELECT room, created FROM invites WHERE from_sub = ? AND to_sub = ? AND game = ?",
      fromSub, me, game).toArray()[0];
    if (!row) throw new HttpError(404, "That invite is no longer available.");
    if (Date.now() - row.created > INVITE_TTL) {
      this.sql.exec("DELETE FROM invites WHERE from_sub = ? AND to_sub = ? AND game = ?", fromSub, me, game);
      throw new HttpError(410, "That invite expired.");
    }
    this.sql.exec("DELETE FROM invites WHERE from_sub = ? AND to_sub = ? AND game = ?", fromSub, me, game);
    this.sql.exec("DELETE FROM invites WHERE from_sub = ? AND to_sub = ? AND game = ?", me, fromSub, game);
    return { ...(await this.state(token)), room: row.room, game };
  }

  // Decline an invite you received, or cancel one you sent.
  async inviteDecline(token, otherSub, game) {
    const me = await this.verifySession(token);
    this.sql.exec("DELETE FROM invites WHERE from_sub = ? AND to_sub = ? AND game = ?", otherSub, me, game);
    this.sql.exec("DELETE FROM invites WHERE from_sub = ? AND to_sub = ? AND game = ?", me, otherSub, game);
    return this.state(token);
  }

  // Add a friend by their 6-character code (replaces open name/email search).
  async addByCode(token, rawCode) {
    const me = await this.verifySession(token);
    const code = (rawCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== CODE_LEN) throw new HttpError(400, "Enter a valid 6-character code.");
    const target = this.sql.exec("SELECT sub FROM users WHERE code = ?", code).toArray()[0];
    if (!target) throw new HttpError(404, "No player has that code.");
    const other = target.sub;
    if (other === me) throw new HttpError(400, "That's your own code.");
    if (this.isBlockedBetween(me, other)) throw new HttpError(403, "Unable to add this player.");
    const already = this.sql.exec("SELECT 1 FROM friends WHERE a = ? AND b = ?", me, other).toArray()[0];
    if (already) return { ...(await this.state(token)), message: "You're already friends." };
    // If they already requested me, accept instead of creating a duplicate.
    const reverse = this.sql.exec("SELECT 1 FROM requests WHERE from_sub = ? AND to_sub = ?", other, me).toArray()[0];
    if (reverse) { await this.accept(token, other); return { ...(await this.state(token)), message: "You're now friends!" }; }
    this.sql.exec("INSERT OR IGNORE INTO requests (from_sub, to_sub, created) VALUES (?, ?, ?)", me, other, Date.now());
    return { ...(await this.state(token)), message: "Friend request sent." };
  }

  async accept(token, fromSub) {
    const me = await this.verifySession(token);
    const req = this.sql.exec("SELECT 1 FROM requests WHERE from_sub = ? AND to_sub = ?", fromSub, me).toArray()[0];
    if (!req) throw new HttpError(404, "no such request");
    if (this.isBlockedBetween(me, fromSub)) throw new HttpError(403, "Unable to add this player.");
    const now = Date.now();
    this.sql.exec("DELETE FROM requests WHERE from_sub = ? AND to_sub = ?", fromSub, me);
    this.sql.exec("DELETE FROM requests WHERE from_sub = ? AND to_sub = ?", me, fromSub);
    this.sql.exec("INSERT OR IGNORE INTO friends (a, b, created) VALUES (?, ?, ?)", me, fromSub, now);
    this.sql.exec("INSERT OR IGNORE INTO friends (a, b, created) VALUES (?, ?, ?)", fromSub, me, now);
    return this.state(token);
  }

  // Decline an incoming request OR cancel one you sent.
  async decline(token, otherSub) {
    const me = await this.verifySession(token);
    this.sql.exec("DELETE FROM requests WHERE from_sub = ? AND to_sub = ?", otherSub, me);
    this.sql.exec("DELETE FROM requests WHERE from_sub = ? AND to_sub = ?", me, otherSub);
    return this.state(token);
  }

  async unfriend(token, otherSub) {
    const me = await this.verifySession(token);
    this.sql.exec("DELETE FROM friends WHERE a = ? AND b = ?", me, otherSub);
    this.sql.exec("DELETE FROM friends WHERE a = ? AND b = ?", otherSub, me);
    this.dropInvitesBetween(me, otherSub);
    return this.state(token);
  }

  dropInvitesBetween(x, y) {
    this.sql.exec("DELETE FROM invites WHERE (from_sub = ? AND to_sub = ?) OR (from_sub = ? AND to_sub = ?)",
      x, y, y, x);
  }

  // Block a user: severs friendship + pending requests and prevents future contact.
  async block(token, otherSub) {
    const me = await this.verifySession(token);
    if (!otherSub || otherSub === me) throw new HttpError(400, "invalid target");
    this.sql.exec("INSERT OR IGNORE INTO blocks (blocker, blocked, created) VALUES (?, ?, ?)", me, otherSub, Date.now());
    this.sql.exec("DELETE FROM friends WHERE a = ? AND b = ?", me, otherSub);
    this.sql.exec("DELETE FROM friends WHERE a = ? AND b = ?", otherSub, me);
    this.sql.exec("DELETE FROM requests WHERE from_sub = ? AND to_sub = ?", me, otherSub);
    this.sql.exec("DELETE FROM requests WHERE from_sub = ? AND to_sub = ?", otherSub, me);
    this.dropInvitesBetween(me, otherSub);
    return this.state(token);
  }

  async unblock(token, otherSub) {
    const me = await this.verifySession(token);
    this.sql.exec("DELETE FROM blocks WHERE blocker = ? AND blocked = ?", me, otherSub);
    return this.state(token);
  }

  // Report a user, then block them automatically for the reporter's safety.
  async report(token, otherSub, reason) {
    const me = await this.verifySession(token);
    if (!otherSub || otherSub === me) throw new HttpError(400, "invalid target");
    this.sql.exec("INSERT INTO reports (reporter, reported, reason, created) VALUES (?, ?, ?, ?)",
      me, otherSub, String(reason || "").slice(0, 500), Date.now());
    return this.block(token, otherSub);
  }
}

// ── Room: one Durable Object per game room, relaying messages between players ──
// This replaces the old local quoridor-server.js so online play works straight from
// GitHub Pages. The protocol is deliberately generic: `create`/`join` establish the
// room, and every other message is forwarded verbatim to the other players — so any
// multiplayer game can use it, not just Quoridor.
export class Room extends DurableObject {
  fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get("role") === "host" ? "host" : "guest";
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    // Hibernation API: the tag records which side this socket is, and survives eviction.
    this.ctx.acceptWebSocket(pair[1], [role]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* socket already gone */ }
  }
  hosts() { return this.ctx.getWebSockets("host"); }
  guests() { return this.ctx.getWebSockets("guest"); }
  isHost(ws) { return this.ctx.getTags(ws).includes("host"); }
  // Everyone in the room except the sender.
  others(ws) { return this.ctx.getWebSockets().filter((s) => s !== ws); }

  // How many players this room holds. Two-player games never send `max`, so the
  // default keeps their "that game is full" behaviour exactly as it was; party
  // games (3-16 players) declare a bigger room when the host creates it.
  async roomMax() {
    if (this._max) return this._max;
    const v = await this.ctx.storage.get("max");
    this._max = Math.max(2, Math.min(ROOM_MAX_PLAYERS, v || 2));
    return this._max;
  }

  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === "create") {
      // A host coming back after a dropped connection replaces its old, half-dead socket.
      if (m.resume) {
        for (const s of this.hosts()) if (s !== ws) { try { s.close(1000, "replaced"); } catch (e) { /* already gone */ } }
      }
      // A second host on the same code means a code collision — bounce the newcomer.
      else if (this.hosts().length > 1) {
        this.send(ws, { t: "error", msg: "That code is already in use — try again." });
        return;
      }
      const max = Math.max(2, Math.min(ROOM_MAX_PLAYERS, (m.max | 0) || 2));
      this._max = max;
      await this.ctx.storage.put("max", max);   // survives hibernation + code reuse
      this.send(ws, { t: "created", code: m.code || "", color: "blue", max });
      return;
    }

    if (m.t === "join") {
      if (!this.hosts().length) {
        this.send(ws, { t: "error", msg: "No game with that code." });
        return;
      }
      const max = await this.roomMax();
      // The joining socket is already counted here: host + guests must fit in `max`.
      if (this.guests().length + 1 > max) {
        this.send(ws, { t: "error", msg: "That game is full." });
        return;
      }
      this.send(ws, { t: "joined", color: "red", max, seat: this.guests().length });
      for (const s of this.ctx.getWebSockets()) this.send(s, { t: "start" });
      return;
    }

    // Everything else (moves, rematch requests, chat…) is relayed untouched.
    for (const s of this.others(ws)) this.send(s, m);
  }

  webSocketClose(ws) {
    for (const s of this.others(ws)) this.send(s, { t: "left" });
  }
  webSocketError(ws) {
    for (const s of this.others(ws)) this.send(s, { t: "left" });
  }
}

// ── Worker router ──
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });

    const url = new URL(request.url);
    const path = url.pathname;

    // Multiplayer relay. Routed before anything else because a WebSocket upgrade
    // must not be wrapped in the JSON/CORS helpers.
    if (path === "/ws") {
      const code = (url.searchParams.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (code.length < 3 || code.length > 8) return new Response("bad room code", { status: 400 });
      return env.ROOM.getByName("room:" + code).fetch(request);
    }

    const stub = env.HUB.getByName("global");
    const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const ip = request.headers.get("CF-Connecting-IP") || "";

    try {
      if (path === "/" || path === "/api/health") return json(await stub.health(), 200, origin);

      if (path === "/api/login" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        // Test sign-in for `wrangler dev --var DEV_LOGIN:1` on localhost ONLY: lets the
        // signed-in features be tested without Google. Never active on the live Worker
        // (no such var there, and the hostname check fails anyway).
        if (env.DEV_LOGIN === "1" && url.hostname === "localhost" && /^dev:/.test(body.idToken || "")) {
          const id = String(body.idToken).slice(4);
          return json(await stub.login("", ip, { aud: CLIENT_ID, sub: "dev-" + id, email: id + "@dev.test", name: id + " Tester", email_verified: "true" }, body.gid), 200, origin);
        }
        return json(await stub.login(body.idToken, ip, null, body.gid), 200, origin);
      }
      if (path === "/api/me") return json(await stub.state(auth, ip), 200, origin);
      if (path === "/api/ping") return json(await stub.ping(auth, url.searchParams.get("game"),
        url.searchParams.get("gid"), ip, request.headers.get("User-Agent"), url.searchParams.get("tos"), url.searchParams.get("room")), 200, origin);
      if (path === "/api/profile") return json(await stub.profile(auth, url.searchParams.get("sub")), 200, origin);
      if (path === "/api/contests") return json(await stub.contests(auth), 200, origin);
      if (path === "/api/leaderboard") return json(await stub.leaderboard(url.searchParams.get("game")), 200, origin);
      if (path === "/api/my-data") return json(await stub.myData(auth), 200, origin);
      if (path === "/api/guest-data") return json(await stub.guestData(url.searchParams.get("gid")), 200, origin);
      if (path === "/api/appeal" && request.method === "GET") return json(await stub.appealStatus(auth, url.searchParams.get("gid")), 200, origin);
      if (path === "/api/admin/appeals") return json(await stub.adminAppeals(auth), 200, origin);
      if (path === "/api/admin/stats") return json(await stub.adminStats(auth), 200, origin);
      if (path === "/api/admin/ban-requests") return json(await stub.adminBanRequests(auth), 200, origin);

      // Game saves — the cloud half of glitchbox-save.js.
      if (path === "/api/load") {
        return json(await stub.loadGame(auth, url.searchParams.get("game") || ""), 200, origin);
      }
      if (path === "/api/saves") return json(await stub.listSaves(auth), 200, origin);

      // Owner-only console. Each of these re-checks ownership inside the Hub.
      if (path === "/api/admin/overview") return json(await stub.adminOverview(auth), 200, origin);
      if (path === "/api/admin/players") {
        return json(await stub.adminPlayers(auth, url.searchParams.get("q"),
          url.searchParams.get("limit")), 200, origin);
      }
      if (path === "/api/admin/reports") return json(await stub.adminReports(auth), 200, origin);
      if (path === "/api/admin/log") return json(await stub.adminLog(auth), 200, origin);
      if (path === "/api/admin/guests") return json(await stub.adminGuests(auth), 200, origin);
      if (path === "/api/admin/view") return json(await stub.adminView(auth, url.searchParams.get("target")), 200, origin);

      if (request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (path === "/api/tos")      return json(await stub.acceptTos(auth, body.version), 200, origin);
        if (path === "/api/appeal")   return json(await stub.appeal(auth, body.gid, ip, body.text), 200, origin);
        if (path === "/api/privacy")  return json(await stub.setPrivacy(auth, body.hide), 200, origin);
        if (path === "/api/score")    return json(await stub.postScore(auth, body.game, body.score, body.low), 200, origin);
        if (path === "/api/delete-me")    return json(await stub.deleteMe(auth, body.confirm), 200, origin);
        if (path === "/api/guest-forget") return json(await stub.guestForget(body.gid), 200, origin);
        if (path === "/api/admin/reset-tag")     return json(await stub.adminResetTag(auth, body.sub), 200, origin);
        if (path === "/api/admin/set-mod")       return json(await stub.adminSetMod(auth, body.sub, body.on), 200, origin);
        if (path === "/api/admin/ban-decide")    return json(await stub.adminBanDecide(auth, body.id, body.approve), 200, origin);
        if (path === "/api/admin/appeal-decide") return json(await stub.adminAppealDecide(auth, body.id, body.accept, body.reply), 200, origin);
        if (path === "/api/admin/featured")      return json(await stub.adminFeatured(auth, body.file), 200, origin);
        if (path === "/api/avatar")   return json(await stub.setAvatar(auth, body.picture), 200, origin);
        if (path === "/api/nametag")  return json(await stub.setTag(auth, body.tag), 200, origin);
        if (path === "/api/nametag-ideas") return json(await stub.tagIdeas(auth), 200, origin);
        if (path === "/api/admin/claim")  return json(await stub.adminClaim(auth, body.code), 200, origin);
        if (path === "/api/admin/ban")    return json(await stub.adminBan(auth, body.sub, body.banned, body.reason, body.hours), 200, origin);
        if (path === "/api/admin/announce")    return json(await stub.adminAnnounce(auth, body.text, body.hours, body.tone), 200, origin);
        if (path === "/api/admin/maintenance") return json(await stub.adminMaintenance(auth, body.on, body.text), 200, origin);
        if (path === "/api/admin/delete") return json(await stub.adminDeletePlayer(auth, body.sub), 200, origin);
        if (path === "/api/admin/gift")   return json(await stub.adminGift(auth, body.sub, body.tokens, body.games, body.icons, body.note), 200, origin);
        if (path === "/api/gifts/claim")  return json(await stub.claimGifts(auth, body.ids), 200, origin);
        if (path === "/api/trade")        return json(await stub.trade(auth, body.to, body.tokens), 200, origin);
        if (path === "/api/admin/guest-ban")   return json(await stub.adminGuestBan(auth, body.gid, body.banned, body.reason, body.hours, body.ip), 200, origin);
        if (path === "/api/admin/guest-label") return json(await stub.adminGuestLabel(auth, body.gid, body.label), 200, origin);
        if (path === "/api/admin/ip-ban")      return json(await stub.adminIpBan(auth, body.ip, body.banned, body.reason, body.hours), 200, origin);
        if (path === "/api/admin/kick")        return json(await stub.adminKick(auth, body.target, body.reason), 200, origin);
        if (path === "/api/admin/popup")       return json(await stub.adminPopup(auth, body.target, body.text), 200, origin);
        if (path === "/api/admin/contest")     return json(await stub.adminContestCreate(auth, body), 200, origin);
        if (path === "/api/admin/contest-end") return json(await stub.adminContestEnd(auth, body.id, body.cancel), 200, origin);
        if (path === "/api/admin/game-gift")   return json(await stub.adminGameGift(auth, body.target, body.game, body.amount, body.note), 200, origin);
        if (path === "/api/admin/reload-all")  return json(await stub.adminReloadAll(auth), 200, origin);
        if (path === "/api/admin/games")       return json(await stub.adminGames(auth, body.disabled), 200, origin);
        if (path === "/api/admin/guests-lock") return json(await stub.adminGuestsLock(auth, body.on), 200, origin);
        if (path === "/api/admin/dismiss-report") return json(await stub.adminDismissReport(auth, body.id), 200, origin);
        if (path === "/api/add-by-code") return json(await stub.addByCode(auth, body.code), 200, origin);
        if (path === "/api/accept")   return json(await stub.accept(auth, body.sub), 200, origin);
        if (path === "/api/decline")  return json(await stub.decline(auth, body.sub), 200, origin);
        if (path === "/api/unfriend") return json(await stub.unfriend(auth, body.sub), 200, origin);
        if (path === "/api/block")    return json(await stub.block(auth, body.sub), 200, origin);
        if (path === "/api/unblock")  return json(await stub.unblock(auth, body.sub), 200, origin);
        if (path === "/api/report")   return json(await stub.report(auth, body.sub, body.reason), 200, origin);
        if (path === "/api/invite")         return json(await stub.invite(auth, body.sub, body.game, body.room), 200, origin);
        if (path === "/api/invite-accept")  return json(await stub.inviteAccept(auth, body.sub, body.game), 200, origin);
        if (path === "/api/invite-decline") return json(await stub.inviteDecline(auth, body.sub, body.game), 200, origin);
        if (path === "/api/save")        return json(await stub.saveGame(auth, body.game, body.box), 200, origin);
        if (path === "/api/save-delete") return json(await stub.deleteGame(auth, body.game), 200, origin);
      }
      return json({ error: "not found" }, 404, origin);
    } catch (e) {
      let status = 500, msg = (e && e.message) || "server error";
      const m = /^(\d{3}):([\s\S]*)$/.exec(msg);
      if (m) { status = +m[1]; msg = m[2]; }
      else if (e && e.status) { status = e.status; }
      return json({ error: msg }, status, origin);
    }
  },
};
