import { DurableObject } from "cloudflare:workers";

// The OAuth client the ID tokens must be minted for.
const CLIENT_ID = "292202234478-kdcu37vvdogpttpksc6acg85ljavkfj6.apps.googleusercontent.com";
const ALLOWED_ORIGINS = [
  "https://levtheduck-web.github.io",
  "http://localhost:8095",
  "http://127.0.0.1:8095",
];
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
// Friend-code alphabet: no 0/O/1/I/L to avoid confusion. Same style as the room codes.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;
const ROOM_LEN = 4;              // game-room codes are shorter — typed by hand mid-session
const INVITE_TTL = 10 * 60 * 1000; // a game invite goes stale after 10 minutes
const ONLINE_WINDOW = 90 * 1000;   // "online" = seen within 90s (hub polls every ~20s)
const SAVE_MAX_BYTES = 512 * 1024; // per game-save cap — a colony snapshot is a few KB

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
// Public view of another user — never leaks email.
function pub(u) {
  return u ? { sub: u.sub, name: u.name, picture: u.picture } : null;
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
      // Defensive: add `code` column if this DO predates the friend-code feature.
      try { this.sql.exec("ALTER TABLE users ADD COLUMN code TEXT"); } catch (e) { /* already there */ }
      this.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_code ON users(code)");
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
    });
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

  async verifySession(token) {
    if (!token) throw new HttpError(401, "no session");
    const [payload, sig] = token.split(".");
    if (!payload || !sig) throw new HttpError(401, "bad session");
    if ((await this.hmac(payload)) !== sig) throw new HttpError(401, "bad signature");
    let data;
    try { data = JSON.parse(b64urlDecodeStr(payload)); } catch { throw new HttpError(401, "bad payload"); }
    if (!data.exp || data.exp < Date.now()) throw new HttpError(401, "session expired");
    return data.sub;
  }

  userOf(sub) {
    return this.sql.exec("SELECT sub, email, name, picture, code, created FROM users WHERE sub = ?", sub).toArray()[0] || null;
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

  // ── endpoints ──
  async login(idToken) {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken || ""));
    if (!r.ok) throw new HttpError(401, "invalid Google token");
    const info = await r.json();
    if (info.aud !== CLIENT_ID) throw new HttpError(401, "token audience mismatch");
    if (!info.sub) throw new HttpError(401, "no subject");
    const now = Date.now();
    const existing = this.userOf(info.sub);
    this.sql.exec(
      `INSERT INTO users (sub, email, name, picture, created, last_seen)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(sub) DO UPDATE SET email=excluded.email, name=excluded.name,
         picture=excluded.picture, last_seen=excluded.last_seen`,
      info.sub, info.email || "", info.name || info.email || "Player",
      info.picture || "", now, now);
    if (!existing) this.sql.exec("UPDATE users SET created = ? WHERE sub = ?", now, info.sub);
    this.ensureCode(info.sub);
    const session = await this.makeSession(info.sub);
    const profile = this.userOf(info.sub);
    return { sessionToken: session, profile, created: profile.created, isNew: !existing };
  }

  async state(token) {
    const me = await this.verifySession(token);
    const now = Date.now();
    this.sql.exec("UPDATE users SET last_seen = ? WHERE sub = ?", now, me);
    if (!this.userOf(me).code) this.ensureCode(me);
    // Sweep stale invites so nobody is offered a room that has long since emptied.
    this.sql.exec("DELETE FROM invites WHERE created < ?", now - INVITE_TTL);
    const profile = this.userOf(me); // self — includes email + code
    const friends = this.sql.exec(
      `SELECT u.sub, u.name, u.picture,
              (u.last_seen > ?) AS online FROM friends f
       JOIN users u ON u.sub = f.b WHERE f.a = ? ORDER BY online DESC, u.name`,
      now - ONLINE_WINDOW, me).toArray();
    const incoming = this.sql.exec(
      `SELECT u.sub, u.name, u.picture, r.created FROM requests r
       JOIN users u ON u.sub = r.from_sub WHERE r.to_sub = ? ORDER BY r.created DESC`, me).toArray();
    const outgoing = this.sql.exec(
      `SELECT u.sub, u.name, u.picture, r.created FROM requests r
       JOIN users u ON u.sub = r.to_sub WHERE r.from_sub = ? ORDER BY r.created DESC`, me).toArray();
    const blocked = this.sql.exec(
      `SELECT u.sub, u.name, u.picture FROM blocks bl
       JOIN users u ON u.sub = bl.blocked WHERE bl.blocker = ? ORDER BY u.name`, me).toArray();
    const invitesIn = this.sql.exec(
      `SELECT i.game, i.room, i.created, u.sub, u.name, u.picture FROM invites i
       JOIN users u ON u.sub = i.from_sub WHERE i.to_sub = ? ORDER BY i.created DESC`, me).toArray();
    const invitesOut = this.sql.exec(
      `SELECT i.game, i.room, i.created, u.sub, u.name, u.picture FROM invites i
       JOIN users u ON u.sub = i.to_sub WHERE i.from_sub = ? ORDER BY i.created DESC`, me).toArray();
    return { profile, friends, incoming, outgoing, blocked, invitesIn, invitesOut };
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

  webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === "create") {
      // A second host on the same code means a code collision — bounce the newcomer.
      if (this.hosts().length > 1) {
        this.send(ws, { t: "error", msg: "That code is already in use — try again." });
        return;
      }
      this.send(ws, { t: "created", code: m.code || "", color: "blue" });
      return;
    }

    if (m.t === "join") {
      if (!this.hosts().length) {
        this.send(ws, { t: "error", msg: "No game with that code." });
        return;
      }
      if (this.guests().length > 1) {
        this.send(ws, { t: "error", msg: "That game is full." });
        return;
      }
      this.send(ws, { t: "joined", color: "red" });
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

    try {
      if (path === "/" || path === "/api/health") return json({ ok: true, service: "glitchbox-api" }, 200, origin);

      if (path === "/api/login" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return json(await stub.login(body.idToken), 200, origin);
      }
      if (path === "/api/me") return json(await stub.state(auth), 200, origin);

      // Game saves — the cloud half of glitchbox-save.js.
      if (path === "/api/load") {
        return json(await stub.loadGame(auth, url.searchParams.get("game") || ""), 200, origin);
      }
      if (path === "/api/saves") return json(await stub.listSaves(auth), 200, origin);

      if (request.method === "POST") {
        const body = await request.json().catch(() => ({}));
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
