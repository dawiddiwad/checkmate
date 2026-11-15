#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __export = (target, all2) => {
  for (var name in all2)
    __defProp(target, name, { get: all2[name], enumerable: true });
};

// plugin/src/store.ts
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
var contractVersion = "toolkit-2";
var schemaVersion = "3";
var operationReference = "REFERENCES operations(id) DEFERRABLE INITIALLY DEFERRED";
var tables = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE operations (
	id TEXT PRIMARY KEY,
	at TEXT NOT NULL,
	actor TEXT NOT NULL,
	command TEXT NOT NULL,
	arguments TEXT NOT NULL,
	status TEXT NOT NULL,
	response TEXT NOT NULL,
	subjects TEXT NOT NULL
) STRICT;
CREATE TABLE blobs (sha256 TEXT PRIMARY KEY, size INTEGER NOT NULL, bytes BLOB NOT NULL) STRICT;
CREATE TABLE target_requests (
	target_id TEXT PRIMARY KEY,
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
CREATE TABLE profiles (
	target_id TEXT NOT NULL REFERENCES target_requests(target_id),
	revision INTEGER NOT NULL,
	sha256 TEXT NOT NULL,
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (target_id, revision)
) STRICT;
CREATE TABLE instances (
	target_id TEXT NOT NULL REFERENCES target_requests(target_id),
	instance_id TEXT NOT NULL,
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (target_id, instance_id)
) STRICT;
CREATE TABLE instance_retirements (
	target_id TEXT NOT NULL,
	instance_id TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (target_id, instance_id),
	FOREIGN KEY (target_id, instance_id) REFERENCES instances(target_id, instance_id)
) STRICT;
CREATE TABLE plan_requests (
	plan_id TEXT PRIMARY KEY,
	target_id TEXT NOT NULL,
	target_revision INTEGER NOT NULL,
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	FOREIGN KEY (target_id, target_revision) REFERENCES profiles(target_id, revision)
) STRICT;
CREATE TABLE plan_revisions (
	plan_id TEXT NOT NULL REFERENCES plan_requests(plan_id),
	revision INTEGER NOT NULL,
	previous_revision INTEGER,
	sha256 TEXT NOT NULL,
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (plan_id, revision),
	CHECK ((revision = 1 AND previous_revision IS NULL) OR previous_revision = revision - 1)
) STRICT;
CREATE TABLE decisions (
	id TEXT PRIMARY KEY,
	plan_id TEXT NOT NULL,
	base_revision INTEGER NOT NULL,
	gap_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	value TEXT NOT NULL,
	source TEXT,
	rationale TEXT NOT NULL,
	actor TEXT NOT NULL,
	applied_revision INTEGER,
	operation_id TEXT NOT NULL ${operationReference},
	FOREIGN KEY (plan_id, base_revision) REFERENCES plan_revisions(plan_id, revision),
	UNIQUE (plan_id, base_revision, gap_id)
) STRICT;
CREATE TABLE approvals (
	id TEXT PRIMARY KEY,
	subject_kind TEXT NOT NULL,
	subject_id TEXT NOT NULL,
	subject_sha256 TEXT NOT NULL,
	verdict TEXT NOT NULL,
	rationale TEXT NOT NULL,
	actor TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
CREATE TABLE runs (
	run_id TEXT PRIMARY KEY,
	plan_id TEXT NOT NULL,
	plan_revision INTEGER NOT NULL,
	plan_sha256 TEXT NOT NULL,
	target_id TEXT NOT NULL,
	target_revision INTEGER NOT NULL,
	instance_id TEXT NOT NULL,
	application_build TEXT NOT NULL,
	request TEXT NOT NULL,
	started_at TEXT NOT NULL,
	browser_session TEXT NOT NULL,
	deadline_seconds INTEGER NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	FOREIGN KEY (plan_id, plan_revision) REFERENCES plan_revisions(plan_id, revision),
	FOREIGN KEY (target_id, target_revision) REFERENCES profiles(target_id, revision),
	FOREIGN KEY (target_id, instance_id) REFERENCES instances(target_id, instance_id)
) STRICT;
CREATE TABLE run_attempts (
	run_id TEXT NOT NULL REFERENCES runs(run_id),
	attempt INTEGER NOT NULL,
	started_at TEXT NOT NULL,
	actor TEXT NOT NULL,
	PRIMARY KEY (run_id, attempt)
) STRICT;
CREATE TABLE assertion_results (
	run_id TEXT NOT NULL REFERENCES runs(run_id),
	test_id TEXT NOT NULL,
	assertion_id TEXT NOT NULL,
	attempt INTEGER NOT NULL,
	result TEXT NOT NULL,
	observed TEXT,
	reason TEXT,
	recorded_at TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (run_id, test_id, assertion_id),
	FOREIGN KEY (run_id, attempt) REFERENCES run_attempts(run_id, attempt)
) STRICT;
CREATE TABLE outcomes (
	run_id TEXT NOT NULL REFERENCES runs(run_id),
	test_id TEXT NOT NULL,
	attempt INTEGER NOT NULL,
	outcome TEXT NOT NULL,
	reason TEXT,
	recorded_at TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (run_id, test_id),
	FOREIGN KEY (run_id, attempt) REFERENCES run_attempts(run_id, attempt)
) STRICT;
CREATE TABLE evidence (
	id TEXT PRIMARY KEY,
	run_id TEXT NOT NULL REFERENCES runs(run_id),
	test_id TEXT NOT NULL,
	assertion_id TEXT,
	kind TEXT NOT NULL,
	name TEXT NOT NULL,
	media_type TEXT NOT NULL,
	sha256 TEXT NOT NULL REFERENCES blobs(sha256),
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
CREATE TABLE findings (
	id TEXT NOT NULL,
	run_id TEXT NOT NULL REFERENCES runs(run_id),
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (run_id, id)
) STRICT;
CREATE TABLE run_gaps (
	id TEXT NOT NULL,
	run_id TEXT NOT NULL REFERENCES runs(run_id),
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference},
	PRIMARY KEY (run_id, id)
) STRICT;
CREATE TABLE results (
	run_id TEXT PRIMARY KEY REFERENCES runs(run_id),
	completion TEXT NOT NULL,
	coverage TEXT NOT NULL,
	finished_at TEXT NOT NULL,
	sha256 TEXT NOT NULL,
	body TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
CREATE VIEW latest_plans AS
	SELECT p.* FROM plan_revisions p
	WHERE p.revision = (SELECT max(revision) FROM plan_revisions WHERE plan_id = p.plan_id);
CREATE VIEW plan_tests AS
	SELECT p.plan_id, p.revision, t.value ->> '$.id' AS test_id, t.value AS test
	FROM plan_revisions p, json_each(p.body, '$.tests') t;
CREATE VIEW plan_gaps AS
	SELECT p.plan_id, p.revision, g.value ->> '$.id' AS gap_id,
		g.value ->> '$.status' AS status, g.value ->> '$.severity' AS severity, g.value AS gap
	FROM plan_revisions p, json_each(p.body, '$.gaps') g;
`;
var tableNames = [...tables.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1]);
var decisionColumns = [
  "id",
  "plan_id",
  "base_revision",
  "gap_id",
  "kind",
  "value",
  "source",
  "rationale",
  "actor",
  "operation_id"
];
function updateTrigger(table) {
  if (table === "decisions")
    return `CREATE TRIGGER decisions_update BEFORE UPDATE ON decisions
	WHEN OLD.applied_revision IS NOT NULL OR NEW.applied_revision IS NULL OR ${decisionColumns.map((column) => `NEW.${column} IS NOT OLD.${column}`).join(" OR ")}
	BEGIN SELECT RAISE(ABORT, 'Decisions are immutable. Only applied_revision can change, once, from NULL'); END;`;
  if (table === "plan_revisions")
    return `CREATE TRIGGER plan_revisions_update BEFORE UPDATE ON plan_revisions
	WHEN NEW.plan_id IS NOT OLD.plan_id OR NEW.revision IS NOT OLD.revision
		OR NEW.previous_revision IS NOT OLD.previous_revision
		OR EXISTS (SELECT 1 FROM approvals WHERE subject_kind = 'plan'
			AND subject_id = OLD.plan_id || '@' || OLD.revision AND verdict = 'approved')
		OR EXISTS (SELECT 1 FROM runs WHERE plan_id = OLD.plan_id AND plan_revision = OLD.revision)
		OR EXISTS (SELECT 1 FROM plan_revisions WHERE plan_id = OLD.plan_id AND revision > OLD.revision)
	BEGIN SELECT RAISE(ABORT, 'Rows of plan_revisions are immutable once approved, run, or revised'); END;`;
  return `CREATE TRIGGER ${table}_update BEFORE UPDATE ON ${table}
	BEGIN SELECT RAISE(ABORT, 'Rows of ${table} are immutable'); END;`;
}
var triggers = tableNames.map(
  (table) => `${updateTrigger(table)}
CREATE TRIGGER ${table}_delete BEFORE DELETE ON ${table}
	BEGIN SELECT RAISE(ABORT, 'Rows of ${table} are immutable'); END;`
).join("\n");
function completed(subject, data = {}) {
  return { status: "completed", subject, reasons: [], data };
}
function databasePath(workspace) {
  return join(workspace, ".checkmate", "checkmate.db");
}
function removeTemporaryDirectory(store, name) {
  const temporary = join(store.workspace, ".checkmate", "tmp");
  rmSync(join(temporary, name), { recursive: true, force: true });
  try {
    rmdirSync(temporary);
  } catch {
  }
}
var busyReason = "Another command holds the database lock. Nothing changed. Run the command again.";
function isBusy(error) {
  return error instanceof Error && "errcode" in error && [5, 6].includes(Number(error.errcode) & 255);
}
function busyTimeout(value2 = process.env.CHECKMATE_BUSY_TIMEOUT_MS) {
  const milliseconds = Number(value2);
  return value2 !== void 0 && /^[1-9][0-9]*$/.test(value2) && milliseconds <= 2147483647 ? milliseconds : 3e4;
}
function openStore(workspace) {
  const path = databasePath(workspace);
  mkdirSync(join(workspace, ".checkmate"), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = ${busyTimeout()}`);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("BEGIN IMMEDIATE");
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get()) {
      db.exec(tables);
      db.exec(triggers);
      const insert = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
      insert.run("contractVersion", contractVersion);
      insert.run("schemaVersion", schemaVersion);
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
    throw error;
  }
  return checkedStore(db, workspace, path);
}
function openReadOnlyStore(workspace) {
  const path = databasePath(workspace);
  closeStore(openStore(workspace));
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec(`PRAGMA busy_timeout = ${busyTimeout()}`);
  return checkedStore(db, workspace, path);
}
function checkedStore(db, workspace, path) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get();
  if (row?.value !== schemaVersion) {
    db.close();
    throw new Error(`Database ${path} has schema version ${row?.value ?? "none"}. Expected ${schemaVersion}.`);
  }
  return { db, workspace, path };
}
function closeStore(store) {
  store.db.close();
}
function one(store, sql, ...parameters) {
  return store.db.prepare(sql).get(...parameters);
}
function all(store, sql, ...parameters) {
  return store.db.prepare(sql).all(...parameters);
}
function execute(store, sql, ...parameters) {
  store.db.prepare(sql).run(...parameters);
}
function write(store, operation, change) {
  const actor = operation.actor?.trim();
  if (!actor) throw new Error("A write needs an actor. Use --actor <name> or set CHECKMATE_ACTOR.");
  const id2 = ulid();
  const at = (/* @__PURE__ */ new Date()).toISOString();
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const { reply, subjects } = change(id2, at, actor);
    recordOperation(store, { ...operation, id: id2, at, actor }, reply, subjects);
    store.db.exec("COMMIT");
    return reply;
  } catch (error) {
    if (store.db.isTransaction) store.db.exec("ROLLBACK");
    if (isBusy(error)) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    store.db.exec("BEGIN IMMEDIATE");
    recordOperation(
      store,
      { ...operation, id: ulid(), at: (/* @__PURE__ */ new Date()).toISOString(), actor },
      { status: "rejected", subject: operation.subject, reasons: [reason], data: {} },
      []
    );
    store.db.exec("COMMIT");
    throw error;
  }
}
function recordOperation(store, operation, reply, subjects) {
  execute(
    store,
    "INSERT INTO operations (id, at, actor, command, arguments, status, response, subjects) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    operation.id,
    operation.at,
    operation.actor,
    operation.command,
    canonical(operation.input ?? null),
    reply.status,
    canonical(reply),
    canonical(subjects)
  );
}
function canonical(value2) {
  return JSON.stringify(sorted(value2));
}
function sorted(value2) {
  if (Array.isArray(value2)) return value2.map(sorted);
  if (value2 && typeof value2 === "object")
    return Object.fromEntries(
      Object.keys(value2).sort().map((key) => [key, sorted(value2[key])])
    );
  return value2;
}
function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}
var crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
var lastTime = 0;
var lastRandom = 0n;
function ulid(now = Date.now()) {
  if (now > lastTime) {
    lastTime = now;
    lastRandom = BigInt(`0x${randomBytes(10).toString("hex")}`);
  } else {
    lastRandom += 1n;
    if (lastRandom >= 1n << 80n) throw new Error("ULID random part overflowed in one millisecond");
  }
  return base32(BigInt(lastTime), 10) + base32(lastRandom, 16);
}
function base32(value2, length) {
  let text = "";
  for (let i = 0; i < length; i++) {
    text = crockford[Number(value2 % 32n)] + text;
    value2 /= 32n;
  }
  return text;
}

// plugin/src/validators.js
var validators_exports = {};
__export(validators_exports, {
  finding: () => ns,
  gap: () => ps,
  instance: () => os,
  plan: () => cs,
  planCandidate: () => ms,
  planDelta: () => ls,
  planPatch: () => us,
  planRequest: () => ds,
  profile: () => hs,
  response: () => fs,
  result: () => ys
});
var H = (u, t) => () => {
  try {
    return t || u((t = { exports: {} }).exports, t), t.exports;
  } catch (_) {
    throw t = 0, _;
  }
};
var pe = H((X) => {
  "use strict";
  Object.defineProperty(X, "__esModule", { value: true });
  function ne(u) {
    let t = u.length, _ = 0, Z = 0, N;
    for (; Z < t; ) _++, N = u.charCodeAt(Z++), N >= 55296 && N <= 56319 && Z < t && (N = u.charCodeAt(Z), (N & 64512) === 56320 && Z++);
    return _;
  }
  X.default = ne;
  ne.code = 'require("ajv/dist/runtime/ucs2length").default';
});
var me = H((rs, oe) => {
  "use strict";
  oe.exports = function u(t, _) {
    if (t === _) return true;
    if (t && _ && typeof t == "object" && typeof _ == "object") {
      if (t.constructor !== _.constructor) return false;
      var Z, N, e;
      if (Array.isArray(t)) {
        if (Z = t.length, Z != _.length) return false;
        for (N = Z; N-- !== 0; ) if (!u(t[N], _[N])) return false;
        return true;
      }
      if (t.constructor === RegExp) return t.source === _.source && t.flags === _.flags;
      if (t.valueOf !== Object.prototype.valueOf) return t.valueOf() === _.valueOf();
      if (t.toString !== Object.prototype.toString) return t.toString() === _.toString();
      if (e = Object.keys(t), Z = e.length, Z !== Object.keys(_).length) return false;
      for (N = Z; N-- !== 0; ) if (!Object.prototype.hasOwnProperty.call(_, e[N])) return false;
      for (N = Z; N-- !== 0; ) {
        var s = e[N];
        if (!u(t[s], _[s])) return false;
      }
      return true;
    }
    return t !== t && _ !== _;
  };
});
var ue = H((J) => {
  "use strict";
  Object.defineProperty(J, "__esModule", { value: true });
  var le = me();
  le.code = 'require("ajv/dist/runtime/equal").default';
  J.default = le;
});
var ke = H((G) => {
  "use strict";
  Object.defineProperty(G, "__esModule", { value: true });
  G.formatNames = G.fastFormats = G.fullFormats = void 0;
  function K(u, t) {
    return { validate: u, compare: t };
  }
  G.fullFormats = { date: K(fe, te), time: K(ee(true), re), "date-time": K(de(true), ge), "iso-time": K(ee(), ye), "iso-date-time": K(de(), Pe), duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/, uri: Fe, "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i, "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i, url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu, email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i, hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i, ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/, ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i, regex: He, uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i, "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/, "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i, "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/, byte: Re, int32: { type: "number", validate: Be }, int64: { type: "number", validate: Me }, float: { type: "number", validate: he }, double: { type: "number", validate: he }, password: true, binary: true };
  G.fastFormats = { ...G.fullFormats, date: K(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, te), time: K(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, re), "date-time": K(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, ge), "iso-time": K(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, ye), "iso-date-time": K(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, Pe), uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i, "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i, email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i };
  G.formatNames = Object.keys(G.fullFormats);
  function xe(u) {
    return u % 4 === 0 && (u % 100 !== 0 || u % 400 === 0);
  }
  var Ve = /^(\d\d\d\d)-(\d\d)-(\d\d)$/, De = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function fe(u) {
    let t = Ve.exec(u);
    if (!t) return false;
    let _ = +t[1], Z = +t[2], N = +t[3];
    return Z >= 1 && Z <= 12 && N >= 1 && N <= (Z === 2 && xe(_) ? 29 : De[Z]);
  }
  function te(u, t) {
    if (u && t) return u > t ? 1 : u < t ? -1 : 0;
  }
  var Q = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
  function ee(u) {
    return function(_) {
      let Z = Q.exec(_);
      if (!Z) return false;
      let N = +Z[1], e = +Z[2], s = +Z[3], O = Z[4], g = Z[5] === "-" ? -1 : 1, o = +(Z[6] || 0), y = +(Z[7] || 0);
      if (o > 23 || y > 59 || u && !O) return false;
      if (N <= 23 && e <= 59 && s < 60) return true;
      let l = e - y * g, d = N - o * g - (l < 0 ? 1 : 0);
      return (d === 23 || d === -1) && (l === 59 || l === -1) && s < 61;
    };
  }
  function re(u, t) {
    if (!(u && t)) return;
    let _ = (/* @__PURE__ */ new Date("2020-01-01T" + u)).valueOf(), Z = (/* @__PURE__ */ new Date("2020-01-01T" + t)).valueOf();
    if (_ && Z) return _ - Z;
  }
  function ye(u, t) {
    if (!(u && t)) return;
    let _ = Q.exec(u), Z = Q.exec(t);
    if (_ && Z) return u = _[1] + _[2] + _[3], t = Z[1] + Z[2] + Z[3], u > t ? 1 : u < t ? -1 : 0;
  }
  var se = /t|\s/i;
  function de(u) {
    let t = ee(u);
    return function(Z) {
      let N = Z.split(se);
      return N.length === 2 && fe(N[0]) && t(N[1]);
    };
  }
  function ge(u, t) {
    if (!(u && t)) return;
    let _ = new Date(u).valueOf(), Z = new Date(t).valueOf();
    if (_ && Z) return _ - Z;
  }
  function Pe(u, t) {
    if (!(u && t)) return;
    let [_, Z] = u.split(se), [N, e] = t.split(se), s = te(_, N);
    if (s !== void 0) return s || re(Z, e);
  }
  var Ke = /\/|:/, Ge = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
  function Fe(u) {
    return Ke.test(u) && Ge.test(u);
  }
  var ce = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
  function Re(u) {
    return ce.lastIndex = 0, ce.test(u);
  }
  var Ee = -(2 ** 31), Ce = 2 ** 31 - 1;
  function Be(u) {
    return Number.isInteger(u) && u <= Ce && u >= Ee;
  }
  function Me(u) {
    return Number.isInteger(u);
  }
  function he() {
    return true;
  }
  var Se = /[^\\]\\Z/;
  function He(u) {
    if (Se.test(u)) return false;
    try {
      return new RegExp(u), true;
    } catch {
      return false;
    }
  }
});
var ns = Ie;
var ie = { $schema: "http://json-schema.org/draft-07/schema#", $id: "finding.schema.json", type: "object", properties: { id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, type: { enum: ["defect", "potential_issue"] }, severity: { enum: ["low", "medium", "high", "critical"] }, assertionIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\\.[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, requirementIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, title: { type: "string", minLength: 1 }, expected: { type: "string", minLength: 1 }, observed: { type: "string", minLength: 1 }, reproduction: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true }, evidenceIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, metadata: { $ref: "plan.schema.json#/definitions/metadata" } }, required: ["id", "type", "severity", "assertionIds", "requirementIds", "title", "expected", "observed", "reproduction", "evidenceIds"], additionalProperties: false };
var F = { type: "object", propertyNames: { pattern: "^[A-Za-z][A-Za-z0-9_.-]{0,63}$" }, additionalProperties: { type: ["string", "number", "boolean"], maxLength: 500 }, maxProperties: 20 };
var C = Object.prototype.hasOwnProperty;
var j = pe().default;
var z = new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$", "u");
var ve = new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\\.[A-Za-z0-9][A-Za-z0-9_-]{0,95}$", "u");
var R = new RegExp("^[A-Za-z][A-Za-z0-9_.-]{0,63}$", "u");
function Ie(u, { instancePath: t = "", parentData: _, parentDataProperty: Z, rootData: N = u } = {}) {
  let e = null, s = 0;
  if (u && typeof u == "object" && !Array.isArray(u)) {
    if (u.id === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.type === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.severity === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "severity" }, message: "must have required property 'severity'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.assertionIds === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "assertionIds" }, message: "must have required property 'assertionIds'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.requirementIds === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "requirementIds" }, message: "must have required property 'requirementIds'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.title === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "title" }, message: "must have required property 'title'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.expected === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "expected" }, message: "must have required property 'expected'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.observed === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "observed" }, message: "must have required property 'observed'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.reproduction === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "reproduction" }, message: "must have required property 'reproduction'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.evidenceIds === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "evidenceIds" }, message: "must have required property 'evidenceIds'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    for (let g in u) if (!C.call(ie.properties, g)) {
      let o = { instancePath: t, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: g }, message: "must NOT have additional properties" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.id !== void 0) {
      let g = u.id;
      if (typeof g == "string") {
        if (!z.test(g)) {
          let o = { instancePath: t + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [o] : e.push(o), s++;
        }
      } else {
        let o = { instancePath: t + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.type !== void 0) {
      let g = u.type;
      if (!(g === "defect" || g === "potential_issue")) {
        let o = { instancePath: t + "/type", schemaPath: "#/properties/type/enum", keyword: "enum", params: { allowedValues: ie.properties.type.enum }, message: "must be equal to one of the allowed values" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.severity !== void 0) {
      let g = u.severity;
      if (!(g === "low" || g === "medium" || g === "high" || g === "critical")) {
        let o = { instancePath: t + "/severity", schemaPath: "#/properties/severity/enum", keyword: "enum", params: { allowedValues: ie.properties.severity.enum }, message: "must be equal to one of the allowed values" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.assertionIds !== void 0) {
      let g = u.assertionIds;
      if (Array.isArray(g)) {
        if (g.length < 1) {
          let d = { instancePath: t + "/assertionIds", schemaPath: "#/properties/assertionIds/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [d] : e.push(d), s++;
        }
        let o = g.length;
        for (let d = 0; d < o; d++) {
          let n = g[d];
          if (typeof n == "string") {
            if (!ve.test(n)) {
              let m = { instancePath: t + "/assertionIds/" + d, schemaPath: "#/properties/assertionIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\\.[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\\.[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: t + "/assertionIds/" + d, schemaPath: "#/properties/assertionIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        let y = g.length, l;
        if (y > 1) {
          let d = {};
          for (; y--; ) {
            let n = g[y];
            if (typeof n == "string") {
              if (typeof d[n] == "number") {
                l = d[n];
                let m = { instancePath: t + "/assertionIds", schemaPath: "#/properties/assertionIds/uniqueItems", keyword: "uniqueItems", params: { i: y, j: l }, message: "must NOT have duplicate items (items ## " + l + " and " + y + " are identical)" };
                e === null ? e = [m] : e.push(m), s++;
                break;
              }
              d[n] = y;
            }
          }
        }
      } else {
        let o = { instancePath: t + "/assertionIds", schemaPath: "#/properties/assertionIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.requirementIds !== void 0) {
      let g = u.requirementIds;
      if (Array.isArray(g)) {
        if (g.length < 1) {
          let d = { instancePath: t + "/requirementIds", schemaPath: "#/properties/requirementIds/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [d] : e.push(d), s++;
        }
        let o = g.length;
        for (let d = 0; d < o; d++) {
          let n = g[d];
          if (typeof n == "string") {
            if (!z.test(n)) {
              let m = { instancePath: t + "/requirementIds/" + d, schemaPath: "#/properties/requirementIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: t + "/requirementIds/" + d, schemaPath: "#/properties/requirementIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        let y = g.length, l;
        if (y > 1) {
          let d = {};
          for (; y--; ) {
            let n = g[y];
            if (typeof n == "string") {
              if (typeof d[n] == "number") {
                l = d[n];
                let m = { instancePath: t + "/requirementIds", schemaPath: "#/properties/requirementIds/uniqueItems", keyword: "uniqueItems", params: { i: y, j: l }, message: "must NOT have duplicate items (items ## " + l + " and " + y + " are identical)" };
                e === null ? e = [m] : e.push(m), s++;
                break;
              }
              d[n] = y;
            }
          }
        }
      } else {
        let o = { instancePath: t + "/requirementIds", schemaPath: "#/properties/requirementIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.title !== void 0) {
      let g = u.title;
      if (typeof g == "string") {
        if (j(g) < 1) {
          let o = { instancePath: t + "/title", schemaPath: "#/properties/title/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [o] : e.push(o), s++;
        }
      } else {
        let o = { instancePath: t + "/title", schemaPath: "#/properties/title/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.expected !== void 0) {
      let g = u.expected;
      if (typeof g == "string") {
        if (j(g) < 1) {
          let o = { instancePath: t + "/expected", schemaPath: "#/properties/expected/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [o] : e.push(o), s++;
        }
      } else {
        let o = { instancePath: t + "/expected", schemaPath: "#/properties/expected/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.observed !== void 0) {
      let g = u.observed;
      if (typeof g == "string") {
        if (j(g) < 1) {
          let o = { instancePath: t + "/observed", schemaPath: "#/properties/observed/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [o] : e.push(o), s++;
        }
      } else {
        let o = { instancePath: t + "/observed", schemaPath: "#/properties/observed/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.reproduction !== void 0) {
      let g = u.reproduction;
      if (Array.isArray(g)) {
        if (g.length < 1) {
          let d = { instancePath: t + "/reproduction", schemaPath: "#/properties/reproduction/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [d] : e.push(d), s++;
        }
        let o = g.length;
        for (let d = 0; d < o; d++) {
          let n = g[d];
          if (typeof n == "string") {
            if (j(n) < 1) {
              let m = { instancePath: t + "/reproduction/" + d, schemaPath: "#/properties/reproduction/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: t + "/reproduction/" + d, schemaPath: "#/properties/reproduction/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        let y = g.length, l;
        if (y > 1) {
          let d = {};
          for (; y--; ) {
            let n = g[y];
            if (typeof n == "string") {
              if (typeof d[n] == "number") {
                l = d[n];
                let m = { instancePath: t + "/reproduction", schemaPath: "#/properties/reproduction/uniqueItems", keyword: "uniqueItems", params: { i: y, j: l }, message: "must NOT have duplicate items (items ## " + l + " and " + y + " are identical)" };
                e === null ? e = [m] : e.push(m), s++;
                break;
              }
              d[n] = y;
            }
          }
        }
      } else {
        let o = { instancePath: t + "/reproduction", schemaPath: "#/properties/reproduction/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.evidenceIds !== void 0) {
      let g = u.evidenceIds;
      if (Array.isArray(g)) {
        if (g.length < 1) {
          let d = { instancePath: t + "/evidenceIds", schemaPath: "#/properties/evidenceIds/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [d] : e.push(d), s++;
        }
        let o = g.length;
        for (let d = 0; d < o; d++) {
          let n = g[d];
          if (typeof n == "string") {
            if (!z.test(n)) {
              let m = { instancePath: t + "/evidenceIds/" + d, schemaPath: "#/properties/evidenceIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: t + "/evidenceIds/" + d, schemaPath: "#/properties/evidenceIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        let y = g.length, l;
        if (y > 1) {
          let d = {};
          for (; y--; ) {
            let n = g[y];
            if (typeof n == "string") {
              if (typeof d[n] == "number") {
                l = d[n];
                let m = { instancePath: t + "/evidenceIds", schemaPath: "#/properties/evidenceIds/uniqueItems", keyword: "uniqueItems", params: { i: y, j: l }, message: "must NOT have duplicate items (items ## " + l + " and " + y + " are identical)" };
                e === null ? e = [m] : e.push(m), s++;
                break;
              }
              d[n] = y;
            }
          }
        }
      } else {
        let o = { instancePath: t + "/evidenceIds", schemaPath: "#/properties/evidenceIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.metadata !== void 0) {
      let g = u.metadata;
      if (g && typeof g == "object" && !Array.isArray(g)) {
        if (Object.keys(g).length > 20) {
          let o = { instancePath: t + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/maxProperties", keyword: "maxProperties", params: { limit: 20 }, message: "must NOT have more than 20 properties" };
          e === null ? e = [o] : e.push(o), s++;
        }
        for (let o in g) {
          let y = s;
          if (typeof o == "string" && !R.test(o)) {
            let l = { instancePath: t + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z][A-Za-z0-9_.-]{0,63}$" }, message: 'must match pattern "^[A-Za-z][A-Za-z0-9_.-]{0,63}$"', propertyName: o };
            e === null ? e = [l] : e.push(l), s++;
          }
          var O = y === s;
          if (!O) {
            let l = { instancePath: t + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/propertyNames", keyword: "propertyNames", params: { propertyName: o }, message: "property name must be valid" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
        for (let o in g) {
          let y = g[o];
          if (typeof y != "string" && !(typeof y == "number" && isFinite(y)) && typeof y != "boolean") {
            let l = { instancePath: t + "/metadata/" + o.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan.schema.json#/definitions/metadata/additionalProperties/type", keyword: "type", params: { type: F.additionalProperties.type }, message: "must be string,number,boolean" };
            e === null ? e = [l] : e.push(l), s++;
          }
          if (typeof y == "string" && j(y) > 500) {
            let l = { instancePath: t + "/metadata/" + o.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan.schema.json#/definitions/metadata/additionalProperties/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
      } else {
        let o = { instancePath: t + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
  } else {
    let g = { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [g] : e.push(g), s++;
  }
  return Ie.errors = e, s === 0;
}
var ps = be;
var B = { $schema: "http://json-schema.org/draft-07/schema#", $id: "gap.schema.json", type: "object", properties: { id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, severity: { enum: ["blocking", "non_blocking"] }, status: { enum: ["open", "resolved", "deferred"] }, requirementIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 0, uniqueItems: true }, testIds: { type: "array", items: { type: "string", pattern: "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 0, uniqueItems: true }, question: { type: "string", minLength: 1 }, consequence: { type: "string", minLength: 1 }, decisionId: { anyOf: [{ type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, { type: "null" }] } }, required: ["id", "severity", "status", "requirementIds", "testIds", "question", "consequence", "decisionId"], additionalProperties: false };
var M = new RegExp("^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$", "u");
function be(u, { instancePath: t = "", parentData: _, parentDataProperty: Z, rootData: N = u } = {}) {
  let e = null, s = 0;
  if (u && typeof u == "object" && !Array.isArray(u)) {
    if (u.id === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.severity === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "severity" }, message: "must have required property 'severity'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.status === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "status" }, message: "must have required property 'status'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.requirementIds === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "requirementIds" }, message: "must have required property 'requirementIds'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.testIds === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "testIds" }, message: "must have required property 'testIds'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.question === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "question" }, message: "must have required property 'question'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.consequence === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "consequence" }, message: "must have required property 'consequence'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.decisionId === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "decisionId" }, message: "must have required property 'decisionId'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    for (let g in u) if (!(g === "id" || g === "severity" || g === "status" || g === "requirementIds" || g === "testIds" || g === "question" || g === "consequence" || g === "decisionId")) {
      let o = { instancePath: t, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: g }, message: "must NOT have additional properties" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.id !== void 0) {
      let g = u.id;
      if (typeof g == "string") {
        if (!z.test(g)) {
          let o = { instancePath: t + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [o] : e.push(o), s++;
        }
      } else {
        let o = { instancePath: t + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.severity !== void 0) {
      let g = u.severity;
      if (!(g === "blocking" || g === "non_blocking")) {
        let o = { instancePath: t + "/severity", schemaPath: "#/properties/severity/enum", keyword: "enum", params: { allowedValues: B.properties.severity.enum }, message: "must be equal to one of the allowed values" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.status !== void 0) {
      let g = u.status;
      if (!(g === "open" || g === "resolved" || g === "deferred")) {
        let o = { instancePath: t + "/status", schemaPath: "#/properties/status/enum", keyword: "enum", params: { allowedValues: B.properties.status.enum }, message: "must be equal to one of the allowed values" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.requirementIds !== void 0) {
      let g = u.requirementIds;
      if (Array.isArray(g)) {
        if (g.length < 0) {
          let d = { instancePath: t + "/requirementIds", schemaPath: "#/properties/requirementIds/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [d] : e.push(d), s++;
        }
        let o = g.length;
        for (let d = 0; d < o; d++) {
          let n = g[d];
          if (typeof n == "string") {
            if (!z.test(n)) {
              let m = { instancePath: t + "/requirementIds/" + d, schemaPath: "#/properties/requirementIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: t + "/requirementIds/" + d, schemaPath: "#/properties/requirementIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        let y = g.length, l;
        if (y > 1) {
          let d = {};
          for (; y--; ) {
            let n = g[y];
            if (typeof n == "string") {
              if (typeof d[n] == "number") {
                l = d[n];
                let m = { instancePath: t + "/requirementIds", schemaPath: "#/properties/requirementIds/uniqueItems", keyword: "uniqueItems", params: { i: y, j: l }, message: "must NOT have duplicate items (items ## " + l + " and " + y + " are identical)" };
                e === null ? e = [m] : e.push(m), s++;
                break;
              }
              d[n] = y;
            }
          }
        }
      } else {
        let o = { instancePath: t + "/requirementIds", schemaPath: "#/properties/requirementIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.testIds !== void 0) {
      let g = u.testIds;
      if (Array.isArray(g)) {
        if (g.length < 0) {
          let d = { instancePath: t + "/testIds", schemaPath: "#/properties/testIds/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [d] : e.push(d), s++;
        }
        let o = g.length;
        for (let d = 0; d < o; d++) {
          let n = g[d];
          if (typeof n == "string") {
            if (!M.test(n)) {
              let m = { instancePath: t + "/testIds/" + d, schemaPath: "#/properties/testIds/items/pattern", keyword: "pattern", params: { pattern: "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: t + "/testIds/" + d, schemaPath: "#/properties/testIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        let y = g.length, l;
        if (y > 1) {
          let d = {};
          for (; y--; ) {
            let n = g[y];
            if (typeof n == "string") {
              if (typeof d[n] == "number") {
                l = d[n];
                let m = { instancePath: t + "/testIds", schemaPath: "#/properties/testIds/uniqueItems", keyword: "uniqueItems", params: { i: y, j: l }, message: "must NOT have duplicate items (items ## " + l + " and " + y + " are identical)" };
                e === null ? e = [m] : e.push(m), s++;
                break;
              }
              d[n] = y;
            }
          }
        }
      } else {
        let o = { instancePath: t + "/testIds", schemaPath: "#/properties/testIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.question !== void 0) {
      let g = u.question;
      if (typeof g == "string") {
        if (j(g) < 1) {
          let o = { instancePath: t + "/question", schemaPath: "#/properties/question/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [o] : e.push(o), s++;
        }
      } else {
        let o = { instancePath: t + "/question", schemaPath: "#/properties/question/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.consequence !== void 0) {
      let g = u.consequence;
      if (typeof g == "string") {
        if (j(g) < 1) {
          let o = { instancePath: t + "/consequence", schemaPath: "#/properties/consequence/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [o] : e.push(o), s++;
        }
      } else {
        let o = { instancePath: t + "/consequence", schemaPath: "#/properties/consequence/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.decisionId !== void 0) {
      let g = u.decisionId, o = s, y = false, l = s;
      if (typeof g == "string") {
        if (!z.test(g)) {
          let d = { instancePath: t + "/decisionId", schemaPath: "#/properties/decisionId/anyOf/0/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [d] : e.push(d), s++;
        }
      } else {
        let d = { instancePath: t + "/decisionId", schemaPath: "#/properties/decisionId/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [d] : e.push(d), s++;
      }
      var O = l === s;
      if (y = y || O, !y) {
        let d = s;
        if (g !== null) {
          let m = { instancePath: t + "/decisionId", schemaPath: "#/properties/decisionId/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
          e === null ? e = [m] : e.push(m), s++;
        }
        var O = d === s;
        y = y || O;
      }
      if (y) s = o, e !== null && (o ? e.length = o : e = null);
      else {
        let d = { instancePath: t + "/decisionId", schemaPath: "#/properties/decisionId/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
        e === null ? e = [d] : e.push(d), s++;
      }
    }
  } else {
    let g = { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [g] : e.push(g), s++;
  }
  return be.errors = e, s === 0;
}
var os = Ae;
function Ae(u, { instancePath: t = "", parentData: _, parentDataProperty: Z, rootData: N = u } = {}) {
  let e = null, s = 0;
  if (u && typeof u == "object" && !Array.isArray(u)) {
    if (u.entries === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entries" }, message: "must have required property 'entries'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    for (let g in u) if (!(g === "entries" || g === "environment" || g === "references")) {
      let o = { instancePath: t, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: g }, message: "must NOT have additional properties" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.entries !== void 0) {
      let g = u.entries;
      if (g && typeof g == "object" && !Array.isArray(g)) {
        if (Object.keys(g).length < 1) {
          let o = { instancePath: t + "/entries", schemaPath: "#/properties/entries/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
          e === null ? e = [o] : e.push(o), s++;
        }
        for (let o in g) {
          let y = s;
          if (typeof o == "string" && !z.test(o)) {
            let l = { instancePath: t + "/entries", schemaPath: "#/properties/entries/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"', propertyName: o };
            e === null ? e = [l] : e.push(l), s++;
          }
          var O = y === s;
          if (!O) {
            let l = { instancePath: t + "/entries", schemaPath: "#/properties/entries/propertyNames", keyword: "propertyNames", params: { propertyName: o }, message: "property name must be valid" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
        for (let o in g) {
          let y = g[o];
          if (typeof y == "string") {
            if (j(y) > 2e3) {
              let l = { instancePath: t + "/entries/" + o.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/entries/additionalProperties/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
              e === null ? e = [l] : e.push(l), s++;
            }
            if (j(y) < 1) {
              let l = { instancePath: t + "/entries/" + o.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/entries/additionalProperties/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              e === null ? e = [l] : e.push(l), s++;
            }
          } else {
            let l = { instancePath: t + "/entries/" + o.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/entries/additionalProperties/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
      } else {
        let o = { instancePath: t + "/entries", schemaPath: "#/properties/entries/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.environment !== void 0) {
      let g = u.environment;
      if (typeof g == "string") {
        if (j(g) > 500) {
          let o = { instancePath: t + "/environment", schemaPath: "#/properties/environment/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
          e === null ? e = [o] : e.push(o), s++;
        }
        if (j(g) < 1) {
          let o = { instancePath: t + "/environment", schemaPath: "#/properties/environment/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [o] : e.push(o), s++;
        }
      } else {
        let o = { instancePath: t + "/environment", schemaPath: "#/properties/environment/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.references !== void 0) {
      let g = u.references;
      if (Array.isArray(g)) {
        if (g.length < 0) {
          let d = { instancePath: t + "/references", schemaPath: "#/properties/references/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [d] : e.push(d), s++;
        }
        let o = g.length;
        for (let d = 0; d < o; d++) {
          let n = g[d];
          if (typeof n == "string") {
            if (j(n) > 200) {
              let m = { instancePath: t + "/references/" + d, schemaPath: "#/properties/references/items/maxLength", keyword: "maxLength", params: { limit: 200 }, message: "must NOT have more than 200 characters" };
              e === null ? e = [m] : e.push(m), s++;
            }
            if (j(n) < 1) {
              let m = { instancePath: t + "/references/" + d, schemaPath: "#/properties/references/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: t + "/references/" + d, schemaPath: "#/properties/references/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        let y = g.length, l;
        if (y > 1) {
          let d = {};
          for (; y--; ) {
            let n = g[y];
            if (typeof n == "string") {
              if (typeof d[n] == "number") {
                l = d[n];
                let m = { instancePath: t + "/references", schemaPath: "#/properties/references/uniqueItems", keyword: "uniqueItems", params: { i: y, j: l }, message: "must NOT have duplicate items (items ## " + l + " and " + y + " are identical)" };
                e === null ? e = [m] : e.push(m), s++;
                break;
              }
              d[n] = y;
            }
          }
        }
      } else {
        let o = { instancePath: t + "/references", schemaPath: "#/properties/references/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
  } else {
    let g = { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [g] : e.push(g), s++;
  }
  return Ae.errors = e, s === 0;
}
var ms = ze;
var Ye = { $schema: "http://json-schema.org/draft-07/schema#", $id: "plan-candidate.schema.json", type: "object", properties: { requirements: { $ref: "plan.schema.json#/properties/requirements" }, tests: { type: "array", items: { type: "object", properties: { id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, title: { type: "string", minLength: 1, maxLength: 200 }, requirementIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, capability: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, operations: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, dependsOn: { type: "array", items: { type: "string", pattern: "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 0, uniqueItems: true }, preconditions: { type: "array", items: { type: "string", minLength: 1 }, minItems: 0, uniqueItems: true }, action: { type: "string", minLength: 1 }, assertions: { type: "array", items: { $ref: "plan.schema.json#/definitions/assertion" }, minItems: 0, uniqueItems: true }, metadata: { $ref: "plan.schema.json#/definitions/metadata" } }, required: ["id", "title", "requirementIds", "capability", "operations", "dependsOn", "preconditions", "action", "assertions"], additionalProperties: false }, minItems: 0, uniqueItems: true }, gaps: { type: "array", items: { $ref: "gap.schema.json" }, minItems: 0, uniqueItems: true } }, required: ["tests", "gaps"], additionalProperties: false };
var je = { type: "object", properties: { id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, check: { type: "string", minLength: 1 }, checkKind: { enum: ["deterministic", "agent_observation"] } }, required: ["id", "check", "checkKind"], additionalProperties: false };
var L = ue().default;
function Y(u, { instancePath: t = "", parentData: _, parentDataProperty: Z, rootData: N = u } = {}) {
  let e = null, s = 0;
  if (Array.isArray(u)) {
    if (u.length < 1) {
      let l = { instancePath: t, schemaPath: "#/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
      e === null ? e = [l] : e.push(l), s++;
    }
    let g = u.length;
    for (let l = 0; l < g; l++) {
      let d = u[l];
      if (d && typeof d == "object" && !Array.isArray(d)) {
        if (d.id === void 0) {
          let n = { instancePath: t + "/" + l, schemaPath: "#/items/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
          e === null ? e = [n] : e.push(n), s++;
        }
        if (d.text === void 0) {
          let n = { instancePath: t + "/" + l, schemaPath: "#/items/required", keyword: "required", params: { missingProperty: "text" }, message: "must have required property 'text'" };
          e === null ? e = [n] : e.push(n), s++;
        }
        if (d.source === void 0) {
          let n = { instancePath: t + "/" + l, schemaPath: "#/items/required", keyword: "required", params: { missingProperty: "source" }, message: "must have required property 'source'" };
          e === null ? e = [n] : e.push(n), s++;
        }
        for (let n in d) if (!(n === "id" || n === "text" || n === "source" || n === "metadata")) {
          let m = { instancePath: t + "/" + l, schemaPath: "#/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: n }, message: "must NOT have additional properties" };
          e === null ? e = [m] : e.push(m), s++;
        }
        if (d.id !== void 0) {
          let n = d.id;
          if (typeof n == "string") {
            if (!z.test(n)) {
              let m = { instancePath: t + "/" + l + "/id", schemaPath: "#/items/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: t + "/" + l + "/id", schemaPath: "#/items/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        if (d.text !== void 0) {
          let n = d.text;
          if (typeof n == "string") {
            if (j(n) < 1) {
              let m = { instancePath: t + "/" + l + "/text", schemaPath: "#/items/properties/text/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: t + "/" + l + "/text", schemaPath: "#/items/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        if (d.source !== void 0) {
          let n = d.source;
          if (typeof n == "string") {
            if (j(n) < 1) {
              let m = { instancePath: t + "/" + l + "/source", schemaPath: "#/items/properties/source/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: t + "/" + l + "/source", schemaPath: "#/items/properties/source/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        if (d.metadata !== void 0) {
          let n = d.metadata;
          if (n && typeof n == "object" && !Array.isArray(n)) {
            if (Object.keys(n).length > 20) {
              let m = { instancePath: t + "/" + l + "/metadata", schemaPath: "#/definitions/metadata/maxProperties", keyword: "maxProperties", params: { limit: 20 }, message: "must NOT have more than 20 properties" };
              e === null ? e = [m] : e.push(m), s++;
            }
            for (let m in n) {
              let a = s;
              if (typeof m == "string" && !R.test(m)) {
                let r = { instancePath: t + "/" + l + "/metadata", schemaPath: "#/definitions/metadata/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z][A-Za-z0-9_.-]{0,63}$" }, message: 'must match pattern "^[A-Za-z][A-Za-z0-9_.-]{0,63}$"', propertyName: m };
                e === null ? e = [r] : e.push(r), s++;
              }
              var O = a === s;
              if (!O) {
                let r = { instancePath: t + "/" + l + "/metadata", schemaPath: "#/definitions/metadata/propertyNames", keyword: "propertyNames", params: { propertyName: m }, message: "property name must be valid" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            for (let m in n) {
              let a = n[m];
              if (typeof a != "string" && !(typeof a == "number" && isFinite(a)) && typeof a != "boolean") {
                let r = { instancePath: t + "/" + l + "/metadata/" + m.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/definitions/metadata/additionalProperties/type", keyword: "type", params: { type: F.additionalProperties.type }, message: "must be string,number,boolean" };
                e === null ? e = [r] : e.push(r), s++;
              }
              if (typeof a == "string" && j(a) > 500) {
                let r = { instancePath: t + "/" + l + "/metadata/" + m.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/definitions/metadata/additionalProperties/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
          } else {
            let m = { instancePath: t + "/" + l + "/metadata", schemaPath: "#/definitions/metadata/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
      } else {
        let n = { instancePath: t + "/" + l, schemaPath: "#/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [n] : e.push(n), s++;
      }
    }
    let o = u.length, y;
    if (o > 1) {
      e: for (; o--; ) for (y = o; y--; ) if (L(u[o], u[y])) {
        let l = { instancePath: t, schemaPath: "#/uniqueItems", keyword: "uniqueItems", params: { i: o, j: y }, message: "must NOT have duplicate items (items ## " + y + " and " + o + " are identical)" };
        e === null ? e = [l] : e.push(l), s++;
        break e;
      }
    }
  } else {
    let g = { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "array" }, message: "must be array" };
    e === null ? e = [g] : e.push(g), s++;
  }
  return Y.errors = e, s === 0;
}
function ze(u, { instancePath: t = "", parentData: _, parentDataProperty: Z, rootData: N = u } = {}) {
  let e = null, s = 0;
  if (u && typeof u == "object" && !Array.isArray(u)) {
    if (u.tests === void 0) {
      let o = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "tests" }, message: "must have required property 'tests'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.gaps === void 0) {
      let o = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "gaps" }, message: "must have required property 'gaps'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    for (let o in u) if (!(o === "requirements" || o === "tests" || o === "gaps")) {
      let y = { instancePath: t, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: o }, message: "must NOT have additional properties" };
      e === null ? e = [y] : e.push(y), s++;
    }
    if (u.requirements !== void 0 && (Y(u.requirements, { instancePath: t + "/requirements", parentData: u, parentDataProperty: "requirements", rootData: N }) || (e = e === null ? Y.errors : e.concat(Y.errors), s = e.length)), u.tests !== void 0) {
      let o = u.tests;
      if (Array.isArray(o)) {
        if (o.length < 0) {
          let n = { instancePath: t + "/tests", schemaPath: "#/properties/tests/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [n] : e.push(n), s++;
        }
        let y = o.length;
        for (let n = 0; n < y; n++) {
          let m = o[n];
          if (m && typeof m == "object" && !Array.isArray(m)) {
            if (m.id === void 0) {
              let a = { instancePath: t + "/tests/" + n, schemaPath: "#/properties/tests/items/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.title === void 0) {
              let a = { instancePath: t + "/tests/" + n, schemaPath: "#/properties/tests/items/required", keyword: "required", params: { missingProperty: "title" }, message: "must have required property 'title'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.requirementIds === void 0) {
              let a = { instancePath: t + "/tests/" + n, schemaPath: "#/properties/tests/items/required", keyword: "required", params: { missingProperty: "requirementIds" }, message: "must have required property 'requirementIds'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.capability === void 0) {
              let a = { instancePath: t + "/tests/" + n, schemaPath: "#/properties/tests/items/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.operations === void 0) {
              let a = { instancePath: t + "/tests/" + n, schemaPath: "#/properties/tests/items/required", keyword: "required", params: { missingProperty: "operations" }, message: "must have required property 'operations'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.dependsOn === void 0) {
              let a = { instancePath: t + "/tests/" + n, schemaPath: "#/properties/tests/items/required", keyword: "required", params: { missingProperty: "dependsOn" }, message: "must have required property 'dependsOn'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.preconditions === void 0) {
              let a = { instancePath: t + "/tests/" + n, schemaPath: "#/properties/tests/items/required", keyword: "required", params: { missingProperty: "preconditions" }, message: "must have required property 'preconditions'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.action === void 0) {
              let a = { instancePath: t + "/tests/" + n, schemaPath: "#/properties/tests/items/required", keyword: "required", params: { missingProperty: "action" }, message: "must have required property 'action'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.assertions === void 0) {
              let a = { instancePath: t + "/tests/" + n, schemaPath: "#/properties/tests/items/required", keyword: "required", params: { missingProperty: "assertions" }, message: "must have required property 'assertions'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            for (let a in m) if (!C.call(Ye.properties.tests.items.properties, a)) {
              let r = { instancePath: t + "/tests/" + n, schemaPath: "#/properties/tests/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: a }, message: "must NOT have additional properties" };
              e === null ? e = [r] : e.push(r), s++;
            }
            if (m.id !== void 0) {
              let a = m.id;
              if (typeof a == "string") {
                if (!z.test(a)) {
                  let r = { instancePath: t + "/tests/" + n + "/id", schemaPath: "#/properties/tests/items/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/tests/" + n + "/id", schemaPath: "#/properties/tests/items/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.title !== void 0) {
              let a = m.title;
              if (typeof a == "string") {
                if (j(a) > 200) {
                  let r = { instancePath: t + "/tests/" + n + "/title", schemaPath: "#/properties/tests/items/properties/title/maxLength", keyword: "maxLength", params: { limit: 200 }, message: "must NOT have more than 200 characters" };
                  e === null ? e = [r] : e.push(r), s++;
                }
                if (j(a) < 1) {
                  let r = { instancePath: t + "/tests/" + n + "/title", schemaPath: "#/properties/tests/items/properties/title/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/tests/" + n + "/title", schemaPath: "#/properties/tests/items/properties/title/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.requirementIds !== void 0) {
              let a = m.requirementIds;
              if (Array.isArray(a)) {
                if (a.length < 1) {
                  let k = { instancePath: t + "/tests/" + n + "/requirementIds", schemaPath: "#/properties/tests/items/properties/requirementIds/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                  e === null ? e = [k] : e.push(k), s++;
                }
                let r = a.length;
                for (let k = 0; k < r; k++) {
                  let c = a[k];
                  if (typeof c == "string") {
                    if (!z.test(c)) {
                      let P = { instancePath: t + "/tests/" + n + "/requirementIds/" + k, schemaPath: "#/properties/tests/items/properties/requirementIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [P] : e.push(P), s++;
                    }
                  } else {
                    let P = { instancePath: t + "/tests/" + n + "/requirementIds/" + k, schemaPath: "#/properties/tests/items/properties/requirementIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [P] : e.push(P), s++;
                  }
                }
                let i = a.length, p;
                if (i > 1) {
                  let k = {};
                  for (; i--; ) {
                    let c = a[i];
                    if (typeof c == "string") {
                      if (typeof k[c] == "number") {
                        p = k[c];
                        let P = { instancePath: t + "/tests/" + n + "/requirementIds", schemaPath: "#/properties/tests/items/properties/requirementIds/uniqueItems", keyword: "uniqueItems", params: { i, j: p }, message: "must NOT have duplicate items (items ## " + p + " and " + i + " are identical)" };
                        e === null ? e = [P] : e.push(P), s++;
                        break;
                      }
                      k[c] = i;
                    }
                  }
                }
              } else {
                let r = { instancePath: t + "/tests/" + n + "/requirementIds", schemaPath: "#/properties/tests/items/properties/requirementIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.capability !== void 0) {
              let a = m.capability;
              if (typeof a == "string") {
                if (!z.test(a)) {
                  let r = { instancePath: t + "/tests/" + n + "/capability", schemaPath: "#/properties/tests/items/properties/capability/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/tests/" + n + "/capability", schemaPath: "#/properties/tests/items/properties/capability/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.operations !== void 0) {
              let a = m.operations;
              if (Array.isArray(a)) {
                if (a.length < 1) {
                  let k = { instancePath: t + "/tests/" + n + "/operations", schemaPath: "#/properties/tests/items/properties/operations/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                  e === null ? e = [k] : e.push(k), s++;
                }
                let r = a.length;
                for (let k = 0; k < r; k++) {
                  let c = a[k];
                  if (typeof c == "string") {
                    if (!z.test(c)) {
                      let P = { instancePath: t + "/tests/" + n + "/operations/" + k, schemaPath: "#/properties/tests/items/properties/operations/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [P] : e.push(P), s++;
                    }
                  } else {
                    let P = { instancePath: t + "/tests/" + n + "/operations/" + k, schemaPath: "#/properties/tests/items/properties/operations/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [P] : e.push(P), s++;
                  }
                }
                let i = a.length, p;
                if (i > 1) {
                  let k = {};
                  for (; i--; ) {
                    let c = a[i];
                    if (typeof c == "string") {
                      if (typeof k[c] == "number") {
                        p = k[c];
                        let P = { instancePath: t + "/tests/" + n + "/operations", schemaPath: "#/properties/tests/items/properties/operations/uniqueItems", keyword: "uniqueItems", params: { i, j: p }, message: "must NOT have duplicate items (items ## " + p + " and " + i + " are identical)" };
                        e === null ? e = [P] : e.push(P), s++;
                        break;
                      }
                      k[c] = i;
                    }
                  }
                }
              } else {
                let r = { instancePath: t + "/tests/" + n + "/operations", schemaPath: "#/properties/tests/items/properties/operations/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.dependsOn !== void 0) {
              let a = m.dependsOn;
              if (Array.isArray(a)) {
                if (a.length < 0) {
                  let k = { instancePath: t + "/tests/" + n + "/dependsOn", schemaPath: "#/properties/tests/items/properties/dependsOn/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [k] : e.push(k), s++;
                }
                let r = a.length;
                for (let k = 0; k < r; k++) {
                  let c = a[k];
                  if (typeof c == "string") {
                    if (!M.test(c)) {
                      let P = { instancePath: t + "/tests/" + n + "/dependsOn/" + k, schemaPath: "#/properties/tests/items/properties/dependsOn/items/pattern", keyword: "pattern", params: { pattern: "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [P] : e.push(P), s++;
                    }
                  } else {
                    let P = { instancePath: t + "/tests/" + n + "/dependsOn/" + k, schemaPath: "#/properties/tests/items/properties/dependsOn/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [P] : e.push(P), s++;
                  }
                }
                let i = a.length, p;
                if (i > 1) {
                  let k = {};
                  for (; i--; ) {
                    let c = a[i];
                    if (typeof c == "string") {
                      if (typeof k[c] == "number") {
                        p = k[c];
                        let P = { instancePath: t + "/tests/" + n + "/dependsOn", schemaPath: "#/properties/tests/items/properties/dependsOn/uniqueItems", keyword: "uniqueItems", params: { i, j: p }, message: "must NOT have duplicate items (items ## " + p + " and " + i + " are identical)" };
                        e === null ? e = [P] : e.push(P), s++;
                        break;
                      }
                      k[c] = i;
                    }
                  }
                }
              } else {
                let r = { instancePath: t + "/tests/" + n + "/dependsOn", schemaPath: "#/properties/tests/items/properties/dependsOn/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.preconditions !== void 0) {
              let a = m.preconditions;
              if (Array.isArray(a)) {
                if (a.length < 0) {
                  let k = { instancePath: t + "/tests/" + n + "/preconditions", schemaPath: "#/properties/tests/items/properties/preconditions/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [k] : e.push(k), s++;
                }
                let r = a.length;
                for (let k = 0; k < r; k++) {
                  let c = a[k];
                  if (typeof c == "string") {
                    if (j(c) < 1) {
                      let P = { instancePath: t + "/tests/" + n + "/preconditions/" + k, schemaPath: "#/properties/tests/items/properties/preconditions/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                      e === null ? e = [P] : e.push(P), s++;
                    }
                  } else {
                    let P = { instancePath: t + "/tests/" + n + "/preconditions/" + k, schemaPath: "#/properties/tests/items/properties/preconditions/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [P] : e.push(P), s++;
                  }
                }
                let i = a.length, p;
                if (i > 1) {
                  let k = {};
                  for (; i--; ) {
                    let c = a[i];
                    if (typeof c == "string") {
                      if (typeof k[c] == "number") {
                        p = k[c];
                        let P = { instancePath: t + "/tests/" + n + "/preconditions", schemaPath: "#/properties/tests/items/properties/preconditions/uniqueItems", keyword: "uniqueItems", params: { i, j: p }, message: "must NOT have duplicate items (items ## " + p + " and " + i + " are identical)" };
                        e === null ? e = [P] : e.push(P), s++;
                        break;
                      }
                      k[c] = i;
                    }
                  }
                }
              } else {
                let r = { instancePath: t + "/tests/" + n + "/preconditions", schemaPath: "#/properties/tests/items/properties/preconditions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.action !== void 0) {
              let a = m.action;
              if (typeof a == "string") {
                if (j(a) < 1) {
                  let r = { instancePath: t + "/tests/" + n + "/action", schemaPath: "#/properties/tests/items/properties/action/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/tests/" + n + "/action", schemaPath: "#/properties/tests/items/properties/action/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.assertions !== void 0) {
              let a = m.assertions;
              if (Array.isArray(a)) {
                if (a.length < 0) {
                  let k = { instancePath: t + "/tests/" + n + "/assertions", schemaPath: "#/properties/tests/items/properties/assertions/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [k] : e.push(k), s++;
                }
                let r = a.length;
                for (let k = 0; k < r; k++) {
                  let c = a[k];
                  if (c && typeof c == "object" && !Array.isArray(c)) {
                    if (c.id === void 0) {
                      let P = { instancePath: t + "/tests/" + n + "/assertions/" + k, schemaPath: "plan.schema.json#/definitions/assertion/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                      e === null ? e = [P] : e.push(P), s++;
                    }
                    if (c.check === void 0) {
                      let P = { instancePath: t + "/tests/" + n + "/assertions/" + k, schemaPath: "plan.schema.json#/definitions/assertion/required", keyword: "required", params: { missingProperty: "check" }, message: "must have required property 'check'" };
                      e === null ? e = [P] : e.push(P), s++;
                    }
                    if (c.checkKind === void 0) {
                      let P = { instancePath: t + "/tests/" + n + "/assertions/" + k, schemaPath: "plan.schema.json#/definitions/assertion/required", keyword: "required", params: { missingProperty: "checkKind" }, message: "must have required property 'checkKind'" };
                      e === null ? e = [P] : e.push(P), s++;
                    }
                    for (let P in c) if (!(P === "id" || P === "check" || P === "checkKind")) {
                      let f = { instancePath: t + "/tests/" + n + "/assertions/" + k, schemaPath: "plan.schema.json#/definitions/assertion/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: P }, message: "must NOT have additional properties" };
                      e === null ? e = [f] : e.push(f), s++;
                    }
                    if (c.id !== void 0) {
                      let P = c.id;
                      if (typeof P == "string") {
                        if (!z.test(P)) {
                          let f = { instancePath: t + "/tests/" + n + "/assertions/" + k + "/id", schemaPath: "plan.schema.json#/definitions/assertion/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                          e === null ? e = [f] : e.push(f), s++;
                        }
                      } else {
                        let f = { instancePath: t + "/tests/" + n + "/assertions/" + k + "/id", schemaPath: "plan.schema.json#/definitions/assertion/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                        e === null ? e = [f] : e.push(f), s++;
                      }
                    }
                    if (c.check !== void 0) {
                      let P = c.check;
                      if (typeof P == "string") {
                        if (j(P) < 1) {
                          let f = { instancePath: t + "/tests/" + n + "/assertions/" + k + "/check", schemaPath: "plan.schema.json#/definitions/assertion/properties/check/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                          e === null ? e = [f] : e.push(f), s++;
                        }
                      } else {
                        let f = { instancePath: t + "/tests/" + n + "/assertions/" + k + "/check", schemaPath: "plan.schema.json#/definitions/assertion/properties/check/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                        e === null ? e = [f] : e.push(f), s++;
                      }
                    }
                    if (c.checkKind !== void 0) {
                      let P = c.checkKind;
                      if (!(P === "deterministic" || P === "agent_observation")) {
                        let f = { instancePath: t + "/tests/" + n + "/assertions/" + k + "/checkKind", schemaPath: "plan.schema.json#/definitions/assertion/properties/checkKind/enum", keyword: "enum", params: { allowedValues: je.properties.checkKind.enum }, message: "must be equal to one of the allowed values" };
                        e === null ? e = [f] : e.push(f), s++;
                      }
                    }
                  } else {
                    let P = { instancePath: t + "/tests/" + n + "/assertions/" + k, schemaPath: "plan.schema.json#/definitions/assertion/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                    e === null ? e = [P] : e.push(P), s++;
                  }
                }
                let i = a.length, p;
                if (i > 1) {
                  e: for (; i--; ) for (p = i; p--; ) if (L(a[i], a[p])) {
                    let k = { instancePath: t + "/tests/" + n + "/assertions", schemaPath: "#/properties/tests/items/properties/assertions/uniqueItems", keyword: "uniqueItems", params: { i, j: p }, message: "must NOT have duplicate items (items ## " + p + " and " + i + " are identical)" };
                    e === null ? e = [k] : e.push(k), s++;
                    break e;
                  }
                }
              } else {
                let r = { instancePath: t + "/tests/" + n + "/assertions", schemaPath: "#/properties/tests/items/properties/assertions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.metadata !== void 0) {
              let a = m.metadata;
              if (a && typeof a == "object" && !Array.isArray(a)) {
                if (Object.keys(a).length > 20) {
                  let r = { instancePath: t + "/tests/" + n + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/maxProperties", keyword: "maxProperties", params: { limit: 20 }, message: "must NOT have more than 20 properties" };
                  e === null ? e = [r] : e.push(r), s++;
                }
                for (let r in a) {
                  let i = s;
                  if (typeof r == "string" && !R.test(r)) {
                    let p = { instancePath: t + "/tests/" + n + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z][A-Za-z0-9_.-]{0,63}$" }, message: 'must match pattern "^[A-Za-z][A-Za-z0-9_.-]{0,63}$"', propertyName: r };
                    e === null ? e = [p] : e.push(p), s++;
                  }
                  var O = i === s;
                  if (!O) {
                    let p = { instancePath: t + "/tests/" + n + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/propertyNames", keyword: "propertyNames", params: { propertyName: r }, message: "property name must be valid" };
                    e === null ? e = [p] : e.push(p), s++;
                  }
                }
                for (let r in a) {
                  let i = a[r];
                  if (typeof i != "string" && !(typeof i == "number" && isFinite(i)) && typeof i != "boolean") {
                    let p = { instancePath: t + "/tests/" + n + "/metadata/" + r.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan.schema.json#/definitions/metadata/additionalProperties/type", keyword: "type", params: { type: F.additionalProperties.type }, message: "must be string,number,boolean" };
                    e === null ? e = [p] : e.push(p), s++;
                  }
                  if (typeof i == "string" && j(i) > 500) {
                    let p = { instancePath: t + "/tests/" + n + "/metadata/" + r.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan.schema.json#/definitions/metadata/additionalProperties/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
                    e === null ? e = [p] : e.push(p), s++;
                  }
                }
              } else {
                let r = { instancePath: t + "/tests/" + n + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
          } else {
            let a = { instancePath: t + "/tests/" + n, schemaPath: "#/properties/tests/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [a] : e.push(a), s++;
          }
        }
        let l = o.length, d;
        if (l > 1) {
          e: for (; l--; ) for (d = l; d--; ) if (L(o[l], o[d])) {
            let n = { instancePath: t + "/tests", schemaPath: "#/properties/tests/uniqueItems", keyword: "uniqueItems", params: { i: l, j: d }, message: "must NOT have duplicate items (items ## " + d + " and " + l + " are identical)" };
            e === null ? e = [n] : e.push(n), s++;
            break e;
          }
        }
      } else {
        let y = { instancePath: t + "/tests", schemaPath: "#/properties/tests/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
    if (u.gaps !== void 0) {
      let o = u.gaps;
      if (Array.isArray(o)) {
        if (o.length < 0) {
          let n = { instancePath: t + "/gaps", schemaPath: "#/properties/gaps/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [n] : e.push(n), s++;
        }
        let y = o.length;
        for (let n = 0; n < y; n++) {
          let m = o[n];
          if (m && typeof m == "object" && !Array.isArray(m)) {
            if (m.id === void 0) {
              let a = { instancePath: t + "/gaps/" + n, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.severity === void 0) {
              let a = { instancePath: t + "/gaps/" + n, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "severity" }, message: "must have required property 'severity'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.status === void 0) {
              let a = { instancePath: t + "/gaps/" + n, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "status" }, message: "must have required property 'status'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.requirementIds === void 0) {
              let a = { instancePath: t + "/gaps/" + n, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "requirementIds" }, message: "must have required property 'requirementIds'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.testIds === void 0) {
              let a = { instancePath: t + "/gaps/" + n, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "testIds" }, message: "must have required property 'testIds'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.question === void 0) {
              let a = { instancePath: t + "/gaps/" + n, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "question" }, message: "must have required property 'question'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.consequence === void 0) {
              let a = { instancePath: t + "/gaps/" + n, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "consequence" }, message: "must have required property 'consequence'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.decisionId === void 0) {
              let a = { instancePath: t + "/gaps/" + n, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "decisionId" }, message: "must have required property 'decisionId'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            for (let a in m) if (!(a === "id" || a === "severity" || a === "status" || a === "requirementIds" || a === "testIds" || a === "question" || a === "consequence" || a === "decisionId")) {
              let r = { instancePath: t + "/gaps/" + n, schemaPath: "gap.schema.json/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: a }, message: "must NOT have additional properties" };
              e === null ? e = [r] : e.push(r), s++;
            }
            if (m.id !== void 0) {
              let a = m.id;
              if (typeof a == "string") {
                if (!z.test(a)) {
                  let r = { instancePath: t + "/gaps/" + n + "/id", schemaPath: "gap.schema.json/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/gaps/" + n + "/id", schemaPath: "gap.schema.json/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.severity !== void 0) {
              let a = m.severity;
              if (!(a === "blocking" || a === "non_blocking")) {
                let r = { instancePath: t + "/gaps/" + n + "/severity", schemaPath: "gap.schema.json/properties/severity/enum", keyword: "enum", params: { allowedValues: B.properties.severity.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.status !== void 0) {
              let a = m.status;
              if (!(a === "open" || a === "resolved" || a === "deferred")) {
                let r = { instancePath: t + "/gaps/" + n + "/status", schemaPath: "gap.schema.json/properties/status/enum", keyword: "enum", params: { allowedValues: B.properties.status.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.requirementIds !== void 0) {
              let a = m.requirementIds;
              if (Array.isArray(a)) {
                if (a.length < 0) {
                  let k = { instancePath: t + "/gaps/" + n + "/requirementIds", schemaPath: "gap.schema.json/properties/requirementIds/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [k] : e.push(k), s++;
                }
                let r = a.length;
                for (let k = 0; k < r; k++) {
                  let c = a[k];
                  if (typeof c == "string") {
                    if (!z.test(c)) {
                      let P = { instancePath: t + "/gaps/" + n + "/requirementIds/" + k, schemaPath: "gap.schema.json/properties/requirementIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [P] : e.push(P), s++;
                    }
                  } else {
                    let P = { instancePath: t + "/gaps/" + n + "/requirementIds/" + k, schemaPath: "gap.schema.json/properties/requirementIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [P] : e.push(P), s++;
                  }
                }
                let i = a.length, p;
                if (i > 1) {
                  let k = {};
                  for (; i--; ) {
                    let c = a[i];
                    if (typeof c == "string") {
                      if (typeof k[c] == "number") {
                        p = k[c];
                        let P = { instancePath: t + "/gaps/" + n + "/requirementIds", schemaPath: "gap.schema.json/properties/requirementIds/uniqueItems", keyword: "uniqueItems", params: { i, j: p }, message: "must NOT have duplicate items (items ## " + p + " and " + i + " are identical)" };
                        e === null ? e = [P] : e.push(P), s++;
                        break;
                      }
                      k[c] = i;
                    }
                  }
                }
              } else {
                let r = { instancePath: t + "/gaps/" + n + "/requirementIds", schemaPath: "gap.schema.json/properties/requirementIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.testIds !== void 0) {
              let a = m.testIds;
              if (Array.isArray(a)) {
                if (a.length < 0) {
                  let k = { instancePath: t + "/gaps/" + n + "/testIds", schemaPath: "gap.schema.json/properties/testIds/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [k] : e.push(k), s++;
                }
                let r = a.length;
                for (let k = 0; k < r; k++) {
                  let c = a[k];
                  if (typeof c == "string") {
                    if (!M.test(c)) {
                      let P = { instancePath: t + "/gaps/" + n + "/testIds/" + k, schemaPath: "gap.schema.json/properties/testIds/items/pattern", keyword: "pattern", params: { pattern: "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [P] : e.push(P), s++;
                    }
                  } else {
                    let P = { instancePath: t + "/gaps/" + n + "/testIds/" + k, schemaPath: "gap.schema.json/properties/testIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [P] : e.push(P), s++;
                  }
                }
                let i = a.length, p;
                if (i > 1) {
                  let k = {};
                  for (; i--; ) {
                    let c = a[i];
                    if (typeof c == "string") {
                      if (typeof k[c] == "number") {
                        p = k[c];
                        let P = { instancePath: t + "/gaps/" + n + "/testIds", schemaPath: "gap.schema.json/properties/testIds/uniqueItems", keyword: "uniqueItems", params: { i, j: p }, message: "must NOT have duplicate items (items ## " + p + " and " + i + " are identical)" };
                        e === null ? e = [P] : e.push(P), s++;
                        break;
                      }
                      k[c] = i;
                    }
                  }
                }
              } else {
                let r = { instancePath: t + "/gaps/" + n + "/testIds", schemaPath: "gap.schema.json/properties/testIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.question !== void 0) {
              let a = m.question;
              if (typeof a == "string") {
                if (j(a) < 1) {
                  let r = { instancePath: t + "/gaps/" + n + "/question", schemaPath: "gap.schema.json/properties/question/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/gaps/" + n + "/question", schemaPath: "gap.schema.json/properties/question/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.consequence !== void 0) {
              let a = m.consequence;
              if (typeof a == "string") {
                if (j(a) < 1) {
                  let r = { instancePath: t + "/gaps/" + n + "/consequence", schemaPath: "gap.schema.json/properties/consequence/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/gaps/" + n + "/consequence", schemaPath: "gap.schema.json/properties/consequence/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.decisionId !== void 0) {
              let a = m.decisionId, r = s, i = false, p = s;
              if (typeof a == "string") {
                if (!z.test(a)) {
                  let k = { instancePath: t + "/gaps/" + n + "/decisionId", schemaPath: "gap.schema.json/properties/decisionId/anyOf/0/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [k] : e.push(k), s++;
                }
              } else {
                let k = { instancePath: t + "/gaps/" + n + "/decisionId", schemaPath: "gap.schema.json/properties/decisionId/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [k] : e.push(k), s++;
              }
              var g = p === s;
              if (i = i || g, !i) {
                let k = s;
                if (a !== null) {
                  let P = { instancePath: t + "/gaps/" + n + "/decisionId", schemaPath: "gap.schema.json/properties/decisionId/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                  e === null ? e = [P] : e.push(P), s++;
                }
                var g = k === s;
                i = i || g;
              }
              if (i) s = r, e !== null && (r ? e.length = r : e = null);
              else {
                let k = { instancePath: t + "/gaps/" + n + "/decisionId", schemaPath: "gap.schema.json/properties/decisionId/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                e === null ? e = [k] : e.push(k), s++;
              }
            }
          } else {
            let a = { instancePath: t + "/gaps/" + n, schemaPath: "gap.schema.json/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [a] : e.push(a), s++;
          }
        }
        let l = o.length, d;
        if (l > 1) {
          e: for (; l--; ) for (d = l; d--; ) if (L(o[l], o[d])) {
            let n = { instancePath: t + "/gaps", schemaPath: "#/properties/gaps/uniqueItems", keyword: "uniqueItems", params: { i: l, j: d }, message: "must NOT have duplicate items (items ## " + d + " and " + l + " are identical)" };
            e === null ? e = [n] : e.push(n), s++;
            break e;
          }
        }
      } else {
        let y = { instancePath: t + "/gaps", schemaPath: "#/properties/gaps/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
  } else {
    let o = { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [o] : e.push(o), s++;
  }
  return ze.errors = e, s === 0;
}
var ls = Oe;
var Ue = { $schema: "http://json-schema.org/draft-07/schema#", $id: "plan-delta.schema.json", type: "object", properties: { tests: { type: "object", propertyNames: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, additionalProperties: { type: "object", properties: { action: { type: "string", minLength: 1 }, preconditions: { type: "array", items: { type: "string", minLength: 1 }, minItems: 0, uniqueItems: true }, assertions: { type: "object", propertyNames: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, additionalProperties: { anyOf: [{ type: "object", properties: { check: { type: "string", minLength: 1 }, checkKind: { enum: ["deterministic", "agent_observation"] } }, additionalProperties: false, minProperties: 1 }, { type: "null" }] }, minProperties: 1 } }, additionalProperties: false, minProperties: 1 } } }, required: ["tests"], additionalProperties: false };
function Oe(u, { instancePath: t = "", parentData: _, parentDataProperty: Z, rootData: N = u } = {}) {
  let e = null, s = 0;
  if (u && typeof u == "object" && !Array.isArray(u)) {
    if (u.tests === void 0) {
      let y = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "tests" }, message: "must have required property 'tests'" };
      e === null ? e = [y] : e.push(y), s++;
    }
    for (let y in u) if (y !== "tests") {
      let l = { instancePath: t, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: y }, message: "must NOT have additional properties" };
      e === null ? e = [l] : e.push(l), s++;
    }
    if (u.tests !== void 0) {
      let y = u.tests;
      if (y && typeof y == "object" && !Array.isArray(y)) {
        for (let l in y) {
          let d = s;
          if (typeof l == "string" && !z.test(l)) {
            let n = { instancePath: t + "/tests", schemaPath: "#/properties/tests/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"', propertyName: l };
            e === null ? e = [n] : e.push(n), s++;
          }
          var O = d === s;
          if (!O) {
            let n = { instancePath: t + "/tests", schemaPath: "#/properties/tests/propertyNames", keyword: "propertyNames", params: { propertyName: l }, message: "property name must be valid" };
            e === null ? e = [n] : e.push(n), s++;
          }
        }
        for (let l in y) {
          let d = y[l];
          if (d && typeof d == "object" && !Array.isArray(d)) {
            if (Object.keys(d).length < 1) {
              let n = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/tests/additionalProperties/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
              e === null ? e = [n] : e.push(n), s++;
            }
            for (let n in d) if (!(n === "action" || n === "preconditions" || n === "assertions")) {
              let m = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/tests/additionalProperties/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: n }, message: "must NOT have additional properties" };
              e === null ? e = [m] : e.push(m), s++;
            }
            if (d.action !== void 0) {
              let n = d.action;
              if (typeof n == "string") {
                if (j(n) < 1) {
                  let m = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/action", schemaPath: "#/properties/tests/additionalProperties/properties/action/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [m] : e.push(m), s++;
                }
              } else {
                let m = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/action", schemaPath: "#/properties/tests/additionalProperties/properties/action/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [m] : e.push(m), s++;
              }
            }
            if (d.preconditions !== void 0) {
              let n = d.preconditions;
              if (Array.isArray(n)) {
                if (n.length < 0) {
                  let i = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/preconditions", schemaPath: "#/properties/tests/additionalProperties/properties/preconditions/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [i] : e.push(i), s++;
                }
                let m = n.length;
                for (let i = 0; i < m; i++) {
                  let p = n[i];
                  if (typeof p == "string") {
                    if (j(p) < 1) {
                      let k = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/preconditions/" + i, schemaPath: "#/properties/tests/additionalProperties/properties/preconditions/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                      e === null ? e = [k] : e.push(k), s++;
                    }
                  } else {
                    let k = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/preconditions/" + i, schemaPath: "#/properties/tests/additionalProperties/properties/preconditions/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [k] : e.push(k), s++;
                  }
                }
                let a = n.length, r;
                if (a > 1) {
                  let i = {};
                  for (; a--; ) {
                    let p = n[a];
                    if (typeof p == "string") {
                      if (typeof i[p] == "number") {
                        r = i[p];
                        let k = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/preconditions", schemaPath: "#/properties/tests/additionalProperties/properties/preconditions/uniqueItems", keyword: "uniqueItems", params: { i: a, j: r }, message: "must NOT have duplicate items (items ## " + r + " and " + a + " are identical)" };
                        e === null ? e = [k] : e.push(k), s++;
                        break;
                      }
                      i[p] = a;
                    }
                  }
                }
              } else {
                let m = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/preconditions", schemaPath: "#/properties/tests/additionalProperties/properties/preconditions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [m] : e.push(m), s++;
              }
            }
            if (d.assertions !== void 0) {
              let n = d.assertions;
              if (n && typeof n == "object" && !Array.isArray(n)) {
                if (Object.keys(n).length < 1) {
                  let m = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions", schemaPath: "#/properties/tests/additionalProperties/properties/assertions/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
                  e === null ? e = [m] : e.push(m), s++;
                }
                for (let m in n) {
                  let a = s;
                  if (typeof m == "string" && !z.test(m)) {
                    let r = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions", schemaPath: "#/properties/tests/additionalProperties/properties/assertions/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"', propertyName: m };
                    e === null ? e = [r] : e.push(r), s++;
                  }
                  var g = a === s;
                  if (!g) {
                    let r = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions", schemaPath: "#/properties/tests/additionalProperties/properties/assertions/propertyNames", keyword: "propertyNames", params: { propertyName: m }, message: "property name must be valid" };
                    e === null ? e = [r] : e.push(r), s++;
                  }
                }
                for (let m in n) {
                  let a = n[m], r = s, i = false, p = s;
                  if (a && typeof a == "object" && !Array.isArray(a)) {
                    if (Object.keys(a).length < 1) {
                      let k = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + m.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf/0/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
                      e === null ? e = [k] : e.push(k), s++;
                    }
                    for (let k in a) if (!(k === "check" || k === "checkKind")) {
                      let c = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + m.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf/0/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: k }, message: "must NOT have additional properties" };
                      e === null ? e = [c] : e.push(c), s++;
                    }
                    if (a.check !== void 0) {
                      let k = a.check;
                      if (typeof k == "string") {
                        if (j(k) < 1) {
                          let c = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + m.replace(/~/g, "~0").replace(/\//g, "~1") + "/check", schemaPath: "#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf/0/properties/check/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                          e === null ? e = [c] : e.push(c), s++;
                        }
                      } else {
                        let c = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + m.replace(/~/g, "~0").replace(/\//g, "~1") + "/check", schemaPath: "#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf/0/properties/check/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                        e === null ? e = [c] : e.push(c), s++;
                      }
                    }
                    if (a.checkKind !== void 0) {
                      let k = a.checkKind;
                      if (!(k === "deterministic" || k === "agent_observation")) {
                        let c = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + m.replace(/~/g, "~0").replace(/\//g, "~1") + "/checkKind", schemaPath: "#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf/0/properties/checkKind/enum", keyword: "enum", params: { allowedValues: Ue.properties.tests.additionalProperties.properties.assertions.additionalProperties.anyOf[0].properties.checkKind.enum }, message: "must be equal to one of the allowed values" };
                        e === null ? e = [c] : e.push(c), s++;
                      }
                    }
                  } else {
                    let k = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + m.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf/0/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                    e === null ? e = [k] : e.push(k), s++;
                  }
                  var o = p === s;
                  if (i = i || o, !i) {
                    let k = s;
                    if (a !== null) {
                      let P = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + m.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                      e === null ? e = [P] : e.push(P), s++;
                    }
                    var o = k === s;
                    i = i || o;
                  }
                  if (i) s = r, e !== null && (r ? e.length = r : e = null);
                  else {
                    let k = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + m.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                    e === null ? e = [k] : e.push(k), s++;
                  }
                }
              } else {
                let m = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions", schemaPath: "#/properties/tests/additionalProperties/properties/assertions/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                e === null ? e = [m] : e.push(m), s++;
              }
            }
          } else {
            let n = { instancePath: t + "/tests/" + l.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/tests/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [n] : e.push(n), s++;
          }
        }
      } else {
        let l = { instancePath: t + "/tests", schemaPath: "#/properties/tests/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [l] : e.push(l), s++;
      }
    }
  } else {
    let y = { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [y] : e.push(y), s++;
  }
  return Oe.errors = e, s === 0;
}
var us = Ze;
var We = { $schema: "http://json-schema.org/draft-07/schema#", $id: "plan-patch.schema.json", type: "object", properties: { requirements: { type: "object", propertyNames: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, additionalProperties: { anyOf: [{ type: "object", properties: { text: { type: "string", minLength: 1 }, source: { type: "string", minLength: 1 }, metadata: { $ref: "plan.schema.json#/definitions/metadata" } }, additionalProperties: false, minProperties: 1 }, { type: "null" }] } }, tests: { type: "object", propertyNames: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, additionalProperties: { anyOf: [{ type: "object", properties: { title: { $ref: "plan-candidate.schema.json#/properties/tests/items/properties/title" }, requirementIds: { $ref: "plan-candidate.schema.json#/properties/tests/items/properties/requirementIds" }, capability: { $ref: "plan-candidate.schema.json#/properties/tests/items/properties/capability" }, operations: { $ref: "plan-candidate.schema.json#/properties/tests/items/properties/operations" }, dependsOn: { $ref: "plan-candidate.schema.json#/properties/tests/items/properties/dependsOn" }, preconditions: { $ref: "plan-candidate.schema.json#/properties/tests/items/properties/preconditions" }, action: { $ref: "plan-candidate.schema.json#/properties/tests/items/properties/action" }, assertions: { $ref: "plan-delta.schema.json#/properties/tests/additionalProperties/properties/assertions" }, metadata: { $ref: "plan.schema.json#/definitions/metadata" } }, additionalProperties: false, minProperties: 1 }, { type: "null" }] } }, gaps: { type: "object", propertyNames: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, additionalProperties: { anyOf: [{ type: "object", properties: { severity: { $ref: "gap.schema.json#/properties/severity" }, requirementIds: { $ref: "gap.schema.json#/properties/requirementIds" }, testIds: { $ref: "gap.schema.json#/properties/testIds" }, question: { $ref: "gap.schema.json#/properties/question" }, consequence: { $ref: "gap.schema.json#/properties/consequence" } }, additionalProperties: false, minProperties: 1 }, { type: "null" }] } } }, additionalProperties: false, minProperties: 1 };
var Xe = { type: "object", propertyNames: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, additionalProperties: { anyOf: [{ type: "object", properties: { check: { type: "string", minLength: 1 }, checkKind: { enum: ["deterministic", "agent_observation"] } }, additionalProperties: false, minProperties: 1 }, { type: "null" }] }, minProperties: 1 };
var Je = { enum: ["blocking", "non_blocking"] };
function Ze(u, { instancePath: t = "", parentData: _, parentDataProperty: Z, rootData: N = u } = {}) {
  let e = null, s = 0;
  if (u && typeof u == "object" && !Array.isArray(u)) {
    if (Object.keys(u).length < 1) {
      let i = { instancePath: t, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
      e === null ? e = [i] : e.push(i), s++;
    }
    for (let i in u) if (!(i === "requirements" || i === "tests" || i === "gaps")) {
      let p = { instancePath: t, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: i }, message: "must NOT have additional properties" };
      e === null ? e = [p] : e.push(p), s++;
    }
    if (u.requirements !== void 0) {
      let i = u.requirements;
      if (i && typeof i == "object" && !Array.isArray(i)) {
        for (let p in i) {
          let k = s;
          if (typeof p == "string" && !z.test(p)) {
            let c = { instancePath: t + "/requirements", schemaPath: "#/properties/requirements/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"', propertyName: p };
            e === null ? e = [c] : e.push(c), s++;
          }
          var O = k === s;
          if (!O) {
            let c = { instancePath: t + "/requirements", schemaPath: "#/properties/requirements/propertyNames", keyword: "propertyNames", params: { propertyName: p }, message: "property name must be valid" };
            e === null ? e = [c] : e.push(c), s++;
          }
        }
        for (let p in i) {
          let k = i[p], c = s, P = false, f = s;
          if (k && typeof k == "object" && !Array.isArray(k)) {
            if (Object.keys(k).length < 1) {
              let h = { instancePath: t + "/requirements/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/requirements/additionalProperties/anyOf/0/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
              e === null ? e = [h] : e.push(h), s++;
            }
            for (let h in k) if (!(h === "text" || h === "source" || h === "metadata")) {
              let q = { instancePath: t + "/requirements/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/requirements/additionalProperties/anyOf/0/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: h }, message: "must NOT have additional properties" };
              e === null ? e = [q] : e.push(q), s++;
            }
            if (k.text !== void 0) {
              let h = k.text;
              if (typeof h == "string") {
                if (j(h) < 1) {
                  let q = { instancePath: t + "/requirements/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/text", schemaPath: "#/properties/requirements/additionalProperties/anyOf/0/properties/text/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [q] : e.push(q), s++;
                }
              } else {
                let q = { instancePath: t + "/requirements/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/text", schemaPath: "#/properties/requirements/additionalProperties/anyOf/0/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
            if (k.source !== void 0) {
              let h = k.source;
              if (typeof h == "string") {
                if (j(h) < 1) {
                  let q = { instancePath: t + "/requirements/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/source", schemaPath: "#/properties/requirements/additionalProperties/anyOf/0/properties/source/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [q] : e.push(q), s++;
                }
              } else {
                let q = { instancePath: t + "/requirements/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/source", schemaPath: "#/properties/requirements/additionalProperties/anyOf/0/properties/source/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
            if (k.metadata !== void 0) {
              let h = k.metadata;
              if (h && typeof h == "object" && !Array.isArray(h)) {
                if (Object.keys(h).length > 20) {
                  let q = { instancePath: t + "/requirements/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/maxProperties", keyword: "maxProperties", params: { limit: 20 }, message: "must NOT have more than 20 properties" };
                  e === null ? e = [q] : e.push(q), s++;
                }
                for (let q in h) {
                  let b = s;
                  if (typeof q == "string" && !R.test(q)) {
                    let w = { instancePath: t + "/requirements/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z][A-Za-z0-9_.-]{0,63}$" }, message: 'must match pattern "^[A-Za-z][A-Za-z0-9_.-]{0,63}$"', propertyName: q };
                    e === null ? e = [w] : e.push(w), s++;
                  }
                  var g = b === s;
                  if (!g) {
                    let w = { instancePath: t + "/requirements/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/propertyNames", keyword: "propertyNames", params: { propertyName: q }, message: "property name must be valid" };
                    e === null ? e = [w] : e.push(w), s++;
                  }
                }
                for (let q in h) {
                  let b = h[q];
                  if (typeof b != "string" && !(typeof b == "number" && isFinite(b)) && typeof b != "boolean") {
                    let w = { instancePath: t + "/requirements/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/metadata/" + q.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan.schema.json#/definitions/metadata/additionalProperties/type", keyword: "type", params: { type: F.additionalProperties.type }, message: "must be string,number,boolean" };
                    e === null ? e = [w] : e.push(w), s++;
                  }
                  if (typeof b == "string" && j(b) > 500) {
                    let w = { instancePath: t + "/requirements/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/metadata/" + q.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan.schema.json#/definitions/metadata/additionalProperties/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
                    e === null ? e = [w] : e.push(w), s++;
                  }
                }
              } else {
                let q = { instancePath: t + "/requirements/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
          } else {
            let h = { instancePath: t + "/requirements/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/requirements/additionalProperties/anyOf/0/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [h] : e.push(h), s++;
          }
          var o = f === s;
          if (P = P || o, !P) {
            let h = s;
            if (k !== null) {
              let b = { instancePath: t + "/requirements/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/requirements/additionalProperties/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
              e === null ? e = [b] : e.push(b), s++;
            }
            var o = h === s;
            P = P || o;
          }
          if (P) s = c, e !== null && (c ? e.length = c : e = null);
          else {
            let h = { instancePath: t + "/requirements/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/requirements/additionalProperties/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
            e === null ? e = [h] : e.push(h), s++;
          }
        }
      } else {
        let p = { instancePath: t + "/requirements", schemaPath: "#/properties/requirements/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [p] : e.push(p), s++;
      }
    }
    if (u.tests !== void 0) {
      let i = u.tests;
      if (i && typeof i == "object" && !Array.isArray(i)) {
        for (let p in i) {
          let k = s;
          if (typeof p == "string" && !z.test(p)) {
            let c = { instancePath: t + "/tests", schemaPath: "#/properties/tests/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"', propertyName: p };
            e === null ? e = [c] : e.push(c), s++;
          }
          var y = k === s;
          if (!y) {
            let c = { instancePath: t + "/tests", schemaPath: "#/properties/tests/propertyNames", keyword: "propertyNames", params: { propertyName: p }, message: "property name must be valid" };
            e === null ? e = [c] : e.push(c), s++;
          }
        }
        for (let p in i) {
          let k = i[p], c = s, P = false, f = s;
          if (k && typeof k == "object" && !Array.isArray(k)) {
            if (Object.keys(k).length < 1) {
              let h = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/tests/additionalProperties/anyOf/0/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
              e === null ? e = [h] : e.push(h), s++;
            }
            for (let h in k) if (!C.call(We.properties.tests.additionalProperties.anyOf[0].properties, h)) {
              let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/tests/additionalProperties/anyOf/0/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: h }, message: "must NOT have additional properties" };
              e === null ? e = [q] : e.push(q), s++;
            }
            if (k.title !== void 0) {
              let h = k.title;
              if (typeof h == "string") {
                if (j(h) > 200) {
                  let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/title", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/title/maxLength", keyword: "maxLength", params: { limit: 200 }, message: "must NOT have more than 200 characters" };
                  e === null ? e = [q] : e.push(q), s++;
                }
                if (j(h) < 1) {
                  let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/title", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/title/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [q] : e.push(q), s++;
                }
              } else {
                let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/title", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/title/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
            if (k.requirementIds !== void 0) {
              let h = k.requirementIds;
              if (Array.isArray(h)) {
                if (h.length < 1) {
                  let I = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/requirementIds", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/requirementIds/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                  e === null ? e = [I] : e.push(I), s++;
                }
                let q = h.length;
                for (let I = 0; I < q; I++) {
                  let v = h[I];
                  if (typeof v == "string") {
                    if (!z.test(v)) {
                      let A = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/requirementIds/" + I, schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/requirementIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [A] : e.push(A), s++;
                    }
                  } else {
                    let A = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/requirementIds/" + I, schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/requirementIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [A] : e.push(A), s++;
                  }
                }
                let b = h.length, w;
                if (b > 1) {
                  let I = {};
                  for (; b--; ) {
                    let v = h[b];
                    if (typeof v == "string") {
                      if (typeof I[v] == "number") {
                        w = I[v];
                        let A = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/requirementIds", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/requirementIds/uniqueItems", keyword: "uniqueItems", params: { i: b, j: w }, message: "must NOT have duplicate items (items ## " + w + " and " + b + " are identical)" };
                        e === null ? e = [A] : e.push(A), s++;
                        break;
                      }
                      I[v] = b;
                    }
                  }
                }
              } else {
                let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/requirementIds", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/requirementIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
            if (k.capability !== void 0) {
              let h = k.capability;
              if (typeof h == "string") {
                if (!z.test(h)) {
                  let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/capability", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/capability/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [q] : e.push(q), s++;
                }
              } else {
                let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/capability", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/capability/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
            if (k.operations !== void 0) {
              let h = k.operations;
              if (Array.isArray(h)) {
                if (h.length < 1) {
                  let I = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/operations", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/operations/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                  e === null ? e = [I] : e.push(I), s++;
                }
                let q = h.length;
                for (let I = 0; I < q; I++) {
                  let v = h[I];
                  if (typeof v == "string") {
                    if (!z.test(v)) {
                      let A = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/operations/" + I, schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/operations/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [A] : e.push(A), s++;
                    }
                  } else {
                    let A = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/operations/" + I, schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/operations/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [A] : e.push(A), s++;
                  }
                }
                let b = h.length, w;
                if (b > 1) {
                  let I = {};
                  for (; b--; ) {
                    let v = h[b];
                    if (typeof v == "string") {
                      if (typeof I[v] == "number") {
                        w = I[v];
                        let A = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/operations", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/operations/uniqueItems", keyword: "uniqueItems", params: { i: b, j: w }, message: "must NOT have duplicate items (items ## " + w + " and " + b + " are identical)" };
                        e === null ? e = [A] : e.push(A), s++;
                        break;
                      }
                      I[v] = b;
                    }
                  }
                }
              } else {
                let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/operations", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/operations/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
            if (k.dependsOn !== void 0) {
              let h = k.dependsOn;
              if (Array.isArray(h)) {
                if (h.length < 0) {
                  let I = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/dependsOn", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/dependsOn/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [I] : e.push(I), s++;
                }
                let q = h.length;
                for (let I = 0; I < q; I++) {
                  let v = h[I];
                  if (typeof v == "string") {
                    if (!M.test(v)) {
                      let A = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/dependsOn/" + I, schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/dependsOn/items/pattern", keyword: "pattern", params: { pattern: "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [A] : e.push(A), s++;
                    }
                  } else {
                    let A = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/dependsOn/" + I, schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/dependsOn/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [A] : e.push(A), s++;
                  }
                }
                let b = h.length, w;
                if (b > 1) {
                  let I = {};
                  for (; b--; ) {
                    let v = h[b];
                    if (typeof v == "string") {
                      if (typeof I[v] == "number") {
                        w = I[v];
                        let A = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/dependsOn", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/dependsOn/uniqueItems", keyword: "uniqueItems", params: { i: b, j: w }, message: "must NOT have duplicate items (items ## " + w + " and " + b + " are identical)" };
                        e === null ? e = [A] : e.push(A), s++;
                        break;
                      }
                      I[v] = b;
                    }
                  }
                }
              } else {
                let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/dependsOn", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/dependsOn/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
            if (k.preconditions !== void 0) {
              let h = k.preconditions;
              if (Array.isArray(h)) {
                if (h.length < 0) {
                  let I = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/preconditions", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/preconditions/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [I] : e.push(I), s++;
                }
                let q = h.length;
                for (let I = 0; I < q; I++) {
                  let v = h[I];
                  if (typeof v == "string") {
                    if (j(v) < 1) {
                      let A = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/preconditions/" + I, schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/preconditions/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                      e === null ? e = [A] : e.push(A), s++;
                    }
                  } else {
                    let A = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/preconditions/" + I, schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/preconditions/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [A] : e.push(A), s++;
                  }
                }
                let b = h.length, w;
                if (b > 1) {
                  let I = {};
                  for (; b--; ) {
                    let v = h[b];
                    if (typeof v == "string") {
                      if (typeof I[v] == "number") {
                        w = I[v];
                        let A = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/preconditions", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/preconditions/uniqueItems", keyword: "uniqueItems", params: { i: b, j: w }, message: "must NOT have duplicate items (items ## " + w + " and " + b + " are identical)" };
                        e === null ? e = [A] : e.push(A), s++;
                        break;
                      }
                      I[v] = b;
                    }
                  }
                }
              } else {
                let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/preconditions", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/preconditions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
            if (k.action !== void 0) {
              let h = k.action;
              if (typeof h == "string") {
                if (j(h) < 1) {
                  let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/action", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/action/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [q] : e.push(q), s++;
                }
              } else {
                let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/action", schemaPath: "plan-candidate.schema.json#/properties/tests/items/properties/action/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
            if (k.assertions !== void 0) {
              let h = k.assertions;
              if (h && typeof h == "object" && !Array.isArray(h)) {
                if (Object.keys(h).length < 1) {
                  let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions", schemaPath: "plan-delta.schema.json#/properties/tests/additionalProperties/properties/assertions/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
                  e === null ? e = [q] : e.push(q), s++;
                }
                for (let q in h) {
                  let b = s;
                  if (typeof q == "string" && !z.test(q)) {
                    let w = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions", schemaPath: "plan-delta.schema.json#/properties/tests/additionalProperties/properties/assertions/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"', propertyName: q };
                    e === null ? e = [w] : e.push(w), s++;
                  }
                  var l = b === s;
                  if (!l) {
                    let w = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions", schemaPath: "plan-delta.schema.json#/properties/tests/additionalProperties/properties/assertions/propertyNames", keyword: "propertyNames", params: { propertyName: q }, message: "property name must be valid" };
                    e === null ? e = [w] : e.push(w), s++;
                  }
                }
                for (let q in h) {
                  let b = h[q], w = s, I = false, v = s;
                  if (b && typeof b == "object" && !Array.isArray(b)) {
                    if (Object.keys(b).length < 1) {
                      let A = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + q.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan-delta.schema.json#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf/0/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
                      e === null ? e = [A] : e.push(A), s++;
                    }
                    for (let A in b) if (!(A === "check" || A === "checkKind")) {
                      let T = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + q.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan-delta.schema.json#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf/0/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: A }, message: "must NOT have additional properties" };
                      e === null ? e = [T] : e.push(T), s++;
                    }
                    if (b.check !== void 0) {
                      let A = b.check;
                      if (typeof A == "string") {
                        if (j(A) < 1) {
                          let T = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + q.replace(/~/g, "~0").replace(/\//g, "~1") + "/check", schemaPath: "plan-delta.schema.json#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf/0/properties/check/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                          e === null ? e = [T] : e.push(T), s++;
                        }
                      } else {
                        let T = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + q.replace(/~/g, "~0").replace(/\//g, "~1") + "/check", schemaPath: "plan-delta.schema.json#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf/0/properties/check/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                        e === null ? e = [T] : e.push(T), s++;
                      }
                    }
                    if (b.checkKind !== void 0) {
                      let A = b.checkKind;
                      if (!(A === "deterministic" || A === "agent_observation")) {
                        let T = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + q.replace(/~/g, "~0").replace(/\//g, "~1") + "/checkKind", schemaPath: "plan-delta.schema.json#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf/0/properties/checkKind/enum", keyword: "enum", params: { allowedValues: Xe.additionalProperties.anyOf[0].properties.checkKind.enum }, message: "must be equal to one of the allowed values" };
                        e === null ? e = [T] : e.push(T), s++;
                      }
                    }
                  } else {
                    let A = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + q.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan-delta.schema.json#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf/0/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                    e === null ? e = [A] : e.push(A), s++;
                  }
                  var d = v === s;
                  if (I = I || d, !I) {
                    let A = s;
                    if (b !== null) {
                      let D = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + q.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan-delta.schema.json#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                      e === null ? e = [D] : e.push(D), s++;
                    }
                    var d = A === s;
                    I = I || d;
                  }
                  if (I) s = w, e !== null && (w ? e.length = w : e = null);
                  else {
                    let A = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions/" + q.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan-delta.schema.json#/properties/tests/additionalProperties/properties/assertions/additionalProperties/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                    e === null ? e = [A] : e.push(A), s++;
                  }
                }
              } else {
                let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/assertions", schemaPath: "plan-delta.schema.json#/properties/tests/additionalProperties/properties/assertions/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
            if (k.metadata !== void 0) {
              let h = k.metadata;
              if (h && typeof h == "object" && !Array.isArray(h)) {
                if (Object.keys(h).length > 20) {
                  let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/maxProperties", keyword: "maxProperties", params: { limit: 20 }, message: "must NOT have more than 20 properties" };
                  e === null ? e = [q] : e.push(q), s++;
                }
                for (let q in h) {
                  let b = s;
                  if (typeof q == "string" && !R.test(q)) {
                    let w = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z][A-Za-z0-9_.-]{0,63}$" }, message: 'must match pattern "^[A-Za-z][A-Za-z0-9_.-]{0,63}$"', propertyName: q };
                    e === null ? e = [w] : e.push(w), s++;
                  }
                  var n = b === s;
                  if (!n) {
                    let w = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/propertyNames", keyword: "propertyNames", params: { propertyName: q }, message: "property name must be valid" };
                    e === null ? e = [w] : e.push(w), s++;
                  }
                }
                for (let q in h) {
                  let b = h[q];
                  if (typeof b != "string" && !(typeof b == "number" && isFinite(b)) && typeof b != "boolean") {
                    let w = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/metadata/" + q.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan.schema.json#/definitions/metadata/additionalProperties/type", keyword: "type", params: { type: F.additionalProperties.type }, message: "must be string,number,boolean" };
                    e === null ? e = [w] : e.push(w), s++;
                  }
                  if (typeof b == "string" && j(b) > 500) {
                    let w = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/metadata/" + q.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan.schema.json#/definitions/metadata/additionalProperties/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
                    e === null ? e = [w] : e.push(w), s++;
                  }
                }
              } else {
                let q = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
          } else {
            let h = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/tests/additionalProperties/anyOf/0/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [h] : e.push(h), s++;
          }
          var m = f === s;
          if (P = P || m, !P) {
            let h = s;
            if (k !== null) {
              let b = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/tests/additionalProperties/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
              e === null ? e = [b] : e.push(b), s++;
            }
            var m = h === s;
            P = P || m;
          }
          if (P) s = c, e !== null && (c ? e.length = c : e = null);
          else {
            let h = { instancePath: t + "/tests/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/tests/additionalProperties/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
            e === null ? e = [h] : e.push(h), s++;
          }
        }
      } else {
        let p = { instancePath: t + "/tests", schemaPath: "#/properties/tests/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [p] : e.push(p), s++;
      }
    }
    if (u.gaps !== void 0) {
      let i = u.gaps;
      if (i && typeof i == "object" && !Array.isArray(i)) {
        for (let p in i) {
          let k = s;
          if (typeof p == "string" && !z.test(p)) {
            let c = { instancePath: t + "/gaps", schemaPath: "#/properties/gaps/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"', propertyName: p };
            e === null ? e = [c] : e.push(c), s++;
          }
          var a = k === s;
          if (!a) {
            let c = { instancePath: t + "/gaps", schemaPath: "#/properties/gaps/propertyNames", keyword: "propertyNames", params: { propertyName: p }, message: "property name must be valid" };
            e === null ? e = [c] : e.push(c), s++;
          }
        }
        for (let p in i) {
          let k = i[p], c = s, P = false, f = s;
          if (k && typeof k == "object" && !Array.isArray(k)) {
            if (Object.keys(k).length < 1) {
              let h = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/gaps/additionalProperties/anyOf/0/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
              e === null ? e = [h] : e.push(h), s++;
            }
            for (let h in k) if (!(h === "severity" || h === "requirementIds" || h === "testIds" || h === "question" || h === "consequence")) {
              let q = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/gaps/additionalProperties/anyOf/0/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: h }, message: "must NOT have additional properties" };
              e === null ? e = [q] : e.push(q), s++;
            }
            if (k.severity !== void 0) {
              let h = k.severity;
              if (!(h === "blocking" || h === "non_blocking")) {
                let q = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/severity", schemaPath: "gap.schema.json#/properties/severity/enum", keyword: "enum", params: { allowedValues: Je.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
            if (k.requirementIds !== void 0) {
              let h = k.requirementIds;
              if (Array.isArray(h)) {
                if (h.length < 0) {
                  let I = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/requirementIds", schemaPath: "gap.schema.json#/properties/requirementIds/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [I] : e.push(I), s++;
                }
                let q = h.length;
                for (let I = 0; I < q; I++) {
                  let v = h[I];
                  if (typeof v == "string") {
                    if (!z.test(v)) {
                      let A = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/requirementIds/" + I, schemaPath: "gap.schema.json#/properties/requirementIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [A] : e.push(A), s++;
                    }
                  } else {
                    let A = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/requirementIds/" + I, schemaPath: "gap.schema.json#/properties/requirementIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [A] : e.push(A), s++;
                  }
                }
                let b = h.length, w;
                if (b > 1) {
                  let I = {};
                  for (; b--; ) {
                    let v = h[b];
                    if (typeof v == "string") {
                      if (typeof I[v] == "number") {
                        w = I[v];
                        let A = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/requirementIds", schemaPath: "gap.schema.json#/properties/requirementIds/uniqueItems", keyword: "uniqueItems", params: { i: b, j: w }, message: "must NOT have duplicate items (items ## " + w + " and " + b + " are identical)" };
                        e === null ? e = [A] : e.push(A), s++;
                        break;
                      }
                      I[v] = b;
                    }
                  }
                }
              } else {
                let q = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/requirementIds", schemaPath: "gap.schema.json#/properties/requirementIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
            if (k.testIds !== void 0) {
              let h = k.testIds;
              if (Array.isArray(h)) {
                if (h.length < 0) {
                  let I = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/testIds", schemaPath: "gap.schema.json#/properties/testIds/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [I] : e.push(I), s++;
                }
                let q = h.length;
                for (let I = 0; I < q; I++) {
                  let v = h[I];
                  if (typeof v == "string") {
                    if (!M.test(v)) {
                      let A = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/testIds/" + I, schemaPath: "gap.schema.json#/properties/testIds/items/pattern", keyword: "pattern", params: { pattern: "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [A] : e.push(A), s++;
                    }
                  } else {
                    let A = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/testIds/" + I, schemaPath: "gap.schema.json#/properties/testIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [A] : e.push(A), s++;
                  }
                }
                let b = h.length, w;
                if (b > 1) {
                  let I = {};
                  for (; b--; ) {
                    let v = h[b];
                    if (typeof v == "string") {
                      if (typeof I[v] == "number") {
                        w = I[v];
                        let A = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/testIds", schemaPath: "gap.schema.json#/properties/testIds/uniqueItems", keyword: "uniqueItems", params: { i: b, j: w }, message: "must NOT have duplicate items (items ## " + w + " and " + b + " are identical)" };
                        e === null ? e = [A] : e.push(A), s++;
                        break;
                      }
                      I[v] = b;
                    }
                  }
                }
              } else {
                let q = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/testIds", schemaPath: "gap.schema.json#/properties/testIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
            if (k.question !== void 0) {
              let h = k.question;
              if (typeof h == "string") {
                if (j(h) < 1) {
                  let q = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/question", schemaPath: "gap.schema.json#/properties/question/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [q] : e.push(q), s++;
                }
              } else {
                let q = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/question", schemaPath: "gap.schema.json#/properties/question/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
            if (k.consequence !== void 0) {
              let h = k.consequence;
              if (typeof h == "string") {
                if (j(h) < 1) {
                  let q = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/consequence", schemaPath: "gap.schema.json#/properties/consequence/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [q] : e.push(q), s++;
                }
              } else {
                let q = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1") + "/consequence", schemaPath: "gap.schema.json#/properties/consequence/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [q] : e.push(q), s++;
              }
            }
          } else {
            let h = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/gaps/additionalProperties/anyOf/0/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [h] : e.push(h), s++;
          }
          var r = f === s;
          if (P = P || r, !P) {
            let h = s;
            if (k !== null) {
              let b = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/gaps/additionalProperties/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
              e === null ? e = [b] : e.push(b), s++;
            }
            var r = h === s;
            P = P || r;
          }
          if (P) s = c, e !== null && (c ? e.length = c : e = null);
          else {
            let h = { instancePath: t + "/gaps/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/gaps/additionalProperties/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
            e === null ? e = [h] : e.push(h), s++;
          }
        }
      } else {
        let p = { instancePath: t + "/gaps", schemaPath: "#/properties/gaps/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [p] : e.push(p), s++;
      }
    }
  } else {
    let i = { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [i] : e.push(i), s++;
  }
  return Ze.errors = e, s === 0;
}
var ds = _e;
var Qe = { $schema: "http://json-schema.org/draft-07/schema#", $id: "plan-request.schema.json", type: "object", properties: { objective: { type: "string", minLength: 1 }, requirements: { type: "array", items: { type: "object", properties: { id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, text: { type: "string", minLength: 1 }, source: { type: "string", minLength: 1 }, metadata: { $ref: "plan.schema.json#/definitions/metadata" } }, required: ["id", "text", "source"], additionalProperties: false }, minItems: 1, uniqueItems: true }, sourceContext: { type: "array", items: { type: "object", properties: { uri: { type: "string", minLength: 1 }, content: { type: "string", minLength: 1 } }, required: ["uri", "content"], additionalProperties: false }, minItems: 0, uniqueItems: true }, context: { type: "object", properties: { sources: { type: "array", items: { type: "string", minLength: 1 }, minItems: 0, uniqueItems: true }, instructions: { type: "string", minLength: 1 } }, required: ["sources"], additionalProperties: false }, tools: { type: "array", items: { anyOf: [{ type: "string", minLength: 1 }, { type: "object", properties: { name: { type: "string", minLength: 1 }, kind: { enum: ["cli", "mcp", "skill"] }, purpose: { type: "string", minLength: 1 } }, required: ["name", "kind", "purpose"], additionalProperties: false }] }, minItems: 0, uniqueItems: true } }, required: ["objective"], additionalProperties: false };
function _e(u, { instancePath: t = "", parentData: _, parentDataProperty: Z, rootData: N = u } = {}) {
  let e = null, s = 0;
  if (u && typeof u == "object" && !Array.isArray(u)) {
    if (u.objective === void 0) {
      let o = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "objective" }, message: "must have required property 'objective'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    for (let o in u) if (!(o === "objective" || o === "requirements" || o === "sourceContext" || o === "context" || o === "tools")) {
      let y = { instancePath: t, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: o }, message: "must NOT have additional properties" };
      e === null ? e = [y] : e.push(y), s++;
    }
    if (u.objective !== void 0) {
      let o = u.objective;
      if (typeof o == "string") {
        if (j(o) < 1) {
          let y = { instancePath: t + "/objective", schemaPath: "#/properties/objective/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [y] : e.push(y), s++;
        }
      } else {
        let y = { instancePath: t + "/objective", schemaPath: "#/properties/objective/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
    if (u.requirements !== void 0) {
      let o = u.requirements;
      if (Array.isArray(o)) {
        if (o.length < 1) {
          let n = { instancePath: t + "/requirements", schemaPath: "#/properties/requirements/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [n] : e.push(n), s++;
        }
        let y = o.length;
        for (let n = 0; n < y; n++) {
          let m = o[n];
          if (m && typeof m == "object" && !Array.isArray(m)) {
            if (m.id === void 0) {
              let a = { instancePath: t + "/requirements/" + n, schemaPath: "#/properties/requirements/items/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.text === void 0) {
              let a = { instancePath: t + "/requirements/" + n, schemaPath: "#/properties/requirements/items/required", keyword: "required", params: { missingProperty: "text" }, message: "must have required property 'text'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.source === void 0) {
              let a = { instancePath: t + "/requirements/" + n, schemaPath: "#/properties/requirements/items/required", keyword: "required", params: { missingProperty: "source" }, message: "must have required property 'source'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            for (let a in m) if (!(a === "id" || a === "text" || a === "source" || a === "metadata")) {
              let r = { instancePath: t + "/requirements/" + n, schemaPath: "#/properties/requirements/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: a }, message: "must NOT have additional properties" };
              e === null ? e = [r] : e.push(r), s++;
            }
            if (m.id !== void 0) {
              let a = m.id;
              if (typeof a == "string") {
                if (!z.test(a)) {
                  let r = { instancePath: t + "/requirements/" + n + "/id", schemaPath: "#/properties/requirements/items/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/requirements/" + n + "/id", schemaPath: "#/properties/requirements/items/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.text !== void 0) {
              let a = m.text;
              if (typeof a == "string") {
                if (j(a) < 1) {
                  let r = { instancePath: t + "/requirements/" + n + "/text", schemaPath: "#/properties/requirements/items/properties/text/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/requirements/" + n + "/text", schemaPath: "#/properties/requirements/items/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.source !== void 0) {
              let a = m.source;
              if (typeof a == "string") {
                if (j(a) < 1) {
                  let r = { instancePath: t + "/requirements/" + n + "/source", schemaPath: "#/properties/requirements/items/properties/source/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/requirements/" + n + "/source", schemaPath: "#/properties/requirements/items/properties/source/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.metadata !== void 0) {
              let a = m.metadata;
              if (a && typeof a == "object" && !Array.isArray(a)) {
                if (Object.keys(a).length > 20) {
                  let r = { instancePath: t + "/requirements/" + n + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/maxProperties", keyword: "maxProperties", params: { limit: 20 }, message: "must NOT have more than 20 properties" };
                  e === null ? e = [r] : e.push(r), s++;
                }
                for (let r in a) {
                  let i = s;
                  if (typeof r == "string" && !R.test(r)) {
                    let p = { instancePath: t + "/requirements/" + n + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z][A-Za-z0-9_.-]{0,63}$" }, message: 'must match pattern "^[A-Za-z][A-Za-z0-9_.-]{0,63}$"', propertyName: r };
                    e === null ? e = [p] : e.push(p), s++;
                  }
                  var O = i === s;
                  if (!O) {
                    let p = { instancePath: t + "/requirements/" + n + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/propertyNames", keyword: "propertyNames", params: { propertyName: r }, message: "property name must be valid" };
                    e === null ? e = [p] : e.push(p), s++;
                  }
                }
                for (let r in a) {
                  let i = a[r];
                  if (typeof i != "string" && !(typeof i == "number" && isFinite(i)) && typeof i != "boolean") {
                    let p = { instancePath: t + "/requirements/" + n + "/metadata/" + r.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan.schema.json#/definitions/metadata/additionalProperties/type", keyword: "type", params: { type: F.additionalProperties.type }, message: "must be string,number,boolean" };
                    e === null ? e = [p] : e.push(p), s++;
                  }
                  if (typeof i == "string" && j(i) > 500) {
                    let p = { instancePath: t + "/requirements/" + n + "/metadata/" + r.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan.schema.json#/definitions/metadata/additionalProperties/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
                    e === null ? e = [p] : e.push(p), s++;
                  }
                }
              } else {
                let r = { instancePath: t + "/requirements/" + n + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
          } else {
            let a = { instancePath: t + "/requirements/" + n, schemaPath: "#/properties/requirements/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [a] : e.push(a), s++;
          }
        }
        let l = o.length, d;
        if (l > 1) {
          e: for (; l--; ) for (d = l; d--; ) if (L(o[l], o[d])) {
            let n = { instancePath: t + "/requirements", schemaPath: "#/properties/requirements/uniqueItems", keyword: "uniqueItems", params: { i: l, j: d }, message: "must NOT have duplicate items (items ## " + d + " and " + l + " are identical)" };
            e === null ? e = [n] : e.push(n), s++;
            break e;
          }
        }
      } else {
        let y = { instancePath: t + "/requirements", schemaPath: "#/properties/requirements/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
    if (u.sourceContext !== void 0) {
      let o = u.sourceContext;
      if (Array.isArray(o)) {
        if (o.length < 0) {
          let n = { instancePath: t + "/sourceContext", schemaPath: "#/properties/sourceContext/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [n] : e.push(n), s++;
        }
        let y = o.length;
        for (let n = 0; n < y; n++) {
          let m = o[n];
          if (m && typeof m == "object" && !Array.isArray(m)) {
            if (m.uri === void 0) {
              let a = { instancePath: t + "/sourceContext/" + n, schemaPath: "#/properties/sourceContext/items/required", keyword: "required", params: { missingProperty: "uri" }, message: "must have required property 'uri'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.content === void 0) {
              let a = { instancePath: t + "/sourceContext/" + n, schemaPath: "#/properties/sourceContext/items/required", keyword: "required", params: { missingProperty: "content" }, message: "must have required property 'content'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            for (let a in m) if (!(a === "uri" || a === "content")) {
              let r = { instancePath: t + "/sourceContext/" + n, schemaPath: "#/properties/sourceContext/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: a }, message: "must NOT have additional properties" };
              e === null ? e = [r] : e.push(r), s++;
            }
            if (m.uri !== void 0) {
              let a = m.uri;
              if (typeof a == "string") {
                if (j(a) < 1) {
                  let r = { instancePath: t + "/sourceContext/" + n + "/uri", schemaPath: "#/properties/sourceContext/items/properties/uri/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/sourceContext/" + n + "/uri", schemaPath: "#/properties/sourceContext/items/properties/uri/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.content !== void 0) {
              let a = m.content;
              if (typeof a == "string") {
                if (j(a) < 1) {
                  let r = { instancePath: t + "/sourceContext/" + n + "/content", schemaPath: "#/properties/sourceContext/items/properties/content/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/sourceContext/" + n + "/content", schemaPath: "#/properties/sourceContext/items/properties/content/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
          } else {
            let a = { instancePath: t + "/sourceContext/" + n, schemaPath: "#/properties/sourceContext/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [a] : e.push(a), s++;
          }
        }
        let l = o.length, d;
        if (l > 1) {
          e: for (; l--; ) for (d = l; d--; ) if (L(o[l], o[d])) {
            let n = { instancePath: t + "/sourceContext", schemaPath: "#/properties/sourceContext/uniqueItems", keyword: "uniqueItems", params: { i: l, j: d }, message: "must NOT have duplicate items (items ## " + d + " and " + l + " are identical)" };
            e === null ? e = [n] : e.push(n), s++;
            break e;
          }
        }
      } else {
        let y = { instancePath: t + "/sourceContext", schemaPath: "#/properties/sourceContext/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
    if (u.context !== void 0) {
      let o = u.context;
      if (o && typeof o == "object" && !Array.isArray(o)) {
        if (o.sources === void 0) {
          let y = { instancePath: t + "/context", schemaPath: "#/properties/context/required", keyword: "required", params: { missingProperty: "sources" }, message: "must have required property 'sources'" };
          e === null ? e = [y] : e.push(y), s++;
        }
        for (let y in o) if (!(y === "sources" || y === "instructions")) {
          let l = { instancePath: t + "/context", schemaPath: "#/properties/context/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: y }, message: "must NOT have additional properties" };
          e === null ? e = [l] : e.push(l), s++;
        }
        if (o.sources !== void 0) {
          let y = o.sources;
          if (Array.isArray(y)) {
            if (y.length < 0) {
              let m = { instancePath: t + "/context/sources", schemaPath: "#/properties/context/properties/sources/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
              e === null ? e = [m] : e.push(m), s++;
            }
            let l = y.length;
            for (let m = 0; m < l; m++) {
              let a = y[m];
              if (typeof a == "string") {
                if (j(a) < 1) {
                  let r = { instancePath: t + "/context/sources/" + m, schemaPath: "#/properties/context/properties/sources/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/context/sources/" + m, schemaPath: "#/properties/context/properties/sources/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            let d = y.length, n;
            if (d > 1) {
              let m = {};
              for (; d--; ) {
                let a = y[d];
                if (typeof a == "string") {
                  if (typeof m[a] == "number") {
                    n = m[a];
                    let r = { instancePath: t + "/context/sources", schemaPath: "#/properties/context/properties/sources/uniqueItems", keyword: "uniqueItems", params: { i: d, j: n }, message: "must NOT have duplicate items (items ## " + n + " and " + d + " are identical)" };
                    e === null ? e = [r] : e.push(r), s++;
                    break;
                  }
                  m[a] = d;
                }
              }
            }
          } else {
            let l = { instancePath: t + "/context/sources", schemaPath: "#/properties/context/properties/sources/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
        if (o.instructions !== void 0) {
          let y = o.instructions;
          if (typeof y == "string") {
            if (j(y) < 1) {
              let l = { instancePath: t + "/context/instructions", schemaPath: "#/properties/context/properties/instructions/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              e === null ? e = [l] : e.push(l), s++;
            }
          } else {
            let l = { instancePath: t + "/context/instructions", schemaPath: "#/properties/context/properties/instructions/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
      } else {
        let y = { instancePath: t + "/context", schemaPath: "#/properties/context/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
    if (u.tools !== void 0) {
      let o = u.tools;
      if (Array.isArray(o)) {
        if (o.length < 0) {
          let n = { instancePath: t + "/tools", schemaPath: "#/properties/tools/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [n] : e.push(n), s++;
        }
        let y = o.length;
        for (let n = 0; n < y; n++) {
          let m = o[n], a = s, r = false, i = s;
          if (typeof m == "string") {
            if (j(m) < 1) {
              let p = { instancePath: t + "/tools/" + n, schemaPath: "#/properties/tools/items/anyOf/0/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              e === null ? e = [p] : e.push(p), s++;
            }
          } else {
            let p = { instancePath: t + "/tools/" + n, schemaPath: "#/properties/tools/items/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [p] : e.push(p), s++;
          }
          var g = i === s;
          if (r = r || g, !r) {
            let p = s;
            if (m && typeof m == "object" && !Array.isArray(m)) {
              if (m.name === void 0) {
                let c = { instancePath: t + "/tools/" + n, schemaPath: "#/properties/tools/items/anyOf/1/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
                e === null ? e = [c] : e.push(c), s++;
              }
              if (m.kind === void 0) {
                let c = { instancePath: t + "/tools/" + n, schemaPath: "#/properties/tools/items/anyOf/1/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
                e === null ? e = [c] : e.push(c), s++;
              }
              if (m.purpose === void 0) {
                let c = { instancePath: t + "/tools/" + n, schemaPath: "#/properties/tools/items/anyOf/1/required", keyword: "required", params: { missingProperty: "purpose" }, message: "must have required property 'purpose'" };
                e === null ? e = [c] : e.push(c), s++;
              }
              for (let c in m) if (!(c === "name" || c === "kind" || c === "purpose")) {
                let P = { instancePath: t + "/tools/" + n, schemaPath: "#/properties/tools/items/anyOf/1/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: c }, message: "must NOT have additional properties" };
                e === null ? e = [P] : e.push(P), s++;
              }
              if (m.name !== void 0) {
                let c = m.name;
                if (typeof c == "string") {
                  if (j(c) < 1) {
                    let P = { instancePath: t + "/tools/" + n + "/name", schemaPath: "#/properties/tools/items/anyOf/1/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                    e === null ? e = [P] : e.push(P), s++;
                  }
                } else {
                  let P = { instancePath: t + "/tools/" + n + "/name", schemaPath: "#/properties/tools/items/anyOf/1/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  e === null ? e = [P] : e.push(P), s++;
                }
              }
              if (m.kind !== void 0) {
                let c = m.kind;
                if (!(c === "cli" || c === "mcp" || c === "skill")) {
                  let P = { instancePath: t + "/tools/" + n + "/kind", schemaPath: "#/properties/tools/items/anyOf/1/properties/kind/enum", keyword: "enum", params: { allowedValues: Qe.properties.tools.items.anyOf[1].properties.kind.enum }, message: "must be equal to one of the allowed values" };
                  e === null ? e = [P] : e.push(P), s++;
                }
              }
              if (m.purpose !== void 0) {
                let c = m.purpose;
                if (typeof c == "string") {
                  if (j(c) < 1) {
                    let P = { instancePath: t + "/tools/" + n + "/purpose", schemaPath: "#/properties/tools/items/anyOf/1/properties/purpose/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                    e === null ? e = [P] : e.push(P), s++;
                  }
                } else {
                  let P = { instancePath: t + "/tools/" + n + "/purpose", schemaPath: "#/properties/tools/items/anyOf/1/properties/purpose/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  e === null ? e = [P] : e.push(P), s++;
                }
              }
            } else {
              let c = { instancePath: t + "/tools/" + n, schemaPath: "#/properties/tools/items/anyOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              e === null ? e = [c] : e.push(c), s++;
            }
            var g = p === s;
            r = r || g;
          }
          if (r) s = a, e !== null && (a ? e.length = a : e = null);
          else {
            let p = { instancePath: t + "/tools/" + n, schemaPath: "#/properties/tools/items/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
            e === null ? e = [p] : e.push(p), s++;
          }
        }
        let l = o.length, d;
        if (l > 1) {
          e: for (; l--; ) for (d = l; d--; ) if (L(o[l], o[d])) {
            let n = { instancePath: t + "/tools", schemaPath: "#/properties/tools/uniqueItems", keyword: "uniqueItems", params: { i: l, j: d }, message: "must NOT have duplicate items (items ## " + d + " and " + l + " are identical)" };
            e === null ? e = [n] : e.push(n), s++;
            break e;
          }
        }
      } else {
        let y = { instancePath: t + "/tools", schemaPath: "#/properties/tools/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
  } else {
    let o = { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [o] : e.push(o), s++;
  }
  return _e.errors = e, s === 0;
}
var cs = Ne;
var ae = { $schema: "http://json-schema.org/draft-07/schema#", $id: "plan.schema.json", type: "object", properties: { contractVersion: { const: "toolkit-2" }, planId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, revision: { type: "integer", minimum: 1 }, previousRevision: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] }, target: { type: "object", properties: { targetId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, revision: { type: "integer", minimum: 1 }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" } }, required: ["targetId", "revision", "sha256"], additionalProperties: false }, objective: { type: "string", minLength: 1 }, requirements: { type: "array", items: { type: "object", properties: { id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, text: { type: "string", minLength: 1 }, source: { type: "string", minLength: 1 }, metadata: { $ref: "#/definitions/metadata" } }, required: ["id", "text", "source"], additionalProperties: false }, minItems: 1, uniqueItems: true }, tests: { type: "array", items: { $ref: "#/definitions/test" }, minItems: 0, uniqueItems: true }, gaps: { type: "array", items: { $ref: "gap.schema.json" }, minItems: 0, uniqueItems: true }, assumptions: { type: "array", items: { type: "object", properties: { decisionId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, text: { type: "string", minLength: 1 } }, required: ["decisionId", "text"], additionalProperties: false }, minItems: 0, uniqueItems: true }, decisions: { type: "array", items: { type: "object", properties: { id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, gapId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, kind: { enum: ["clarify", "accept_assumption", "defer"] }, actor: { type: "string", minLength: 1 }, rationale: { type: "string", minLength: 1 }, value: { type: "string", minLength: 1 }, source: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] } }, required: ["id", "gapId", "kind", "actor", "rationale", "value", "source"], additionalProperties: false }, minItems: 0, uniqueItems: true }, coverage: { type: "array", items: { type: "object", properties: { requirementId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, testIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 0, uniqueItems: true }, status: { enum: ["planned", "blocked", "deferred"] } }, required: ["requirementId", "testIds", "status"], additionalProperties: false }, minItems: 1, uniqueItems: true } }, required: ["contractVersion", "planId", "revision", "previousRevision", "target", "objective", "requirements", "tests", "gaps", "assumptions", "decisions", "coverage"], additionalProperties: false, definitions: { test: { type: "object", properties: { id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, title: { type: "string", minLength: 1, maxLength: 200 }, requirementIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, capability: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, operations: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, readiness: { enum: ["ready", "blocked", "deferred"] }, gapIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 0, uniqueItems: true }, dependsOn: { type: "array", items: { type: "string", pattern: "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 0, uniqueItems: true }, preconditions: { type: "array", items: { type: "string", minLength: 1 }, minItems: 0, uniqueItems: true }, action: { type: "string", minLength: 1 }, assertions: { type: "array", items: { $ref: "#/definitions/assertion" }, minItems: 0, uniqueItems: true }, metadata: { $ref: "#/definitions/metadata" } }, required: ["id", "title", "requirementIds", "capability", "operations", "readiness", "gapIds", "dependsOn", "preconditions", "action", "assertions"], additionalProperties: false }, assertion: { type: "object", properties: { id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, check: { type: "string", minLength: 1 }, checkKind: { enum: ["deterministic", "agent_observation"] } }, required: ["id", "check", "checkKind"], additionalProperties: false }, metadata: { type: "object", propertyNames: { pattern: "^[A-Za-z][A-Za-z0-9_.-]{0,63}$" }, additionalProperties: { type: ["string", "number", "boolean"], maxLength: 500 }, maxProperties: 20 } } };
var U = new RegExp("^[a-f0-9]{64}$", "u");
var qe = { type: "object", properties: { id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, title: { type: "string", minLength: 1, maxLength: 200 }, requirementIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, capability: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, operations: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, readiness: { enum: ["ready", "blocked", "deferred"] }, gapIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 0, uniqueItems: true }, dependsOn: { type: "array", items: { type: "string", pattern: "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 0, uniqueItems: true }, preconditions: { type: "array", items: { type: "string", minLength: 1 }, minItems: 0, uniqueItems: true }, action: { type: "string", minLength: 1 }, assertions: { type: "array", items: { $ref: "#/definitions/assertion" }, minItems: 0, uniqueItems: true }, metadata: { $ref: "#/definitions/metadata" } }, required: ["id", "title", "requirementIds", "capability", "operations", "readiness", "gapIds", "dependsOn", "preconditions", "action", "assertions"], additionalProperties: false };
function W(u, { instancePath: t = "", parentData: _, parentDataProperty: Z, rootData: N = u } = {}) {
  let e = null, s = 0;
  if (u && typeof u == "object" && !Array.isArray(u)) {
    if (u.id === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.title === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "title" }, message: "must have required property 'title'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.requirementIds === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "requirementIds" }, message: "must have required property 'requirementIds'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.capability === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "capability" }, message: "must have required property 'capability'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.operations === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operations" }, message: "must have required property 'operations'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.readiness === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "readiness" }, message: "must have required property 'readiness'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.gapIds === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "gapIds" }, message: "must have required property 'gapIds'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.dependsOn === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "dependsOn" }, message: "must have required property 'dependsOn'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.preconditions === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "preconditions" }, message: "must have required property 'preconditions'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.action === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "action" }, message: "must have required property 'action'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.assertions === void 0) {
      let g = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "assertions" }, message: "must have required property 'assertions'" };
      e === null ? e = [g] : e.push(g), s++;
    }
    for (let g in u) if (!C.call(qe.properties, g)) {
      let o = { instancePath: t, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: g }, message: "must NOT have additional properties" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.id !== void 0) {
      let g = u.id;
      if (typeof g == "string") {
        if (!z.test(g)) {
          let o = { instancePath: t + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [o] : e.push(o), s++;
        }
      } else {
        let o = { instancePath: t + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.title !== void 0) {
      let g = u.title;
      if (typeof g == "string") {
        if (j(g) > 200) {
          let o = { instancePath: t + "/title", schemaPath: "#/properties/title/maxLength", keyword: "maxLength", params: { limit: 200 }, message: "must NOT have more than 200 characters" };
          e === null ? e = [o] : e.push(o), s++;
        }
        if (j(g) < 1) {
          let o = { instancePath: t + "/title", schemaPath: "#/properties/title/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [o] : e.push(o), s++;
        }
      } else {
        let o = { instancePath: t + "/title", schemaPath: "#/properties/title/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.requirementIds !== void 0) {
      let g = u.requirementIds;
      if (Array.isArray(g)) {
        if (g.length < 1) {
          let d = { instancePath: t + "/requirementIds", schemaPath: "#/properties/requirementIds/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [d] : e.push(d), s++;
        }
        let o = g.length;
        for (let d = 0; d < o; d++) {
          let n = g[d];
          if (typeof n == "string") {
            if (!z.test(n)) {
              let m = { instancePath: t + "/requirementIds/" + d, schemaPath: "#/properties/requirementIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: t + "/requirementIds/" + d, schemaPath: "#/properties/requirementIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        let y = g.length, l;
        if (y > 1) {
          let d = {};
          for (; y--; ) {
            let n = g[y];
            if (typeof n == "string") {
              if (typeof d[n] == "number") {
                l = d[n];
                let m = { instancePath: t + "/requirementIds", schemaPath: "#/properties/requirementIds/uniqueItems", keyword: "uniqueItems", params: { i: y, j: l }, message: "must NOT have duplicate items (items ## " + l + " and " + y + " are identical)" };
                e === null ? e = [m] : e.push(m), s++;
                break;
              }
              d[n] = y;
            }
          }
        }
      } else {
        let o = { instancePath: t + "/requirementIds", schemaPath: "#/properties/requirementIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.capability !== void 0) {
      let g = u.capability;
      if (typeof g == "string") {
        if (!z.test(g)) {
          let o = { instancePath: t + "/capability", schemaPath: "#/properties/capability/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [o] : e.push(o), s++;
        }
      } else {
        let o = { instancePath: t + "/capability", schemaPath: "#/properties/capability/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.operations !== void 0) {
      let g = u.operations;
      if (Array.isArray(g)) {
        if (g.length < 1) {
          let d = { instancePath: t + "/operations", schemaPath: "#/properties/operations/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [d] : e.push(d), s++;
        }
        let o = g.length;
        for (let d = 0; d < o; d++) {
          let n = g[d];
          if (typeof n == "string") {
            if (!z.test(n)) {
              let m = { instancePath: t + "/operations/" + d, schemaPath: "#/properties/operations/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: t + "/operations/" + d, schemaPath: "#/properties/operations/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        let y = g.length, l;
        if (y > 1) {
          let d = {};
          for (; y--; ) {
            let n = g[y];
            if (typeof n == "string") {
              if (typeof d[n] == "number") {
                l = d[n];
                let m = { instancePath: t + "/operations", schemaPath: "#/properties/operations/uniqueItems", keyword: "uniqueItems", params: { i: y, j: l }, message: "must NOT have duplicate items (items ## " + l + " and " + y + " are identical)" };
                e === null ? e = [m] : e.push(m), s++;
                break;
              }
              d[n] = y;
            }
          }
        }
      } else {
        let o = { instancePath: t + "/operations", schemaPath: "#/properties/operations/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.readiness !== void 0) {
      let g = u.readiness;
      if (!(g === "ready" || g === "blocked" || g === "deferred")) {
        let o = { instancePath: t + "/readiness", schemaPath: "#/properties/readiness/enum", keyword: "enum", params: { allowedValues: qe.properties.readiness.enum }, message: "must be equal to one of the allowed values" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.gapIds !== void 0) {
      let g = u.gapIds;
      if (Array.isArray(g)) {
        if (g.length < 0) {
          let d = { instancePath: t + "/gapIds", schemaPath: "#/properties/gapIds/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [d] : e.push(d), s++;
        }
        let o = g.length;
        for (let d = 0; d < o; d++) {
          let n = g[d];
          if (typeof n == "string") {
            if (!z.test(n)) {
              let m = { instancePath: t + "/gapIds/" + d, schemaPath: "#/properties/gapIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: t + "/gapIds/" + d, schemaPath: "#/properties/gapIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        let y = g.length, l;
        if (y > 1) {
          let d = {};
          for (; y--; ) {
            let n = g[y];
            if (typeof n == "string") {
              if (typeof d[n] == "number") {
                l = d[n];
                let m = { instancePath: t + "/gapIds", schemaPath: "#/properties/gapIds/uniqueItems", keyword: "uniqueItems", params: { i: y, j: l }, message: "must NOT have duplicate items (items ## " + l + " and " + y + " are identical)" };
                e === null ? e = [m] : e.push(m), s++;
                break;
              }
              d[n] = y;
            }
          }
        }
      } else {
        let o = { instancePath: t + "/gapIds", schemaPath: "#/properties/gapIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.dependsOn !== void 0) {
      let g = u.dependsOn;
      if (Array.isArray(g)) {
        if (g.length < 0) {
          let d = { instancePath: t + "/dependsOn", schemaPath: "#/properties/dependsOn/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [d] : e.push(d), s++;
        }
        let o = g.length;
        for (let d = 0; d < o; d++) {
          let n = g[d];
          if (typeof n == "string") {
            if (!M.test(n)) {
              let m = { instancePath: t + "/dependsOn/" + d, schemaPath: "#/properties/dependsOn/items/pattern", keyword: "pattern", params: { pattern: "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: t + "/dependsOn/" + d, schemaPath: "#/properties/dependsOn/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        let y = g.length, l;
        if (y > 1) {
          let d = {};
          for (; y--; ) {
            let n = g[y];
            if (typeof n == "string") {
              if (typeof d[n] == "number") {
                l = d[n];
                let m = { instancePath: t + "/dependsOn", schemaPath: "#/properties/dependsOn/uniqueItems", keyword: "uniqueItems", params: { i: y, j: l }, message: "must NOT have duplicate items (items ## " + l + " and " + y + " are identical)" };
                e === null ? e = [m] : e.push(m), s++;
                break;
              }
              d[n] = y;
            }
          }
        }
      } else {
        let o = { instancePath: t + "/dependsOn", schemaPath: "#/properties/dependsOn/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.preconditions !== void 0) {
      let g = u.preconditions;
      if (Array.isArray(g)) {
        if (g.length < 0) {
          let d = { instancePath: t + "/preconditions", schemaPath: "#/properties/preconditions/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [d] : e.push(d), s++;
        }
        let o = g.length;
        for (let d = 0; d < o; d++) {
          let n = g[d];
          if (typeof n == "string") {
            if (j(n) < 1) {
              let m = { instancePath: t + "/preconditions/" + d, schemaPath: "#/properties/preconditions/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: t + "/preconditions/" + d, schemaPath: "#/properties/preconditions/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        let y = g.length, l;
        if (y > 1) {
          let d = {};
          for (; y--; ) {
            let n = g[y];
            if (typeof n == "string") {
              if (typeof d[n] == "number") {
                l = d[n];
                let m = { instancePath: t + "/preconditions", schemaPath: "#/properties/preconditions/uniqueItems", keyword: "uniqueItems", params: { i: y, j: l }, message: "must NOT have duplicate items (items ## " + l + " and " + y + " are identical)" };
                e === null ? e = [m] : e.push(m), s++;
                break;
              }
              d[n] = y;
            }
          }
        }
      } else {
        let o = { instancePath: t + "/preconditions", schemaPath: "#/properties/preconditions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.action !== void 0) {
      let g = u.action;
      if (typeof g == "string") {
        if (j(g) < 1) {
          let o = { instancePath: t + "/action", schemaPath: "#/properties/action/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [o] : e.push(o), s++;
        }
      } else {
        let o = { instancePath: t + "/action", schemaPath: "#/properties/action/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.assertions !== void 0) {
      let g = u.assertions;
      if (Array.isArray(g)) {
        if (g.length < 0) {
          let d = { instancePath: t + "/assertions", schemaPath: "#/properties/assertions/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [d] : e.push(d), s++;
        }
        let o = g.length;
        for (let d = 0; d < o; d++) {
          let n = g[d];
          if (n && typeof n == "object" && !Array.isArray(n)) {
            if (n.id === void 0) {
              let m = { instancePath: t + "/assertions/" + d, schemaPath: "#/definitions/assertion/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              e === null ? e = [m] : e.push(m), s++;
            }
            if (n.check === void 0) {
              let m = { instancePath: t + "/assertions/" + d, schemaPath: "#/definitions/assertion/required", keyword: "required", params: { missingProperty: "check" }, message: "must have required property 'check'" };
              e === null ? e = [m] : e.push(m), s++;
            }
            if (n.checkKind === void 0) {
              let m = { instancePath: t + "/assertions/" + d, schemaPath: "#/definitions/assertion/required", keyword: "required", params: { missingProperty: "checkKind" }, message: "must have required property 'checkKind'" };
              e === null ? e = [m] : e.push(m), s++;
            }
            for (let m in n) if (!(m === "id" || m === "check" || m === "checkKind")) {
              let a = { instancePath: t + "/assertions/" + d, schemaPath: "#/definitions/assertion/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: m }, message: "must NOT have additional properties" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (n.id !== void 0) {
              let m = n.id;
              if (typeof m == "string") {
                if (!z.test(m)) {
                  let a = { instancePath: t + "/assertions/" + d + "/id", schemaPath: "#/definitions/assertion/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [a] : e.push(a), s++;
                }
              } else {
                let a = { instancePath: t + "/assertions/" + d + "/id", schemaPath: "#/definitions/assertion/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [a] : e.push(a), s++;
              }
            }
            if (n.check !== void 0) {
              let m = n.check;
              if (typeof m == "string") {
                if (j(m) < 1) {
                  let a = { instancePath: t + "/assertions/" + d + "/check", schemaPath: "#/definitions/assertion/properties/check/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [a] : e.push(a), s++;
                }
              } else {
                let a = { instancePath: t + "/assertions/" + d + "/check", schemaPath: "#/definitions/assertion/properties/check/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [a] : e.push(a), s++;
              }
            }
            if (n.checkKind !== void 0) {
              let m = n.checkKind;
              if (!(m === "deterministic" || m === "agent_observation")) {
                let a = { instancePath: t + "/assertions/" + d + "/checkKind", schemaPath: "#/definitions/assertion/properties/checkKind/enum", keyword: "enum", params: { allowedValues: je.properties.checkKind.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [a] : e.push(a), s++;
              }
            }
          } else {
            let m = { instancePath: t + "/assertions/" + d, schemaPath: "#/definitions/assertion/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        let y = g.length, l;
        if (y > 1) {
          e: for (; y--; ) for (l = y; l--; ) if (L(g[y], g[l])) {
            let d = { instancePath: t + "/assertions", schemaPath: "#/properties/assertions/uniqueItems", keyword: "uniqueItems", params: { i: y, j: l }, message: "must NOT have duplicate items (items ## " + l + " and " + y + " are identical)" };
            e === null ? e = [d] : e.push(d), s++;
            break e;
          }
        }
      } else {
        let o = { instancePath: t + "/assertions", schemaPath: "#/properties/assertions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
    if (u.metadata !== void 0) {
      let g = u.metadata;
      if (g && typeof g == "object" && !Array.isArray(g)) {
        if (Object.keys(g).length > 20) {
          let o = { instancePath: t + "/metadata", schemaPath: "#/definitions/metadata/maxProperties", keyword: "maxProperties", params: { limit: 20 }, message: "must NOT have more than 20 properties" };
          e === null ? e = [o] : e.push(o), s++;
        }
        for (let o in g) {
          let y = s;
          if (typeof o == "string" && !R.test(o)) {
            let l = { instancePath: t + "/metadata", schemaPath: "#/definitions/metadata/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z][A-Za-z0-9_.-]{0,63}$" }, message: 'must match pattern "^[A-Za-z][A-Za-z0-9_.-]{0,63}$"', propertyName: o };
            e === null ? e = [l] : e.push(l), s++;
          }
          var O = y === s;
          if (!O) {
            let l = { instancePath: t + "/metadata", schemaPath: "#/definitions/metadata/propertyNames", keyword: "propertyNames", params: { propertyName: o }, message: "property name must be valid" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
        for (let o in g) {
          let y = g[o];
          if (typeof y != "string" && !(typeof y == "number" && isFinite(y)) && typeof y != "boolean") {
            let l = { instancePath: t + "/metadata/" + o.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/definitions/metadata/additionalProperties/type", keyword: "type", params: { type: F.additionalProperties.type }, message: "must be string,number,boolean" };
            e === null ? e = [l] : e.push(l), s++;
          }
          if (typeof y == "string" && j(y) > 500) {
            let l = { instancePath: t + "/metadata/" + o.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/definitions/metadata/additionalProperties/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
      } else {
        let o = { instancePath: t + "/metadata", schemaPath: "#/definitions/metadata/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [o] : e.push(o), s++;
      }
    }
  } else {
    let g = { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [g] : e.push(g), s++;
  }
  return W.errors = e, s === 0;
}
function Ne(u, { instancePath: t = "", parentData: _, parentDataProperty: Z, rootData: N = u } = {}) {
  let e = null, s = 0;
  if (u && typeof u == "object" && !Array.isArray(u)) {
    if (u.contractVersion === void 0) {
      let l = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "contractVersion" }, message: "must have required property 'contractVersion'" };
      e === null ? e = [l] : e.push(l), s++;
    }
    if (u.planId === void 0) {
      let l = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "planId" }, message: "must have required property 'planId'" };
      e === null ? e = [l] : e.push(l), s++;
    }
    if (u.revision === void 0) {
      let l = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "revision" }, message: "must have required property 'revision'" };
      e === null ? e = [l] : e.push(l), s++;
    }
    if (u.previousRevision === void 0) {
      let l = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "previousRevision" }, message: "must have required property 'previousRevision'" };
      e === null ? e = [l] : e.push(l), s++;
    }
    if (u.target === void 0) {
      let l = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "target" }, message: "must have required property 'target'" };
      e === null ? e = [l] : e.push(l), s++;
    }
    if (u.objective === void 0) {
      let l = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "objective" }, message: "must have required property 'objective'" };
      e === null ? e = [l] : e.push(l), s++;
    }
    if (u.requirements === void 0) {
      let l = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "requirements" }, message: "must have required property 'requirements'" };
      e === null ? e = [l] : e.push(l), s++;
    }
    if (u.tests === void 0) {
      let l = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "tests" }, message: "must have required property 'tests'" };
      e === null ? e = [l] : e.push(l), s++;
    }
    if (u.gaps === void 0) {
      let l = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "gaps" }, message: "must have required property 'gaps'" };
      e === null ? e = [l] : e.push(l), s++;
    }
    if (u.assumptions === void 0) {
      let l = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "assumptions" }, message: "must have required property 'assumptions'" };
      e === null ? e = [l] : e.push(l), s++;
    }
    if (u.decisions === void 0) {
      let l = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "decisions" }, message: "must have required property 'decisions'" };
      e === null ? e = [l] : e.push(l), s++;
    }
    if (u.coverage === void 0) {
      let l = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "coverage" }, message: "must have required property 'coverage'" };
      e === null ? e = [l] : e.push(l), s++;
    }
    for (let l in u) if (!C.call(ae.properties, l)) {
      let d = { instancePath: t, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: l }, message: "must NOT have additional properties" };
      e === null ? e = [d] : e.push(d), s++;
    }
    if (u.contractVersion !== void 0 && u.contractVersion !== "toolkit-2") {
      let l = { instancePath: t + "/contractVersion", schemaPath: "#/properties/contractVersion/const", keyword: "const", params: { allowedValue: "toolkit-2" }, message: "must be equal to constant" };
      e === null ? e = [l] : e.push(l), s++;
    }
    if (u.planId !== void 0) {
      let l = u.planId;
      if (typeof l == "string") {
        if (!z.test(l)) {
          let d = { instancePath: t + "/planId", schemaPath: "#/properties/planId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [d] : e.push(d), s++;
        }
      } else {
        let d = { instancePath: t + "/planId", schemaPath: "#/properties/planId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [d] : e.push(d), s++;
      }
    }
    if (u.revision !== void 0) {
      let l = u.revision;
      if (!(typeof l == "number" && !(l % 1) && !isNaN(l) && isFinite(l))) {
        let d = { instancePath: t + "/revision", schemaPath: "#/properties/revision/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        e === null ? e = [d] : e.push(d), s++;
      }
      if (typeof l == "number" && isFinite(l) && (l < 1 || isNaN(l))) {
        let d = { instancePath: t + "/revision", schemaPath: "#/properties/revision/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
        e === null ? e = [d] : e.push(d), s++;
      }
    }
    if (u.previousRevision !== void 0) {
      let l = u.previousRevision, d = s, n = false, m = s;
      if (!(typeof l == "number" && !(l % 1) && !isNaN(l) && isFinite(l))) {
        let a = { instancePath: t + "/previousRevision", schemaPath: "#/properties/previousRevision/anyOf/0/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        e === null ? e = [a] : e.push(a), s++;
      }
      if (typeof l == "number" && isFinite(l) && (l < 1 || isNaN(l))) {
        let a = { instancePath: t + "/previousRevision", schemaPath: "#/properties/previousRevision/anyOf/0/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
        e === null ? e = [a] : e.push(a), s++;
      }
      var O = m === s;
      if (n = n || O, !n) {
        let a = s;
        if (l !== null) {
          let i = { instancePath: t + "/previousRevision", schemaPath: "#/properties/previousRevision/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
          e === null ? e = [i] : e.push(i), s++;
        }
        var O = a === s;
        n = n || O;
      }
      if (n) s = d, e !== null && (d ? e.length = d : e = null);
      else {
        let a = { instancePath: t + "/previousRevision", schemaPath: "#/properties/previousRevision/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (u.target !== void 0) {
      let l = u.target;
      if (l && typeof l == "object" && !Array.isArray(l)) {
        if (l.targetId === void 0) {
          let d = { instancePath: t + "/target", schemaPath: "#/properties/target/required", keyword: "required", params: { missingProperty: "targetId" }, message: "must have required property 'targetId'" };
          e === null ? e = [d] : e.push(d), s++;
        }
        if (l.revision === void 0) {
          let d = { instancePath: t + "/target", schemaPath: "#/properties/target/required", keyword: "required", params: { missingProperty: "revision" }, message: "must have required property 'revision'" };
          e === null ? e = [d] : e.push(d), s++;
        }
        if (l.sha256 === void 0) {
          let d = { instancePath: t + "/target", schemaPath: "#/properties/target/required", keyword: "required", params: { missingProperty: "sha256" }, message: "must have required property 'sha256'" };
          e === null ? e = [d] : e.push(d), s++;
        }
        for (let d in l) if (!(d === "targetId" || d === "revision" || d === "sha256")) {
          let n = { instancePath: t + "/target", schemaPath: "#/properties/target/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: d }, message: "must NOT have additional properties" };
          e === null ? e = [n] : e.push(n), s++;
        }
        if (l.targetId !== void 0) {
          let d = l.targetId;
          if (typeof d == "string") {
            if (!z.test(d)) {
              let n = { instancePath: t + "/target/targetId", schemaPath: "#/properties/target/properties/targetId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [n] : e.push(n), s++;
            }
          } else {
            let n = { instancePath: t + "/target/targetId", schemaPath: "#/properties/target/properties/targetId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [n] : e.push(n), s++;
          }
        }
        if (l.revision !== void 0) {
          let d = l.revision;
          if (!(typeof d == "number" && !(d % 1) && !isNaN(d) && isFinite(d))) {
            let n = { instancePath: t + "/target/revision", schemaPath: "#/properties/target/properties/revision/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            e === null ? e = [n] : e.push(n), s++;
          }
          if (typeof d == "number" && isFinite(d) && (d < 1 || isNaN(d))) {
            let n = { instancePath: t + "/target/revision", schemaPath: "#/properties/target/properties/revision/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
            e === null ? e = [n] : e.push(n), s++;
          }
        }
        if (l.sha256 !== void 0) {
          let d = l.sha256;
          if (typeof d == "string") {
            if (!U.test(d)) {
              let n = { instancePath: t + "/target/sha256", schemaPath: "#/properties/target/properties/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
              e === null ? e = [n] : e.push(n), s++;
            }
          } else {
            let n = { instancePath: t + "/target/sha256", schemaPath: "#/properties/target/properties/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [n] : e.push(n), s++;
          }
        }
      } else {
        let d = { instancePath: t + "/target", schemaPath: "#/properties/target/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [d] : e.push(d), s++;
      }
    }
    if (u.objective !== void 0) {
      let l = u.objective;
      if (typeof l == "string") {
        if (j(l) < 1) {
          let d = { instancePath: t + "/objective", schemaPath: "#/properties/objective/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [d] : e.push(d), s++;
        }
      } else {
        let d = { instancePath: t + "/objective", schemaPath: "#/properties/objective/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [d] : e.push(d), s++;
      }
    }
    if (u.requirements !== void 0) {
      let l = u.requirements;
      if (Array.isArray(l)) {
        if (l.length < 1) {
          let a = { instancePath: t + "/requirements", schemaPath: "#/properties/requirements/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [a] : e.push(a), s++;
        }
        let d = l.length;
        for (let a = 0; a < d; a++) {
          let r = l[a];
          if (r && typeof r == "object" && !Array.isArray(r)) {
            if (r.id === void 0) {
              let i = { instancePath: t + "/requirements/" + a, schemaPath: "#/properties/requirements/items/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.text === void 0) {
              let i = { instancePath: t + "/requirements/" + a, schemaPath: "#/properties/requirements/items/required", keyword: "required", params: { missingProperty: "text" }, message: "must have required property 'text'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.source === void 0) {
              let i = { instancePath: t + "/requirements/" + a, schemaPath: "#/properties/requirements/items/required", keyword: "required", params: { missingProperty: "source" }, message: "must have required property 'source'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            for (let i in r) if (!(i === "id" || i === "text" || i === "source" || i === "metadata")) {
              let p = { instancePath: t + "/requirements/" + a, schemaPath: "#/properties/requirements/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: i }, message: "must NOT have additional properties" };
              e === null ? e = [p] : e.push(p), s++;
            }
            if (r.id !== void 0) {
              let i = r.id;
              if (typeof i == "string") {
                if (!z.test(i)) {
                  let p = { instancePath: t + "/requirements/" + a + "/id", schemaPath: "#/properties/requirements/items/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [p] : e.push(p), s++;
                }
              } else {
                let p = { instancePath: t + "/requirements/" + a + "/id", schemaPath: "#/properties/requirements/items/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.text !== void 0) {
              let i = r.text;
              if (typeof i == "string") {
                if (j(i) < 1) {
                  let p = { instancePath: t + "/requirements/" + a + "/text", schemaPath: "#/properties/requirements/items/properties/text/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [p] : e.push(p), s++;
                }
              } else {
                let p = { instancePath: t + "/requirements/" + a + "/text", schemaPath: "#/properties/requirements/items/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.source !== void 0) {
              let i = r.source;
              if (typeof i == "string") {
                if (j(i) < 1) {
                  let p = { instancePath: t + "/requirements/" + a + "/source", schemaPath: "#/properties/requirements/items/properties/source/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [p] : e.push(p), s++;
                }
              } else {
                let p = { instancePath: t + "/requirements/" + a + "/source", schemaPath: "#/properties/requirements/items/properties/source/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.metadata !== void 0) {
              let i = r.metadata;
              if (i && typeof i == "object" && !Array.isArray(i)) {
                if (Object.keys(i).length > 20) {
                  let p = { instancePath: t + "/requirements/" + a + "/metadata", schemaPath: "#/definitions/metadata/maxProperties", keyword: "maxProperties", params: { limit: 20 }, message: "must NOT have more than 20 properties" };
                  e === null ? e = [p] : e.push(p), s++;
                }
                for (let p in i) {
                  let k = s;
                  if (typeof p == "string" && !R.test(p)) {
                    let c = { instancePath: t + "/requirements/" + a + "/metadata", schemaPath: "#/definitions/metadata/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z][A-Za-z0-9_.-]{0,63}$" }, message: 'must match pattern "^[A-Za-z][A-Za-z0-9_.-]{0,63}$"', propertyName: p };
                    e === null ? e = [c] : e.push(c), s++;
                  }
                  var g = k === s;
                  if (!g) {
                    let c = { instancePath: t + "/requirements/" + a + "/metadata", schemaPath: "#/definitions/metadata/propertyNames", keyword: "propertyNames", params: { propertyName: p }, message: "property name must be valid" };
                    e === null ? e = [c] : e.push(c), s++;
                  }
                }
                for (let p in i) {
                  let k = i[p];
                  if (typeof k != "string" && !(typeof k == "number" && isFinite(k)) && typeof k != "boolean") {
                    let c = { instancePath: t + "/requirements/" + a + "/metadata/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/definitions/metadata/additionalProperties/type", keyword: "type", params: { type: F.additionalProperties.type }, message: "must be string,number,boolean" };
                    e === null ? e = [c] : e.push(c), s++;
                  }
                  if (typeof k == "string" && j(k) > 500) {
                    let c = { instancePath: t + "/requirements/" + a + "/metadata/" + p.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/definitions/metadata/additionalProperties/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
                    e === null ? e = [c] : e.push(c), s++;
                  }
                }
              } else {
                let p = { instancePath: t + "/requirements/" + a + "/metadata", schemaPath: "#/definitions/metadata/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
          } else {
            let i = { instancePath: t + "/requirements/" + a, schemaPath: "#/properties/requirements/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [i] : e.push(i), s++;
          }
        }
        let n = l.length, m;
        if (n > 1) {
          e: for (; n--; ) for (m = n; m--; ) if (L(l[n], l[m])) {
            let a = { instancePath: t + "/requirements", schemaPath: "#/properties/requirements/uniqueItems", keyword: "uniqueItems", params: { i: n, j: m }, message: "must NOT have duplicate items (items ## " + m + " and " + n + " are identical)" };
            e === null ? e = [a] : e.push(a), s++;
            break e;
          }
        }
      } else {
        let d = { instancePath: t + "/requirements", schemaPath: "#/properties/requirements/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [d] : e.push(d), s++;
      }
    }
    if (u.tests !== void 0) {
      let l = u.tests;
      if (Array.isArray(l)) {
        if (l.length < 0) {
          let a = { instancePath: t + "/tests", schemaPath: "#/properties/tests/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [a] : e.push(a), s++;
        }
        let d = l.length;
        for (let a = 0; a < d; a++) W(l[a], { instancePath: t + "/tests/" + a, parentData: l, parentDataProperty: a, rootData: N }) || (e = e === null ? W.errors : e.concat(W.errors), s = e.length);
        let n = l.length, m;
        if (n > 1) {
          e: for (; n--; ) for (m = n; m--; ) if (L(l[n], l[m])) {
            let a = { instancePath: t + "/tests", schemaPath: "#/properties/tests/uniqueItems", keyword: "uniqueItems", params: { i: n, j: m }, message: "must NOT have duplicate items (items ## " + m + " and " + n + " are identical)" };
            e === null ? e = [a] : e.push(a), s++;
            break e;
          }
        }
      } else {
        let d = { instancePath: t + "/tests", schemaPath: "#/properties/tests/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [d] : e.push(d), s++;
      }
    }
    if (u.gaps !== void 0) {
      let l = u.gaps;
      if (Array.isArray(l)) {
        if (l.length < 0) {
          let a = { instancePath: t + "/gaps", schemaPath: "#/properties/gaps/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [a] : e.push(a), s++;
        }
        let d = l.length;
        for (let a = 0; a < d; a++) {
          let r = l[a];
          if (r && typeof r == "object" && !Array.isArray(r)) {
            if (r.id === void 0) {
              let i = { instancePath: t + "/gaps/" + a, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.severity === void 0) {
              let i = { instancePath: t + "/gaps/" + a, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "severity" }, message: "must have required property 'severity'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.status === void 0) {
              let i = { instancePath: t + "/gaps/" + a, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "status" }, message: "must have required property 'status'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.requirementIds === void 0) {
              let i = { instancePath: t + "/gaps/" + a, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "requirementIds" }, message: "must have required property 'requirementIds'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.testIds === void 0) {
              let i = { instancePath: t + "/gaps/" + a, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "testIds" }, message: "must have required property 'testIds'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.question === void 0) {
              let i = { instancePath: t + "/gaps/" + a, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "question" }, message: "must have required property 'question'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.consequence === void 0) {
              let i = { instancePath: t + "/gaps/" + a, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "consequence" }, message: "must have required property 'consequence'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.decisionId === void 0) {
              let i = { instancePath: t + "/gaps/" + a, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "decisionId" }, message: "must have required property 'decisionId'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            for (let i in r) if (!(i === "id" || i === "severity" || i === "status" || i === "requirementIds" || i === "testIds" || i === "question" || i === "consequence" || i === "decisionId")) {
              let p = { instancePath: t + "/gaps/" + a, schemaPath: "gap.schema.json/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: i }, message: "must NOT have additional properties" };
              e === null ? e = [p] : e.push(p), s++;
            }
            if (r.id !== void 0) {
              let i = r.id;
              if (typeof i == "string") {
                if (!z.test(i)) {
                  let p = { instancePath: t + "/gaps/" + a + "/id", schemaPath: "gap.schema.json/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [p] : e.push(p), s++;
                }
              } else {
                let p = { instancePath: t + "/gaps/" + a + "/id", schemaPath: "gap.schema.json/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.severity !== void 0) {
              let i = r.severity;
              if (!(i === "blocking" || i === "non_blocking")) {
                let p = { instancePath: t + "/gaps/" + a + "/severity", schemaPath: "gap.schema.json/properties/severity/enum", keyword: "enum", params: { allowedValues: B.properties.severity.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.status !== void 0) {
              let i = r.status;
              if (!(i === "open" || i === "resolved" || i === "deferred")) {
                let p = { instancePath: t + "/gaps/" + a + "/status", schemaPath: "gap.schema.json/properties/status/enum", keyword: "enum", params: { allowedValues: B.properties.status.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.requirementIds !== void 0) {
              let i = r.requirementIds;
              if (Array.isArray(i)) {
                if (i.length < 0) {
                  let P = { instancePath: t + "/gaps/" + a + "/requirementIds", schemaPath: "gap.schema.json/properties/requirementIds/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [P] : e.push(P), s++;
                }
                let p = i.length;
                for (let P = 0; P < p; P++) {
                  let f = i[P];
                  if (typeof f == "string") {
                    if (!z.test(f)) {
                      let h = { instancePath: t + "/gaps/" + a + "/requirementIds/" + P, schemaPath: "gap.schema.json/properties/requirementIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [h] : e.push(h), s++;
                    }
                  } else {
                    let h = { instancePath: t + "/gaps/" + a + "/requirementIds/" + P, schemaPath: "gap.schema.json/properties/requirementIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [h] : e.push(h), s++;
                  }
                }
                let k = i.length, c;
                if (k > 1) {
                  let P = {};
                  for (; k--; ) {
                    let f = i[k];
                    if (typeof f == "string") {
                      if (typeof P[f] == "number") {
                        c = P[f];
                        let h = { instancePath: t + "/gaps/" + a + "/requirementIds", schemaPath: "gap.schema.json/properties/requirementIds/uniqueItems", keyword: "uniqueItems", params: { i: k, j: c }, message: "must NOT have duplicate items (items ## " + c + " and " + k + " are identical)" };
                        e === null ? e = [h] : e.push(h), s++;
                        break;
                      }
                      P[f] = k;
                    }
                  }
                }
              } else {
                let p = { instancePath: t + "/gaps/" + a + "/requirementIds", schemaPath: "gap.schema.json/properties/requirementIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.testIds !== void 0) {
              let i = r.testIds;
              if (Array.isArray(i)) {
                if (i.length < 0) {
                  let P = { instancePath: t + "/gaps/" + a + "/testIds", schemaPath: "gap.schema.json/properties/testIds/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [P] : e.push(P), s++;
                }
                let p = i.length;
                for (let P = 0; P < p; P++) {
                  let f = i[P];
                  if (typeof f == "string") {
                    if (!M.test(f)) {
                      let h = { instancePath: t + "/gaps/" + a + "/testIds/" + P, schemaPath: "gap.schema.json/properties/testIds/items/pattern", keyword: "pattern", params: { pattern: "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [h] : e.push(h), s++;
                    }
                  } else {
                    let h = { instancePath: t + "/gaps/" + a + "/testIds/" + P, schemaPath: "gap.schema.json/properties/testIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [h] : e.push(h), s++;
                  }
                }
                let k = i.length, c;
                if (k > 1) {
                  let P = {};
                  for (; k--; ) {
                    let f = i[k];
                    if (typeof f == "string") {
                      if (typeof P[f] == "number") {
                        c = P[f];
                        let h = { instancePath: t + "/gaps/" + a + "/testIds", schemaPath: "gap.schema.json/properties/testIds/uniqueItems", keyword: "uniqueItems", params: { i: k, j: c }, message: "must NOT have duplicate items (items ## " + c + " and " + k + " are identical)" };
                        e === null ? e = [h] : e.push(h), s++;
                        break;
                      }
                      P[f] = k;
                    }
                  }
                }
              } else {
                let p = { instancePath: t + "/gaps/" + a + "/testIds", schemaPath: "gap.schema.json/properties/testIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.question !== void 0) {
              let i = r.question;
              if (typeof i == "string") {
                if (j(i) < 1) {
                  let p = { instancePath: t + "/gaps/" + a + "/question", schemaPath: "gap.schema.json/properties/question/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [p] : e.push(p), s++;
                }
              } else {
                let p = { instancePath: t + "/gaps/" + a + "/question", schemaPath: "gap.schema.json/properties/question/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.consequence !== void 0) {
              let i = r.consequence;
              if (typeof i == "string") {
                if (j(i) < 1) {
                  let p = { instancePath: t + "/gaps/" + a + "/consequence", schemaPath: "gap.schema.json/properties/consequence/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [p] : e.push(p), s++;
                }
              } else {
                let p = { instancePath: t + "/gaps/" + a + "/consequence", schemaPath: "gap.schema.json/properties/consequence/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.decisionId !== void 0) {
              let i = r.decisionId, p = s, k = false, c = s;
              if (typeof i == "string") {
                if (!z.test(i)) {
                  let P = { instancePath: t + "/gaps/" + a + "/decisionId", schemaPath: "gap.schema.json/properties/decisionId/anyOf/0/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [P] : e.push(P), s++;
                }
              } else {
                let P = { instancePath: t + "/gaps/" + a + "/decisionId", schemaPath: "gap.schema.json/properties/decisionId/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [P] : e.push(P), s++;
              }
              var o = c === s;
              if (k = k || o, !k) {
                let P = s;
                if (i !== null) {
                  let h = { instancePath: t + "/gaps/" + a + "/decisionId", schemaPath: "gap.schema.json/properties/decisionId/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                  e === null ? e = [h] : e.push(h), s++;
                }
                var o = P === s;
                k = k || o;
              }
              if (k) s = p, e !== null && (p ? e.length = p : e = null);
              else {
                let P = { instancePath: t + "/gaps/" + a + "/decisionId", schemaPath: "gap.schema.json/properties/decisionId/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                e === null ? e = [P] : e.push(P), s++;
              }
            }
          } else {
            let i = { instancePath: t + "/gaps/" + a, schemaPath: "gap.schema.json/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [i] : e.push(i), s++;
          }
        }
        let n = l.length, m;
        if (n > 1) {
          e: for (; n--; ) for (m = n; m--; ) if (L(l[n], l[m])) {
            let a = { instancePath: t + "/gaps", schemaPath: "#/properties/gaps/uniqueItems", keyword: "uniqueItems", params: { i: n, j: m }, message: "must NOT have duplicate items (items ## " + m + " and " + n + " are identical)" };
            e === null ? e = [a] : e.push(a), s++;
            break e;
          }
        }
      } else {
        let d = { instancePath: t + "/gaps", schemaPath: "#/properties/gaps/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [d] : e.push(d), s++;
      }
    }
    if (u.assumptions !== void 0) {
      let l = u.assumptions;
      if (Array.isArray(l)) {
        if (l.length < 0) {
          let a = { instancePath: t + "/assumptions", schemaPath: "#/properties/assumptions/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [a] : e.push(a), s++;
        }
        let d = l.length;
        for (let a = 0; a < d; a++) {
          let r = l[a];
          if (r && typeof r == "object" && !Array.isArray(r)) {
            if (r.decisionId === void 0) {
              let i = { instancePath: t + "/assumptions/" + a, schemaPath: "#/properties/assumptions/items/required", keyword: "required", params: { missingProperty: "decisionId" }, message: "must have required property 'decisionId'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.text === void 0) {
              let i = { instancePath: t + "/assumptions/" + a, schemaPath: "#/properties/assumptions/items/required", keyword: "required", params: { missingProperty: "text" }, message: "must have required property 'text'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            for (let i in r) if (!(i === "decisionId" || i === "text")) {
              let p = { instancePath: t + "/assumptions/" + a, schemaPath: "#/properties/assumptions/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: i }, message: "must NOT have additional properties" };
              e === null ? e = [p] : e.push(p), s++;
            }
            if (r.decisionId !== void 0) {
              let i = r.decisionId;
              if (typeof i == "string") {
                if (!z.test(i)) {
                  let p = { instancePath: t + "/assumptions/" + a + "/decisionId", schemaPath: "#/properties/assumptions/items/properties/decisionId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [p] : e.push(p), s++;
                }
              } else {
                let p = { instancePath: t + "/assumptions/" + a + "/decisionId", schemaPath: "#/properties/assumptions/items/properties/decisionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.text !== void 0) {
              let i = r.text;
              if (typeof i == "string") {
                if (j(i) < 1) {
                  let p = { instancePath: t + "/assumptions/" + a + "/text", schemaPath: "#/properties/assumptions/items/properties/text/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [p] : e.push(p), s++;
                }
              } else {
                let p = { instancePath: t + "/assumptions/" + a + "/text", schemaPath: "#/properties/assumptions/items/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
          } else {
            let i = { instancePath: t + "/assumptions/" + a, schemaPath: "#/properties/assumptions/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [i] : e.push(i), s++;
          }
        }
        let n = l.length, m;
        if (n > 1) {
          e: for (; n--; ) for (m = n; m--; ) if (L(l[n], l[m])) {
            let a = { instancePath: t + "/assumptions", schemaPath: "#/properties/assumptions/uniqueItems", keyword: "uniqueItems", params: { i: n, j: m }, message: "must NOT have duplicate items (items ## " + m + " and " + n + " are identical)" };
            e === null ? e = [a] : e.push(a), s++;
            break e;
          }
        }
      } else {
        let d = { instancePath: t + "/assumptions", schemaPath: "#/properties/assumptions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [d] : e.push(d), s++;
      }
    }
    if (u.decisions !== void 0) {
      let l = u.decisions;
      if (Array.isArray(l)) {
        if (l.length < 0) {
          let a = { instancePath: t + "/decisions", schemaPath: "#/properties/decisions/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [a] : e.push(a), s++;
        }
        let d = l.length;
        for (let a = 0; a < d; a++) {
          let r = l[a];
          if (r && typeof r == "object" && !Array.isArray(r)) {
            if (r.id === void 0) {
              let i = { instancePath: t + "/decisions/" + a, schemaPath: "#/properties/decisions/items/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.gapId === void 0) {
              let i = { instancePath: t + "/decisions/" + a, schemaPath: "#/properties/decisions/items/required", keyword: "required", params: { missingProperty: "gapId" }, message: "must have required property 'gapId'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.kind === void 0) {
              let i = { instancePath: t + "/decisions/" + a, schemaPath: "#/properties/decisions/items/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.actor === void 0) {
              let i = { instancePath: t + "/decisions/" + a, schemaPath: "#/properties/decisions/items/required", keyword: "required", params: { missingProperty: "actor" }, message: "must have required property 'actor'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.rationale === void 0) {
              let i = { instancePath: t + "/decisions/" + a, schemaPath: "#/properties/decisions/items/required", keyword: "required", params: { missingProperty: "rationale" }, message: "must have required property 'rationale'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.value === void 0) {
              let i = { instancePath: t + "/decisions/" + a, schemaPath: "#/properties/decisions/items/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.source === void 0) {
              let i = { instancePath: t + "/decisions/" + a, schemaPath: "#/properties/decisions/items/required", keyword: "required", params: { missingProperty: "source" }, message: "must have required property 'source'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            for (let i in r) if (!(i === "id" || i === "gapId" || i === "kind" || i === "actor" || i === "rationale" || i === "value" || i === "source")) {
              let p = { instancePath: t + "/decisions/" + a, schemaPath: "#/properties/decisions/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: i }, message: "must NOT have additional properties" };
              e === null ? e = [p] : e.push(p), s++;
            }
            if (r.id !== void 0) {
              let i = r.id;
              if (typeof i == "string") {
                if (!z.test(i)) {
                  let p = { instancePath: t + "/decisions/" + a + "/id", schemaPath: "#/properties/decisions/items/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [p] : e.push(p), s++;
                }
              } else {
                let p = { instancePath: t + "/decisions/" + a + "/id", schemaPath: "#/properties/decisions/items/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.gapId !== void 0) {
              let i = r.gapId;
              if (typeof i == "string") {
                if (!z.test(i)) {
                  let p = { instancePath: t + "/decisions/" + a + "/gapId", schemaPath: "#/properties/decisions/items/properties/gapId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [p] : e.push(p), s++;
                }
              } else {
                let p = { instancePath: t + "/decisions/" + a + "/gapId", schemaPath: "#/properties/decisions/items/properties/gapId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.kind !== void 0) {
              let i = r.kind;
              if (!(i === "clarify" || i === "accept_assumption" || i === "defer")) {
                let p = { instancePath: t + "/decisions/" + a + "/kind", schemaPath: "#/properties/decisions/items/properties/kind/enum", keyword: "enum", params: { allowedValues: ae.properties.decisions.items.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.actor !== void 0) {
              let i = r.actor;
              if (typeof i == "string") {
                if (j(i) < 1) {
                  let p = { instancePath: t + "/decisions/" + a + "/actor", schemaPath: "#/properties/decisions/items/properties/actor/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [p] : e.push(p), s++;
                }
              } else {
                let p = { instancePath: t + "/decisions/" + a + "/actor", schemaPath: "#/properties/decisions/items/properties/actor/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.rationale !== void 0) {
              let i = r.rationale;
              if (typeof i == "string") {
                if (j(i) < 1) {
                  let p = { instancePath: t + "/decisions/" + a + "/rationale", schemaPath: "#/properties/decisions/items/properties/rationale/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [p] : e.push(p), s++;
                }
              } else {
                let p = { instancePath: t + "/decisions/" + a + "/rationale", schemaPath: "#/properties/decisions/items/properties/rationale/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.value !== void 0) {
              let i = r.value;
              if (typeof i == "string") {
                if (j(i) < 1) {
                  let p = { instancePath: t + "/decisions/" + a + "/value", schemaPath: "#/properties/decisions/items/properties/value/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [p] : e.push(p), s++;
                }
              } else {
                let p = { instancePath: t + "/decisions/" + a + "/value", schemaPath: "#/properties/decisions/items/properties/value/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.source !== void 0) {
              let i = r.source, p = s, k = false, c = s;
              if (typeof i == "string") {
                if (j(i) < 1) {
                  let P = { instancePath: t + "/decisions/" + a + "/source", schemaPath: "#/properties/decisions/items/properties/source/anyOf/0/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [P] : e.push(P), s++;
                }
              } else {
                let P = { instancePath: t + "/decisions/" + a + "/source", schemaPath: "#/properties/decisions/items/properties/source/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [P] : e.push(P), s++;
              }
              var y = c === s;
              if (k = k || y, !k) {
                let P = s;
                if (i !== null) {
                  let h = { instancePath: t + "/decisions/" + a + "/source", schemaPath: "#/properties/decisions/items/properties/source/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                  e === null ? e = [h] : e.push(h), s++;
                }
                var y = P === s;
                k = k || y;
              }
              if (k) s = p, e !== null && (p ? e.length = p : e = null);
              else {
                let P = { instancePath: t + "/decisions/" + a + "/source", schemaPath: "#/properties/decisions/items/properties/source/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                e === null ? e = [P] : e.push(P), s++;
              }
            }
          } else {
            let i = { instancePath: t + "/decisions/" + a, schemaPath: "#/properties/decisions/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [i] : e.push(i), s++;
          }
        }
        let n = l.length, m;
        if (n > 1) {
          e: for (; n--; ) for (m = n; m--; ) if (L(l[n], l[m])) {
            let a = { instancePath: t + "/decisions", schemaPath: "#/properties/decisions/uniqueItems", keyword: "uniqueItems", params: { i: n, j: m }, message: "must NOT have duplicate items (items ## " + m + " and " + n + " are identical)" };
            e === null ? e = [a] : e.push(a), s++;
            break e;
          }
        }
      } else {
        let d = { instancePath: t + "/decisions", schemaPath: "#/properties/decisions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [d] : e.push(d), s++;
      }
    }
    if (u.coverage !== void 0) {
      let l = u.coverage;
      if (Array.isArray(l)) {
        if (l.length < 1) {
          let a = { instancePath: t + "/coverage", schemaPath: "#/properties/coverage/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [a] : e.push(a), s++;
        }
        let d = l.length;
        for (let a = 0; a < d; a++) {
          let r = l[a];
          if (r && typeof r == "object" && !Array.isArray(r)) {
            if (r.requirementId === void 0) {
              let i = { instancePath: t + "/coverage/" + a, schemaPath: "#/properties/coverage/items/required", keyword: "required", params: { missingProperty: "requirementId" }, message: "must have required property 'requirementId'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.testIds === void 0) {
              let i = { instancePath: t + "/coverage/" + a, schemaPath: "#/properties/coverage/items/required", keyword: "required", params: { missingProperty: "testIds" }, message: "must have required property 'testIds'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            if (r.status === void 0) {
              let i = { instancePath: t + "/coverage/" + a, schemaPath: "#/properties/coverage/items/required", keyword: "required", params: { missingProperty: "status" }, message: "must have required property 'status'" };
              e === null ? e = [i] : e.push(i), s++;
            }
            for (let i in r) if (!(i === "requirementId" || i === "testIds" || i === "status")) {
              let p = { instancePath: t + "/coverage/" + a, schemaPath: "#/properties/coverage/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: i }, message: "must NOT have additional properties" };
              e === null ? e = [p] : e.push(p), s++;
            }
            if (r.requirementId !== void 0) {
              let i = r.requirementId;
              if (typeof i == "string") {
                if (!z.test(i)) {
                  let p = { instancePath: t + "/coverage/" + a + "/requirementId", schemaPath: "#/properties/coverage/items/properties/requirementId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [p] : e.push(p), s++;
                }
              } else {
                let p = { instancePath: t + "/coverage/" + a + "/requirementId", schemaPath: "#/properties/coverage/items/properties/requirementId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.testIds !== void 0) {
              let i = r.testIds;
              if (Array.isArray(i)) {
                if (i.length < 0) {
                  let P = { instancePath: t + "/coverage/" + a + "/testIds", schemaPath: "#/properties/coverage/items/properties/testIds/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [P] : e.push(P), s++;
                }
                let p = i.length;
                for (let P = 0; P < p; P++) {
                  let f = i[P];
                  if (typeof f == "string") {
                    if (!z.test(f)) {
                      let h = { instancePath: t + "/coverage/" + a + "/testIds/" + P, schemaPath: "#/properties/coverage/items/properties/testIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [h] : e.push(h), s++;
                    }
                  } else {
                    let h = { instancePath: t + "/coverage/" + a + "/testIds/" + P, schemaPath: "#/properties/coverage/items/properties/testIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [h] : e.push(h), s++;
                  }
                }
                let k = i.length, c;
                if (k > 1) {
                  let P = {};
                  for (; k--; ) {
                    let f = i[k];
                    if (typeof f == "string") {
                      if (typeof P[f] == "number") {
                        c = P[f];
                        let h = { instancePath: t + "/coverage/" + a + "/testIds", schemaPath: "#/properties/coverage/items/properties/testIds/uniqueItems", keyword: "uniqueItems", params: { i: k, j: c }, message: "must NOT have duplicate items (items ## " + c + " and " + k + " are identical)" };
                        e === null ? e = [h] : e.push(h), s++;
                        break;
                      }
                      P[f] = k;
                    }
                  }
                }
              } else {
                let p = { instancePath: t + "/coverage/" + a + "/testIds", schemaPath: "#/properties/coverage/items/properties/testIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
            if (r.status !== void 0) {
              let i = r.status;
              if (!(i === "planned" || i === "blocked" || i === "deferred")) {
                let p = { instancePath: t + "/coverage/" + a + "/status", schemaPath: "#/properties/coverage/items/properties/status/enum", keyword: "enum", params: { allowedValues: ae.properties.coverage.items.properties.status.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [p] : e.push(p), s++;
              }
            }
          } else {
            let i = { instancePath: t + "/coverage/" + a, schemaPath: "#/properties/coverage/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [i] : e.push(i), s++;
          }
        }
        let n = l.length, m;
        if (n > 1) {
          e: for (; n--; ) for (m = n; m--; ) if (L(l[n], l[m])) {
            let a = { instancePath: t + "/coverage", schemaPath: "#/properties/coverage/uniqueItems", keyword: "uniqueItems", params: { i: n, j: m }, message: "must NOT have duplicate items (items ## " + m + " and " + n + " are identical)" };
            e === null ? e = [a] : e.push(a), s++;
            break e;
          }
        }
      } else {
        let d = { instancePath: t + "/coverage", schemaPath: "#/properties/coverage/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [d] : e.push(d), s++;
      }
    }
  } else {
    let l = { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [l] : e.push(l), s++;
  }
  return Ne.errors = e, s === 0;
}
var hs = $e;
var E = { $schema: "http://json-schema.org/draft-07/schema#", $id: "profile.schema.json", type: "object", properties: { contractVersion: { const: "toolkit-2" }, targetId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, revision: { type: "integer", minimum: 1 }, entryPoints: { type: "array", items: { type: "object", properties: { name: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, kind: { enum: ["url", "command", "value"] }, purpose: { type: "string", minLength: 1 } }, required: ["name", "kind", "purpose"], additionalProperties: false }, minItems: 1, uniqueItems: true }, capabilities: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, tools: { type: "array", items: { type: "object", properties: { name: { type: "string", minLength: 1 }, kind: { enum: ["cli", "mcp", "skill"] }, purpose: { type: "string", minLength: 1 }, version: { type: "string", minLength: 1 }, reachable: { type: "boolean" } }, required: ["name", "kind", "purpose", "reachable"], additionalProperties: false }, minItems: 0, uniqueItems: true }, authentication: { type: "object", properties: { kind: { enum: ["none", "environment", "browser_session"] }, references: { type: "array", items: { type: "string", minLength: 1 }, minItems: 0, uniqueItems: true } }, required: ["kind", "references"], additionalProperties: false }, allowedOperations: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, startup: { type: "object", properties: { owner: { enum: ["factory", "checkmate"] }, command: { anyOf: [{ type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true }, { type: "null" }] } }, required: ["owner", "command"], additionalProperties: false }, cleanup: { type: "string", minLength: 1 }, reset: { type: "object", properties: { owner: { enum: ["factory", "checkmate"] }, command: { anyOf: [{ type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true }, { type: "null" }] } }, required: ["owner", "command"], additionalProperties: false }, readyForLiveExecution: { type: "boolean" }, approvals: { type: "object", properties: { plan: { enum: ["required", "none"] }, result: { enum: ["required", "none"] } }, required: ["plan", "result"], additionalProperties: false } }, required: ["contractVersion", "targetId", "revision", "entryPoints", "capabilities", "tools", "authentication", "allowedOperations", "startup", "cleanup", "readyForLiveExecution"], additionalProperties: false };
function $e(u, { instancePath: t = "", parentData: _, parentDataProperty: Z, rootData: N = u } = {}) {
  let e = null, s = 0;
  if (u && typeof u == "object" && !Array.isArray(u)) {
    if (u.contractVersion === void 0) {
      let o = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "contractVersion" }, message: "must have required property 'contractVersion'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.targetId === void 0) {
      let o = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "targetId" }, message: "must have required property 'targetId'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.revision === void 0) {
      let o = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "revision" }, message: "must have required property 'revision'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.entryPoints === void 0) {
      let o = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entryPoints" }, message: "must have required property 'entryPoints'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.capabilities === void 0) {
      let o = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "capabilities" }, message: "must have required property 'capabilities'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.tools === void 0) {
      let o = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "tools" }, message: "must have required property 'tools'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.authentication === void 0) {
      let o = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "authentication" }, message: "must have required property 'authentication'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.allowedOperations === void 0) {
      let o = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "allowedOperations" }, message: "must have required property 'allowedOperations'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.startup === void 0) {
      let o = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "startup" }, message: "must have required property 'startup'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.cleanup === void 0) {
      let o = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "cleanup" }, message: "must have required property 'cleanup'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.readyForLiveExecution === void 0) {
      let o = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "readyForLiveExecution" }, message: "must have required property 'readyForLiveExecution'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    for (let o in u) if (!C.call(E.properties, o)) {
      let y = { instancePath: t, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: o }, message: "must NOT have additional properties" };
      e === null ? e = [y] : e.push(y), s++;
    }
    if (u.contractVersion !== void 0 && u.contractVersion !== "toolkit-2") {
      let o = { instancePath: t + "/contractVersion", schemaPath: "#/properties/contractVersion/const", keyword: "const", params: { allowedValue: "toolkit-2" }, message: "must be equal to constant" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.targetId !== void 0) {
      let o = u.targetId;
      if (typeof o == "string") {
        if (!z.test(o)) {
          let y = { instancePath: t + "/targetId", schemaPath: "#/properties/targetId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [y] : e.push(y), s++;
        }
      } else {
        let y = { instancePath: t + "/targetId", schemaPath: "#/properties/targetId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
    if (u.revision !== void 0) {
      let o = u.revision;
      if (!(typeof o == "number" && !(o % 1) && !isNaN(o) && isFinite(o))) {
        let y = { instancePath: t + "/revision", schemaPath: "#/properties/revision/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        e === null ? e = [y] : e.push(y), s++;
      }
      if (typeof o == "number" && isFinite(o) && (o < 1 || isNaN(o))) {
        let y = { instancePath: t + "/revision", schemaPath: "#/properties/revision/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
    if (u.entryPoints !== void 0) {
      let o = u.entryPoints;
      if (Array.isArray(o)) {
        if (o.length < 1) {
          let n = { instancePath: t + "/entryPoints", schemaPath: "#/properties/entryPoints/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [n] : e.push(n), s++;
        }
        let y = o.length;
        for (let n = 0; n < y; n++) {
          let m = o[n];
          if (m && typeof m == "object" && !Array.isArray(m)) {
            if (m.name === void 0) {
              let a = { instancePath: t + "/entryPoints/" + n, schemaPath: "#/properties/entryPoints/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.kind === void 0) {
              let a = { instancePath: t + "/entryPoints/" + n, schemaPath: "#/properties/entryPoints/items/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.purpose === void 0) {
              let a = { instancePath: t + "/entryPoints/" + n, schemaPath: "#/properties/entryPoints/items/required", keyword: "required", params: { missingProperty: "purpose" }, message: "must have required property 'purpose'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            for (let a in m) if (!(a === "name" || a === "kind" || a === "purpose")) {
              let r = { instancePath: t + "/entryPoints/" + n, schemaPath: "#/properties/entryPoints/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: a }, message: "must NOT have additional properties" };
              e === null ? e = [r] : e.push(r), s++;
            }
            if (m.name !== void 0) {
              let a = m.name;
              if (typeof a == "string") {
                if (!z.test(a)) {
                  let r = { instancePath: t + "/entryPoints/" + n + "/name", schemaPath: "#/properties/entryPoints/items/properties/name/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/entryPoints/" + n + "/name", schemaPath: "#/properties/entryPoints/items/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.kind !== void 0) {
              let a = m.kind;
              if (!(a === "url" || a === "command" || a === "value")) {
                let r = { instancePath: t + "/entryPoints/" + n + "/kind", schemaPath: "#/properties/entryPoints/items/properties/kind/enum", keyword: "enum", params: { allowedValues: E.properties.entryPoints.items.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.purpose !== void 0) {
              let a = m.purpose;
              if (typeof a == "string") {
                if (j(a) < 1) {
                  let r = { instancePath: t + "/entryPoints/" + n + "/purpose", schemaPath: "#/properties/entryPoints/items/properties/purpose/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/entryPoints/" + n + "/purpose", schemaPath: "#/properties/entryPoints/items/properties/purpose/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
          } else {
            let a = { instancePath: t + "/entryPoints/" + n, schemaPath: "#/properties/entryPoints/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [a] : e.push(a), s++;
          }
        }
        let l = o.length, d;
        if (l > 1) {
          e: for (; l--; ) for (d = l; d--; ) if (L(o[l], o[d])) {
            let n = { instancePath: t + "/entryPoints", schemaPath: "#/properties/entryPoints/uniqueItems", keyword: "uniqueItems", params: { i: l, j: d }, message: "must NOT have duplicate items (items ## " + d + " and " + l + " are identical)" };
            e === null ? e = [n] : e.push(n), s++;
            break e;
          }
        }
      } else {
        let y = { instancePath: t + "/entryPoints", schemaPath: "#/properties/entryPoints/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
    if (u.capabilities !== void 0) {
      let o = u.capabilities;
      if (Array.isArray(o)) {
        if (o.length < 1) {
          let n = { instancePath: t + "/capabilities", schemaPath: "#/properties/capabilities/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [n] : e.push(n), s++;
        }
        let y = o.length;
        for (let n = 0; n < y; n++) {
          let m = o[n];
          if (typeof m == "string") {
            if (!z.test(m)) {
              let a = { instancePath: t + "/capabilities/" + n, schemaPath: "#/properties/capabilities/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [a] : e.push(a), s++;
            }
          } else {
            let a = { instancePath: t + "/capabilities/" + n, schemaPath: "#/properties/capabilities/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [a] : e.push(a), s++;
          }
        }
        let l = o.length, d;
        if (l > 1) {
          let n = {};
          for (; l--; ) {
            let m = o[l];
            if (typeof m == "string") {
              if (typeof n[m] == "number") {
                d = n[m];
                let a = { instancePath: t + "/capabilities", schemaPath: "#/properties/capabilities/uniqueItems", keyword: "uniqueItems", params: { i: l, j: d }, message: "must NOT have duplicate items (items ## " + d + " and " + l + " are identical)" };
                e === null ? e = [a] : e.push(a), s++;
                break;
              }
              n[m] = l;
            }
          }
        }
      } else {
        let y = { instancePath: t + "/capabilities", schemaPath: "#/properties/capabilities/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
    if (u.tools !== void 0) {
      let o = u.tools;
      if (Array.isArray(o)) {
        if (o.length < 0) {
          let n = { instancePath: t + "/tools", schemaPath: "#/properties/tools/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [n] : e.push(n), s++;
        }
        let y = o.length;
        for (let n = 0; n < y; n++) {
          let m = o[n];
          if (m && typeof m == "object" && !Array.isArray(m)) {
            if (m.name === void 0) {
              let a = { instancePath: t + "/tools/" + n, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.kind === void 0) {
              let a = { instancePath: t + "/tools/" + n, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.purpose === void 0) {
              let a = { instancePath: t + "/tools/" + n, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "purpose" }, message: "must have required property 'purpose'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            if (m.reachable === void 0) {
              let a = { instancePath: t + "/tools/" + n, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "reachable" }, message: "must have required property 'reachable'" };
              e === null ? e = [a] : e.push(a), s++;
            }
            for (let a in m) if (!(a === "name" || a === "kind" || a === "purpose" || a === "version" || a === "reachable")) {
              let r = { instancePath: t + "/tools/" + n, schemaPath: "#/properties/tools/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: a }, message: "must NOT have additional properties" };
              e === null ? e = [r] : e.push(r), s++;
            }
            if (m.name !== void 0) {
              let a = m.name;
              if (typeof a == "string") {
                if (j(a) < 1) {
                  let r = { instancePath: t + "/tools/" + n + "/name", schemaPath: "#/properties/tools/items/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/tools/" + n + "/name", schemaPath: "#/properties/tools/items/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.kind !== void 0) {
              let a = m.kind;
              if (!(a === "cli" || a === "mcp" || a === "skill")) {
                let r = { instancePath: t + "/tools/" + n + "/kind", schemaPath: "#/properties/tools/items/properties/kind/enum", keyword: "enum", params: { allowedValues: E.properties.tools.items.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.purpose !== void 0) {
              let a = m.purpose;
              if (typeof a == "string") {
                if (j(a) < 1) {
                  let r = { instancePath: t + "/tools/" + n + "/purpose", schemaPath: "#/properties/tools/items/properties/purpose/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/tools/" + n + "/purpose", schemaPath: "#/properties/tools/items/properties/purpose/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.version !== void 0) {
              let a = m.version;
              if (typeof a == "string") {
                if (j(a) < 1) {
                  let r = { instancePath: t + "/tools/" + n + "/version", schemaPath: "#/properties/tools/items/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/tools/" + n + "/version", schemaPath: "#/properties/tools/items/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            if (m.reachable !== void 0 && typeof m.reachable != "boolean") {
              let a = { instancePath: t + "/tools/" + n + "/reachable", schemaPath: "#/properties/tools/items/properties/reachable/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
              e === null ? e = [a] : e.push(a), s++;
            }
          } else {
            let a = { instancePath: t + "/tools/" + n, schemaPath: "#/properties/tools/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [a] : e.push(a), s++;
          }
        }
        let l = o.length, d;
        if (l > 1) {
          e: for (; l--; ) for (d = l; d--; ) if (L(o[l], o[d])) {
            let n = { instancePath: t + "/tools", schemaPath: "#/properties/tools/uniqueItems", keyword: "uniqueItems", params: { i: l, j: d }, message: "must NOT have duplicate items (items ## " + d + " and " + l + " are identical)" };
            e === null ? e = [n] : e.push(n), s++;
            break e;
          }
        }
      } else {
        let y = { instancePath: t + "/tools", schemaPath: "#/properties/tools/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
    if (u.authentication !== void 0) {
      let o = u.authentication;
      if (o && typeof o == "object" && !Array.isArray(o)) {
        if (o.kind === void 0) {
          let y = { instancePath: t + "/authentication", schemaPath: "#/properties/authentication/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
          e === null ? e = [y] : e.push(y), s++;
        }
        if (o.references === void 0) {
          let y = { instancePath: t + "/authentication", schemaPath: "#/properties/authentication/required", keyword: "required", params: { missingProperty: "references" }, message: "must have required property 'references'" };
          e === null ? e = [y] : e.push(y), s++;
        }
        for (let y in o) if (!(y === "kind" || y === "references")) {
          let l = { instancePath: t + "/authentication", schemaPath: "#/properties/authentication/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: y }, message: "must NOT have additional properties" };
          e === null ? e = [l] : e.push(l), s++;
        }
        if (o.kind !== void 0) {
          let y = o.kind;
          if (!(y === "none" || y === "environment" || y === "browser_session")) {
            let l = { instancePath: t + "/authentication/kind", schemaPath: "#/properties/authentication/properties/kind/enum", keyword: "enum", params: { allowedValues: E.properties.authentication.properties.kind.enum }, message: "must be equal to one of the allowed values" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
        if (o.references !== void 0) {
          let y = o.references;
          if (Array.isArray(y)) {
            if (y.length < 0) {
              let m = { instancePath: t + "/authentication/references", schemaPath: "#/properties/authentication/properties/references/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
              e === null ? e = [m] : e.push(m), s++;
            }
            let l = y.length;
            for (let m = 0; m < l; m++) {
              let a = y[m];
              if (typeof a == "string") {
                if (j(a) < 1) {
                  let r = { instancePath: t + "/authentication/references/" + m, schemaPath: "#/properties/authentication/properties/references/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [r] : e.push(r), s++;
                }
              } else {
                let r = { instancePath: t + "/authentication/references/" + m, schemaPath: "#/properties/authentication/properties/references/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [r] : e.push(r), s++;
              }
            }
            let d = y.length, n;
            if (d > 1) {
              let m = {};
              for (; d--; ) {
                let a = y[d];
                if (typeof a == "string") {
                  if (typeof m[a] == "number") {
                    n = m[a];
                    let r = { instancePath: t + "/authentication/references", schemaPath: "#/properties/authentication/properties/references/uniqueItems", keyword: "uniqueItems", params: { i: d, j: n }, message: "must NOT have duplicate items (items ## " + n + " and " + d + " are identical)" };
                    e === null ? e = [r] : e.push(r), s++;
                    break;
                  }
                  m[a] = d;
                }
              }
            }
          } else {
            let l = { instancePath: t + "/authentication/references", schemaPath: "#/properties/authentication/properties/references/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
      } else {
        let y = { instancePath: t + "/authentication", schemaPath: "#/properties/authentication/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
    if (u.allowedOperations !== void 0) {
      let o = u.allowedOperations;
      if (Array.isArray(o)) {
        if (o.length < 1) {
          let n = { instancePath: t + "/allowedOperations", schemaPath: "#/properties/allowedOperations/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [n] : e.push(n), s++;
        }
        let y = o.length;
        for (let n = 0; n < y; n++) {
          let m = o[n];
          if (typeof m == "string") {
            if (!z.test(m)) {
              let a = { instancePath: t + "/allowedOperations/" + n, schemaPath: "#/properties/allowedOperations/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [a] : e.push(a), s++;
            }
          } else {
            let a = { instancePath: t + "/allowedOperations/" + n, schemaPath: "#/properties/allowedOperations/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [a] : e.push(a), s++;
          }
        }
        let l = o.length, d;
        if (l > 1) {
          let n = {};
          for (; l--; ) {
            let m = o[l];
            if (typeof m == "string") {
              if (typeof n[m] == "number") {
                d = n[m];
                let a = { instancePath: t + "/allowedOperations", schemaPath: "#/properties/allowedOperations/uniqueItems", keyword: "uniqueItems", params: { i: l, j: d }, message: "must NOT have duplicate items (items ## " + d + " and " + l + " are identical)" };
                e === null ? e = [a] : e.push(a), s++;
                break;
              }
              n[m] = l;
            }
          }
        }
      } else {
        let y = { instancePath: t + "/allowedOperations", schemaPath: "#/properties/allowedOperations/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
    if (u.startup !== void 0) {
      let o = u.startup;
      if (o && typeof o == "object" && !Array.isArray(o)) {
        if (o.owner === void 0) {
          let y = { instancePath: t + "/startup", schemaPath: "#/properties/startup/required", keyword: "required", params: { missingProperty: "owner" }, message: "must have required property 'owner'" };
          e === null ? e = [y] : e.push(y), s++;
        }
        if (o.command === void 0) {
          let y = { instancePath: t + "/startup", schemaPath: "#/properties/startup/required", keyword: "required", params: { missingProperty: "command" }, message: "must have required property 'command'" };
          e === null ? e = [y] : e.push(y), s++;
        }
        for (let y in o) if (!(y === "owner" || y === "command")) {
          let l = { instancePath: t + "/startup", schemaPath: "#/properties/startup/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: y }, message: "must NOT have additional properties" };
          e === null ? e = [l] : e.push(l), s++;
        }
        if (o.owner !== void 0) {
          let y = o.owner;
          if (!(y === "factory" || y === "checkmate")) {
            let l = { instancePath: t + "/startup/owner", schemaPath: "#/properties/startup/properties/owner/enum", keyword: "enum", params: { allowedValues: E.properties.startup.properties.owner.enum }, message: "must be equal to one of the allowed values" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
        if (o.command !== void 0) {
          let y = o.command, l = s, d = false, n = s;
          if (Array.isArray(y)) {
            if (y.length < 1) {
              let i = { instancePath: t + "/startup/command", schemaPath: "#/properties/startup/properties/command/anyOf/0/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
              e === null ? e = [i] : e.push(i), s++;
            }
            let m = y.length;
            for (let i = 0; i < m; i++) {
              let p = y[i];
              if (typeof p == "string") {
                if (j(p) < 1) {
                  let k = { instancePath: t + "/startup/command/" + i, schemaPath: "#/properties/startup/properties/command/anyOf/0/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [k] : e.push(k), s++;
                }
              } else {
                let k = { instancePath: t + "/startup/command/" + i, schemaPath: "#/properties/startup/properties/command/anyOf/0/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [k] : e.push(k), s++;
              }
            }
            let a = y.length, r;
            if (a > 1) {
              let i = {};
              for (; a--; ) {
                let p = y[a];
                if (typeof p == "string") {
                  if (typeof i[p] == "number") {
                    r = i[p];
                    let k = { instancePath: t + "/startup/command", schemaPath: "#/properties/startup/properties/command/anyOf/0/uniqueItems", keyword: "uniqueItems", params: { i: a, j: r }, message: "must NOT have duplicate items (items ## " + r + " and " + a + " are identical)" };
                    e === null ? e = [k] : e.push(k), s++;
                    break;
                  }
                  i[p] = a;
                }
              }
            }
          } else {
            let m = { instancePath: t + "/startup/command", schemaPath: "#/properties/startup/properties/command/anyOf/0/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            e === null ? e = [m] : e.push(m), s++;
          }
          var O = n === s;
          if (d = d || O, !d) {
            let m = s;
            if (y !== null) {
              let r = { instancePath: t + "/startup/command", schemaPath: "#/properties/startup/properties/command/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
              e === null ? e = [r] : e.push(r), s++;
            }
            var O = m === s;
            d = d || O;
          }
          if (d) s = l, e !== null && (l ? e.length = l : e = null);
          else {
            let m = { instancePath: t + "/startup/command", schemaPath: "#/properties/startup/properties/command/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
      } else {
        let y = { instancePath: t + "/startup", schemaPath: "#/properties/startup/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
    if (u.cleanup !== void 0) {
      let o = u.cleanup;
      if (typeof o == "string") {
        if (j(o) < 1) {
          let y = { instancePath: t + "/cleanup", schemaPath: "#/properties/cleanup/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [y] : e.push(y), s++;
        }
      } else {
        let y = { instancePath: t + "/cleanup", schemaPath: "#/properties/cleanup/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
    if (u.reset !== void 0) {
      let o = u.reset;
      if (o && typeof o == "object" && !Array.isArray(o)) {
        if (o.owner === void 0) {
          let y = { instancePath: t + "/reset", schemaPath: "#/properties/reset/required", keyword: "required", params: { missingProperty: "owner" }, message: "must have required property 'owner'" };
          e === null ? e = [y] : e.push(y), s++;
        }
        if (o.command === void 0) {
          let y = { instancePath: t + "/reset", schemaPath: "#/properties/reset/required", keyword: "required", params: { missingProperty: "command" }, message: "must have required property 'command'" };
          e === null ? e = [y] : e.push(y), s++;
        }
        for (let y in o) if (!(y === "owner" || y === "command")) {
          let l = { instancePath: t + "/reset", schemaPath: "#/properties/reset/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: y }, message: "must NOT have additional properties" };
          e === null ? e = [l] : e.push(l), s++;
        }
        if (o.owner !== void 0) {
          let y = o.owner;
          if (!(y === "factory" || y === "checkmate")) {
            let l = { instancePath: t + "/reset/owner", schemaPath: "#/properties/reset/properties/owner/enum", keyword: "enum", params: { allowedValues: E.properties.reset.properties.owner.enum }, message: "must be equal to one of the allowed values" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
        if (o.command !== void 0) {
          let y = o.command, l = s, d = false, n = s;
          if (Array.isArray(y)) {
            if (y.length < 1) {
              let i = { instancePath: t + "/reset/command", schemaPath: "#/properties/reset/properties/command/anyOf/0/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
              e === null ? e = [i] : e.push(i), s++;
            }
            let m = y.length;
            for (let i = 0; i < m; i++) {
              let p = y[i];
              if (typeof p == "string") {
                if (j(p) < 1) {
                  let k = { instancePath: t + "/reset/command/" + i, schemaPath: "#/properties/reset/properties/command/anyOf/0/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [k] : e.push(k), s++;
                }
              } else {
                let k = { instancePath: t + "/reset/command/" + i, schemaPath: "#/properties/reset/properties/command/anyOf/0/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [k] : e.push(k), s++;
              }
            }
            let a = y.length, r;
            if (a > 1) {
              let i = {};
              for (; a--; ) {
                let p = y[a];
                if (typeof p == "string") {
                  if (typeof i[p] == "number") {
                    r = i[p];
                    let k = { instancePath: t + "/reset/command", schemaPath: "#/properties/reset/properties/command/anyOf/0/uniqueItems", keyword: "uniqueItems", params: { i: a, j: r }, message: "must NOT have duplicate items (items ## " + r + " and " + a + " are identical)" };
                    e === null ? e = [k] : e.push(k), s++;
                    break;
                  }
                  i[p] = a;
                }
              }
            }
          } else {
            let m = { instancePath: t + "/reset/command", schemaPath: "#/properties/reset/properties/command/anyOf/0/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            e === null ? e = [m] : e.push(m), s++;
          }
          var g = n === s;
          if (d = d || g, !d) {
            let m = s;
            if (y !== null) {
              let r = { instancePath: t + "/reset/command", schemaPath: "#/properties/reset/properties/command/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
              e === null ? e = [r] : e.push(r), s++;
            }
            var g = m === s;
            d = d || g;
          }
          if (d) s = l, e !== null && (l ? e.length = l : e = null);
          else {
            let m = { instancePath: t + "/reset/command", schemaPath: "#/properties/reset/properties/command/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
      } else {
        let y = { instancePath: t + "/reset", schemaPath: "#/properties/reset/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
    if (u.readyForLiveExecution !== void 0 && typeof u.readyForLiveExecution != "boolean") {
      let o = { instancePath: t + "/readyForLiveExecution", schemaPath: "#/properties/readyForLiveExecution/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (u.approvals !== void 0) {
      let o = u.approvals;
      if (o && typeof o == "object" && !Array.isArray(o)) {
        if (o.plan === void 0) {
          let y = { instancePath: t + "/approvals", schemaPath: "#/properties/approvals/required", keyword: "required", params: { missingProperty: "plan" }, message: "must have required property 'plan'" };
          e === null ? e = [y] : e.push(y), s++;
        }
        if (o.result === void 0) {
          let y = { instancePath: t + "/approvals", schemaPath: "#/properties/approvals/required", keyword: "required", params: { missingProperty: "result" }, message: "must have required property 'result'" };
          e === null ? e = [y] : e.push(y), s++;
        }
        for (let y in o) if (!(y === "plan" || y === "result")) {
          let l = { instancePath: t + "/approvals", schemaPath: "#/properties/approvals/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: y }, message: "must NOT have additional properties" };
          e === null ? e = [l] : e.push(l), s++;
        }
        if (o.plan !== void 0) {
          let y = o.plan;
          if (!(y === "required" || y === "none")) {
            let l = { instancePath: t + "/approvals/plan", schemaPath: "#/properties/approvals/properties/plan/enum", keyword: "enum", params: { allowedValues: E.properties.approvals.properties.plan.enum }, message: "must be equal to one of the allowed values" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
        if (o.result !== void 0) {
          let y = o.result;
          if (!(y === "required" || y === "none")) {
            let l = { instancePath: t + "/approvals/result", schemaPath: "#/properties/approvals/properties/result/enum", keyword: "enum", params: { allowedValues: E.properties.approvals.properties.result.enum }, message: "must be equal to one of the allowed values" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
      } else {
        let y = { instancePath: t + "/approvals", schemaPath: "#/properties/approvals/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [y] : e.push(y), s++;
      }
    }
  } else {
    let o = { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [o] : e.push(o), s++;
  }
  return $e.errors = e, s === 0;
}
var fs = Te;
var es = { $schema: "http://json-schema.org/draft-07/schema#", $id: "response.schema.json", type: "object", properties: { status: { enum: ["completed", "needs_decision", "interrupted", "operational_error", "rejected"] }, subject: { type: "string", minLength: 1 }, reasons: { type: "array", items: { type: "string", minLength: 1 }, minItems: 0, uniqueItems: true } }, required: ["status", "subject", "reasons"], additionalProperties: false };
function Te(u, { instancePath: t = "", parentData: _, parentDataProperty: Z, rootData: N = u } = {}) {
  let e = null, s = 0;
  if (u && typeof u == "object" && !Array.isArray(u)) {
    if (u.status === void 0) {
      let O = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "status" }, message: "must have required property 'status'" };
      e === null ? e = [O] : e.push(O), s++;
    }
    if (u.subject === void 0) {
      let O = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "subject" }, message: "must have required property 'subject'" };
      e === null ? e = [O] : e.push(O), s++;
    }
    if (u.reasons === void 0) {
      let O = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "reasons" }, message: "must have required property 'reasons'" };
      e === null ? e = [O] : e.push(O), s++;
    }
    for (let O in u) if (!(O === "status" || O === "subject" || O === "reasons")) {
      let g = { instancePath: t, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: O }, message: "must NOT have additional properties" };
      e === null ? e = [g] : e.push(g), s++;
    }
    if (u.status !== void 0) {
      let O = u.status;
      if (!(O === "completed" || O === "needs_decision" || O === "interrupted" || O === "operational_error" || O === "rejected")) {
        let g = { instancePath: t + "/status", schemaPath: "#/properties/status/enum", keyword: "enum", params: { allowedValues: es.properties.status.enum }, message: "must be equal to one of the allowed values" };
        e === null ? e = [g] : e.push(g), s++;
      }
    }
    if (u.subject !== void 0) {
      let O = u.subject;
      if (typeof O == "string") {
        if (j(O) < 1) {
          let g = { instancePath: t + "/subject", schemaPath: "#/properties/subject/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [g] : e.push(g), s++;
        }
      } else {
        let g = { instancePath: t + "/subject", schemaPath: "#/properties/subject/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [g] : e.push(g), s++;
      }
    }
    if (u.reasons !== void 0) {
      let O = u.reasons;
      if (Array.isArray(O)) {
        if (O.length < 0) {
          let l = { instancePath: t + "/reasons", schemaPath: "#/properties/reasons/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [l] : e.push(l), s++;
        }
        let g = O.length;
        for (let l = 0; l < g; l++) {
          let d = O[l];
          if (typeof d == "string") {
            if (j(d) < 1) {
              let n = { instancePath: t + "/reasons/" + l, schemaPath: "#/properties/reasons/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              e === null ? e = [n] : e.push(n), s++;
            }
          } else {
            let n = { instancePath: t + "/reasons/" + l, schemaPath: "#/properties/reasons/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [n] : e.push(n), s++;
          }
        }
        let o = O.length, y;
        if (o > 1) {
          let l = {};
          for (; o--; ) {
            let d = O[o];
            if (typeof d == "string") {
              if (typeof l[d] == "number") {
                y = l[d];
                let n = { instancePath: t + "/reasons", schemaPath: "#/properties/reasons/uniqueItems", keyword: "uniqueItems", params: { i: o, j: y }, message: "must NOT have duplicate items (items ## " + y + " and " + o + " are identical)" };
                e === null ? e = [n] : e.push(n), s++;
                break;
              }
              l[d] = o;
            }
          }
        }
      } else {
        let g = { instancePath: t + "/reasons", schemaPath: "#/properties/reasons/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [g] : e.push(g), s++;
      }
    }
  } else {
    let O = { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [O] : e.push(O), s++;
  }
  return Te.errors = e, s === 0;
}
var ys = Le;
var V = { $schema: "http://json-schema.org/draft-07/schema#", $id: "result.schema.json", type: "object", properties: { contractVersion: { const: "toolkit-2" }, runId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, plan: { type: "object", properties: { planId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, revision: { type: "integer", minimum: 1 }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" } }, required: ["planId", "revision", "sha256"], additionalProperties: false }, target: { type: "object", properties: { targetId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, revision: { type: "integer", minimum: 1 }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" } }, required: ["targetId", "revision", "sha256"], additionalProperties: false }, instanceId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, applicationBuild: { type: "string", minLength: 1 }, selectedTestIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, retestOf: { anyOf: [{ type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, { type: "null" }] }, startedAt: { type: "string", format: "date-time" }, finishedAt: { type: "string", format: "date-time" }, attempts: { type: "integer", minimum: 1 }, completion: { enum: ["completed", "interrupted", "operational_error"] }, completionReason: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] }, tests: { type: "array", items: { type: "object", properties: { testId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, outcome: { enum: ["passed", "failed", "inconclusive", "blocked", "not_run", "error"] }, reason: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] }, assertions: { type: "array", items: { type: "object", properties: { assertionId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, check: { type: "string", minLength: 1 }, checkKind: { enum: ["deterministic", "agent_observation"] }, result: { enum: ["passed", "failed", "inconclusive", "not_checked"] }, observed: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] }, reason: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] }, evidenceIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 0, uniqueItems: true } }, required: ["assertionId", "check", "checkKind", "result", "observed", "reason", "evidenceIds"], additionalProperties: false }, minItems: 0, uniqueItems: true } }, required: ["testId", "outcome", "reason", "assertions"], additionalProperties: false }, minItems: 1, uniqueItems: true }, findings: { type: "array", items: { type: "object", properties: { id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, type: { enum: ["defect", "potential_issue"] }, severity: { enum: ["low", "medium", "high", "critical"] }, requirementIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, title: { type: "string", minLength: 1 }, expected: { type: "string", minLength: 1 }, observed: { type: "string", minLength: 1 }, reproduction: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true }, evidenceIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, testIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, assertionIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\\.[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, metadata: { $ref: "plan.schema.json#/definitions/metadata" } }, required: ["id", "type", "severity", "requirementIds", "title", "expected", "observed", "reproduction", "evidenceIds", "testIds", "assertionIds"], additionalProperties: false }, minItems: 0, uniqueItems: true }, newGaps: { type: "array", items: { $ref: "gap.schema.json" }, minItems: 0, uniqueItems: true }, evidence: { type: "array", items: { type: "object", properties: { id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, testId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, assertionId: { anyOf: [{ type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, { type: "null" }] }, kind: { enum: ["observation", "http_exchange", "screenshot", "trace"] }, name: { type: "string", minLength: 1 }, mediaType: { type: "string", minLength: 1 }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, size: { type: "integer", minimum: 0 } }, required: ["id", "testId", "assertionId", "kind", "name", "mediaType", "sha256", "size"], additionalProperties: false }, minItems: 0, uniqueItems: true }, cleanup: { type: "object", properties: { status: { enum: ["completed", "failed", "not_applicable"] }, reason: { type: "string", minLength: 1 } }, required: ["status", "reason"], additionalProperties: false }, coverage: { type: "object", properties: { status: { enum: ["complete", "partial", "not_executed"] }, requirements: { type: "array", items: { type: "object", properties: { requirementId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, status: { enum: ["tested", "deferred", "uncovered"] }, testIds: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 0, uniqueItems: true }, reason: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] } }, required: ["requirementId", "status", "testIds", "reason"], additionalProperties: false }, minItems: 1, uniqueItems: true } }, required: ["status", "requirements"], additionalProperties: false } }, required: ["contractVersion", "runId", "plan", "target", "instanceId", "applicationBuild", "selectedTestIds", "retestOf", "startedAt", "finishedAt", "attempts", "completion", "tests", "findings", "newGaps", "evidence", "cleanup", "coverage"], additionalProperties: false };
var we = ke().fullFormats["date-time"];
function Le(u, { instancePath: t = "", parentData: _, parentDataProperty: Z, rootData: N = u } = {}) {
  let e = null, s = 0;
  if (u && typeof u == "object" && !Array.isArray(u)) {
    if (u.contractVersion === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "contractVersion" }, message: "must have required property 'contractVersion'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.runId === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "runId" }, message: "must have required property 'runId'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.plan === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "plan" }, message: "must have required property 'plan'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.target === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "target" }, message: "must have required property 'target'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.instanceId === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "instanceId" }, message: "must have required property 'instanceId'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.applicationBuild === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "applicationBuild" }, message: "must have required property 'applicationBuild'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.selectedTestIds === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "selectedTestIds" }, message: "must have required property 'selectedTestIds'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.retestOf === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "retestOf" }, message: "must have required property 'retestOf'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.startedAt === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "startedAt" }, message: "must have required property 'startedAt'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.finishedAt === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "finishedAt" }, message: "must have required property 'finishedAt'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.attempts === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "attempts" }, message: "must have required property 'attempts'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.completion === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "completion" }, message: "must have required property 'completion'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.tests === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "tests" }, message: "must have required property 'tests'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.findings === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "findings" }, message: "must have required property 'findings'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.newGaps === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "newGaps" }, message: "must have required property 'newGaps'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.evidence === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "evidence" }, message: "must have required property 'evidence'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.cleanup === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "cleanup" }, message: "must have required property 'cleanup'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.coverage === void 0) {
      let r = { instancePath: t, schemaPath: "#/required", keyword: "required", params: { missingProperty: "coverage" }, message: "must have required property 'coverage'" };
      e === null ? e = [r] : e.push(r), s++;
    }
    for (let r in u) if (!C.call(V.properties, r)) {
      let i = { instancePath: t, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: r }, message: "must NOT have additional properties" };
      e === null ? e = [i] : e.push(i), s++;
    }
    if (u.contractVersion !== void 0 && u.contractVersion !== "toolkit-2") {
      let r = { instancePath: t + "/contractVersion", schemaPath: "#/properties/contractVersion/const", keyword: "const", params: { allowedValue: "toolkit-2" }, message: "must be equal to constant" };
      e === null ? e = [r] : e.push(r), s++;
    }
    if (u.runId !== void 0) {
      let r = u.runId;
      if (typeof r == "string") {
        if (!z.test(r)) {
          let i = { instancePath: t + "/runId", schemaPath: "#/properties/runId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: t + "/runId", schemaPath: "#/properties/runId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (u.plan !== void 0) {
      let r = u.plan;
      if (r && typeof r == "object" && !Array.isArray(r)) {
        if (r.planId === void 0) {
          let i = { instancePath: t + "/plan", schemaPath: "#/properties/plan/required", keyword: "required", params: { missingProperty: "planId" }, message: "must have required property 'planId'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        if (r.revision === void 0) {
          let i = { instancePath: t + "/plan", schemaPath: "#/properties/plan/required", keyword: "required", params: { missingProperty: "revision" }, message: "must have required property 'revision'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        if (r.sha256 === void 0) {
          let i = { instancePath: t + "/plan", schemaPath: "#/properties/plan/required", keyword: "required", params: { missingProperty: "sha256" }, message: "must have required property 'sha256'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        for (let i in r) if (!(i === "planId" || i === "revision" || i === "sha256")) {
          let p = { instancePath: t + "/plan", schemaPath: "#/properties/plan/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: i }, message: "must NOT have additional properties" };
          e === null ? e = [p] : e.push(p), s++;
        }
        if (r.planId !== void 0) {
          let i = r.planId;
          if (typeof i == "string") {
            if (!z.test(i)) {
              let p = { instancePath: t + "/plan/planId", schemaPath: "#/properties/plan/properties/planId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [p] : e.push(p), s++;
            }
          } else {
            let p = { instancePath: t + "/plan/planId", schemaPath: "#/properties/plan/properties/planId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [p] : e.push(p), s++;
          }
        }
        if (r.revision !== void 0) {
          let i = r.revision;
          if (!(typeof i == "number" && !(i % 1) && !isNaN(i) && isFinite(i))) {
            let p = { instancePath: t + "/plan/revision", schemaPath: "#/properties/plan/properties/revision/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            e === null ? e = [p] : e.push(p), s++;
          }
          if (typeof i == "number" && isFinite(i) && (i < 1 || isNaN(i))) {
            let p = { instancePath: t + "/plan/revision", schemaPath: "#/properties/plan/properties/revision/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
            e === null ? e = [p] : e.push(p), s++;
          }
        }
        if (r.sha256 !== void 0) {
          let i = r.sha256;
          if (typeof i == "string") {
            if (!U.test(i)) {
              let p = { instancePath: t + "/plan/sha256", schemaPath: "#/properties/plan/properties/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
              e === null ? e = [p] : e.push(p), s++;
            }
          } else {
            let p = { instancePath: t + "/plan/sha256", schemaPath: "#/properties/plan/properties/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [p] : e.push(p), s++;
          }
        }
      } else {
        let i = { instancePath: t + "/plan", schemaPath: "#/properties/plan/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (u.target !== void 0) {
      let r = u.target;
      if (r && typeof r == "object" && !Array.isArray(r)) {
        if (r.targetId === void 0) {
          let i = { instancePath: t + "/target", schemaPath: "#/properties/target/required", keyword: "required", params: { missingProperty: "targetId" }, message: "must have required property 'targetId'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        if (r.revision === void 0) {
          let i = { instancePath: t + "/target", schemaPath: "#/properties/target/required", keyword: "required", params: { missingProperty: "revision" }, message: "must have required property 'revision'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        if (r.sha256 === void 0) {
          let i = { instancePath: t + "/target", schemaPath: "#/properties/target/required", keyword: "required", params: { missingProperty: "sha256" }, message: "must have required property 'sha256'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        for (let i in r) if (!(i === "targetId" || i === "revision" || i === "sha256")) {
          let p = { instancePath: t + "/target", schemaPath: "#/properties/target/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: i }, message: "must NOT have additional properties" };
          e === null ? e = [p] : e.push(p), s++;
        }
        if (r.targetId !== void 0) {
          let i = r.targetId;
          if (typeof i == "string") {
            if (!z.test(i)) {
              let p = { instancePath: t + "/target/targetId", schemaPath: "#/properties/target/properties/targetId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [p] : e.push(p), s++;
            }
          } else {
            let p = { instancePath: t + "/target/targetId", schemaPath: "#/properties/target/properties/targetId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [p] : e.push(p), s++;
          }
        }
        if (r.revision !== void 0) {
          let i = r.revision;
          if (!(typeof i == "number" && !(i % 1) && !isNaN(i) && isFinite(i))) {
            let p = { instancePath: t + "/target/revision", schemaPath: "#/properties/target/properties/revision/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            e === null ? e = [p] : e.push(p), s++;
          }
          if (typeof i == "number" && isFinite(i) && (i < 1 || isNaN(i))) {
            let p = { instancePath: t + "/target/revision", schemaPath: "#/properties/target/properties/revision/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
            e === null ? e = [p] : e.push(p), s++;
          }
        }
        if (r.sha256 !== void 0) {
          let i = r.sha256;
          if (typeof i == "string") {
            if (!U.test(i)) {
              let p = { instancePath: t + "/target/sha256", schemaPath: "#/properties/target/properties/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
              e === null ? e = [p] : e.push(p), s++;
            }
          } else {
            let p = { instancePath: t + "/target/sha256", schemaPath: "#/properties/target/properties/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [p] : e.push(p), s++;
          }
        }
      } else {
        let i = { instancePath: t + "/target", schemaPath: "#/properties/target/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (u.instanceId !== void 0) {
      let r = u.instanceId;
      if (typeof r == "string") {
        if (!z.test(r)) {
          let i = { instancePath: t + "/instanceId", schemaPath: "#/properties/instanceId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: t + "/instanceId", schemaPath: "#/properties/instanceId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (u.applicationBuild !== void 0) {
      let r = u.applicationBuild;
      if (typeof r == "string") {
        if (j(r) < 1) {
          let i = { instancePath: t + "/applicationBuild", schemaPath: "#/properties/applicationBuild/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: t + "/applicationBuild", schemaPath: "#/properties/applicationBuild/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (u.selectedTestIds !== void 0) {
      let r = u.selectedTestIds;
      if (Array.isArray(r)) {
        if (r.length < 1) {
          let c = { instancePath: t + "/selectedTestIds", schemaPath: "#/properties/selectedTestIds/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [c] : e.push(c), s++;
        }
        let i = r.length;
        for (let c = 0; c < i; c++) {
          let P = r[c];
          if (typeof P == "string") {
            if (!z.test(P)) {
              let f = { instancePath: t + "/selectedTestIds/" + c, schemaPath: "#/properties/selectedTestIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [f] : e.push(f), s++;
            }
          } else {
            let f = { instancePath: t + "/selectedTestIds/" + c, schemaPath: "#/properties/selectedTestIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [f] : e.push(f), s++;
          }
        }
        let p = r.length, k;
        if (p > 1) {
          let c = {};
          for (; p--; ) {
            let P = r[p];
            if (typeof P == "string") {
              if (typeof c[P] == "number") {
                k = c[P];
                let f = { instancePath: t + "/selectedTestIds", schemaPath: "#/properties/selectedTestIds/uniqueItems", keyword: "uniqueItems", params: { i: p, j: k }, message: "must NOT have duplicate items (items ## " + k + " and " + p + " are identical)" };
                e === null ? e = [f] : e.push(f), s++;
                break;
              }
              c[P] = p;
            }
          }
        }
      } else {
        let i = { instancePath: t + "/selectedTestIds", schemaPath: "#/properties/selectedTestIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (u.retestOf !== void 0) {
      let r = u.retestOf, i = s, p = false, k = s;
      if (typeof r == "string") {
        if (!z.test(r)) {
          let c = { instancePath: t + "/retestOf", schemaPath: "#/properties/retestOf/anyOf/0/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [c] : e.push(c), s++;
        }
      } else {
        let c = { instancePath: t + "/retestOf", schemaPath: "#/properties/retestOf/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [c] : e.push(c), s++;
      }
      var O = k === s;
      if (p = p || O, !p) {
        let c = s;
        if (r !== null) {
          let f = { instancePath: t + "/retestOf", schemaPath: "#/properties/retestOf/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
          e === null ? e = [f] : e.push(f), s++;
        }
        var O = c === s;
        p = p || O;
      }
      if (p) s = i, e !== null && (i ? e.length = i : e = null);
      else {
        let c = { instancePath: t + "/retestOf", schemaPath: "#/properties/retestOf/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
        e === null ? e = [c] : e.push(c), s++;
      }
    }
    if (u.startedAt !== void 0) {
      let r = u.startedAt;
      if (typeof r == "string") {
        if (!we.validate(r)) {
          let i = { instancePath: t + "/startedAt", schemaPath: "#/properties/startedAt/format", keyword: "format", params: { format: "date-time" }, message: 'must match format "date-time"' };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: t + "/startedAt", schemaPath: "#/properties/startedAt/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (u.finishedAt !== void 0) {
      let r = u.finishedAt;
      if (typeof r == "string") {
        if (!we.validate(r)) {
          let i = { instancePath: t + "/finishedAt", schemaPath: "#/properties/finishedAt/format", keyword: "format", params: { format: "date-time" }, message: 'must match format "date-time"' };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: t + "/finishedAt", schemaPath: "#/properties/finishedAt/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (u.attempts !== void 0) {
      let r = u.attempts;
      if (!(typeof r == "number" && !(r % 1) && !isNaN(r) && isFinite(r))) {
        let i = { instancePath: t + "/attempts", schemaPath: "#/properties/attempts/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        e === null ? e = [i] : e.push(i), s++;
      }
      if (typeof r == "number" && isFinite(r) && (r < 1 || isNaN(r))) {
        let i = { instancePath: t + "/attempts", schemaPath: "#/properties/attempts/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (u.completion !== void 0) {
      let r = u.completion;
      if (!(r === "completed" || r === "interrupted" || r === "operational_error")) {
        let i = { instancePath: t + "/completion", schemaPath: "#/properties/completion/enum", keyword: "enum", params: { allowedValues: V.properties.completion.enum }, message: "must be equal to one of the allowed values" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (u.completionReason !== void 0) {
      let r = u.completionReason, i = s, p = false, k = s;
      if (typeof r == "string") {
        if (j(r) < 1) {
          let c = { instancePath: t + "/completionReason", schemaPath: "#/properties/completionReason/anyOf/0/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [c] : e.push(c), s++;
        }
      } else {
        let c = { instancePath: t + "/completionReason", schemaPath: "#/properties/completionReason/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [c] : e.push(c), s++;
      }
      var g = k === s;
      if (p = p || g, !p) {
        let c = s;
        if (r !== null) {
          let f = { instancePath: t + "/completionReason", schemaPath: "#/properties/completionReason/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
          e === null ? e = [f] : e.push(f), s++;
        }
        var g = c === s;
        p = p || g;
      }
      if (p) s = i, e !== null && (i ? e.length = i : e = null);
      else {
        let c = { instancePath: t + "/completionReason", schemaPath: "#/properties/completionReason/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
        e === null ? e = [c] : e.push(c), s++;
      }
    }
    if (u.tests !== void 0) {
      let r = u.tests;
      if (Array.isArray(r)) {
        if (r.length < 1) {
          let c = { instancePath: t + "/tests", schemaPath: "#/properties/tests/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [c] : e.push(c), s++;
        }
        let i = r.length;
        for (let c = 0; c < i; c++) {
          let P = r[c];
          if (P && typeof P == "object" && !Array.isArray(P)) {
            if (P.testId === void 0) {
              let f = { instancePath: t + "/tests/" + c, schemaPath: "#/properties/tests/items/required", keyword: "required", params: { missingProperty: "testId" }, message: "must have required property 'testId'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.outcome === void 0) {
              let f = { instancePath: t + "/tests/" + c, schemaPath: "#/properties/tests/items/required", keyword: "required", params: { missingProperty: "outcome" }, message: "must have required property 'outcome'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.reason === void 0) {
              let f = { instancePath: t + "/tests/" + c, schemaPath: "#/properties/tests/items/required", keyword: "required", params: { missingProperty: "reason" }, message: "must have required property 'reason'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.assertions === void 0) {
              let f = { instancePath: t + "/tests/" + c, schemaPath: "#/properties/tests/items/required", keyword: "required", params: { missingProperty: "assertions" }, message: "must have required property 'assertions'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            for (let f in P) if (!(f === "testId" || f === "outcome" || f === "reason" || f === "assertions")) {
              let h = { instancePath: t + "/tests/" + c, schemaPath: "#/properties/tests/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: f }, message: "must NOT have additional properties" };
              e === null ? e = [h] : e.push(h), s++;
            }
            if (P.testId !== void 0) {
              let f = P.testId;
              if (typeof f == "string") {
                if (!z.test(f)) {
                  let h = { instancePath: t + "/tests/" + c + "/testId", schemaPath: "#/properties/tests/items/properties/testId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [h] : e.push(h), s++;
                }
              } else {
                let h = { instancePath: t + "/tests/" + c + "/testId", schemaPath: "#/properties/tests/items/properties/testId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.outcome !== void 0) {
              let f = P.outcome;
              if (!(f === "passed" || f === "failed" || f === "inconclusive" || f === "blocked" || f === "not_run" || f === "error")) {
                let h = { instancePath: t + "/tests/" + c + "/outcome", schemaPath: "#/properties/tests/items/properties/outcome/enum", keyword: "enum", params: { allowedValues: V.properties.tests.items.properties.outcome.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.reason !== void 0) {
              let f = P.reason, h = s, q = false, b = s;
              if (typeof f == "string") {
                if (j(f) < 1) {
                  let w = { instancePath: t + "/tests/" + c + "/reason", schemaPath: "#/properties/tests/items/properties/reason/anyOf/0/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [w] : e.push(w), s++;
                }
              } else {
                let w = { instancePath: t + "/tests/" + c + "/reason", schemaPath: "#/properties/tests/items/properties/reason/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [w] : e.push(w), s++;
              }
              var o = b === s;
              if (q = q || o, !q) {
                let w = s;
                if (f !== null) {
                  let v = { instancePath: t + "/tests/" + c + "/reason", schemaPath: "#/properties/tests/items/properties/reason/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                  e === null ? e = [v] : e.push(v), s++;
                }
                var o = w === s;
                q = q || o;
              }
              if (q) s = h, e !== null && (h ? e.length = h : e = null);
              else {
                let w = { instancePath: t + "/tests/" + c + "/reason", schemaPath: "#/properties/tests/items/properties/reason/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                e === null ? e = [w] : e.push(w), s++;
              }
            }
            if (P.assertions !== void 0) {
              let f = P.assertions;
              if (Array.isArray(f)) {
                if (f.length < 0) {
                  let w = { instancePath: t + "/tests/" + c + "/assertions", schemaPath: "#/properties/tests/items/properties/assertions/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [w] : e.push(w), s++;
                }
                let h = f.length;
                for (let w = 0; w < h; w++) {
                  let I = f[w];
                  if (I && typeof I == "object" && !Array.isArray(I)) {
                    if (I.assertionId === void 0) {
                      let v = { instancePath: t + "/tests/" + c + "/assertions/" + w, schemaPath: "#/properties/tests/items/properties/assertions/items/required", keyword: "required", params: { missingProperty: "assertionId" }, message: "must have required property 'assertionId'" };
                      e === null ? e = [v] : e.push(v), s++;
                    }
                    if (I.check === void 0) {
                      let v = { instancePath: t + "/tests/" + c + "/assertions/" + w, schemaPath: "#/properties/tests/items/properties/assertions/items/required", keyword: "required", params: { missingProperty: "check" }, message: "must have required property 'check'" };
                      e === null ? e = [v] : e.push(v), s++;
                    }
                    if (I.checkKind === void 0) {
                      let v = { instancePath: t + "/tests/" + c + "/assertions/" + w, schemaPath: "#/properties/tests/items/properties/assertions/items/required", keyword: "required", params: { missingProperty: "checkKind" }, message: "must have required property 'checkKind'" };
                      e === null ? e = [v] : e.push(v), s++;
                    }
                    if (I.result === void 0) {
                      let v = { instancePath: t + "/tests/" + c + "/assertions/" + w, schemaPath: "#/properties/tests/items/properties/assertions/items/required", keyword: "required", params: { missingProperty: "result" }, message: "must have required property 'result'" };
                      e === null ? e = [v] : e.push(v), s++;
                    }
                    if (I.observed === void 0) {
                      let v = { instancePath: t + "/tests/" + c + "/assertions/" + w, schemaPath: "#/properties/tests/items/properties/assertions/items/required", keyword: "required", params: { missingProperty: "observed" }, message: "must have required property 'observed'" };
                      e === null ? e = [v] : e.push(v), s++;
                    }
                    if (I.reason === void 0) {
                      let v = { instancePath: t + "/tests/" + c + "/assertions/" + w, schemaPath: "#/properties/tests/items/properties/assertions/items/required", keyword: "required", params: { missingProperty: "reason" }, message: "must have required property 'reason'" };
                      e === null ? e = [v] : e.push(v), s++;
                    }
                    if (I.evidenceIds === void 0) {
                      let v = { instancePath: t + "/tests/" + c + "/assertions/" + w, schemaPath: "#/properties/tests/items/properties/assertions/items/required", keyword: "required", params: { missingProperty: "evidenceIds" }, message: "must have required property 'evidenceIds'" };
                      e === null ? e = [v] : e.push(v), s++;
                    }
                    for (let v in I) if (!(v === "assertionId" || v === "check" || v === "checkKind" || v === "result" || v === "observed" || v === "reason" || v === "evidenceIds")) {
                      let A = { instancePath: t + "/tests/" + c + "/assertions/" + w, schemaPath: "#/properties/tests/items/properties/assertions/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: v }, message: "must NOT have additional properties" };
                      e === null ? e = [A] : e.push(A), s++;
                    }
                    if (I.assertionId !== void 0) {
                      let v = I.assertionId;
                      if (typeof v == "string") {
                        if (!z.test(v)) {
                          let A = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/assertionId", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/assertionId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                          e === null ? e = [A] : e.push(A), s++;
                        }
                      } else {
                        let A = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/assertionId", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/assertionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                        e === null ? e = [A] : e.push(A), s++;
                      }
                    }
                    if (I.check !== void 0) {
                      let v = I.check;
                      if (typeof v == "string") {
                        if (j(v) < 1) {
                          let A = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/check", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/check/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                          e === null ? e = [A] : e.push(A), s++;
                        }
                      } else {
                        let A = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/check", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/check/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                        e === null ? e = [A] : e.push(A), s++;
                      }
                    }
                    if (I.checkKind !== void 0) {
                      let v = I.checkKind;
                      if (!(v === "deterministic" || v === "agent_observation")) {
                        let A = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/checkKind", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/checkKind/enum", keyword: "enum", params: { allowedValues: V.properties.tests.items.properties.assertions.items.properties.checkKind.enum }, message: "must be equal to one of the allowed values" };
                        e === null ? e = [A] : e.push(A), s++;
                      }
                    }
                    if (I.result !== void 0) {
                      let v = I.result;
                      if (!(v === "passed" || v === "failed" || v === "inconclusive" || v === "not_checked")) {
                        let A = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/result", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/result/enum", keyword: "enum", params: { allowedValues: V.properties.tests.items.properties.assertions.items.properties.result.enum }, message: "must be equal to one of the allowed values" };
                        e === null ? e = [A] : e.push(A), s++;
                      }
                    }
                    if (I.observed !== void 0) {
                      let v = I.observed, A = s, T = false, D = s;
                      if (typeof v == "string") {
                        if (j(v) < 1) {
                          let $ = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/observed", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/observed/anyOf/0/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                          e === null ? e = [$] : e.push($), s++;
                        }
                      } else {
                        let $ = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/observed", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/observed/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                        e === null ? e = [$] : e.push($), s++;
                      }
                      var y = D === s;
                      if (T = T || y, !T) {
                        let $ = s;
                        if (v !== null) {
                          let x = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/observed", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/observed/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                          e === null ? e = [x] : e.push(x), s++;
                        }
                        var y = $ === s;
                        T = T || y;
                      }
                      if (T) s = A, e !== null && (A ? e.length = A : e = null);
                      else {
                        let $ = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/observed", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/observed/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                        e === null ? e = [$] : e.push($), s++;
                      }
                    }
                    if (I.reason !== void 0) {
                      let v = I.reason, A = s, T = false, D = s;
                      if (typeof v == "string") {
                        if (j(v) < 1) {
                          let $ = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/reason", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/reason/anyOf/0/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                          e === null ? e = [$] : e.push($), s++;
                        }
                      } else {
                        let $ = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/reason", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/reason/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                        e === null ? e = [$] : e.push($), s++;
                      }
                      var l = D === s;
                      if (T = T || l, !T) {
                        let $ = s;
                        if (v !== null) {
                          let x = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/reason", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/reason/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                          e === null ? e = [x] : e.push(x), s++;
                        }
                        var l = $ === s;
                        T = T || l;
                      }
                      if (T) s = A, e !== null && (A ? e.length = A : e = null);
                      else {
                        let $ = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/reason", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/reason/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                        e === null ? e = [$] : e.push($), s++;
                      }
                    }
                    if (I.evidenceIds !== void 0) {
                      let v = I.evidenceIds;
                      if (Array.isArray(v)) {
                        if (v.length < 0) {
                          let $ = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/evidenceIds", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/evidenceIds/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                          e === null ? e = [$] : e.push($), s++;
                        }
                        let A = v.length;
                        for (let $ = 0; $ < A; $++) {
                          let S = v[$];
                          if (typeof S == "string") {
                            if (!z.test(S)) {
                              let x = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/evidenceIds/" + $, schemaPath: "#/properties/tests/items/properties/assertions/items/properties/evidenceIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                              e === null ? e = [x] : e.push(x), s++;
                            }
                          } else {
                            let x = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/evidenceIds/" + $, schemaPath: "#/properties/tests/items/properties/assertions/items/properties/evidenceIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                            e === null ? e = [x] : e.push(x), s++;
                          }
                        }
                        let T = v.length, D;
                        if (T > 1) {
                          let $ = {};
                          for (; T--; ) {
                            let S = v[T];
                            if (typeof S == "string") {
                              if (typeof $[S] == "number") {
                                D = $[S];
                                let x = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/evidenceIds", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/evidenceIds/uniqueItems", keyword: "uniqueItems", params: { i: T, j: D }, message: "must NOT have duplicate items (items ## " + D + " and " + T + " are identical)" };
                                e === null ? e = [x] : e.push(x), s++;
                                break;
                              }
                              $[S] = T;
                            }
                          }
                        }
                      } else {
                        let A = { instancePath: t + "/tests/" + c + "/assertions/" + w + "/evidenceIds", schemaPath: "#/properties/tests/items/properties/assertions/items/properties/evidenceIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                        e === null ? e = [A] : e.push(A), s++;
                      }
                    }
                  } else {
                    let v = { instancePath: t + "/tests/" + c + "/assertions/" + w, schemaPath: "#/properties/tests/items/properties/assertions/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                    e === null ? e = [v] : e.push(v), s++;
                  }
                }
                let q = f.length, b;
                if (q > 1) {
                  e: for (; q--; ) for (b = q; b--; ) if (L(f[q], f[b])) {
                    let w = { instancePath: t + "/tests/" + c + "/assertions", schemaPath: "#/properties/tests/items/properties/assertions/uniqueItems", keyword: "uniqueItems", params: { i: q, j: b }, message: "must NOT have duplicate items (items ## " + b + " and " + q + " are identical)" };
                    e === null ? e = [w] : e.push(w), s++;
                    break e;
                  }
                }
              } else {
                let h = { instancePath: t + "/tests/" + c + "/assertions", schemaPath: "#/properties/tests/items/properties/assertions/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
          } else {
            let f = { instancePath: t + "/tests/" + c, schemaPath: "#/properties/tests/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [f] : e.push(f), s++;
          }
        }
        let p = r.length, k;
        if (p > 1) {
          e: for (; p--; ) for (k = p; k--; ) if (L(r[p], r[k])) {
            let c = { instancePath: t + "/tests", schemaPath: "#/properties/tests/uniqueItems", keyword: "uniqueItems", params: { i: p, j: k }, message: "must NOT have duplicate items (items ## " + k + " and " + p + " are identical)" };
            e === null ? e = [c] : e.push(c), s++;
            break e;
          }
        }
      } else {
        let i = { instancePath: t + "/tests", schemaPath: "#/properties/tests/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (u.findings !== void 0) {
      let r = u.findings;
      if (Array.isArray(r)) {
        if (r.length < 0) {
          let c = { instancePath: t + "/findings", schemaPath: "#/properties/findings/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [c] : e.push(c), s++;
        }
        let i = r.length;
        for (let c = 0; c < i; c++) {
          let P = r[c];
          if (P && typeof P == "object" && !Array.isArray(P)) {
            if (P.id === void 0) {
              let f = { instancePath: t + "/findings/" + c, schemaPath: "#/properties/findings/items/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.type === void 0) {
              let f = { instancePath: t + "/findings/" + c, schemaPath: "#/properties/findings/items/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.severity === void 0) {
              let f = { instancePath: t + "/findings/" + c, schemaPath: "#/properties/findings/items/required", keyword: "required", params: { missingProperty: "severity" }, message: "must have required property 'severity'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.requirementIds === void 0) {
              let f = { instancePath: t + "/findings/" + c, schemaPath: "#/properties/findings/items/required", keyword: "required", params: { missingProperty: "requirementIds" }, message: "must have required property 'requirementIds'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.title === void 0) {
              let f = { instancePath: t + "/findings/" + c, schemaPath: "#/properties/findings/items/required", keyword: "required", params: { missingProperty: "title" }, message: "must have required property 'title'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.expected === void 0) {
              let f = { instancePath: t + "/findings/" + c, schemaPath: "#/properties/findings/items/required", keyword: "required", params: { missingProperty: "expected" }, message: "must have required property 'expected'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.observed === void 0) {
              let f = { instancePath: t + "/findings/" + c, schemaPath: "#/properties/findings/items/required", keyword: "required", params: { missingProperty: "observed" }, message: "must have required property 'observed'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.reproduction === void 0) {
              let f = { instancePath: t + "/findings/" + c, schemaPath: "#/properties/findings/items/required", keyword: "required", params: { missingProperty: "reproduction" }, message: "must have required property 'reproduction'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.evidenceIds === void 0) {
              let f = { instancePath: t + "/findings/" + c, schemaPath: "#/properties/findings/items/required", keyword: "required", params: { missingProperty: "evidenceIds" }, message: "must have required property 'evidenceIds'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.testIds === void 0) {
              let f = { instancePath: t + "/findings/" + c, schemaPath: "#/properties/findings/items/required", keyword: "required", params: { missingProperty: "testIds" }, message: "must have required property 'testIds'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.assertionIds === void 0) {
              let f = { instancePath: t + "/findings/" + c, schemaPath: "#/properties/findings/items/required", keyword: "required", params: { missingProperty: "assertionIds" }, message: "must have required property 'assertionIds'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            for (let f in P) if (!C.call(V.properties.findings.items.properties, f)) {
              let h = { instancePath: t + "/findings/" + c, schemaPath: "#/properties/findings/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: f }, message: "must NOT have additional properties" };
              e === null ? e = [h] : e.push(h), s++;
            }
            if (P.id !== void 0) {
              let f = P.id;
              if (typeof f == "string") {
                if (!z.test(f)) {
                  let h = { instancePath: t + "/findings/" + c + "/id", schemaPath: "#/properties/findings/items/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [h] : e.push(h), s++;
                }
              } else {
                let h = { instancePath: t + "/findings/" + c + "/id", schemaPath: "#/properties/findings/items/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.type !== void 0) {
              let f = P.type;
              if (!(f === "defect" || f === "potential_issue")) {
                let h = { instancePath: t + "/findings/" + c + "/type", schemaPath: "#/properties/findings/items/properties/type/enum", keyword: "enum", params: { allowedValues: V.properties.findings.items.properties.type.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.severity !== void 0) {
              let f = P.severity;
              if (!(f === "low" || f === "medium" || f === "high" || f === "critical")) {
                let h = { instancePath: t + "/findings/" + c + "/severity", schemaPath: "#/properties/findings/items/properties/severity/enum", keyword: "enum", params: { allowedValues: V.properties.findings.items.properties.severity.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.requirementIds !== void 0) {
              let f = P.requirementIds;
              if (Array.isArray(f)) {
                if (f.length < 1) {
                  let w = { instancePath: t + "/findings/" + c + "/requirementIds", schemaPath: "#/properties/findings/items/properties/requirementIds/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                  e === null ? e = [w] : e.push(w), s++;
                }
                let h = f.length;
                for (let w = 0; w < h; w++) {
                  let I = f[w];
                  if (typeof I == "string") {
                    if (!z.test(I)) {
                      let v = { instancePath: t + "/findings/" + c + "/requirementIds/" + w, schemaPath: "#/properties/findings/items/properties/requirementIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [v] : e.push(v), s++;
                    }
                  } else {
                    let v = { instancePath: t + "/findings/" + c + "/requirementIds/" + w, schemaPath: "#/properties/findings/items/properties/requirementIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [v] : e.push(v), s++;
                  }
                }
                let q = f.length, b;
                if (q > 1) {
                  let w = {};
                  for (; q--; ) {
                    let I = f[q];
                    if (typeof I == "string") {
                      if (typeof w[I] == "number") {
                        b = w[I];
                        let v = { instancePath: t + "/findings/" + c + "/requirementIds", schemaPath: "#/properties/findings/items/properties/requirementIds/uniqueItems", keyword: "uniqueItems", params: { i: q, j: b }, message: "must NOT have duplicate items (items ## " + b + " and " + q + " are identical)" };
                        e === null ? e = [v] : e.push(v), s++;
                        break;
                      }
                      w[I] = q;
                    }
                  }
                }
              } else {
                let h = { instancePath: t + "/findings/" + c + "/requirementIds", schemaPath: "#/properties/findings/items/properties/requirementIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.title !== void 0) {
              let f = P.title;
              if (typeof f == "string") {
                if (j(f) < 1) {
                  let h = { instancePath: t + "/findings/" + c + "/title", schemaPath: "#/properties/findings/items/properties/title/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [h] : e.push(h), s++;
                }
              } else {
                let h = { instancePath: t + "/findings/" + c + "/title", schemaPath: "#/properties/findings/items/properties/title/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.expected !== void 0) {
              let f = P.expected;
              if (typeof f == "string") {
                if (j(f) < 1) {
                  let h = { instancePath: t + "/findings/" + c + "/expected", schemaPath: "#/properties/findings/items/properties/expected/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [h] : e.push(h), s++;
                }
              } else {
                let h = { instancePath: t + "/findings/" + c + "/expected", schemaPath: "#/properties/findings/items/properties/expected/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.observed !== void 0) {
              let f = P.observed;
              if (typeof f == "string") {
                if (j(f) < 1) {
                  let h = { instancePath: t + "/findings/" + c + "/observed", schemaPath: "#/properties/findings/items/properties/observed/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [h] : e.push(h), s++;
                }
              } else {
                let h = { instancePath: t + "/findings/" + c + "/observed", schemaPath: "#/properties/findings/items/properties/observed/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.reproduction !== void 0) {
              let f = P.reproduction;
              if (Array.isArray(f)) {
                if (f.length < 1) {
                  let w = { instancePath: t + "/findings/" + c + "/reproduction", schemaPath: "#/properties/findings/items/properties/reproduction/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                  e === null ? e = [w] : e.push(w), s++;
                }
                let h = f.length;
                for (let w = 0; w < h; w++) {
                  let I = f[w];
                  if (typeof I == "string") {
                    if (j(I) < 1) {
                      let v = { instancePath: t + "/findings/" + c + "/reproduction/" + w, schemaPath: "#/properties/findings/items/properties/reproduction/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                      e === null ? e = [v] : e.push(v), s++;
                    }
                  } else {
                    let v = { instancePath: t + "/findings/" + c + "/reproduction/" + w, schemaPath: "#/properties/findings/items/properties/reproduction/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [v] : e.push(v), s++;
                  }
                }
                let q = f.length, b;
                if (q > 1) {
                  let w = {};
                  for (; q--; ) {
                    let I = f[q];
                    if (typeof I == "string") {
                      if (typeof w[I] == "number") {
                        b = w[I];
                        let v = { instancePath: t + "/findings/" + c + "/reproduction", schemaPath: "#/properties/findings/items/properties/reproduction/uniqueItems", keyword: "uniqueItems", params: { i: q, j: b }, message: "must NOT have duplicate items (items ## " + b + " and " + q + " are identical)" };
                        e === null ? e = [v] : e.push(v), s++;
                        break;
                      }
                      w[I] = q;
                    }
                  }
                }
              } else {
                let h = { instancePath: t + "/findings/" + c + "/reproduction", schemaPath: "#/properties/findings/items/properties/reproduction/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.evidenceIds !== void 0) {
              let f = P.evidenceIds;
              if (Array.isArray(f)) {
                if (f.length < 1) {
                  let w = { instancePath: t + "/findings/" + c + "/evidenceIds", schemaPath: "#/properties/findings/items/properties/evidenceIds/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                  e === null ? e = [w] : e.push(w), s++;
                }
                let h = f.length;
                for (let w = 0; w < h; w++) {
                  let I = f[w];
                  if (typeof I == "string") {
                    if (!z.test(I)) {
                      let v = { instancePath: t + "/findings/" + c + "/evidenceIds/" + w, schemaPath: "#/properties/findings/items/properties/evidenceIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [v] : e.push(v), s++;
                    }
                  } else {
                    let v = { instancePath: t + "/findings/" + c + "/evidenceIds/" + w, schemaPath: "#/properties/findings/items/properties/evidenceIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [v] : e.push(v), s++;
                  }
                }
                let q = f.length, b;
                if (q > 1) {
                  let w = {};
                  for (; q--; ) {
                    let I = f[q];
                    if (typeof I == "string") {
                      if (typeof w[I] == "number") {
                        b = w[I];
                        let v = { instancePath: t + "/findings/" + c + "/evidenceIds", schemaPath: "#/properties/findings/items/properties/evidenceIds/uniqueItems", keyword: "uniqueItems", params: { i: q, j: b }, message: "must NOT have duplicate items (items ## " + b + " and " + q + " are identical)" };
                        e === null ? e = [v] : e.push(v), s++;
                        break;
                      }
                      w[I] = q;
                    }
                  }
                }
              } else {
                let h = { instancePath: t + "/findings/" + c + "/evidenceIds", schemaPath: "#/properties/findings/items/properties/evidenceIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.testIds !== void 0) {
              let f = P.testIds;
              if (Array.isArray(f)) {
                if (f.length < 1) {
                  let w = { instancePath: t + "/findings/" + c + "/testIds", schemaPath: "#/properties/findings/items/properties/testIds/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                  e === null ? e = [w] : e.push(w), s++;
                }
                let h = f.length;
                for (let w = 0; w < h; w++) {
                  let I = f[w];
                  if (typeof I == "string") {
                    if (!z.test(I)) {
                      let v = { instancePath: t + "/findings/" + c + "/testIds/" + w, schemaPath: "#/properties/findings/items/properties/testIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [v] : e.push(v), s++;
                    }
                  } else {
                    let v = { instancePath: t + "/findings/" + c + "/testIds/" + w, schemaPath: "#/properties/findings/items/properties/testIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [v] : e.push(v), s++;
                  }
                }
                let q = f.length, b;
                if (q > 1) {
                  let w = {};
                  for (; q--; ) {
                    let I = f[q];
                    if (typeof I == "string") {
                      if (typeof w[I] == "number") {
                        b = w[I];
                        let v = { instancePath: t + "/findings/" + c + "/testIds", schemaPath: "#/properties/findings/items/properties/testIds/uniqueItems", keyword: "uniqueItems", params: { i: q, j: b }, message: "must NOT have duplicate items (items ## " + b + " and " + q + " are identical)" };
                        e === null ? e = [v] : e.push(v), s++;
                        break;
                      }
                      w[I] = q;
                    }
                  }
                }
              } else {
                let h = { instancePath: t + "/findings/" + c + "/testIds", schemaPath: "#/properties/findings/items/properties/testIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.assertionIds !== void 0) {
              let f = P.assertionIds;
              if (Array.isArray(f)) {
                if (f.length < 1) {
                  let w = { instancePath: t + "/findings/" + c + "/assertionIds", schemaPath: "#/properties/findings/items/properties/assertionIds/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                  e === null ? e = [w] : e.push(w), s++;
                }
                let h = f.length;
                for (let w = 0; w < h; w++) {
                  let I = f[w];
                  if (typeof I == "string") {
                    if (!ve.test(I)) {
                      let v = { instancePath: t + "/findings/" + c + "/assertionIds/" + w, schemaPath: "#/properties/findings/items/properties/assertionIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\\.[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\\.[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [v] : e.push(v), s++;
                    }
                  } else {
                    let v = { instancePath: t + "/findings/" + c + "/assertionIds/" + w, schemaPath: "#/properties/findings/items/properties/assertionIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [v] : e.push(v), s++;
                  }
                }
                let q = f.length, b;
                if (q > 1) {
                  let w = {};
                  for (; q--; ) {
                    let I = f[q];
                    if (typeof I == "string") {
                      if (typeof w[I] == "number") {
                        b = w[I];
                        let v = { instancePath: t + "/findings/" + c + "/assertionIds", schemaPath: "#/properties/findings/items/properties/assertionIds/uniqueItems", keyword: "uniqueItems", params: { i: q, j: b }, message: "must NOT have duplicate items (items ## " + b + " and " + q + " are identical)" };
                        e === null ? e = [v] : e.push(v), s++;
                        break;
                      }
                      w[I] = q;
                    }
                  }
                }
              } else {
                let h = { instancePath: t + "/findings/" + c + "/assertionIds", schemaPath: "#/properties/findings/items/properties/assertionIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.metadata !== void 0) {
              let f = P.metadata;
              if (f && typeof f == "object" && !Array.isArray(f)) {
                if (Object.keys(f).length > 20) {
                  let h = { instancePath: t + "/findings/" + c + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/maxProperties", keyword: "maxProperties", params: { limit: 20 }, message: "must NOT have more than 20 properties" };
                  e === null ? e = [h] : e.push(h), s++;
                }
                for (let h in f) {
                  let q = s;
                  if (typeof h == "string" && !R.test(h)) {
                    let b = { instancePath: t + "/findings/" + c + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z][A-Za-z0-9_.-]{0,63}$" }, message: 'must match pattern "^[A-Za-z][A-Za-z0-9_.-]{0,63}$"', propertyName: h };
                    e === null ? e = [b] : e.push(b), s++;
                  }
                  var d = q === s;
                  if (!d) {
                    let b = { instancePath: t + "/findings/" + c + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/propertyNames", keyword: "propertyNames", params: { propertyName: h }, message: "property name must be valid" };
                    e === null ? e = [b] : e.push(b), s++;
                  }
                }
                for (let h in f) {
                  let q = f[h];
                  if (typeof q != "string" && !(typeof q == "number" && isFinite(q)) && typeof q != "boolean") {
                    let b = { instancePath: t + "/findings/" + c + "/metadata/" + h.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan.schema.json#/definitions/metadata/additionalProperties/type", keyword: "type", params: { type: F.additionalProperties.type }, message: "must be string,number,boolean" };
                    e === null ? e = [b] : e.push(b), s++;
                  }
                  if (typeof q == "string" && j(q) > 500) {
                    let b = { instancePath: t + "/findings/" + c + "/metadata/" + h.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "plan.schema.json#/definitions/metadata/additionalProperties/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
                    e === null ? e = [b] : e.push(b), s++;
                  }
                }
              } else {
                let h = { instancePath: t + "/findings/" + c + "/metadata", schemaPath: "plan.schema.json#/definitions/metadata/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
          } else {
            let f = { instancePath: t + "/findings/" + c, schemaPath: "#/properties/findings/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [f] : e.push(f), s++;
          }
        }
        let p = r.length, k;
        if (p > 1) {
          e: for (; p--; ) for (k = p; k--; ) if (L(r[p], r[k])) {
            let c = { instancePath: t + "/findings", schemaPath: "#/properties/findings/uniqueItems", keyword: "uniqueItems", params: { i: p, j: k }, message: "must NOT have duplicate items (items ## " + k + " and " + p + " are identical)" };
            e === null ? e = [c] : e.push(c), s++;
            break e;
          }
        }
      } else {
        let i = { instancePath: t + "/findings", schemaPath: "#/properties/findings/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (u.newGaps !== void 0) {
      let r = u.newGaps;
      if (Array.isArray(r)) {
        if (r.length < 0) {
          let c = { instancePath: t + "/newGaps", schemaPath: "#/properties/newGaps/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [c] : e.push(c), s++;
        }
        let i = r.length;
        for (let c = 0; c < i; c++) {
          let P = r[c];
          if (P && typeof P == "object" && !Array.isArray(P)) {
            if (P.id === void 0) {
              let f = { instancePath: t + "/newGaps/" + c, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.severity === void 0) {
              let f = { instancePath: t + "/newGaps/" + c, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "severity" }, message: "must have required property 'severity'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.status === void 0) {
              let f = { instancePath: t + "/newGaps/" + c, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "status" }, message: "must have required property 'status'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.requirementIds === void 0) {
              let f = { instancePath: t + "/newGaps/" + c, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "requirementIds" }, message: "must have required property 'requirementIds'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.testIds === void 0) {
              let f = { instancePath: t + "/newGaps/" + c, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "testIds" }, message: "must have required property 'testIds'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.question === void 0) {
              let f = { instancePath: t + "/newGaps/" + c, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "question" }, message: "must have required property 'question'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.consequence === void 0) {
              let f = { instancePath: t + "/newGaps/" + c, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "consequence" }, message: "must have required property 'consequence'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.decisionId === void 0) {
              let f = { instancePath: t + "/newGaps/" + c, schemaPath: "gap.schema.json/required", keyword: "required", params: { missingProperty: "decisionId" }, message: "must have required property 'decisionId'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            for (let f in P) if (!(f === "id" || f === "severity" || f === "status" || f === "requirementIds" || f === "testIds" || f === "question" || f === "consequence" || f === "decisionId")) {
              let h = { instancePath: t + "/newGaps/" + c, schemaPath: "gap.schema.json/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: f }, message: "must NOT have additional properties" };
              e === null ? e = [h] : e.push(h), s++;
            }
            if (P.id !== void 0) {
              let f = P.id;
              if (typeof f == "string") {
                if (!z.test(f)) {
                  let h = { instancePath: t + "/newGaps/" + c + "/id", schemaPath: "gap.schema.json/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [h] : e.push(h), s++;
                }
              } else {
                let h = { instancePath: t + "/newGaps/" + c + "/id", schemaPath: "gap.schema.json/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.severity !== void 0) {
              let f = P.severity;
              if (!(f === "blocking" || f === "non_blocking")) {
                let h = { instancePath: t + "/newGaps/" + c + "/severity", schemaPath: "gap.schema.json/properties/severity/enum", keyword: "enum", params: { allowedValues: B.properties.severity.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.status !== void 0) {
              let f = P.status;
              if (!(f === "open" || f === "resolved" || f === "deferred")) {
                let h = { instancePath: t + "/newGaps/" + c + "/status", schemaPath: "gap.schema.json/properties/status/enum", keyword: "enum", params: { allowedValues: B.properties.status.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.requirementIds !== void 0) {
              let f = P.requirementIds;
              if (Array.isArray(f)) {
                if (f.length < 0) {
                  let w = { instancePath: t + "/newGaps/" + c + "/requirementIds", schemaPath: "gap.schema.json/properties/requirementIds/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [w] : e.push(w), s++;
                }
                let h = f.length;
                for (let w = 0; w < h; w++) {
                  let I = f[w];
                  if (typeof I == "string") {
                    if (!z.test(I)) {
                      let v = { instancePath: t + "/newGaps/" + c + "/requirementIds/" + w, schemaPath: "gap.schema.json/properties/requirementIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [v] : e.push(v), s++;
                    }
                  } else {
                    let v = { instancePath: t + "/newGaps/" + c + "/requirementIds/" + w, schemaPath: "gap.schema.json/properties/requirementIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [v] : e.push(v), s++;
                  }
                }
                let q = f.length, b;
                if (q > 1) {
                  let w = {};
                  for (; q--; ) {
                    let I = f[q];
                    if (typeof I == "string") {
                      if (typeof w[I] == "number") {
                        b = w[I];
                        let v = { instancePath: t + "/newGaps/" + c + "/requirementIds", schemaPath: "gap.schema.json/properties/requirementIds/uniqueItems", keyword: "uniqueItems", params: { i: q, j: b }, message: "must NOT have duplicate items (items ## " + b + " and " + q + " are identical)" };
                        e === null ? e = [v] : e.push(v), s++;
                        break;
                      }
                      w[I] = q;
                    }
                  }
                }
              } else {
                let h = { instancePath: t + "/newGaps/" + c + "/requirementIds", schemaPath: "gap.schema.json/properties/requirementIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.testIds !== void 0) {
              let f = P.testIds;
              if (Array.isArray(f)) {
                if (f.length < 0) {
                  let w = { instancePath: t + "/newGaps/" + c + "/testIds", schemaPath: "gap.schema.json/properties/testIds/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                  e === null ? e = [w] : e.push(w), s++;
                }
                let h = f.length;
                for (let w = 0; w < h; w++) {
                  let I = f[w];
                  if (typeof I == "string") {
                    if (!M.test(I)) {
                      let v = { instancePath: t + "/newGaps/" + c + "/testIds/" + w, schemaPath: "gap.schema.json/properties/testIds/items/pattern", keyword: "pattern", params: { pattern: "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^([A-Za-z0-9][A-Za-z0-9_-]{0,95}:)?[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [v] : e.push(v), s++;
                    }
                  } else {
                    let v = { instancePath: t + "/newGaps/" + c + "/testIds/" + w, schemaPath: "gap.schema.json/properties/testIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [v] : e.push(v), s++;
                  }
                }
                let q = f.length, b;
                if (q > 1) {
                  let w = {};
                  for (; q--; ) {
                    let I = f[q];
                    if (typeof I == "string") {
                      if (typeof w[I] == "number") {
                        b = w[I];
                        let v = { instancePath: t + "/newGaps/" + c + "/testIds", schemaPath: "gap.schema.json/properties/testIds/uniqueItems", keyword: "uniqueItems", params: { i: q, j: b }, message: "must NOT have duplicate items (items ## " + b + " and " + q + " are identical)" };
                        e === null ? e = [v] : e.push(v), s++;
                        break;
                      }
                      w[I] = q;
                    }
                  }
                }
              } else {
                let h = { instancePath: t + "/newGaps/" + c + "/testIds", schemaPath: "gap.schema.json/properties/testIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.question !== void 0) {
              let f = P.question;
              if (typeof f == "string") {
                if (j(f) < 1) {
                  let h = { instancePath: t + "/newGaps/" + c + "/question", schemaPath: "gap.schema.json/properties/question/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [h] : e.push(h), s++;
                }
              } else {
                let h = { instancePath: t + "/newGaps/" + c + "/question", schemaPath: "gap.schema.json/properties/question/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.consequence !== void 0) {
              let f = P.consequence;
              if (typeof f == "string") {
                if (j(f) < 1) {
                  let h = { instancePath: t + "/newGaps/" + c + "/consequence", schemaPath: "gap.schema.json/properties/consequence/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [h] : e.push(h), s++;
                }
              } else {
                let h = { instancePath: t + "/newGaps/" + c + "/consequence", schemaPath: "gap.schema.json/properties/consequence/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.decisionId !== void 0) {
              let f = P.decisionId, h = s, q = false, b = s;
              if (typeof f == "string") {
                if (!z.test(f)) {
                  let w = { instancePath: t + "/newGaps/" + c + "/decisionId", schemaPath: "gap.schema.json/properties/decisionId/anyOf/0/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [w] : e.push(w), s++;
                }
              } else {
                let w = { instancePath: t + "/newGaps/" + c + "/decisionId", schemaPath: "gap.schema.json/properties/decisionId/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [w] : e.push(w), s++;
              }
              var n = b === s;
              if (q = q || n, !q) {
                let w = s;
                if (f !== null) {
                  let v = { instancePath: t + "/newGaps/" + c + "/decisionId", schemaPath: "gap.schema.json/properties/decisionId/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                  e === null ? e = [v] : e.push(v), s++;
                }
                var n = w === s;
                q = q || n;
              }
              if (q) s = h, e !== null && (h ? e.length = h : e = null);
              else {
                let w = { instancePath: t + "/newGaps/" + c + "/decisionId", schemaPath: "gap.schema.json/properties/decisionId/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                e === null ? e = [w] : e.push(w), s++;
              }
            }
          } else {
            let f = { instancePath: t + "/newGaps/" + c, schemaPath: "gap.schema.json/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [f] : e.push(f), s++;
          }
        }
        let p = r.length, k;
        if (p > 1) {
          e: for (; p--; ) for (k = p; k--; ) if (L(r[p], r[k])) {
            let c = { instancePath: t + "/newGaps", schemaPath: "#/properties/newGaps/uniqueItems", keyword: "uniqueItems", params: { i: p, j: k }, message: "must NOT have duplicate items (items ## " + k + " and " + p + " are identical)" };
            e === null ? e = [c] : e.push(c), s++;
            break e;
          }
        }
      } else {
        let i = { instancePath: t + "/newGaps", schemaPath: "#/properties/newGaps/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (u.evidence !== void 0) {
      let r = u.evidence;
      if (Array.isArray(r)) {
        if (r.length < 0) {
          let c = { instancePath: t + "/evidence", schemaPath: "#/properties/evidence/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [c] : e.push(c), s++;
        }
        let i = r.length;
        for (let c = 0; c < i; c++) {
          let P = r[c];
          if (P && typeof P == "object" && !Array.isArray(P)) {
            if (P.id === void 0) {
              let f = { instancePath: t + "/evidence/" + c, schemaPath: "#/properties/evidence/items/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.testId === void 0) {
              let f = { instancePath: t + "/evidence/" + c, schemaPath: "#/properties/evidence/items/required", keyword: "required", params: { missingProperty: "testId" }, message: "must have required property 'testId'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.assertionId === void 0) {
              let f = { instancePath: t + "/evidence/" + c, schemaPath: "#/properties/evidence/items/required", keyword: "required", params: { missingProperty: "assertionId" }, message: "must have required property 'assertionId'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.kind === void 0) {
              let f = { instancePath: t + "/evidence/" + c, schemaPath: "#/properties/evidence/items/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.name === void 0) {
              let f = { instancePath: t + "/evidence/" + c, schemaPath: "#/properties/evidence/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.mediaType === void 0) {
              let f = { instancePath: t + "/evidence/" + c, schemaPath: "#/properties/evidence/items/required", keyword: "required", params: { missingProperty: "mediaType" }, message: "must have required property 'mediaType'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.sha256 === void 0) {
              let f = { instancePath: t + "/evidence/" + c, schemaPath: "#/properties/evidence/items/required", keyword: "required", params: { missingProperty: "sha256" }, message: "must have required property 'sha256'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            if (P.size === void 0) {
              let f = { instancePath: t + "/evidence/" + c, schemaPath: "#/properties/evidence/items/required", keyword: "required", params: { missingProperty: "size" }, message: "must have required property 'size'" };
              e === null ? e = [f] : e.push(f), s++;
            }
            for (let f in P) if (!(f === "id" || f === "testId" || f === "assertionId" || f === "kind" || f === "name" || f === "mediaType" || f === "sha256" || f === "size")) {
              let h = { instancePath: t + "/evidence/" + c, schemaPath: "#/properties/evidence/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: f }, message: "must NOT have additional properties" };
              e === null ? e = [h] : e.push(h), s++;
            }
            if (P.id !== void 0) {
              let f = P.id;
              if (typeof f == "string") {
                if (!z.test(f)) {
                  let h = { instancePath: t + "/evidence/" + c + "/id", schemaPath: "#/properties/evidence/items/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [h] : e.push(h), s++;
                }
              } else {
                let h = { instancePath: t + "/evidence/" + c + "/id", schemaPath: "#/properties/evidence/items/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.testId !== void 0) {
              let f = P.testId;
              if (typeof f == "string") {
                if (!z.test(f)) {
                  let h = { instancePath: t + "/evidence/" + c + "/testId", schemaPath: "#/properties/evidence/items/properties/testId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [h] : e.push(h), s++;
                }
              } else {
                let h = { instancePath: t + "/evidence/" + c + "/testId", schemaPath: "#/properties/evidence/items/properties/testId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.assertionId !== void 0) {
              let f = P.assertionId, h = s, q = false, b = s;
              if (typeof f == "string") {
                if (!z.test(f)) {
                  let w = { instancePath: t + "/evidence/" + c + "/assertionId", schemaPath: "#/properties/evidence/items/properties/assertionId/anyOf/0/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [w] : e.push(w), s++;
                }
              } else {
                let w = { instancePath: t + "/evidence/" + c + "/assertionId", schemaPath: "#/properties/evidence/items/properties/assertionId/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [w] : e.push(w), s++;
              }
              var m = b === s;
              if (q = q || m, !q) {
                let w = s;
                if (f !== null) {
                  let v = { instancePath: t + "/evidence/" + c + "/assertionId", schemaPath: "#/properties/evidence/items/properties/assertionId/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                  e === null ? e = [v] : e.push(v), s++;
                }
                var m = w === s;
                q = q || m;
              }
              if (q) s = h, e !== null && (h ? e.length = h : e = null);
              else {
                let w = { instancePath: t + "/evidence/" + c + "/assertionId", schemaPath: "#/properties/evidence/items/properties/assertionId/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                e === null ? e = [w] : e.push(w), s++;
              }
            }
            if (P.kind !== void 0) {
              let f = P.kind;
              if (!(f === "observation" || f === "http_exchange" || f === "screenshot" || f === "trace")) {
                let h = { instancePath: t + "/evidence/" + c + "/kind", schemaPath: "#/properties/evidence/items/properties/kind/enum", keyword: "enum", params: { allowedValues: V.properties.evidence.items.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.name !== void 0) {
              let f = P.name;
              if (typeof f == "string") {
                if (j(f) < 1) {
                  let h = { instancePath: t + "/evidence/" + c + "/name", schemaPath: "#/properties/evidence/items/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [h] : e.push(h), s++;
                }
              } else {
                let h = { instancePath: t + "/evidence/" + c + "/name", schemaPath: "#/properties/evidence/items/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.mediaType !== void 0) {
              let f = P.mediaType;
              if (typeof f == "string") {
                if (j(f) < 1) {
                  let h = { instancePath: t + "/evidence/" + c + "/mediaType", schemaPath: "#/properties/evidence/items/properties/mediaType/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [h] : e.push(h), s++;
                }
              } else {
                let h = { instancePath: t + "/evidence/" + c + "/mediaType", schemaPath: "#/properties/evidence/items/properties/mediaType/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.sha256 !== void 0) {
              let f = P.sha256;
              if (typeof f == "string") {
                if (!U.test(f)) {
                  let h = { instancePath: t + "/evidence/" + c + "/sha256", schemaPath: "#/properties/evidence/items/properties/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
                  e === null ? e = [h] : e.push(h), s++;
                }
              } else {
                let h = { instancePath: t + "/evidence/" + c + "/sha256", schemaPath: "#/properties/evidence/items/properties/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            if (P.size !== void 0) {
              let f = P.size;
              if (!(typeof f == "number" && !(f % 1) && !isNaN(f) && isFinite(f))) {
                let h = { instancePath: t + "/evidence/" + c + "/size", schemaPath: "#/properties/evidence/items/properties/size/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                e === null ? e = [h] : e.push(h), s++;
              }
              if (typeof f == "number" && isFinite(f) && (f < 0 || isNaN(f))) {
                let h = { instancePath: t + "/evidence/" + c + "/size", schemaPath: "#/properties/evidence/items/properties/size/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
          } else {
            let f = { instancePath: t + "/evidence/" + c, schemaPath: "#/properties/evidence/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [f] : e.push(f), s++;
          }
        }
        let p = r.length, k;
        if (p > 1) {
          e: for (; p--; ) for (k = p; k--; ) if (L(r[p], r[k])) {
            let c = { instancePath: t + "/evidence", schemaPath: "#/properties/evidence/uniqueItems", keyword: "uniqueItems", params: { i: p, j: k }, message: "must NOT have duplicate items (items ## " + k + " and " + p + " are identical)" };
            e === null ? e = [c] : e.push(c), s++;
            break e;
          }
        }
      } else {
        let i = { instancePath: t + "/evidence", schemaPath: "#/properties/evidence/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (u.cleanup !== void 0) {
      let r = u.cleanup;
      if (r && typeof r == "object" && !Array.isArray(r)) {
        if (r.status === void 0) {
          let i = { instancePath: t + "/cleanup", schemaPath: "#/properties/cleanup/required", keyword: "required", params: { missingProperty: "status" }, message: "must have required property 'status'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        if (r.reason === void 0) {
          let i = { instancePath: t + "/cleanup", schemaPath: "#/properties/cleanup/required", keyword: "required", params: { missingProperty: "reason" }, message: "must have required property 'reason'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        for (let i in r) if (!(i === "status" || i === "reason")) {
          let p = { instancePath: t + "/cleanup", schemaPath: "#/properties/cleanup/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: i }, message: "must NOT have additional properties" };
          e === null ? e = [p] : e.push(p), s++;
        }
        if (r.status !== void 0) {
          let i = r.status;
          if (!(i === "completed" || i === "failed" || i === "not_applicable")) {
            let p = { instancePath: t + "/cleanup/status", schemaPath: "#/properties/cleanup/properties/status/enum", keyword: "enum", params: { allowedValues: V.properties.cleanup.properties.status.enum }, message: "must be equal to one of the allowed values" };
            e === null ? e = [p] : e.push(p), s++;
          }
        }
        if (r.reason !== void 0) {
          let i = r.reason;
          if (typeof i == "string") {
            if (j(i) < 1) {
              let p = { instancePath: t + "/cleanup/reason", schemaPath: "#/properties/cleanup/properties/reason/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              e === null ? e = [p] : e.push(p), s++;
            }
          } else {
            let p = { instancePath: t + "/cleanup/reason", schemaPath: "#/properties/cleanup/properties/reason/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [p] : e.push(p), s++;
          }
        }
      } else {
        let i = { instancePath: t + "/cleanup", schemaPath: "#/properties/cleanup/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (u.coverage !== void 0) {
      let r = u.coverage;
      if (r && typeof r == "object" && !Array.isArray(r)) {
        if (r.status === void 0) {
          let i = { instancePath: t + "/coverage", schemaPath: "#/properties/coverage/required", keyword: "required", params: { missingProperty: "status" }, message: "must have required property 'status'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        if (r.requirements === void 0) {
          let i = { instancePath: t + "/coverage", schemaPath: "#/properties/coverage/required", keyword: "required", params: { missingProperty: "requirements" }, message: "must have required property 'requirements'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        for (let i in r) if (!(i === "status" || i === "requirements")) {
          let p = { instancePath: t + "/coverage", schemaPath: "#/properties/coverage/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: i }, message: "must NOT have additional properties" };
          e === null ? e = [p] : e.push(p), s++;
        }
        if (r.status !== void 0) {
          let i = r.status;
          if (!(i === "complete" || i === "partial" || i === "not_executed")) {
            let p = { instancePath: t + "/coverage/status", schemaPath: "#/properties/coverage/properties/status/enum", keyword: "enum", params: { allowedValues: V.properties.coverage.properties.status.enum }, message: "must be equal to one of the allowed values" };
            e === null ? e = [p] : e.push(p), s++;
          }
        }
        if (r.requirements !== void 0) {
          let i = r.requirements;
          if (Array.isArray(i)) {
            if (i.length < 1) {
              let P = { instancePath: t + "/coverage/requirements", schemaPath: "#/properties/coverage/properties/requirements/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
              e === null ? e = [P] : e.push(P), s++;
            }
            let p = i.length;
            for (let P = 0; P < p; P++) {
              let f = i[P];
              if (f && typeof f == "object" && !Array.isArray(f)) {
                if (f.requirementId === void 0) {
                  let h = { instancePath: t + "/coverage/requirements/" + P, schemaPath: "#/properties/coverage/properties/requirements/items/required", keyword: "required", params: { missingProperty: "requirementId" }, message: "must have required property 'requirementId'" };
                  e === null ? e = [h] : e.push(h), s++;
                }
                if (f.status === void 0) {
                  let h = { instancePath: t + "/coverage/requirements/" + P, schemaPath: "#/properties/coverage/properties/requirements/items/required", keyword: "required", params: { missingProperty: "status" }, message: "must have required property 'status'" };
                  e === null ? e = [h] : e.push(h), s++;
                }
                if (f.testIds === void 0) {
                  let h = { instancePath: t + "/coverage/requirements/" + P, schemaPath: "#/properties/coverage/properties/requirements/items/required", keyword: "required", params: { missingProperty: "testIds" }, message: "must have required property 'testIds'" };
                  e === null ? e = [h] : e.push(h), s++;
                }
                if (f.reason === void 0) {
                  let h = { instancePath: t + "/coverage/requirements/" + P, schemaPath: "#/properties/coverage/properties/requirements/items/required", keyword: "required", params: { missingProperty: "reason" }, message: "must have required property 'reason'" };
                  e === null ? e = [h] : e.push(h), s++;
                }
                for (let h in f) if (!(h === "requirementId" || h === "status" || h === "testIds" || h === "reason")) {
                  let q = { instancePath: t + "/coverage/requirements/" + P, schemaPath: "#/properties/coverage/properties/requirements/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: h }, message: "must NOT have additional properties" };
                  e === null ? e = [q] : e.push(q), s++;
                }
                if (f.requirementId !== void 0) {
                  let h = f.requirementId;
                  if (typeof h == "string") {
                    if (!z.test(h)) {
                      let q = { instancePath: t + "/coverage/requirements/" + P + "/requirementId", schemaPath: "#/properties/coverage/properties/requirements/items/properties/requirementId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                      e === null ? e = [q] : e.push(q), s++;
                    }
                  } else {
                    let q = { instancePath: t + "/coverage/requirements/" + P + "/requirementId", schemaPath: "#/properties/coverage/properties/requirements/items/properties/requirementId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [q] : e.push(q), s++;
                  }
                }
                if (f.status !== void 0) {
                  let h = f.status;
                  if (!(h === "tested" || h === "deferred" || h === "uncovered")) {
                    let q = { instancePath: t + "/coverage/requirements/" + P + "/status", schemaPath: "#/properties/coverage/properties/requirements/items/properties/status/enum", keyword: "enum", params: { allowedValues: V.properties.coverage.properties.requirements.items.properties.status.enum }, message: "must be equal to one of the allowed values" };
                    e === null ? e = [q] : e.push(q), s++;
                  }
                }
                if (f.testIds !== void 0) {
                  let h = f.testIds;
                  if (Array.isArray(h)) {
                    if (h.length < 0) {
                      let I = { instancePath: t + "/coverage/requirements/" + P + "/testIds", schemaPath: "#/properties/coverage/properties/requirements/items/properties/testIds/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
                      e === null ? e = [I] : e.push(I), s++;
                    }
                    let q = h.length;
                    for (let I = 0; I < q; I++) {
                      let v = h[I];
                      if (typeof v == "string") {
                        if (!z.test(v)) {
                          let A = { instancePath: t + "/coverage/requirements/" + P + "/testIds/" + I, schemaPath: "#/properties/coverage/properties/requirements/items/properties/testIds/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                          e === null ? e = [A] : e.push(A), s++;
                        }
                      } else {
                        let A = { instancePath: t + "/coverage/requirements/" + P + "/testIds/" + I, schemaPath: "#/properties/coverage/properties/requirements/items/properties/testIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                        e === null ? e = [A] : e.push(A), s++;
                      }
                    }
                    let b = h.length, w;
                    if (b > 1) {
                      let I = {};
                      for (; b--; ) {
                        let v = h[b];
                        if (typeof v == "string") {
                          if (typeof I[v] == "number") {
                            w = I[v];
                            let A = { instancePath: t + "/coverage/requirements/" + P + "/testIds", schemaPath: "#/properties/coverage/properties/requirements/items/properties/testIds/uniqueItems", keyword: "uniqueItems", params: { i: b, j: w }, message: "must NOT have duplicate items (items ## " + w + " and " + b + " are identical)" };
                            e === null ? e = [A] : e.push(A), s++;
                            break;
                          }
                          I[v] = b;
                        }
                      }
                    }
                  } else {
                    let q = { instancePath: t + "/coverage/requirements/" + P + "/testIds", schemaPath: "#/properties/coverage/properties/requirements/items/properties/testIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                    e === null ? e = [q] : e.push(q), s++;
                  }
                }
                if (f.reason !== void 0) {
                  let h = f.reason, q = s, b = false, w = s;
                  if (typeof h == "string") {
                    if (j(h) < 1) {
                      let I = { instancePath: t + "/coverage/requirements/" + P + "/reason", schemaPath: "#/properties/coverage/properties/requirements/items/properties/reason/anyOf/0/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                      e === null ? e = [I] : e.push(I), s++;
                    }
                  } else {
                    let I = { instancePath: t + "/coverage/requirements/" + P + "/reason", schemaPath: "#/properties/coverage/properties/requirements/items/properties/reason/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    e === null ? e = [I] : e.push(I), s++;
                  }
                  var a = w === s;
                  if (b = b || a, !b) {
                    let I = s;
                    if (h !== null) {
                      let A = { instancePath: t + "/coverage/requirements/" + P + "/reason", schemaPath: "#/properties/coverage/properties/requirements/items/properties/reason/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                      e === null ? e = [A] : e.push(A), s++;
                    }
                    var a = I === s;
                    b = b || a;
                  }
                  if (b) s = q, e !== null && (q ? e.length = q : e = null);
                  else {
                    let I = { instancePath: t + "/coverage/requirements/" + P + "/reason", schemaPath: "#/properties/coverage/properties/requirements/items/properties/reason/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                    e === null ? e = [I] : e.push(I), s++;
                  }
                }
              } else {
                let h = { instancePath: t + "/coverage/requirements/" + P, schemaPath: "#/properties/coverage/properties/requirements/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                e === null ? e = [h] : e.push(h), s++;
              }
            }
            let k = i.length, c;
            if (k > 1) {
              e: for (; k--; ) for (c = k; c--; ) if (L(i[k], i[c])) {
                let P = { instancePath: t + "/coverage/requirements", schemaPath: "#/properties/coverage/properties/requirements/uniqueItems", keyword: "uniqueItems", params: { i: k, j: c }, message: "must NOT have duplicate items (items ## " + c + " and " + k + " are identical)" };
                e === null ? e = [P] : e.push(P), s++;
                break e;
              }
            }
          } else {
            let p = { instancePath: t + "/coverage/requirements", schemaPath: "#/properties/coverage/properties/requirements/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            e === null ? e = [p] : e.push(p), s++;
          }
        }
      } else {
        let i = { instancePath: t + "/coverage", schemaPath: "#/properties/coverage/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
  } else {
    let r = { instancePath: t, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [r] : e.push(r), s++;
  }
  return Le.errors = e, s === 0;
}

// plugin/src/contracts.ts
var identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
function same(a, b) {
  return canonical(a) === canonical(b);
}
function validate(name, value2) {
  const check = validators_exports[name.replace(/-./g, (match) => match[1].toUpperCase())];
  const errors = () => unionErrors(check.errors ?? []).filter((error) => error.keyword !== "propertyNames").map((error) => schemaError(`${name}${error.instancePath}`, error)).join(", ");
  requireCondition(check(value2), `Invalid ${name}: ${errors()}`);
  return value2;
}
function unionErrors(errors) {
  let kept = errors;
  for (const union of errors.filter((error) => ["anyOf", "oneOf"].includes(error.keyword))) {
    const misses = kept.filter(
      (error) => error.keyword === "type" && error.instancePath === union.instancePath && error.schemaPath.startsWith(union.schemaPath) && /^\/[0-9]+\/type$/.test(error.schemaPath.slice(union.schemaPath.length))
    );
    const under = (error) => error.instancePath === union.instancePath || error.instancePath.startsWith(`${union.instancePath}/`);
    const matched = kept.some((error) => error !== union && !misses.includes(error) && under(error));
    const merged = { ...misses[0], params: { type: misses.flatMap((error) => error.params.type ?? []) } };
    const replacement = matched ? [] : misses.length ? [merged] : [union];
    kept = kept.flatMap((error) => error === union ? replacement : misses.includes(error) ? [] : [error]);
  }
  return kept;
}
function typeList(types) {
  if (types.length < 3) return types.join(" or ");
  return `${types.slice(0, -1).join(", ")}, or ${types.at(-1)}`;
}
function schemaError(path, error) {
  if (error.keyword === "type") return `${path} must be ${typeList([error.params.type ?? []].flat())}`;
  if (error.keyword === "additionalProperties")
    return `${path} has unknown field "${error.params.additionalProperty}"`;
  if (error.keyword === "enum") return `${path} must be one of: ${error.params.allowedValues?.join(", ")}`;
  if (error.propertyName !== void 0) return `${path} field name "${error.propertyName}" ${error.message}`;
  return `${path} ${error.message}`;
}
function requireIdentifier(value2, name) {
  requireCondition(
    typeof value2 === "string" && identifier.test(value2),
    `Invalid ${name}: ${String(value2)}. Use 1 to 96 letters, digits, _ or -, starting with a letter or digit.`
  );
  return value2;
}
function requireText(value2, name) {
  requireCondition(typeof value2 === "string" && value2.trim().length > 0, `Missing ${name}`);
  return value2;
}
function requireChoice(value2, choices, name) {
  requireCondition(
    choices.includes(value2),
    `Invalid ${name}: ${String(value2)}. Use one of: ${choices.join(", ")}.`
  );
  return value2;
}
function revisionReference(text, name) {
  const [id2, revision, ...rest] = text.split("@");
  requireIdentifier(id2, name);
  requireCondition(
    !rest.length && (revision === void 0 || /^[1-9][0-9]*$/.test(revision)),
    `Invalid ${name}: ${text}. Use <id> or <id>@<revision>.`
  );
  return { id: id2, revision: revision === void 0 ? null : Number(revision) };
}
function testReference(reference) {
  const [planId, testId] = reference.includes(":") ? reference.split(":") : [null, reference];
  return { planId, testId };
}
function expectDigest(actual, expected, subject) {
  if (expected === void 0) return;
  requireCondition(/^[a-f0-9]{8,64}$/.test(expected), `Invalid --expect-sha: ${expected}. Use 8 to 64 hex digits.`);
  requireCondition(
    actual.startsWith(expected),
    `${subject} has digest ${actual}, not ${expected}. Read it again before you decide.`
  );
}
function index(items, key, name) {
  const map = /* @__PURE__ */ new Map();
  for (const item of items) {
    requireCondition(!map.has(item[key]), `Duplicate ${name}: ${String(item[key])}`);
    map.set(item[key], item);
  }
  return map;
}
function references(ids2, map, name) {
  for (const id2 of ids2) requireCondition(map.has(id2), `Unknown ${name}: ${id2}`);
}
function profileCheck(value2) {
  const profile = validate("profile", value2);
  index(profile.tools, "name", "tool");
  index(profile.entryPoints, "name", "entry point");
  for (const tool of profile.tools)
    requireCondition(
      tool.version === void 0 || !/resolve-and-pin|unknown/i.test(tool.version),
      `Record the actual version of ${tool.name}, or leave version out`
    );
  return profile;
}
function approvalPolicy(profile) {
  return profile.approvals ?? { plan: "required", result: "required" };
}
function gapsAffecting(gaps, test) {
  return gaps.filter(
    (gap) => gap.testIds.includes(test.id) || gap.requirementIds.some((id2) => test.requirementIds.includes(id2)) || gap.testIds.length === 0 && gap.requirementIds.length === 0
  );
}
function testReadiness(gaps, test) {
  const affected = gapsAffecting(gaps, test);
  if (affected.some((gap) => gap.status === "deferred" && gap.severity === "blocking")) return "deferred";
  if (affected.some((gap) => gap.status === "open" && gap.severity === "blocking")) return "blocked";
  return "ready";
}
function planCoverage(plan) {
  return plan.requirements.map((requirement) => {
    const tests = plan.tests.filter((test) => test.requirementIds.includes(requirement.id));
    const gaps = plan.gaps.filter(
      (gap) => gap.requirementIds.includes(requirement.id) || !gap.requirementIds.length && !gap.testIds.length
    );
    const status = gaps.some((gap) => gap.status === "deferred" && gap.severity === "blocking") || tests.some((test) => test.readiness === "deferred") ? "deferred" : gaps.some((gap) => gap.severity === "blocking" && gap.status === "open") || tests.some((test) => test.readiness === "blocked") || tests.length === 0 ? "blocked" : "planned";
    return { requirementId: requirement.id, testIds: tests.map((test) => test.id), status };
  });
}
function withoutEmptyMetadata(item) {
  if (!item.metadata || Object.keys(item.metadata).length) return item;
  const { metadata, ...rest } = item;
  return rest;
}
function derivePlan(draft) {
  const tests = draft.tests.map((test) => ({
    ...withoutEmptyMetadata(test),
    gapIds: gapsAffecting(draft.gaps, test).map((gap) => gap.id),
    readiness: testReadiness(draft.gaps, test)
  }));
  const requirements = draft.requirements.map(withoutEmptyMetadata);
  return { ...draft, requirements, tests, coverage: planCoverage({ ...draft, requirements, tests }) };
}
function planCheck(value2) {
  const plan = validate("plan", value2);
  const requirements = index(plan.requirements, "id", "requirement");
  const tests = index(plan.tests, "id", "test");
  const gaps = index(plan.gaps, "id", "gap");
  const decisions = index(plan.decisions, "id", "decision");
  index(plan.coverage, "requirementId", "coverage requirement");
  index(plan.assumptions, "decisionId", "assumption decision");
  const localReferences = (ids2) => ids2.filter((id2) => {
    const { planId } = testReference(id2);
    requireCondition(planId !== plan.planId, `Use the local test ID, not ${id2}`);
    return planId === null;
  });
  for (const gap of plan.gaps) {
    references(gap.requirementIds, requirements, `requirement in gap ${gap.id}`);
    references(localReferences(gap.testIds), tests, `test in gap ${gap.id}`);
    if (gap.status === "open") requireCondition(gap.decisionId === null, `Open gap ${gap.id} has a decision`);
    else {
      const decision = decisions.get(gap.decisionId ?? "");
      requireCondition(decision?.gapId === gap.id, `Gap ${gap.id} needs a matching decision`);
      requireCondition(
        decision.kind === "defer" === (gap.status === "deferred"),
        `Gap ${gap.id} status conflicts with decision ${decision.id}`
      );
    }
  }
  for (const decision of plan.decisions) {
    requireCondition(
      gaps.get(decision.gapId)?.decisionId === decision.id,
      `Decision ${decision.id} does not resolve its gap`
    );
    if (decision.kind === "clarify")
      requireCondition(decision.source, `Clarification ${decision.id} needs a source`);
    if (decision.kind === "accept_assumption")
      requireCondition(
        plan.assumptions.some((a) => a.decisionId === decision.id && a.text === decision.value),
        `Accepted assumption ${decision.id} must stay visible`
      );
  }
  for (const assumption of plan.assumptions)
    requireCondition(
      decisions.get(assumption.decisionId)?.kind === "accept_assumption",
      `Assumption ${assumption.decisionId} lacks oracle acceptance`
    );
  for (const test of plan.tests) {
    references(test.requirementIds, requirements, `requirement in test ${test.id}`);
    references(test.gapIds, gaps, `gap in test ${test.id}`);
    references(localReferences(test.dependsOn), tests, `dependency of test ${test.id}`);
    index(test.assertions, "id", `assertion in test ${test.id}`);
    requireCondition(
      same(
        test.gapIds,
        gapsAffecting(plan.gaps, test).map((gap) => gap.id)
      ),
      `Test ${test.id} gapIds conflict with gap scope`
    );
    requireCondition(
      test.readiness === testReadiness(plan.gaps, test),
      `Test ${test.id} readiness conflicts with gaps`
    );
    if (test.readiness === "ready")
      requireCondition(test.assertions.length > 0, `Ready test ${test.id} needs one or more assertions`);
  }
  for (const requirement of plan.requirements)
    requireCondition(
      plan.tests.some((test) => test.requirementIds.includes(requirement.id)) || plan.gaps.some((gap) => gap.requirementIds.includes(requirement.id)),
      `Requirement ${requirement.id} has no test or gap`
    );
  requireCondition(same(plan.coverage, planCoverage(plan)), "Plan coverage is inconsistent");
  return plan;
}
function planTargetCheck(plan, profile) {
  for (const test of plan.tests.filter((test2) => test2.readiness === "ready")) {
    requireCondition(
      profile.capabilities.includes(test.capability),
      `Test ${test.id} needs capability ${test.capability}, which the target lacks. Record a planning gap.`
    );
    for (const operation of test.operations)
      requireCondition(
        profile.allowedOperations.includes(operation),
        `Test ${test.id} uses operation ${operation}, which the target does not permit`
      );
  }
}
function dependencyCheck(plan, latest) {
  const plans = new Map(latest).set(plan.planId, plan);
  const crossReferences = [...plans.values()].flatMap((other) => [
    ...other.tests.flatMap((test) => test.dependsOn),
    ...other.gaps.flatMap((gap) => gap.testIds)
  ]).filter((id2) => id2.includes(":"));
  for (const reference of crossReferences) {
    const { planId, testId } = testReference(reference);
    const other = plans.get(planId);
    requireCondition(other, `Unknown plan in ${reference}: ${planId}`);
    requireCondition(
      other.tests.some((test) => test.id === testId),
      `Unknown test in ${reference}: ${testId} is not in ${planId}@${other.revision}`
    );
  }
  const edges = /* @__PURE__ */ new Map();
  for (const [planId, other] of plans)
    for (const test of other.tests)
      edges.set(
        `${planId}:${test.id}`,
        test.dependsOn.map((id2) => id2.includes(":") ? id2 : `${planId}:${id2}`)
      );
  const visiting = [];
  const visited = /* @__PURE__ */ new Set();
  function visit(node) {
    const start = visiting.indexOf(node);
    requireCondition(start < 0, `Test dependency cycle: ${[...visiting.slice(start), node].join(" -> ")}`);
    if (visited.has(node)) return;
    visiting.push(node);
    for (const next of edges.get(node) ?? []) visit(next);
    visiting.pop();
    visited.add(node);
  }
  for (const node of edges.keys()) visit(node);
}
function testOutcome(results) {
  if (results.includes("failed")) return "failed";
  if (results.includes("not_checked")) return "error";
  if (results.includes("inconclusive")) return "inconclusive";
  return "passed";
}
function resultCoverage(plan, tests, newGaps2) {
  const outcomes = new Map(tests.map((test) => [test.testId, test.outcome]));
  const conclusive = (test) => ["passed", "failed"].includes(outcomes.get(test.id) ?? "");
  const requirements = plan.requirements.map((requirement) => {
    const planned = plan.tests.filter((test) => test.requirementIds.includes(requirement.id));
    const gaps = [...plan.gaps, ...newGaps2].filter(
      (gap) => gap.requirementIds.includes(requirement.id) || !gap.requirementIds.length && !gap.testIds.length
    );
    const blocking = gaps.some((gap) => gap.status === "open" && gap.severity === "blocking");
    const deferredGap = gaps.some((gap) => gap.status === "deferred" && gap.severity === "blocking");
    const tested = planned.length > 0 && !blocking && !deferredGap && planned.every(conclusive);
    const deferred = !tested && !blocking && (deferredGap || planned.some((test) => test.readiness === "deferred")) && planned.every((test) => test.readiness === "deferred" || conclusive(test));
    return {
      requirementId: requirement.id,
      status: tested ? "tested" : deferred ? "deferred" : "uncovered",
      testIds: planned.map((test) => test.id),
      reason: tested ? null : deferred ? "An oracle decision deferred the missing checks." : planned.some((test) => outcomes.get(test.id) === "inconclusive") ? "An assertion is inconclusive." : "At least one required check or decision is missing."
    };
  });
  const executed = ["passed", "failed", "error", "inconclusive"];
  return {
    status: requirements.every((row) => row.status === "tested") ? "complete" : tests.some((test) => executed.includes(test.outcome)) ? "partial" : "not_executed",
    requirements
  };
}

// plugin/src/targets.ts
var toolKinds = ["cli", "mcp", "skill"];
var entryPointKinds = ["url", "command", "value"];
function openTarget(store, actor, input) {
  return write(store, { actor, command: "target open", subject: input.targetId, input }, (operationId) => {
    const request = targetRequestCheck(input);
    const existing = one(
      store,
      "SELECT body FROM target_requests WHERE target_id = ?",
      request.targetId
    );
    if (existing) {
      requireCondition(
        existing.body === canonical(request),
        `Target ${request.targetId} is open with other values. Use a new target ID for a different scope.`
      );
      return { reply: completed(request.targetId, { request, recorded: false }), subjects: [] };
    }
    execute(
      store,
      "INSERT INTO target_requests (target_id, body, operation_id) VALUES (?, ?, ?)",
      request.targetId,
      canonical(request),
      operationId
    );
    return {
      reply: completed(request.targetId, { request, recorded: true }),
      subjects: [`target:${request.targetId}`]
    };
  });
}
function targetRequestCheck(input) {
  requireIdentifier(input.targetId, "target ID");
  requireCondition(
    Array.isArray(input.entryPoints) && input.entryPoints.length > 0,
    "Missing entry points. Give one or more --entry-point <name>:<url|command|value>:<purpose>."
  );
  const entryPoints = input.entryPoints.map(entryPointCheck);
  requireCondition(
    new Set(entryPoints.map((entry) => entry.name)).size === entryPoints.length,
    "Duplicate entry point name"
  );
  for (const [name, list2] of [
    ["capabilities", input.capabilities],
    ["operations", input.allowedOperations]
  ]) {
    requireCondition(Array.isArray(list2) && list2.length > 0, `Missing ${name}`);
    list2.forEach((item) => requireIdentifier(item, name));
    requireCondition(new Set(list2).size === list2.length, `Duplicate item in ${name}`);
  }
  const tools = (input.tools ?? []).map((tool) => toolCheck(tool));
  requireCondition(new Set(tools.map((tool) => tool.name)).size === tools.length, "Duplicate tool name");
  return {
    targetId: input.targetId,
    entryPoints,
    capabilities: input.capabilities,
    allowedOperations: input.allowedOperations,
    tools
  };
}
function entryPointCheck(entry) {
  const name = requireIdentifier(entry.name, "entry point name");
  return {
    name,
    kind: requireChoice(entry.kind, entryPointKinds, `kind of entry point ${name}`),
    purpose: requireText(entry.purpose, `purpose of entry point ${name}`).trim()
  };
}
function toolName(value2) {
  const name = typeof value2 === "string" ? value2.trim() : value2;
  requireCondition(
    typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}(:[A-Za-z0-9][A-Za-z0-9_-]{0,95})?$/.test(name),
    `Invalid tool name: ${String(name)}. Use 1 to 96 letters, digits, _ or -, starting with a letter or digit, with an optional <plugin>: prefix.`
  );
  return name;
}
function toolCheck(tool) {
  return {
    name: toolName(tool.name),
    kind: requireChoice(tool.kind, toolKinds, `kind of tool ${tool.name}`),
    purpose: requireText(tool.purpose, `purpose of tool ${tool.name}`)
  };
}
function targetRequest(store, targetId) {
  const row = one(store, "SELECT body FROM target_requests WHERE target_id = ?", targetId);
  requireCondition(row, `Unknown target: ${targetId}. Run target open first.`);
  return JSON.parse(row.body);
}
function showTargetRequest(store, targetId) {
  return completed(targetId, { request: targetRequest(store, targetId) });
}
function saveTarget(store, actor, input) {
  const reply = save(store, actor, input);
  removeTemporaryDirectory(store, `setup-${input.targetId}`);
  return reply;
}
function save(store, actor, input) {
  return write(store, { actor, command: "target save", subject: input.targetId, input }, (operationId) => {
    const request = targetRequest(store, input.targetId);
    const profile = profileCheck(input.profile);
    requireCondition(
      profile.targetId === request.targetId,
      `Profile targetId ${profile.targetId} differs from ${request.targetId}`
    );
    requireCondition(
      same(profile.entryPoints, request.entryPoints),
      "Profile entryPoints differ from the setup request"
    );
    requireCondition(
      same(profile.capabilities, request.capabilities),
      "Profile capabilities differ from the setup request"
    );
    requireCondition(
      same(profile.allowedOperations, request.allowedOperations),
      "Profile allowedOperations differ from the setup request"
    );
    for (const requested of request.tools) {
      const tool = profile.tools.find((tool2) => tool2.name === requested.name);
      requireCondition(tool, `Profile has no entry for the requested tool ${requested.name}`);
      requireCondition(
        tool.kind === requested.kind,
        `Tool ${tool.name} is ${tool.kind} in the profile, not ${requested.kind}`
      );
    }
    const unreachable = profile.tools.filter((tool) => !tool.reachable && request.tools.some((requested) => requested.name === tool.name)).map((tool) => `Requested tool ${tool.name} (${tool.kind}) is not reachable`);
    requireCondition(
      !unreachable.length || !profile.readyForLiveExecution,
      `${unreachable.join(". ")}. Set readyForLiveExecution to false.`
    );
    const body = canonical(profile);
    const latest = one(
      store,
      "SELECT revision, body FROM profiles WHERE target_id = ? ORDER BY revision DESC LIMIT 1",
      profile.targetId
    );
    const subject = `${profile.targetId}@${profile.revision}`;
    const reasons2 = profile.readyForLiveExecution ? [] : [...unreachable, "Target prerequisites are not ready. Inspect the profile."];
    const status = profile.readyForLiveExecution ? "completed" : "needs_decision";
    const data = { targetId: profile.targetId, revision: profile.revision, sha256: digest(body) };
    if (latest && latest.revision === profile.revision) {
      requireCondition(
        latest.body === body,
        `Profile ${subject} exists with other content. Save revision ${latest.revision + 1} for changes.`
      );
      return { reply: { status, subject, reasons: reasons2, data: { ...data, recorded: false } }, subjects: [] };
    }
    const next = (latest?.revision ?? 0) + 1;
    requireCondition(profile.revision === next, `Profile revision must be ${next}, not ${profile.revision}`);
    execute(
      store,
      "INSERT INTO profiles (target_id, revision, sha256, body, operation_id) VALUES (?, ?, ?, ?, ?)",
      profile.targetId,
      profile.revision,
      data.sha256,
      body,
      operationId
    );
    return {
      reply: { status, subject, reasons: reasons2, data: { ...data, recorded: true } },
      subjects: [`target:${profile.targetId}`]
    };
  });
}
function targetRevision(store, targetId, revision = null) {
  const row = one(
    store,
    revision === null ? "SELECT revision, sha256, body FROM profiles WHERE target_id = ? ORDER BY revision DESC LIMIT 1" : "SELECT revision, sha256, body FROM profiles WHERE target_id = ? AND revision = ?",
    targetId,
    ...revision === null ? [] : [revision]
  );
  requireCondition(row, `Unknown target profile: ${targetId}${revision === null ? "" : `@${revision}`}`);
  return { profile: JSON.parse(row.body), revision: row.revision, sha256: row.sha256 };
}
function showTarget(store, reference, instanceId) {
  const { id: id2, revision } = revisionReference(reference, "target reference");
  const target = targetRevision(store, id2, revision);
  return completed(`${id2}@${target.revision}`, {
    targetId: id2,
    revision: target.revision,
    sha256: target.sha256,
    approvals: approvalPolicy(target.profile),
    profile: target.profile,
    instances: instanceList(store, id2).filter((instance) => !instance.retired),
    ...instanceId === void 0 ? {} : { instance: findInstance(store, id2, instanceId) }
  });
}
function targetList(store) {
  return all(
    store,
    `SELECT r.target_id, r.body, (SELECT max(revision) FROM profiles p WHERE p.target_id = r.target_id) AS revision,
			(SELECT count(*) FROM instances i WHERE i.target_id = r.target_id AND NOT EXISTS
				(SELECT 1 FROM instance_retirements x WHERE x.target_id = i.target_id AND x.instance_id = i.instance_id))
				AS instances
		FROM target_requests r ORDER BY r.target_id`
  ).map((row) => {
    const request = JSON.parse(row.body);
    return {
      targetId: row.target_id,
      revision: row.revision,
      capabilities: request.capabilities,
      entryPoints: request.entryPoints.map((entry) => entry.name),
      activeInstances: row.instances
    };
  });
}
function targetHistory(store, targetId) {
  targetRequest(store, targetId);
  const rows = all(
    store,
    `SELECT p.revision, p.sha256, p.body, o.at, o.actor FROM profiles p JOIN operations o ON o.id = p.operation_id
		WHERE p.target_id = ? ORDER BY p.revision`,
    targetId
  );
  return rows.map((row, i) => {
    const profile = JSON.parse(row.body);
    const before = i ? JSON.parse(rows[i - 1].body) : null;
    const keys = [.../* @__PURE__ */ new Set([...Object.keys(profile), ...Object.keys(before ?? {})])].sort();
    return {
      revision: row.revision,
      sha256: row.sha256,
      at: row.at,
      actor: row.actor,
      changed: before ? keys.filter((key) => key !== "revision" && canonical(profile[key]) !== canonical(before[key])) : []
    };
  });
}
function instanceCheck(entryPoints, value2) {
  const instance = validate("instance", value2);
  const names = Object.keys(instance.entries);
  const missing = entryPoints.filter((entry) => !names.includes(entry.name)).map((entry) => entry.name);
  const unknown = names.filter((name) => !entryPoints.some((entry) => entry.name === name));
  requireCondition(!missing.length, `Missing value for entry point: ${missing.join(", ")}`);
  requireCondition(
    !unknown.length,
    `Unknown entry point: ${unknown.join(", ")}. The target has: ${entryPoints.map((entry) => entry.name).join(", ")}.`
  );
  const entries = {};
  for (const entry of entryPoints) {
    const text = requireText(instance.entries[entry.name], `value for entry point ${entry.name}`).trim();
    entries[entry.name] = text;
    if (entry.kind !== "url") continue;
    let url;
    try {
      url = new URL(text);
    } catch {
      throw new Error(`Entry point ${entry.name} needs a valid URL, not ${text}`);
    }
    requireCondition(
      !url.username && !url.password,
      `Entry point ${entry.name} has URL credentials. Use authentication references instead.`
    );
  }
  const references2 = (instance.references ?? []).map((reference) => requireText(reference, "reference").trim());
  const repeated = references2.find((reference, i) => references2.indexOf(reference) !== i);
  requireCondition(repeated === void 0, `Reference ${repeated} is given twice`);
  return {
    entries,
    ...instance.environment === void 0 ? {} : { environment: requireText(instance.environment, "environment").trim() },
    references: references2
  };
}
function addInstance(store, actor, input) {
  return write(store, { actor, command: "target instance add", subject: input.targetId, input }, (operationId) => {
    const request = targetRequest(store, input.targetId);
    const instanceId = requireIdentifier(input.instanceId, "instance ID");
    const instance = instanceCheck(request.entryPoints, input.instance);
    const subject = `${input.targetId}/${instanceId}`;
    const existing = one(
      store,
      "SELECT body FROM instances WHERE target_id = ? AND instance_id = ?",
      input.targetId,
      instanceId
    );
    if (existing) {
      requireCondition(
        !retirement(store, input.targetId, instanceId),
        `Instance ${subject} is retired. Use a new instance ID.`
      );
      requireCondition(
        existing.body === canonical(instance),
        `Instance ${subject} exists. An instance does not change. Use a new instance ID.`
      );
      return { reply: completed(subject, { ...instance, instanceId, recorded: false }), subjects: [] };
    }
    execute(
      store,
      "INSERT INTO instances (target_id, instance_id, body, operation_id) VALUES (?, ?, ?, ?)",
      input.targetId,
      instanceId,
      canonical(instance),
      operationId
    );
    return {
      reply: completed(subject, { ...instance, instanceId, recorded: true }),
      subjects: [`target:${input.targetId}`]
    };
  });
}
function retireInstance(store, actor, input) {
  return write(store, { actor, command: "target instance retire", subject: input.targetId, input }, (operationId) => {
    const instance = findInstance(store, input.targetId, input.instanceId);
    const subject = `${input.targetId}/${input.instanceId}`;
    if (instance.retired)
      return {
        reply: completed(subject, { instanceId: input.instanceId, recorded: false }),
        subjects: []
      };
    execute(
      store,
      "INSERT INTO instance_retirements (target_id, instance_id, operation_id) VALUES (?, ?, ?)",
      input.targetId,
      input.instanceId,
      operationId
    );
    const startedRuns = all(
      store,
      "SELECT r.run_id FROM runs r LEFT JOIN results s ON s.run_id = r.run_id WHERE r.target_id = ? AND r.instance_id = ? AND s.run_id IS NULL ORDER BY r.rowid",
      input.targetId,
      input.instanceId
    ).map((row) => row.run_id);
    return {
      reply: completed(subject, { instanceId: input.instanceId, recorded: true, startedRuns }),
      subjects: [`target:${input.targetId}`]
    };
  });
}
function retirement(store, targetId, instanceId) {
  return one(
    store,
    `SELECT o.at, o.actor FROM instance_retirements x JOIN operations o ON o.id = x.operation_id
		WHERE x.target_id = ? AND x.instance_id = ?`,
    targetId,
    instanceId
  );
}
function instanceRecord(store, targetId, row) {
  const body = JSON.parse(row.body);
  const order = targetRequest(store, targetId).entryPoints.map((entry) => entry.name);
  const retired = retirement(store, targetId, row.instance_id);
  return {
    targetId,
    instanceId: row.instance_id,
    entries: Object.fromEntries(order.map((name) => [name, body.entries[name]])),
    environment: body.environment ?? null,
    references: body.references ?? [],
    addedAt: row.at,
    addedBy: row.actor,
    retired: retired ? { at: retired.at, actor: retired.actor } : null
  };
}
function instanceList(store, targetId) {
  targetRequest(store, targetId);
  return all(
    store,
    `SELECT i.instance_id, i.body, o.at, o.actor FROM instances i JOIN operations o ON o.id = i.operation_id
		WHERE i.target_id = ? ORDER BY i.rowid`,
    targetId
  ).map((row) => instanceRecord(store, targetId, row));
}
function findInstance(store, targetId, instanceId) {
  targetRequest(store, targetId);
  const row = one(
    store,
    `SELECT i.instance_id, i.body, o.at, o.actor FROM instances i JOIN operations o ON o.id = i.operation_id
		WHERE i.target_id = ? AND i.instance_id = ?`,
    targetId,
    instanceId
  );
  requireCondition(row, `Unknown instance: ${targetId}/${instanceId}. Run target instance list ${targetId}.`);
  return instanceRecord(store, targetId, row);
}
function runInstance(store, targetId, instanceId) {
  if (instanceId !== void 0) {
    const instance = findInstance(store, targetId, instanceId);
    requireCondition(
      !instance.retired,
      `Instance ${targetId}/${instanceId} is retired. A retired instance cannot start a run.`
    );
    return instance;
  }
  const active = instanceList(store, targetId).filter((instance) => !instance.retired);
  requireCondition(
    active.length,
    `Target ${targetId} has no active instance. Add one with target instance add ${targetId} <instanceId>.`
  );
  requireCondition(
    active.length === 1,
    `Target ${targetId} has ${active.length} active instances: ${active.map((instance) => instance.instanceId).join(", ")}. Name one with --instance.`
  );
  return active[0];
}

// plugin/src/plans.ts
var decisionKinds = ["clarify", "accept_assumption", "defer"];
var partialModes = ["wait_for_resolution", "ready_only"];
function openPlan(store, actor, input) {
  return write(store, { actor, command: "plan open", subject: input.planId, input }, (operationId) => {
    const planId = requireIdentifier(input.planId, "plan ID");
    const target = revisionReference(requireText(input.target, "target (--target)"), "target reference");
    requireCondition(target.revision !== null, `Name the target revision: --target ${target.id}@<revision>`);
    const profile = targetRevision(store, target.id, target.revision).profile;
    const request = validate("plan-request", input.request);
    requireCondition(
      request.requirements?.length || request.context?.sources.length,
      "A plan request needs requirements or context sources"
    );
    index(request.requirements ?? [], "id", "requirement");
    for (const tool of request.tools ?? [])
      if (typeof tool === "string")
        requireCondition(
          profile.tools.some((known) => known.name === tool),
          `Unknown tool ${tool}. The target profile has: ${profile.tools.map((known) => known.name).join(", ") || "no tools"}.`
        );
      else {
        toolCheck(tool);
        requireCondition(
          !profile.tools.some((known) => known.name === tool.name),
          `Tool ${tool.name} is in the target profile. Name it as a string.`
        );
      }
    const names = planTools(request, profile).map((tool) => tool.name);
    requireCondition(new Set(names).size === names.length, "Duplicate tool name in the plan request");
    const body = canonical(request);
    const data = { planId, target: `${target.id}@${target.revision}` };
    const existing = one(store, "SELECT * FROM plan_requests WHERE plan_id = ?", planId);
    if (existing) {
      requireCondition(
        existing.target_id === target.id && existing.target_revision === target.revision && existing.body === body,
        `Plan ${planId} is open with another request. Use a new plan ID.`
      );
      return { reply: completed(planId, { ...data, recorded: false }), subjects: [] };
    }
    execute(
      store,
      "INSERT INTO plan_requests (plan_id, target_id, target_revision, body, operation_id) VALUES (?, ?, ?, ?, ?)",
      planId,
      target.id,
      target.revision,
      body,
      operationId
    );
    return { reply: completed(planId, { ...data, recorded: true }), subjects: [`plan:${planId}`, "inbox"] };
  });
}
function planRequest(store, planId) {
  const row = one(store, "SELECT * FROM plan_requests WHERE plan_id = ?", planId);
  requireCondition(row, `Unknown plan: ${planId}. Run plan open first.`);
  const request = JSON.parse(row.body);
  return { request, target: targetRevision(store, row.target_id, row.target_revision) };
}
function planTools(request, profile) {
  const named = (request.tools ?? []).filter((tool) => typeof tool === "string");
  const added = (request.tools ?? []).filter((tool) => typeof tool !== "string");
  const kept = named.length ? profile.tools.filter((tool) => named.includes(tool.name)) : profile.tools;
  return [...kept, ...added];
}
function showPlanRequest(store, planId) {
  const { request, target } = planRequest(store, planId);
  return completed(planId, {
    planId,
    target: `${target.profile.targetId}@${target.revision}`,
    objective: request.objective,
    requirements: request.requirements ?? [],
    sourceContext: request.sourceContext ?? [],
    context: request.context ?? { sources: [] },
    tools: planTools(request, target.profile),
    capabilities: target.profile.capabilities,
    allowedOperations: target.profile.allowedOperations
  });
}
function planRevision(store, planId, revision = null) {
  const row = one(
    store,
    revision === null ? "SELECT body, sha256 FROM latest_plans WHERE plan_id = ?" : "SELECT body, sha256 FROM plan_revisions WHERE plan_id = ? AND revision = ?",
    planId,
    ...revision === null ? [] : [revision]
  );
  if (!row) {
    planRequest(store, planId);
    throw new Error(
      revision === null ? `Plan ${planId} has no revision. Run plan save first.` : `Plan ${planId} has no revision ${revision}`
    );
  }
  return { plan: JSON.parse(row.body), sha256: row.sha256 };
}
function latestPlans(store) {
  const rows = all(
    store,
    "SELECT plan_id, body FROM latest_plans ORDER BY plan_id"
  );
  return new Map(rows.map((row) => [row.plan_id, JSON.parse(row.body)]));
}
function checkedRevision(store, draft) {
  const plan = planCheck(derivePlan(draft));
  planTargetCheck(plan, targetRevision(store, plan.target.targetId, plan.target.revision).profile);
  const others = latestPlans(store);
  others.delete(plan.planId);
  dependencyCheck(plan, others);
  const body = canonical(plan);
  return { plan, body, sha256: digest(body) };
}
function revisionChange(plan, sha256) {
  const blockers = plan.gaps.filter((gap) => gap.status === "open" && gap.severity === "blocking");
  return {
    reply: {
      status: blockers.length ? "needs_decision" : "completed",
      subject: `${plan.planId}@${plan.revision}`,
      reasons: blockers.map((gap) => `${gap.id}: ${gap.question}`),
      data: { planId: plan.planId, revision: plan.revision, sha256 }
    },
    subjects: [`plan:${plan.planId}`, "inbox"]
  };
}
function storeRevision(store, draft, operationId) {
  const { plan, body, sha256 } = checkedRevision(store, draft);
  execute(
    store,
    "INSERT INTO plan_revisions (plan_id, revision, previous_revision, sha256, body, operation_id) VALUES (?, ?, ?, ?, ?, ?)",
    plan.planId,
    plan.revision,
    plan.previousRevision,
    sha256,
    body,
    operationId
  );
  return revisionChange(plan, sha256);
}
function planCandidate(plan) {
  return {
    requirements: plan.requirements,
    tests: plan.tests.map(({ readiness, gapIds, ...test }) => test),
    gaps: plan.gaps
  };
}
function frozenRevision(store, planId, revision) {
  if (one(store, "SELECT 1 FROM runs WHERE plan_id = ? AND plan_revision = ?", planId, revision)) return "run";
  const approved = one(
    store,
    "SELECT 1 FROM approvals WHERE subject_kind = 'plan' AND subject_id = ? AND verdict = 'approved'",
    `${planId}@${revision}`
  );
  return approved ? "approved" : null;
}
function editPlan(store, actor, input) {
  return write(store, { actor, command: "plan edit", subject: input.reference, input }, (operationId) => {
    const base = editableRevision(store, input.reference, input.expectSha256);
    const candidate = validate("plan-candidate", input.candidate);
    gapEditCheck(store, base.plan, candidate);
    return storeEdit(store, operationId, base, candidate);
  });
}
function patchPlan(store, actor, input) {
  return write(store, { actor, command: "plan edit", subject: input.reference, input }, (operationId) => {
    const base = editableRevision(store, input.reference, input.expectSha256);
    const patch = validate("plan-patch", input.patch);
    const candidate = patchedCandidate(base.plan, patch);
    gapEditCheck(store, base.plan, candidate);
    return storeEdit(store, operationId, base, candidate);
  });
}
function gapEditCheck(store, plan, candidate) {
  const { gaps, tests } = candidate;
  const pending = pendingDecisions(store, plan.planId).map((decision) => decision.gap_id);
  const kept = (id2) => id2.includes(":") || tests.some((test) => test.id === id2);
  for (const old of plan.gaps) {
    if (old.status === "open" && !pending.includes(old.id)) continue;
    const now = gaps.find((gap) => gap.id === old.id);
    requireCondition(
      now && same(now, { ...old, testIds: old.testIds.filter(kept) }),
      `Gap ${old.id} has a decision. Only an open gap without a decision can change.`
    );
  }
  const open = planRunGaps(store, plan.planId).filter((item) => !item.adopted);
  for (const gap of gaps.filter((gap2) => !plan.gaps.some((old) => old.id === gap2.id)))
    requireCondition(
      !one(store, "SELECT 1 FROM plan_gaps WHERE plan_id = ? AND gap_id = ?", plan.planId, gap.id) && !open.some((item) => item.gap.id === gap.id),
      `Gap ID ${gap.id} is in use. Use a new ID.`
    );
}
function adoptGaps(store, actor, input) {
  return write(store, { actor, command: "plan adopt-gaps", subject: input.reference, input }, (operationId) => {
    const base = editableRevision(store, input.reference, input.expectSha256);
    const planId = base.plan.planId;
    const run2 = one(store, "SELECT plan_id FROM runs WHERE run_id = ?", input.runId);
    requireCondition(run2, `Unknown run: ${input.runId}`);
    requireCondition(run2.plan_id === planId, `Run ${input.runId} tests plan ${run2.plan_id}, not ${planId}`);
    const recorded = planRunGaps(store, planId).filter((item) => item.runId === input.runId);
    const gaps = input.gapIds === void 0 ? recorded.filter((item) => !item.adopted).map((item) => item.gap) : input.gapIds.map((id2) => {
      const item = recorded.find((item2) => item2.gap.id === id2);
      requireCondition(item, `Run ${input.runId} has no gap ${id2}`);
      requireCondition(!item.adopted, `Gap ${id2} of run ${input.runId} is in plan ${planId}`);
      return item.gap;
    });
    requireCondition(gaps.length, `Run ${input.runId} has no gap to adopt`);
    return adoption(store, operationId, base, input.runId, gaps);
  });
}
function adoption(store, operationId, base, runId, gaps) {
  const candidate = planCandidate(base.plan);
  const tested = runPlan(store, runId);
  const kept = gaps.map((gap) => currentScope(base.plan, tested, gap));
  const change = storeEdit(store, operationId, base, { ...candidate, gaps: [...candidate.gaps, ...kept] });
  change.reply.data.runId = runId;
  change.reply.data.adopted = gaps.map((gap) => gap.id);
  change.subjects.push(`run:${runId}`);
  return change;
}
function runPlan(store, runId) {
  const run2 = one(
    store,
    "SELECT plan_id, plan_revision FROM runs WHERE run_id = ?",
    runId
  );
  return planRevision(store, run2.plan_id, run2.plan_revision).plan;
}
function currentScope(plan, tested, gap) {
  const exists = (id2) => id2.includes(":") || plan.tests.some((test) => test.id === id2);
  const known = (id2) => plan.requirements.some((requirement) => requirement.id === id2);
  const testIds = gap.testIds.filter(exists);
  const removed = gap.testIds.filter((id2) => !exists(id2));
  const requirementIds = testIds.length || gap.requirementIds.length ? gap.requirementIds.filter(known) : tested.tests.filter((test) => removed.includes(test.id)).flatMap((test) => test.requirementIds.filter(known));
  requireCondition(
    testIds.length || requirementIds.length || !gap.testIds.length && !gap.requirementIds.length,
    `Gap ${gap.id} names only tests and requirements that ${plan.planId}@${plan.revision} does not have. Record a new gap.`
  );
  return { ...gap, testIds, requirementIds: [...new Set(requirementIds)] };
}
function planRunGaps(store, planId) {
  return all(
    store,
    `SELECT g.run_id, g.body, o.at, EXISTS (SELECT 1 FROM plan_gaps p
			WHERE p.plan_id = r.plan_id AND p.revision > r.plan_revision AND p.gap_id = g.id) AS adopted
		FROM run_gaps g JOIN runs r ON r.run_id = g.run_id JOIN operations o ON o.id = g.operation_id
		WHERE r.plan_id = ? ORDER BY g.rowid`,
    planId
  ).map((row) => ({ runId: row.run_id, gap: JSON.parse(row.body), adopted: row.adopted === 1, at: row.at }));
}
function editableRevision(store, text, expectSha256) {
  const reference = revisionReference(requireText(text, "plan reference"), "plan reference");
  requireCondition(reference.revision !== null, `Name the plan revision: ${reference.id}@<revision>`);
  const base = planRevision(store, reference.id, reference.revision);
  const subject = `${reference.id}@${reference.revision}`;
  const latest = planRevision(store, reference.id).plan.revision;
  requireCondition(
    latest === reference.revision,
    `${subject} is not the latest revision. Edit ${reference.id}@${latest}.`
  );
  expectDigest(base.sha256, expectSha256, subject);
  return base;
}
function storeEdit(store, operationId, base, value2) {
  const candidate = validate("plan-candidate", value2);
  const planId = base.plan.planId;
  const frozen = frozenRevision(store, planId, base.plan.revision);
  const { coverage: coverage2, tests, ...kept } = structuredClone(base.plan);
  const draft = {
    ...kept,
    ...frozen ? { revision: base.plan.revision + 1, previousRevision: base.plan.revision } : {},
    requirements: candidate.requirements ?? kept.requirements,
    tests: candidate.tests,
    gaps: candidate.gaps
  };
  for (const decision of pendingDecisions(store, planId))
    requireCondition(
      draft.gaps.some((gap) => gap.id === decision.gap_id && gap.status === "open"),
      `Gap ${decision.gap_id} has a pending decision ${decision.id}. Keep the gap open.`
    );
  for (const test of draft.tests) {
    const before = base.plan.tests.find((item) => item.id === test.id)?.assertions ?? [];
    const used = usedAssertionIds(store, planId, test.id);
    for (const assertion of test.assertions)
      requireCondition(
        before.some((item) => item.id === assertion.id) || !used.includes(assertion.id),
        `Assertion ID ${test.id}.${assertion.id} was used in an earlier revision. Use a new ID.`
      );
  }
  if (frozen) {
    const change2 = storeRevision(store, draft, operationId);
    change2.reply.data.edit = "new_revision";
    change2.reply.data.reason = frozen;
    return change2;
  }
  const { plan, body, sha256 } = checkedRevision(store, draft);
  execute(
    store,
    "UPDATE plan_revisions SET sha256 = ?, body = ?, operation_id = ? WHERE plan_id = ? AND revision = ?",
    sha256,
    body,
    operationId,
    plan.planId,
    plan.revision
  );
  const change = revisionChange(plan, sha256);
  change.reply.data.edit = "in_place";
  change.reply.data.previousSha256 = base.sha256;
  return change;
}
function patchedCandidate(plan, patch) {
  const candidate = planCandidate(structuredClone(plan));
  return {
    requirements: patchList(
      candidate.requirements,
      patch.requirements,
      "requirement",
      (item, id2, change) => item ? { ...item, ...change } : { id: id2, ...newFields(`requirement ${id2}`, change, ["text", "source"]) }
    ),
    tests: patchList(candidate.tests, patch.tests, "test", (item, id2, change) => {
      const { assertions, ...fields } = change;
      const test = item ? { ...item, ...fields } : {
        id: id2,
        assertions: [],
        ...newFields(
          `test ${id2}`,
          fields,
          ["title", "requirementIds", "capability", "operations", "action"],
          { dependsOn: [], preconditions: [] }
        )
      };
      test.assertions = patchList(
        test.assertions,
        assertions,
        `assertion in test ${id2}`,
        (old, key, value2) => old ? { ...old, ...value2 } : { id: key, ...newFields(`assertion ${id2}.${key}`, value2, ["check", "checkKind"]) }
      );
      return test;
    }),
    gaps: patchList(
      candidate.gaps,
      patch.gaps,
      "gap",
      (item, id2, change) => item ? { ...item, ...change } : {
        id: id2,
        status: "open",
        decisionId: null,
        ...newFields(`gap ${id2}`, change, [
          "severity",
          "requirementIds",
          "testIds",
          "question",
          "consequence"
        ])
      }
    )
  };
}
function patchList(items, changes, name, apply) {
  const result = [...items];
  for (const [id2, change] of Object.entries(changes ?? {})) {
    const position = result.findIndex((item) => item.id === id2);
    if (change === null) {
      requireCondition(position >= 0, `Cannot remove unknown ${name} ${id2}`);
      result.splice(position, 1);
    } else if (position >= 0) result[position] = apply(result[position], id2, change);
    else result.push(apply(void 0, id2, change));
  }
  return result;
}
function newFields(name, change, required, defaults = {}) {
  const missing = required.filter((field2) => !(field2 in change));
  requireCondition(!missing.length, `New ${name} needs ${missing.join(", ")}`);
  return { ...defaults, ...change };
}
function savePlan(store, actor, input) {
  return write(store, { actor, command: "plan save", subject: input.planId, input }, (operationId) => {
    const { request, target } = planRequest(store, input.planId);
    requireCondition(
      !one(store, "SELECT 1 FROM plan_revisions WHERE plan_id = ?", input.planId),
      `Plan ${input.planId} has revision 1. Use plan edit, or gap answer and plan revise, to change it.`
    );
    const candidate = validate("plan-candidate", input.candidate);
    const requirements = candidateRequirements(request, candidate.requirements);
    return storeRevision(
      store,
      {
        contractVersion: "toolkit-2",
        planId: input.planId,
        revision: 1,
        previousRevision: null,
        target: { targetId: target.profile.targetId, revision: target.revision, sha256: target.sha256 },
        objective: request.objective,
        requirements,
        tests: candidate.tests,
        gaps: candidate.gaps,
        assumptions: [],
        decisions: []
      },
      operationId
    );
  });
}
function candidateRequirements(request, drafted) {
  if (request.requirements?.length) {
    requireCondition(!drafted, "The plan request names the requirements. Do not add requirements to the candidate.");
    return request.requirements;
  }
  const sources = request.context?.sources ?? [];
  requireCondition(
    drafted?.length,
    `The plan request has no requirements. Draft them from the context sources: ${sources.join(", ")}`
  );
  index(drafted, "id", "requirement");
  for (const requirement of drafted)
    requireCondition(
      sources.some((source) => requirement.source.startsWith(source)),
      `Requirement ${requirement.id} cites ${requirement.source}, which is not a context source. Use one of: ${sources.join(", ")}`
    );
  return drafted;
}
function pendingDecisions(store, planId) {
  return all(
    store,
    "SELECT * FROM decisions WHERE plan_id = ? AND applied_revision IS NULL ORDER BY rowid",
    planId
  );
}
function answerGap(store, actor, input) {
  return write(store, { actor, command: "gap answer", subject: input.planId, input }, (operationId, at, actor2) => {
    const kind = requireChoice(input.kind, decisionKinds, "decision kind (--kind)");
    const value2 = requireText(input.value, "decision value (--value)");
    const rationale = requireText(input.rationale, "rationale (--rationale)");
    const source = input.source ?? null;
    if (source !== null) requireText(source, "source (--source)");
    requireCondition(kind !== "clarify" || source, "A clarification needs a source (--source)");
    const answered = planRevision(store, input.planId);
    expectDigest(answered.sha256, input.expectSha256, `${input.planId}@${answered.plan.revision}`);
    const adopted = answered.plan.gaps.some((gap2) => gap2.id === input.gapId) ? null : adoptRunGap(store, operationId, answered, input.gapId);
    const latest = adopted ? planRevision(store, input.planId) : answered;
    const subject = `${input.planId}@${latest.plan.revision}`;
    const gap = latest.plan.gaps.find((gap2) => gap2.id === input.gapId);
    requireCondition(
      gap.status === "open",
      `Gap ${gap.id} is ${gap.status} in ${subject}. Only an open gap takes a decision.`
    );
    const pending = pendingDecisions(store, input.planId).find((decision) => decision.gap_id === gap.id);
    requireCondition(
      !pending,
      `Gap ${gap.id} has a pending decision ${pending?.id}. Run plan revise to apply it first.`
    );
    const id2 = ulid();
    execute(
      store,
      "INSERT INTO decisions (id, plan_id, base_revision, gap_id, kind, value, source, rationale, actor, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id2,
      input.planId,
      latest.plan.revision,
      gap.id,
      kind,
      value2,
      source,
      rationale,
      actor2,
      operationId
    );
    return {
      reply: completed(input.planId, {
        decisionId: id2,
        planId: input.planId,
        baseRevision: latest.plan.revision,
        gapId: gap.id,
        kind,
        ...adopted ? {
          adopted: {
            runId: adopted.reply.data.runId,
            revision: latest.plan.revision,
            edit: adopted.reply.data.edit
          }
        } : {}
      }),
      subjects: adopted ? adopted.subjects : [`plan:${input.planId}`, "inbox"]
    };
  });
}
function adoptRunGap(store, operationId, base, gapId) {
  const subject = `${base.plan.planId}@${base.plan.revision}`;
  const found = planRunGaps(store, base.plan.planId).find((item) => item.gap.id === gapId && !item.adopted);
  requireCondition(found, `Unknown gap ${gapId} in ${subject}`);
  return adoption(store, operationId, base, found.runId, [found.gap]);
}
function affectedTests(plan, gapIds) {
  const gaps = plan.gaps.filter((gap) => gapIds.includes(gap.id));
  return plan.tests.filter((test) => gapsAffecting(gaps, test).length > 0);
}
function showPending(store, planId) {
  const latest = planRevision(store, planId);
  const decisions = pendingDecisions(store, planId);
  const gapIds = decisions.map((decision) => decision.gap_id);
  return completed(`${planId}@${latest.plan.revision}`, {
    planId,
    revision: latest.plan.revision,
    sha256: latest.sha256,
    decisions: decisions.map(decisionSnapshot),
    gaps: latest.plan.gaps.filter((gap) => gapIds.includes(gap.id)),
    tests: affectedTests(latest.plan, gapIds)
  });
}
function decisionSnapshot(row) {
  return {
    id: row.id,
    gapId: row.gap_id,
    kind: row.kind,
    actor: row.actor,
    rationale: row.rationale,
    value: row.value,
    source: row.source
  };
}
function revisePlan(store, actor, input) {
  return write(store, { actor, command: "plan revise", subject: input.planId, input }, (operationId) => {
    const base = planRevision(store, input.planId);
    expectDigest(base.sha256, input.expectSha256, `${input.planId}@${base.plan.revision}`);
    const decisions = pendingDecisions(store, input.planId);
    requireCondition(
      decisions.length > 0,
      `Plan ${input.planId} has no pending decision. Record one with gap answer first.`
    );
    const delta = validate("plan-delta", input.delta);
    const { coverage: coverage2, ...draft } = structuredClone(base.plan);
    draft.revision = base.plan.revision + 1;
    draft.previousRevision = base.plan.revision;
    for (const decision of decisions) {
      const gap = draft.gaps.find((gap2) => gap2.id === decision.gap_id);
      gap.status = decision.kind === "defer" ? "deferred" : "resolved";
      gap.decisionId = decision.id;
      draft.decisions.push(decisionSnapshot(decision));
      if (decision.kind === "accept_assumption")
        draft.assumptions.push({ decisionId: decision.id, text: decision.value });
    }
    const affected = affectedTests(
      base.plan,
      decisions.map((decision) => decision.gap_id)
    ).map((test) => test.id);
    for (const [testId, change2] of Object.entries(delta.tests)) {
      const test = draft.tests.find((test2) => test2.id === testId);
      requireCondition(test, `Unknown test in delta: ${testId}`);
      requireCondition(
        affected.includes(testId),
        `Test ${testId} is not affected by a pending decision. A revision changes only affected tests.`
      );
      applyTestChange(test, change2, usedAssertionIds(store, input.planId, testId));
    }
    const change = storeRevision(store, draft, operationId);
    for (const decision of decisions)
      execute(store, "UPDATE decisions SET applied_revision = ? WHERE id = ?", draft.revision, decision.id);
    change.reply.data.applied = decisions.map((decision) => decision.id);
    return change;
  });
}
function usedAssertionIds(store, planId, testId) {
  return all(
    store,
    "SELECT DISTINCT a.value ->> '$.id' AS id FROM plan_tests t, json_each(t.test, '$.assertions') a WHERE t.plan_id = ? AND t.test_id = ?",
    planId,
    testId
  ).map((row) => row.id);
}
function applyTestChange(test, change, used) {
  if (change.action !== void 0) test.action = change.action;
  if (change.preconditions !== void 0) test.preconditions = change.preconditions;
  for (const [id2, assertion] of Object.entries(change.assertions ?? {})) {
    const position = test.assertions.findIndex((existing) => existing.id === id2);
    if (assertion === null) {
      requireCondition(position >= 0, `Cannot remove unknown assertion ${test.id}.${id2}`);
      test.assertions.splice(position, 1);
    } else if (position >= 0) test.assertions[position] = { ...test.assertions[position], ...assertion };
    else {
      requireCondition(
        !used.includes(id2),
        `Assertion ID ${test.id}.${id2} was used in an earlier revision. Use a new ID.`
      );
      requireCondition(
        assertion.check !== void 0 && assertion.checkKind !== void 0,
        `New assertion ${test.id}.${id2} needs check and checkKind`
      );
      test.assertions.push({ id: id2, check: assertion.check, checkKind: assertion.checkKind });
    }
  }
}
function approvePlan(store, actor, input) {
  return decidePlan(store, actor, input, "approved");
}
function rejectPlan(store, actor, input) {
  return decidePlan(store, actor, input, "rejected");
}
function decidePlan(store, actor, input, verdict) {
  const command = verdict === "approved" ? "plan approve" : "plan reject";
  return write(store, { actor, command, subject: input.reference, input }, (operationId, at, actor2) => {
    const reference = revisionReference(requireText(input.reference, "plan reference"), "plan reference");
    requireCondition(reference.revision !== null, `Name the plan revision: ${reference.id}@<revision>`);
    const revision = planRevision(store, reference.id, reference.revision);
    const subject = `${reference.id}@${reference.revision}`;
    latestCheck(store, reference.id, reference.revision);
    expectDigest(revision.sha256, input.expectSha256, subject);
    expectDecision(store, "plan", subject, input.expectDecision);
    return {
      reply: recordApproval(store, actor2, operationId, {
        kind: "plan",
        subject,
        sha256: revision.sha256,
        verdict,
        rationale: input.rationale
      }),
      subjects: [`plan:${reference.id}`, "inbox"]
    };
  });
}
function latestCheck(store, planId, revision) {
  const latest = planRevision(store, planId).plan.revision;
  requireCondition(latest === revision, `${planId}@${revision} is not the latest revision. Use ${planId}@${latest}.`);
}
function recordApproval(store, actor, operationId, input) {
  const rationale = requireText(input.rationale, "rationale (--rationale)");
  const id2 = ulid();
  execute(
    store,
    "INSERT INTO approvals (id, subject_kind, subject_id, subject_sha256, verdict, rationale, actor, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id2,
    input.kind,
    input.subject,
    input.sha256,
    input.verdict,
    rationale,
    actor,
    operationId
  );
  return completed(input.subject, { approvalId: id2, verdict: input.verdict, sha256: input.sha256 });
}
function latestApproval(store, kind, subject) {
  return one(
    store,
    `SELECT a.verdict, a.subject_sha256 AS sha256, a.actor, a.rationale, o.at FROM approvals a
		JOIN operations o ON o.id = a.operation_id
		WHERE a.subject_kind = ? AND a.subject_id = ? ORDER BY a.rowid DESC LIMIT 1`,
    kind,
    subject
  );
}
function decisionToken(store, kind, subject) {
  return one(
    store,
    "SELECT id FROM approvals WHERE subject_kind = ? AND subject_id = ? ORDER BY rowid DESC LIMIT 1",
    kind,
    subject
  )?.id ?? "none";
}
function expectDecision(store, kind, subject, expected) {
  if (expected === void 0) return;
  requireCondition(
    decisionToken(store, kind, subject) === expected,
    `${subject} has a newer decision. Read it again before you decide.`
  );
}
function approvalState(store, kind, subject, sha256, policy) {
  const latest = latestApproval(store, kind, subject) ?? null;
  const current = latest?.sha256 === sha256;
  return {
    policy,
    latest,
    approved: current && latest?.verdict === "approved",
    rejected: current && latest?.verdict === "rejected"
  };
}
function planApproval(store, plan, sha256) {
  const policy = approvalPolicy(targetRevision(store, plan.target.targetId, plan.target.revision).profile).plan;
  return approvalState(store, "plan", `${plan.planId}@${plan.revision}`, sha256, policy);
}
function gate(store, input) {
  const reference = revisionReference(requireText(input.reference, "plan reference"), "plan reference");
  requireCondition(reference.revision !== null, `Name the plan revision: ${reference.id}@<revision>`);
  const revision = planRevision(store, reference.id, reference.revision);
  const { plan } = revision;
  const subject = `${plan.planId}@${plan.revision}`;
  latestCheck(store, plan.planId, plan.revision);
  const target = targetRevision(store, plan.target.targetId, plan.target.revision);
  const build = requireText(input.build, "application build (--build)");
  const partial = requireChoice(input.partial ?? "wait_for_resolution", partialModes, "partial execution (--partial)");
  const tests = index(plan.tests, "id", "test");
  const selection = input.tests === void 0 && partial === "ready_only" ? readySelection(store, plan, build) : givenSelection(input.tests, tests, subject);
  const selected = selection.tests;
  if (input.retestOf) retestCheck(store, input.retestOf, plan, build, input.instance);
  const earlier = input.retestOf ? retestDefects(store, input.retestOf) : [];
  const reasons2 = [];
  if (!selected.length) reasons2.push(`No test is ready in ${subject}`);
  if (input.retestOf) {
    for (const [id2, why] of retestSelection(store, plan, build, input.retestOf, earlier))
      if (!selected.includes(id2)) reasons2.push(`Retest of ${input.retestOf} must select ${id2}: ${why}`);
  }
  if (!target.profile.readyForLiveExecution)
    reasons2.push(`Target prerequisites are not ready: ${plan.target.targetId}@${plan.target.revision}`);
  const approval = planApproval(store, plan, revision.sha256);
  if (approval.policy === "required" && !approval.approved) reasons2.push(`Plan ${subject} is not approved`);
  if (partial === "wait_for_resolution") {
    for (const gap of plan.gaps)
      if (gap.status === "open" && gap.severity === "blocking") reasons2.push(`Open blocking gap: ${gap.id}`);
  }
  const runGaps2 = blockingRunGaps(store, plan.planId);
  for (const id2 of selected) {
    const test = tests.get(id2);
    if (test.readiness !== "ready") reasons2.push(`Test is not ready: ${id2}`);
    const runGap = runGapAffecting(runGaps2, test);
    if (runGap && partial === "wait_for_resolution")
      reasons2.push(`Open blocking gap ${runGap.gap.id} of ${runGap.runId} affects ${id2}`);
    if (!target.profile.capabilities.includes(test.capability))
      reasons2.push(`Missing capability: ${test.capability}`);
    if (!test.operations.every((operation) => target.profile.allowedOperations.includes(operation)))
      reasons2.push(`Operation is not permitted: ${id2}`);
    if (!test.assertions.length) reasons2.push(`Test has no assertions: ${id2}`);
    for (const dependency of test.dependsOn)
      if (!dependency.includes(":") && !selected.includes(dependency))
        reasons2.push(`Missing prerequisite: ${dependency}`);
  }
  for (const id2 of selected)
    for (const dependency of tests.get(id2).dependsOn.filter((dependency2) => dependency2.includes(":"))) {
      const cause = dependencyBlock(store, dependency, build);
      if (cause) reasons2.push(`Blocked by ${dependency}: ${cause}`);
    }
  return {
    reply: {
      status: reasons2.length ? "needs_decision" : "completed",
      subject,
      reasons: [...new Set(reasons2)],
      data: {
        planId: plan.planId,
        revision: plan.revision,
        sha256: revision.sha256,
        tests: selected,
        leftOut: selection.leftOut
      }
    },
    tests: selected,
    revision,
    target,
    build,
    partial,
    retestDefects: earlier
  };
}
function retestSelection(store, plan, build, runId, earlier) {
  const selectable = readySelection(store, plan, build).tests;
  const required = /* @__PURE__ */ new Map();
  for (const defect of earlier)
    for (const id2 of defect.testIds)
      if (selectable.includes(id2) && !required.has(id2))
        required.set(id2, `it has open defect ${defect.findingId} of ${runId}`);
  for (const test of plan.tests)
    if (test.metadata?.type === "regression" && selectable.includes(test.id) && !required.has(test.id))
      required.set(test.id, "it is a regression test");
  return required;
}
function givenSelection(selected, tests, subject) {
  requireCondition(
    Array.isArray(selected) && selected.length > 0,
    "Select one or more tests with --tests, or add --partial ready_only"
  );
  requireCondition(new Set(selected).size === selected.length, "Duplicate test in --tests");
  references(selected, tests, `test in ${subject}`);
  return { tests: selected, leftOut: [] };
}
function blockingRunGaps(store, planId) {
  return planRunGaps(store, planId).filter((item) => !item.adopted && item.gap.severity === "blocking");
}
function runGapAffecting(runGaps2, test) {
  return runGaps2.find((item) => gapsAffecting([item.gap], test).length > 0);
}
function deferredPrerequisites(plan) {
  const deferred = /* @__PURE__ */ new Map();
  const root = (id2) => {
    const test = plan.tests.find((item) => item.id === id2);
    if (test?.readiness === "deferred") return id2;
    return deferred.get(id2);
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const test of plan.tests.filter((item) => item.readiness === "ready" && !deferred.has(item.id))) {
      const prerequisite = test.dependsOn.filter((id2) => !id2.includes(":")).find(root);
      if (!prerequisite) continue;
      deferred.set(test.id, root(prerequisite));
      changed = true;
    }
  }
  return deferred;
}
function readySelection(store, plan, build) {
  const leftOut = [];
  const runGaps2 = blockingRunGaps(store, plan.planId);
  const deferred = deferredPrerequisites(plan);
  for (const test of plan.tests) {
    const prerequisite = deferred.get(test.id);
    const reason = prerequisite ? `deferred: prerequisite ${prerequisite} is deferred` : notReadyReason(store, plan, test, build, runGaps2);
    if (reason) leftOut.push({ testId: test.id, reason });
  }
  let selected = plan.tests.map((test) => test.id).filter((id2) => !leftOut.some((item) => item.testId === id2));
  for (let changed = true; changed; ) {
    changed = false;
    for (const test of plan.tests.filter((test2) => selected.includes(test2.id))) {
      const missing = test.dependsOn.find((id2) => !id2.includes(":") && !selected.includes(id2));
      if (!missing) continue;
      leftOut.push({ testId: test.id, reason: `needs ${missing}, which is left out` });
      selected = selected.filter((id2) => id2 !== test.id);
      changed = true;
    }
  }
  const order = plan.tests.map((test) => test.id);
  leftOut.sort((a, b) => order.indexOf(a.testId) - order.indexOf(b.testId));
  return { tests: selected, leftOut };
}
function notReadyReason(store, plan, test, build, runGaps2) {
  if (test.readiness !== "ready") {
    const gaps = plan.gaps.filter(
      (gap) => test.gapIds.includes(gap.id) && (test.readiness === "deferred" ? gap.status === "deferred" && gap.severity === "blocking" : gap.status === "open" && gap.severity === "blocking")
    );
    return `${test.readiness} by ${gaps.map((gap) => gap.id).join(", ")}`;
  }
  const runGap = runGapAffecting(runGaps2, test);
  if (runGap) return `blocked by ${runGap.gap.id} of ${runGap.runId}`;
  for (const dependency of test.dependsOn.filter((id2) => id2.includes(":"))) {
    const cause = dependencyBlock(store, dependency, build);
    if (cause) return `blocked by ${dependency}: ${cause}`;
  }
  return null;
}
function retestCheck(store, runId, plan, build, instanceId) {
  const previous = one(
    store,
    "SELECT r.plan_id, r.target_id, r.target_revision, r.instance_id, r.application_build, s.run_id IS NOT NULL AS finished FROM runs r LEFT JOIN results s ON s.run_id = r.run_id WHERE r.run_id = ?",
    runId
  );
  requireCondition(previous, `Unknown run to retest: ${runId}`);
  requireCondition(previous.finished, `Run ${runId} is not finished. Retest a finished run.`);
  requireCondition(
    previous.plan_id === plan.planId && previous.target_id === plan.target.targetId && previous.target_revision === plan.target.revision,
    `Retest scope changed: ${runId} ran plan ${previous.plan_id} on ${previous.target_id}@${previous.target_revision}`
  );
  const refreshed = instanceId !== void 0 && instanceId !== previous.instance_id && findInstance(store, previous.target_id, previous.instance_id).retired;
  requireCondition(
    previous.application_build !== build || refreshed,
    `Retest needs a new build. Run ${runId} used build ${build}. Keep the build only on a new instance after ${previous.instance_id} is retired.`
  );
}
function finalizedResults(store, planId) {
  return all(
    store,
    "SELECT s.body FROM results s JOIN runs r ON r.run_id = s.run_id WHERE r.plan_id = ? ORDER BY r.rowid",
    planId
  ).map((row) => JSON.parse(row.body));
}
function rejectedRuns(store, planId) {
  const rows = all(
    store,
    "SELECT r.run_id, r.target_id, r.target_revision, s.sha256 FROM runs r JOIN results s ON s.run_id = r.run_id WHERE r.plan_id = ?",
    planId
  );
  const rejected = rows.filter((row) => {
    const policy = approvalPolicy(targetRevision(store, row.target_id, row.target_revision).profile).result;
    return approvalState(store, "result", row.run_id, row.sha256, policy).rejected;
  });
  return new Set(rejected.map((row) => row.run_id));
}
function selectedOutcome(result, testId) {
  if (!result.selectedTestIds.includes(testId)) return null;
  return result.tests.find((test) => test.testId === testId)?.outcome ?? null;
}
function retests(later, earlier, byRun) {
  for (let runId = later.retestOf; runId; runId = byRun.get(runId)?.retestOf ?? null)
    if (runId === earlier.runId) return true;
  return false;
}
function supersedes(later, earlier, byRun) {
  return later.instanceId === earlier.instanceId || later.applicationBuild !== earlier.applicationBuild || retests(later, earlier, byRun);
}
function openDefects(results, rejected) {
  const byRun = new Map(results.map((result) => [result.runId, result]));
  const counted = results.filter((result) => !rejected.has(result.runId));
  return counted.flatMap((result, i) => {
    const later = counted.slice(i + 1).filter((run2) => supersedes(run2, result, byRun));
    const fixed = (testIds) => later.some((run2) => testIds.every((testId) => selectedOutcome(run2, testId) === "passed"));
    const found = (testIds) => later.some(
      (run2) => retests(run2, result, byRun) && run2.findings.some(
        (other) => other.type === "defect" && other.testIds.some(
          (testId) => testIds.includes(testId) && selectedOutcome(run2, testId) === "failed"
        )
      )
    );
    return result.findings.filter((finding) => finding.type === "defect" && !fixed(finding.testIds) && !found(finding.testIds)).map((finding) => ({ runId: result.runId, finding }));
  });
}
function retestDefects(store, runId) {
  const { plan_id } = one(store, "SELECT plan_id FROM runs WHERE run_id = ?", runId);
  return openDefects(finalizedResults(store, plan_id), rejectedRuns(store, plan_id)).filter((defect) => defect.runId === runId).map(({ finding }) => ({ findingId: finding.id, title: finding.title, testIds: finding.testIds }));
}
function dependencyBlock(store, reference, build) {
  const { planId, testId } = testReference(reference);
  const results = all(
    store,
    `SELECT r.run_id, r.target_id, r.target_revision, s.sha256,
			(SELECT t.value ->> '$.outcome' FROM json_each(s.body, '$.tests') t WHERE t.value ->> '$.testId' = ?) AS outcome
		FROM runs r JOIN results s ON s.run_id = r.run_id
		WHERE r.plan_id = ? AND (? IS NULL OR r.application_build = ?)
			AND EXISTS (SELECT 1 FROM json_each(s.body, '$.selectedTestIds') WHERE value = ?)
		ORDER BY r.rowid DESC`,
    testId,
    planId,
    build,
    build,
    testId
  );
  if (!results.length) return build === null ? "no finalized result" : `no finalized result for build ${build}`;
  const passed = results.filter((result) => result.outcome === "passed");
  if (!passed.length) return `latest result ${results[0].run_id} shows ${results[0].outcome}`;
  const accepted = (result) => {
    const policy = approvalPolicy(targetRevision(store, result.target_id, result.target_revision).profile).result;
    return policy === "none" || approvalState(store, "result", result.run_id, result.sha256, policy).approved;
  };
  if (!passed.some(accepted)) return `result ${passed[0].run_id} is not accepted`;
  for (const [owner, plan] of latestPlans(store)) {
    const open = plan.gaps.filter((gap2) => gap2.status === "open" && gap2.severity === "blocking");
    const test = plan.tests.find((test2) => test2.id === testId);
    const gap = owner === planId ? test && gapsAffecting(open, test)[0] : open.find((gap2) => gap2.testIds.includes(reference));
    if (gap) return `open blocking gap ${gap.id} in ${owner}`;
  }
  return null;
}
function planChanges(before, after) {
  const lines2 = [];
  const show = (value2) => value2 === void 0 ? "(none)" : JSON.stringify(value2);
  const fields = (prefix, a, b, skip = []) => {
    const x = a;
    const y = b;
    for (const key of [.../* @__PURE__ */ new Set([...Object.keys(x), ...Object.keys(y)])].sort())
      if (!skip.includes(key) && !same(x[key], y[key]))
        lines2.push(`${prefix} ${key}: ${show(x[key])} \u2192 ${show(y[key])}`);
  };
  const items = (old, next, label, skip = [], inner = () => {
  }) => {
    for (const item of old)
      if (!next.some((other) => other.id === item.id)) lines2.push(`${item.id} removed: ${show(label(item))}`);
    for (const item of next) {
      const previous = old.find((other) => other.id === item.id);
      if (!previous) {
        lines2.push(`${item.id} added: ${show(label(item))}`);
        continue;
      }
      fields(item.id, previous, item, skip);
      inner(previous, item);
    }
  };
  items(before.requirements, after.requirements, (requirement) => requirement.text);
  items(
    before.tests,
    after.tests,
    (test) => test.title,
    ["assertions"],
    (old, test) => {
      for (const assertion of old.assertions)
        if (!test.assertions.some((item) => item.id === assertion.id))
          lines2.push(`${test.id}.${assertion.id} removed: ${show(assertion.check)}`);
      for (const assertion of test.assertions) {
        const previous = old.assertions.find((item) => item.id === assertion.id);
        if (previous) fields(`${test.id}.${assertion.id}`, previous, assertion);
        else lines2.push(`${test.id}.${assertion.id} added: ${show(assertion.check)}`);
      }
    }
  );
  items(before.gaps, after.gaps, (gap) => gap.question);
  for (const decision of after.decisions.filter((item) => !before.decisions.some((old) => old.id === item.id)))
    lines2.push(`decision ${decision.id} ${decision.kind} ${decision.gapId}: ${JSON.stringify(decision.value)}`);
  for (const assumption of after.assumptions.filter(
    (item) => !before.assumptions.some((old) => old.decisionId === item.decisionId)
  ))
    lines2.push(`assumption ${assumption.decisionId}: ${JSON.stringify(assumption.text)}`);
  for (const row of after.coverage) {
    const old = before.coverage.find((item) => item.requirementId === row.requirementId);
    if (old && old.status !== row.status)
      lines2.push(`${row.requirementId} coverage: ${JSON.stringify(old.status)} \u2192 ${JSON.stringify(row.status)}`);
  }
  return lines2;
}
function jsonPatch(before, after, path = "") {
  if (same(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const common = Math.min(before.length, after.length);
    const operations = [];
    for (let i = 0; i < common; i++) operations.push(...jsonPatch(before[i], after[i], `${path}/${i}`));
    for (let i = common; i < after.length; i++)
      operations.push({ op: "add", path: `${path}/${i}`, value: after[i] });
    for (let i = before.length - 1; i >= after.length; i--) operations.push({ op: "remove", path: `${path}/${i}` });
    return operations;
  }
  if (isRecord(before) && isRecord(after)) {
    const operations = [];
    const pointer = (key) => `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    for (const key of Object.keys(before).sort())
      if (!(key in after)) operations.push({ op: "remove", path: pointer(key) });
    for (const key of Object.keys(after).sort())
      if (key in before) operations.push(...jsonPatch(before[key], after[key], pointer(key)));
      else operations.push({ op: "add", path: pointer(key), value: after[key] });
    return operations;
  }
  return [{ op: "replace", path, value: after }];
}
function isRecord(value2) {
  return typeof value2 === "object" && value2 !== null && !Array.isArray(value2);
}
function diffPlan(store, input) {
  const revision = (text) => {
    requireCondition(/^[1-9][0-9]*$/.test(text), `Invalid revision: ${text}. Use a positive integer.`);
    return planRevision(store, input.planId, Number(text)).plan;
  };
  const before = revision(input.from);
  const after = revision(input.to);
  return completed(`${input.planId}@${before.revision}..${after.revision}`, {
    planId: input.planId,
    from: before.revision,
    to: after.revision,
    patch: jsonPatch(before, after),
    changes: planChanges(before, after)
  });
}

// plugin/src/runs.ts
import { mkdirSync as mkdirSync2, readFileSync, realpathSync, rmSync as rmSync2, statSync } from "node:fs";
import { basename, extname, isAbsolute, join as join2, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
var maxEvidenceBytes = 32 * 1024 * 1024;
var assertionResults = ["passed", "failed", "inconclusive", "not_checked"];
var closeOutcomes = ["blocked", "not_run", "error"];
var completions = ["completed", "interrupted", "operational_error"];
var cleanupStatuses = ["completed", "failed", "not_applicable"];
var newBlockerPolicies = ["continue_independent", "return_to_oracle"];
var stoppedReason = "Run stopped before the test closed. Actions may have occurred.";
var deadlineClaim = /deadline|time ?out|timed out|out of time|(enough|no|remaining|limited|insufficient) time|time (budget|limit|constraint|ran out|is up|left|remaining)/i;
var deadlineShare = 0.9;
var kindByExtension = {
  ".png": "screenshot",
  ".jpg": "screenshot",
  ".jpeg": "screenshot",
  ".webp": "screenshot",
  ".zip": "trace",
  ".trace": "trace"
};
var mediaTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".json": "application/json",
  ".xml": "application/xml",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".zip": "application/zip"
};
function evidenceDirectory(runId) {
  return `.checkmate/tmp/${runId}/`;
}
function runState(store, runId) {
  const row = one(store, "SELECT * FROM runs WHERE run_id = ?", runId);
  requireCondition(row, `Unknown run: ${runId}`);
  const plan = one(
    store,
    "SELECT body FROM plan_revisions WHERE plan_id = ? AND revision = ?",
    row.plan_id,
    row.plan_revision
  );
  return {
    row,
    request: JSON.parse(row.request),
    plan: JSON.parse(plan.body),
    finished: Boolean(one(store, "SELECT 1 FROM results WHERE run_id = ?", runId))
  };
}
function startedRun(store, runId) {
  const run2 = runState(store, runId);
  requireCondition(!run2.finished, `Run ${runId} is finished. A finished run does not change.`);
  return run2;
}
function selectedTest(run2, testId) {
  requireCondition(
    run2.request.selectedTestIds.includes(testId),
    `Test ${testId} is not selected in run ${run2.row.run_id}`
  );
  return run2.plan.tests.find((test) => test.id === testId);
}
function runClock(store, row, at = (/* @__PURE__ */ new Date()).toISOString()) {
  const attempt = one(
    store,
    "SELECT started_at FROM run_attempts WHERE run_id = ? ORDER BY attempt DESC LIMIT 1",
    row.run_id
  );
  const start = Date.parse(attempt.started_at);
  const elapsedSeconds = Math.max(0, Math.floor((Date.parse(at) - start) / 1e3));
  return {
    attemptStartedAt: attempt.started_at,
    deadline: new Date(start + row.deadline_seconds * 1e3).toISOString(),
    deadlineSeconds: row.deadline_seconds,
    elapsedSeconds,
    remainingSeconds: Math.max(0, row.deadline_seconds - elapsedSeconds)
  };
}
function refuseEarlyDeadline(store, row, at, reason) {
  if (!deadlineClaim.test(reason)) return;
  const clock2 = runClock(store, row, at);
  const used = clock2.elapsedSeconds / clock2.deadlineSeconds;
  requireCondition(
    used >= deadlineShare,
    `Only ${Math.floor(used * 100)}% of the deadline is used: ${clock2.elapsedSeconds} of ${clock2.deadlineSeconds} seconds, ${clock2.remainingSeconds} remain until ${clock2.deadline}. Continue the remaining tests.`
  );
}
function currentAttempt(store, runId) {
  return one(store, "SELECT max(attempt) AS attempt FROM run_attempts WHERE run_id = ?", runId).attempt;
}
function runOutcomes(store, runId) {
  const rows = all(store, "SELECT * FROM outcomes WHERE run_id = ? ORDER BY rowid", runId);
  return new Map(rows.map((row) => [row.test_id, row]));
}
function runAssertions(store, runId) {
  const rows = all(store, "SELECT * FROM assertion_results WHERE run_id = ? ORDER BY rowid", runId);
  return new Map(rows.map((row) => [`${row.test_id}.${row.assertion_id}`, row]));
}
function runEvidence(store, runId) {
  return all(
    store,
    "SELECT e.id, e.test_id, e.assertion_id, e.kind, e.name, e.media_type, e.sha256, b.size FROM evidence e JOIN blobs b ON b.sha256 = e.sha256 WHERE e.run_id = ? ORDER BY e.rowid",
    runId
  );
}
function runFindings(store, runId) {
  return all(store, "SELECT body FROM findings WHERE run_id = ? ORDER BY rowid", runId).map(
    (row) => JSON.parse(row.body)
  );
}
function runGaps(store, runId) {
  return all(store, "SELECT body FROM run_gaps WHERE run_id = ? ORDER BY rowid", runId).map(
    (row) => JSON.parse(row.body)
  );
}
function beginRun(store, actor, input) {
  const reply = write(
    store,
    { actor, command: "run begin", subject: input.runId, input },
    (operationId, at, actor2) => {
      const runId = requireIdentifier(input.runId, "run ID");
      requireCondition(
        !one(store, "SELECT 1 FROM runs WHERE run_id = ?", runId),
        `Run ${runId} exists. Use a new run ID.`
      );
      const onNewBlocker = requireChoice(
        input.onNewBlocker ?? "continue_independent",
        newBlockerPolicies,
        "new blocker policy (--on-new-blocker)"
      );
      const timeoutSeconds = input.timeoutSeconds ?? 600;
      requireCondition(
        Number.isInteger(timeoutSeconds) && timeoutSeconds > 0 && timeoutSeconds <= 3600,
        `Invalid timeout: ${timeoutSeconds}. Use 1 to 3600 seconds.`
      );
      const instance = runInstance(store, plannedTarget(store, input.reference), input.instance);
      const checked = gate(store, { ...input, instance: instance.instanceId });
      if (checked.reply.status !== "completed")
        return { reply: { ...checked.reply, subject: runId }, subjects: [] };
      const { plan, sha256 } = checked.revision;
      const request = {
        selectedTestIds: checked.tests,
        partialExecution: checked.partial,
        onNewBlocker,
        timeoutSeconds,
        retestOf: input.retestOf ?? null,
        ...input.retestOf ? { retestDefects: checked.retestDefects } : {}
      };
      const browserSession = `cm-${randomUUID()}`;
      execute(
        store,
        "INSERT INTO runs (run_id, plan_id, plan_revision, plan_sha256, target_id, target_revision, instance_id, application_build, request, started_at, browser_session, deadline_seconds, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        runId,
        plan.planId,
        plan.revision,
        sha256,
        plan.target.targetId,
        plan.target.revision,
        instance.instanceId,
        checked.build,
        canonical(request),
        at,
        browserSession,
        timeoutSeconds,
        operationId
      );
      execute(
        store,
        "INSERT INTO run_attempts (run_id, attempt, started_at, actor) VALUES (?, 1, ?, ?)",
        runId,
        at,
        actor2
      );
      return {
        reply: completed(runId, {
          runId,
          plan: `${plan.planId}@${plan.revision}`,
          instanceId: instance.instanceId,
          tests: checked.tests,
          leftOut: checked.reply.data.leftOut,
          startedAt: at,
          browserSession,
          deadlineSeconds: timeoutSeconds,
          deadline: new Date(Date.parse(at) + timeoutSeconds * 1e3).toISOString(),
          evidenceDirectory: evidenceDirectory(runId)
        }),
        subjects: [`run:${runId}`, `plan:${plan.planId}`]
      };
    }
  );
  if (reply.status === "completed")
    mkdirSync2(join2(store.workspace, evidenceDirectory(input.runId)), { recursive: true });
  return reply;
}
function plannedTarget(store, text) {
  const reference = revisionReference(requireText(text, "plan reference"), "plan reference");
  return planRevision(store, reference.id, reference.revision).plan.target.targetId;
}
var evidenceKinds = ["observation", "http_exchange", "screenshot", "trace"];
function textEvidence(input, name) {
  requireCondition(
    typeof input.text === "string" && input.text.trim().length > 0,
    "Missing evidence text on standard input"
  );
  const bytes = Buffer.from(input.text, "utf8");
  requireCondition(bytes.length <= maxEvidenceBytes, "Evidence text exceeds 32 MiB");
  let json = true;
  try {
    JSON.parse(input.text);
  } catch {
    json = false;
  }
  return {
    path: null,
    name: `${name}.${json ? "json" : "txt"}`,
    kind: requireChoice(input.kind ?? "observation", evidenceKinds, "evidence kind"),
    mediaType: json ? "application/json" : "text/plain",
    bytes
  };
}
function readEvidence(store, runId, spec) {
  const match = /^(.*):(observation|http_exchange|screenshot|trace)$/.exec(spec);
  const name = match ? match[1] : spec;
  requireCondition(name && !isAbsolute(name), `Evidence path must be relative to the workspace: ${name}`);
  const directory2 = evidenceDirectory(runId);
  let root;
  let real;
  try {
    root = realpathSync(join2(store.workspace, directory2));
  } catch {
    throw new Error(`Evidence directory ${directory2} does not exist`);
  }
  const path = resolve(store.workspace, name);
  try {
    real = realpathSync(path);
  } catch {
    throw new Error(`Evidence file not found: ${name}`);
  }
  requireCondition(real.startsWith(root + sep), `Evidence file must be inside ${directory2}: ${name}`);
  const stats = statSync(real);
  requireCondition(stats.isFile(), `Evidence must be a file: ${name}`);
  requireCondition(stats.size <= maxEvidenceBytes, `Evidence file exceeds 32 MiB: ${name}`);
  const extension = extname(name).toLowerCase();
  return {
    path,
    name: basename(name),
    kind: match ? match[2] : kindByExtension[extension] ?? "observation",
    mediaType: mediaTypes[extension] ?? "application/octet-stream",
    bytes: readFileSync(real)
  };
}
function storeEvidence(store, runId, testId, assertionId, files, operationId) {
  return files.map((file) => {
    const sha256 = digest(file.bytes);
    execute(
      store,
      "INSERT OR IGNORE INTO blobs (sha256, size, bytes) VALUES (?, ?, ?)",
      sha256,
      file.bytes.length,
      file.bytes
    );
    const id2 = ulid();
    execute(
      store,
      "INSERT INTO evidence (id, run_id, test_id, assertion_id, kind, name, media_type, sha256, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id2,
      runId,
      testId,
      assertionId,
      file.kind,
      file.name,
      file.mediaType,
      sha256,
      operationId
    );
    return id2;
  });
}
function evidenceFiles(store, runId, name, specs = []) {
  const files = specs.map(
    (spec) => typeof spec === "string" ? readEvidence(store, runId, spec) : textEvidence(spec, name)
  );
  const paths = files.flatMap((file) => file.path ?? []);
  requireCondition(new Set(paths).size === paths.length, "An evidence file is listed twice");
  requireCondition(files.length - paths.length <= 1, "Give one evidence text on standard input");
  return files;
}
function removeFiles(files) {
  for (const file of files) if (file.path) rmSync2(file.path, { force: true });
}
function optionalText(value2, name) {
  return value2 === void 0 ? null : requireText(value2, name);
}
function requireOpen(store, runId, testId) {
  const closed = runOutcomes(store, runId).get(testId);
  requireCondition(!closed, `Test ${testId} is closed as ${closed?.outcome}. A test outcome is final.`);
}
function checkAssertion(store, actor, input) {
  let files = [];
  const reply = write(store, { actor, command: "run check", subject: input.runId, input }, (operationId, at) => {
    const run2 = startedRun(store, input.runId);
    const test = selectedTest(run2, input.testId);
    const assertion = test.assertions.find((assertion2) => assertion2.id === input.assertionId);
    requireCondition(assertion, `Unknown assertion ${test.id}.${input.assertionId}`);
    requireOpen(store, input.runId, test.id);
    requireCondition(
      !runAssertions(store, input.runId).has(`${test.id}.${assertion.id}`),
      `Assertion ${test.id}.${assertion.id} has a result. An assertion result is final.`
    );
    const outcomes = runOutcomes(store, input.runId);
    for (const dependency of test.dependsOn.filter((id2) => !id2.includes(":")))
      requireCondition(
        outcomes.get(dependency)?.outcome === "passed",
        `Prerequisite ${dependency} has not passed. Close ${dependency} as passed before you check ${test.id}.`
      );
    const result = requireChoice(input.result, assertionResults, "result (--result)");
    const observed = optionalText(input.observed, "observation (--observed)");
    const reason = optionalText(input.reason, "reason (--reason)");
    files = evidenceFiles(store, input.runId, `${test.id}-${assertion.id}`, input.evidence);
    if (result !== "not_checked")
      requireCondition(
        observed && files.length > 0,
        `${result === "inconclusive" ? "An" : "A"} ${result} result needs an observation (--observed) and one or more evidence items (--evidence)`
      );
    if (result === "inconclusive")
      requireCondition(
        reason,
        "An inconclusive result needs a reason (--reason) that says what the evidence cannot show"
      );
    if (result === "not_checked")
      requireCondition(reason, "A not_checked result needs a reason (--reason) that says why it was not checked");
    execute(
      store,
      "INSERT INTO assertion_results (run_id, test_id, assertion_id, attempt, result, observed, reason, recorded_at, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      input.runId,
      test.id,
      assertion.id,
      currentAttempt(store, input.runId),
      result,
      observed,
      reason,
      at,
      operationId
    );
    const evidenceIds = storeEvidence(store, input.runId, test.id, assertion.id, files, operationId);
    return {
      reply: completed(input.runId, {
        runId: input.runId,
        testId: test.id,
        assertionId: assertion.id,
        result,
        evidenceIds
      }),
      subjects: [`run:${input.runId}`]
    };
  });
  removeFiles(files);
  return reply;
}
function closeTest(store, actor, input) {
  let files = [];
  const reply = write(store, { actor, command: "run close", subject: input.runId, input }, (operationId, at) => {
    const run2 = startedRun(store, input.runId);
    const test = selectedTest(run2, input.testId);
    requireOpen(store, input.runId, test.id);
    const results = runAssertions(store, input.runId);
    const recorded = test.assertions.flatMap((assertion) => results.get(`${test.id}.${assertion.id}`) ?? []);
    let outcome;
    let reason;
    if (input.outcome === void 0) {
      requireCondition(input.reason === void 0, "--reason applies only with --outcome");
      requireCondition(!input.evidence?.length, "--evidence applies only with --outcome error");
      const missing = test.assertions.filter((assertion) => !results.has(`${test.id}.${assertion.id}`));
      requireCondition(
        !missing.length,
        `Assertions without a result: ${missing.map((assertion) => `${test.id}.${assertion.id}`).join(", ")}`
      );
      outcome = testOutcome(recorded.map((row) => row.result));
      const unchecked = recorded.filter((row) => row.result === "not_checked");
      reason = outcome === "error" ? `Assertions not checked: ${unchecked.map((row) => `${test.id}.${row.assertion_id}`).join(", ")}` : null;
    } else {
      outcome = requireChoice(input.outcome, closeOutcomes, "outcome (--outcome)");
      reason = requireText(input.reason, `reason (--reason) for outcome ${outcome}`);
      if (outcome !== "error") refuseEarlyDeadline(store, run2.row, at, reason);
      requireCondition(
        outcome === "error" || !recorded.length,
        `Test ${test.id} has assertion results. Record the remaining assertions, or close it as error.`
      );
      requireCondition(
        outcome === "error" || !input.evidence?.length,
        "--evidence applies only with --outcome error"
      );
      files = evidenceFiles(store, input.runId, test.id, input.evidence);
    }
    execute(
      store,
      "INSERT INTO outcomes (run_id, test_id, attempt, outcome, reason, recorded_at, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      input.runId,
      test.id,
      currentAttempt(store, input.runId),
      outcome,
      reason,
      at,
      operationId
    );
    const evidenceIds = storeEvidence(store, input.runId, test.id, null, files, operationId);
    return {
      reply: completed(input.runId, { runId: input.runId, testId: test.id, outcome, reason, evidenceIds }),
      subjects: [`run:${input.runId}`]
    };
  });
  removeFiles(files);
  return reply;
}
function recordFinding(store, actor, input) {
  return write(store, { actor, command: "run finding", subject: input.runId, input }, (operationId) => {
    const run2 = startedRun(store, input.runId);
    const finding = validate("finding", input.finding);
    requireCondition(
      !one(store, "SELECT 1 FROM findings WHERE run_id = ? AND id = ?", input.runId, finding.id),
      `Finding ${finding.id} exists in run ${input.runId}`
    );
    const results = runAssertions(store, input.runId);
    const named = finding.assertionIds.map((reference) => {
      const [testId, assertionId] = reference.split(".");
      const test = selectedTest(run2, testId);
      requireCondition(
        test.assertions.some((assertion) => assertion.id === assertionId),
        `Unknown assertion in finding ${finding.id}: ${reference}`
      );
      if (finding.type === "defect")
        requireCondition(
          results.get(reference)?.result === "failed",
          `Defect ${finding.id} names ${reference}, which is not failed. A defect names only failed assertions.`
        );
      return { test, assertionId };
    });
    const testIds = run2.plan.tests.filter((test) => named.some((item) => item.test.id === test.id)).map((test) => test.id);
    for (const requirementId of finding.requirementIds)
      for (const { test } of named)
        requireCondition(
          test.requirementIds.includes(requirementId),
          `Finding ${finding.id} names requirement ${requirementId}, which test ${test.id} does not cover`
        );
    const evidence2 = new Map(runEvidence(store, input.runId).map((row) => [row.id, row]));
    for (const id2 of finding.evidenceIds) {
      const row = evidence2.get(id2);
      requireCondition(row, `Unknown evidence in finding ${finding.id}: ${id2}`);
      requireCondition(
        testIds.includes(row.test_id) && (row.assertion_id === null || finding.assertionIds.includes(`${row.test_id}.${row.assertion_id}`)),
        `Evidence ${id2} does not belong to the assertions or tests of finding ${finding.id}`
      );
    }
    execute(
      store,
      "INSERT INTO findings (id, run_id, body, operation_id) VALUES (?, ?, ?, ?)",
      finding.id,
      input.runId,
      canonical({ ...withoutEmptyMetadata(finding), testIds }),
      operationId
    );
    return {
      reply: completed(input.runId, { runId: input.runId, findingId: finding.id, testIds }),
      subjects: [`run:${input.runId}`]
    };
  });
}
function recordGap(store, actor, input) {
  return write(store, { actor, command: "run gap", subject: input.runId, input }, (operationId) => {
    const run2 = startedRun(store, input.runId);
    const gap = validate("gap", input.gap);
    requireCondition(
      gap.status === "open" && gap.decisionId === null,
      `Runtime gap ${gap.id} must be open and have no decision`
    );
    const planId = run2.plan.planId;
    requireCondition(
      !one(store, "SELECT 1 FROM plan_gaps WHERE plan_id = ? AND gap_id = ?", planId, gap.id) && !planRunGaps(store, planId).some((item) => item.gap.id === gap.id),
      `Gap ID ${gap.id} is in use. Use a new ID.`
    );
    for (const id2 of gap.requirementIds)
      requireCondition(
        run2.plan.requirements.some((requirement) => requirement.id === id2),
        `Unknown requirement in gap ${gap.id}: ${id2}`
      );
    const plans = latestPlans(store);
    for (const reference of gap.testIds) {
      const { planId: planId2, testId } = testReference(reference);
      const plan = planId2 === null ? run2.plan : plans.get(planId2);
      requireCondition(
        plan?.tests.some((test) => test.id === testId),
        `Unknown test in gap ${gap.id}: ${reference}`
      );
    }
    execute(
      store,
      "INSERT INTO run_gaps (id, run_id, body, operation_id) VALUES (?, ?, ?, ?)",
      gap.id,
      input.runId,
      canonical(gap),
      operationId
    );
    return {
      reply: completed(input.runId, { runId: input.runId, gapId: gap.id }),
      subjects: [`run:${input.runId}`]
    };
  });
}
function finishRun(store, actor, input) {
  const reply = finish(store, actor, input);
  removeTemporaryDirectory(store, input.runId);
  return reply;
}
function finish(store, actor, input) {
  return write(store, { actor, command: "run finish", subject: input.runId, input }, (operationId, at) => {
    const run2 = startedRun(store, input.runId);
    const completion = requireChoice(input.completion, completions, "completion (--completion)");
    const reason = completion === "interrupted" ? requireText(input.reason, "reason (--reason) for completion interrupted") : optionalText(input.reason, "reason (--reason)");
    if (reason && completion !== "completed") refuseEarlyDeadline(store, run2.row, at, reason);
    const cleanup2 = {
      status: requireChoice(input.cleanup, cleanupStatuses, "cleanup (--cleanup)"),
      reason: requireText(input.cleanupReason, "cleanup reason (--cleanup-reason)")
    };
    const selected = run2.request.selectedTestIds;
    const attempt = currentAttempt(store, input.runId);
    const unclosed = selected.filter((id2) => !runOutcomes(store, input.runId).has(id2));
    if (completion === "completed")
      requireCondition(
        !unclosed.length,
        `Selected tests are not closed: ${unclosed.join(", ")}. Close them, or finish as interrupted.`
      );
    for (const testId of unclosed)
      execute(
        store,
        "INSERT INTO outcomes (run_id, test_id, attempt, outcome, reason, recorded_at, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        input.runId,
        testId,
        attempt,
        "error",
        stoppedReason,
        at,
        operationId
      );
    const outcomes = runOutcomes(store, input.runId);
    const results = runAssertions(store, input.runId);
    const findings2 = runFindings(store, input.runId);
    const newGaps2 = runGaps(store, input.runId);
    for (const row of results.values())
      if (row.result === "failed")
        requireCondition(
          findings2.some(
            (finding) => finding.type === "defect" && finding.assertionIds.includes(`${row.test_id}.${row.assertion_id}`)
          ),
          `Failed assertion ${row.test_id}.${row.assertion_id} needs a defect finding. Record it with run finding.`
        );
    if (completion === "completed") {
      const failures = selected.filter((id2) => outcomes.get(id2).outcome === "error");
      requireCondition(
        !failures.length,
        `Operational failure cannot be completed: ${failures.join(", ")} closed as error`
      );
      requireCondition(cleanup2.status !== "failed", "Cleanup failed, so the run cannot be completed");
      for (const verdict of retestVerdicts(run2, outcomes))
        for (const testId of verdict.testIds.filter((id2) => selected.includes(id2))) {
          const outcome = outcomes.get(testId).outcome;
          requireCondition(
            outcome === "passed" || outcome === "failed",
            `Retest ${input.runId} has no verdict on defect ${verdict.findingId} of ${verdict.runId}: ${testId} is ${outcome}. Retest ${testId} to passed or failed, or finish as interrupted with a reason.`
          );
        }
      for (const test of run2.plan.tests.filter((test2) => selected.includes(test2.id))) {
        const outcome = outcomes.get(test.id).outcome;
        if (outcome !== "not_run" && outcome !== "blocked") continue;
        const cause = test.dependsOn.some(
          (id2) => id2.includes(":") ? dependencyBlock(store, id2, run2.row.application_build) !== null : outcomes.get(id2)?.outcome !== "passed"
        ) || newGaps2.some((gap) => gap.severity === "blocking");
        requireCondition(
          cause,
          `Selected test ${test.id} is ${outcome} without a cause. A completed run needs a failed prerequisite or a new blocking gap.`
        );
      }
    }
    const evidence2 = runEvidence(store, input.runId);
    const tests = run2.plan.tests.map((test) => {
      const closed = outcomes.get(test.id);
      if (!closed)
        return { testId: test.id, outcome: "not_run", reason: "Test was not selected.", assertions: [] };
      return {
        testId: test.id,
        outcome: closed.outcome,
        reason: closed.reason,
        assertions: test.assertions.flatMap((assertion) => {
          const row = results.get(`${test.id}.${assertion.id}`);
          if (!row) return [];
          return {
            assertionId: assertion.id,
            check: assertion.check,
            checkKind: assertion.checkKind,
            result: row.result,
            observed: row.observed,
            reason: row.reason,
            evidenceIds: evidence2.filter((item) => item.test_id === test.id && item.assertion_id === assertion.id).map((item) => item.id)
          };
        })
      };
    });
    const coverage2 = resultCoverage(run2.plan, tests, newGaps2);
    const result = validate("result", {
      contractVersion: "toolkit-2",
      runId: input.runId,
      plan: { planId: run2.plan.planId, revision: run2.plan.revision, sha256: run2.row.plan_sha256 },
      target: run2.plan.target,
      instanceId: run2.row.instance_id,
      applicationBuild: run2.row.application_build,
      selectedTestIds: selected,
      retestOf: run2.request.retestOf,
      startedAt: run2.row.started_at,
      finishedAt: at,
      attempts: attempt,
      completion,
      completionReason: reason,
      tests,
      findings: findings2,
      newGaps: newGaps2,
      evidence: evidence2.map((row) => ({
        id: row.id,
        testId: row.test_id,
        assertionId: row.assertion_id,
        kind: row.kind,
        name: row.name,
        mediaType: row.media_type,
        sha256: row.sha256,
        size: row.size
      })),
      cleanup: cleanup2,
      coverage: coverage2
    });
    const body = canonical(result);
    const sha256 = digest(body);
    execute(
      store,
      "INSERT INTO results (run_id, completion, coverage, finished_at, sha256, body, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      input.runId,
      completion,
      coverage2.status,
      at,
      sha256,
      body,
      operationId
    );
    return {
      reply: {
        status: completion,
        subject: input.runId,
        reasons: [],
        data: {
          runId: input.runId,
          completion,
          coverage: coverage2.status,
          sha256,
          counts: outcomeCounts(tests.filter((test) => selected.includes(test.testId)))
        }
      },
      subjects: [`run:${input.runId}`, `plan:${run2.plan.planId}`, "inbox"]
    };
  });
}
function retestVerdicts(run2, outcomes) {
  return (run2.request.retestDefects ?? []).map((defect) => {
    const tested = defect.testIds.map((id2) => outcomes.get(id2)?.outcome);
    const verdict = tested.includes("failed") ? "not_fixed" : tested.every((outcome) => outcome === "passed") ? "fixed" : "not_retested";
    return { runId: run2.request.retestOf, ...defect, verdict };
  });
}
function outcomeCounts(tests) {
  const counts2 = {};
  for (const test of tests) counts2[test.outcome] = (counts2[test.outcome] ?? 0) + 1;
  return counts2;
}
function resumeRun(store, actor, input) {
  return write(store, { actor, command: "run resume", subject: input.runId, input }, (operationId, at, actor2) => {
    const run2 = startedRun(store, input.runId);
    const stalled = input.error ?? [];
    requireCondition(stalled.length > 0 || input.reason === void 0, "--reason applies only with --error");
    const reason = stalled.length ? requireText(input.reason, "reason (--reason) for --error") : null;
    const attempt = currentAttempt(store, input.runId) + 1;
    execute(
      store,
      "INSERT INTO run_attempts (run_id, attempt, started_at, actor) VALUES (?, ?, ?, ?)",
      input.runId,
      attempt,
      at,
      actor2
    );
    for (const testId of stalled) {
      selectedTest(run2, testId);
      requireOpen(store, input.runId, testId);
      execute(
        store,
        "INSERT INTO outcomes (run_id, test_id, attempt, outcome, reason, recorded_at, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        input.runId,
        testId,
        attempt,
        "error",
        reason,
        at,
        operationId
      );
    }
    const outcomes = runOutcomes(store, input.runId);
    const results = runAssertions(store, input.runId);
    const tests = run2.plan.tests.filter((test) => run2.request.selectedTestIds.includes(test.id) && !outcomes.has(test.id)).map((test) => ({
      testId: test.id,
      warning: "Actions may have occurred",
      recorded: test.assertions.filter((assertion) => results.has(`${test.id}.${assertion.id}`)).length,
      assertions: test.assertions.filter((assertion) => !results.has(`${test.id}.${assertion.id}`))
    }));
    return {
      reply: completed(input.runId, {
        runId: input.runId,
        attempt,
        browserSession: run2.row.browser_session,
        deadlineSeconds: run2.row.deadline_seconds,
        deadline: new Date(Date.parse(at) + run2.row.deadline_seconds * 1e3).toISOString(),
        evidenceDirectory: evidenceDirectory(input.runId),
        closed: stalled,
        tests
      }),
      subjects: [`run:${input.runId}`]
    };
  });
}
function acceptResult(store, actor, input) {
  return decideResult(store, actor, input, "approved");
}
function rejectResult(store, actor, input) {
  return decideResult(store, actor, input, "rejected");
}
function decideResult(store, actor, input, verdict) {
  const command = verdict === "approved" ? "result accept" : "result reject";
  return write(store, { actor, command, subject: input.runId, input }, (operationId, at, actor2) => {
    const run2 = runState(store, input.runId);
    const result = runResult(store, input.runId);
    requireCondition(result, `Run ${input.runId} is not finished. Finish it before you decide on its result.`);
    expectDigest(result.sha256, input.expectSha256, input.runId);
    expectDecision(store, "result", input.runId, input.expectDecision);
    return {
      reply: recordApproval(store, actor2, operationId, {
        kind: "result",
        subject: input.runId,
        sha256: result.sha256,
        verdict,
        rationale: input.rationale
      }),
      subjects: [`run:${input.runId}`, `plan:${run2.plan.planId}`, "inbox"]
    };
  });
}
function runResult(store, runId) {
  const row = one(store, "SELECT sha256, body FROM results WHERE run_id = ?", runId);
  return row ? { sha256: row.sha256, result: JSON.parse(row.body) } : null;
}
function resultAcceptance(store, run2, sha256) {
  const policy = approvalPolicy(targetRevision(store, run2.target_id, run2.target_revision).profile).result;
  return approvalState(store, "result", run2.run_id, sha256, policy);
}

// plugin/src/views.ts
function approvalLabel(state) {
  if (state.approved) return "approved";
  if (state.rejected) return "rejected";
  return state.policy === "required" ? "pending" : "not_required";
}
function latestRevisions(store) {
  return all(
    store,
    `SELECT p.plan_id, p.revision, p.sha256, p.body, o.at, o.actor FROM latest_plans p
		JOIN operations o ON o.id = p.operation_id ORDER BY p.plan_id`
  ).map((row) => ({ ...row, plan: JSON.parse(row.body) }));
}
function requestedPlans(store) {
  return all(
    store,
    `SELECT r.plan_id, r.target_id, r.target_revision, r.body, o.at FROM plan_requests r
		JOIN operations o ON o.id = r.operation_id
		WHERE NOT EXISTS (SELECT 1 FROM plan_revisions p WHERE p.plan_id = r.plan_id) ORDER BY r.plan_id`
  ).map((row) => ({
    planId: row.plan_id,
    target: `${row.target_id}@${row.target_revision}`,
    objective: JSON.parse(row.body).objective,
    since: row.at
  }));
}
function planSummary(plan) {
  const count = (readiness) => plan.tests.filter((test) => test.readiness === readiness).length;
  const open = plan.gaps.filter((gap) => gap.status === "open").length;
  return `${plan.tests.length} tests: ${count("ready")} ready, ${count("blocked")} blocked, ${count("deferred")} deferred; ${open} open gaps`;
}
function inbox(store) {
  const pending = new Set(
    all(
      store,
      "SELECT plan_id, gap_id FROM decisions WHERE applied_revision IS NULL"
    ).map((row) => `${row.plan_id}:${row.gap_id}`)
  );
  const revisions = latestRevisions(store);
  const gaps = revisions.flatMap((row) => [
    ...row.plan.gaps.filter((gap) => gap.status === "open" && !pending.has(`${row.plan_id}:${gap.id}`)).map((gap) => ({
      planId: row.plan_id,
      revision: row.revision,
      gapId: gap.id,
      question: gap.question,
      severity: gap.severity,
      since: row.at,
      runId: null
    })),
    ...planRunGaps(store, row.plan_id).filter((item) => !item.adopted).map((item) => ({
      planId: row.plan_id,
      revision: row.revision,
      gapId: item.gap.id,
      question: item.gap.question,
      severity: item.gap.severity,
      since: item.at,
      runId: item.runId
    }))
  ]).sort(bySince);
  const plans = revisions.map((row) => ({ row, approval: approvalLabel(planApproval(store, row.plan, row.sha256)) })).filter(({ approval }) => approval === "pending" || approval === "rejected").map(({ row, approval }) => ({
    planId: row.plan_id,
    revision: row.revision,
    sha256: row.sha256,
    approval,
    since: row.at,
    summary: `${approval === "rejected" ? "Rejected. Change the plan. " : ""}${planSummary(row.plan)}`
  })).sort(bySince);
  const results = revisions.flatMap((row) => {
    const runs = runList(store, { planId: row.plan_id });
    const record = planRecord(store, row.plan);
    const waited = /* @__PURE__ */ new Set([...record.supplied, ...record.defects.map((item) => item.runId)]);
    return runs.filter((run2) => waited.has(run2.runId) && run2.acceptance === "pending").map((run2) => {
      const result = record.results.find((item) => item.runId === run2.runId);
      return {
        runId: run2.runId,
        planId: run2.planId,
        revision: run2.revision,
        build: run2.build,
        counts: selectedCounts(result),
        coverage: run2.coverage,
        sha256: run2.sha256,
        since: result.finishedAt
      };
    });
  });
  return { gaps, plans, results, requests: requestedPlans(store).sort(bySince) };
}
function selectedCounts(result) {
  return outcomeCounts(result.tests.filter((test) => result.selectedTestIds.includes(test.testId)));
}
function bySince(a, b) {
  return a.since.localeCompare(b.since);
}
function testCounts(plan) {
  const count = (readiness) => plan.tests.filter((test) => test.readiness === readiness).length;
  return { total: plan.tests.length, ready: count("ready"), blocked: count("blocked"), deferred: count("deferred") };
}
function planList(store) {
  const drafted = latestRevisions(store).map((row) => {
    const open = [
      ...row.plan.gaps.filter((gap) => gap.status === "open"),
      ...planRunGaps(store, row.plan_id).filter((item) => !item.adopted).map((item) => item.gap)
    ];
    return {
      planId: row.plan_id,
      status: "drafted",
      revision: row.revision,
      sha256: row.sha256,
      since: row.at,
      openGaps: open.map((gap) => gap.id),
      openBlockingGaps: open.filter((gap) => gap.severity === "blocking").map((gap) => gap.id),
      tests: testCounts(row.plan),
      approval: approvalLabel(planApproval(store, row.plan, row.sha256)),
      blocked: row.plan.tests.flatMap(
        (test) => test.dependsOn.filter((dependency) => dependency.includes(":")).flatMap((dependency) => {
          const cause = dependencyBlock(store, dependency, null);
          return cause ? [{ testId: test.id, dependency, cause }] : [];
        })
      ),
      loop: loopOf(store, row.plan_id)
    };
  });
  const requested = requestedPlans(store).map((request) => ({
    planId: request.planId,
    status: "requested",
    revision: null,
    sha256: null,
    since: request.since,
    openGaps: [],
    openBlockingGaps: [],
    tests: { total: 0, ready: 0, blocked: 0, deferred: 0 },
    approval: null,
    blocked: [],
    loop: { state: "needs_plan", waitsOn: "planner" }
  }));
  return [...drafted, ...requested].sort((a, b) => a.planId.localeCompare(b.planId));
}
function planDetail(store, planId, revision = null) {
  const selected = planRevision(store, planId, revision);
  const latest = planRevision(store, planId);
  const approval = planApproval(store, selected.plan, selected.sha256);
  const pending = latest.plan.revision === selected.plan.revision ? all(
    store,
    "SELECT id, gap_id, kind, value, actor, rationale FROM decisions WHERE plan_id = ? AND applied_revision IS NULL ORDER BY rowid",
    planId
  ).map((row) => ({
    id: row.id,
    gapId: row.gap_id,
    kind: row.kind,
    value: row.value,
    actor: row.actor,
    rationale: row.rationale
  })) : [];
  return {
    planId,
    revision: selected.plan.revision,
    latestRevision: latest.plan.revision,
    sha256: selected.sha256,
    approval: { state: approvalLabel(approval), policy: approval.policy, latest: approval.latest },
    pendingDecisions: pending,
    plan: selected.plan,
    runs: runList(store, { planId }).map((run2) => ({
      runId: run2.runId,
      revision: run2.revision,
      build: run2.build,
      instanceId: run2.instanceId,
      startedAt: run2.startedAt,
      state: run2.state,
      completion: run2.completion,
      coverage: run2.coverage,
      counts: run2.counts,
      acceptance: run2.acceptance
    }))
  };
}
function planHistory(store, planId) {
  planRevision(store, planId);
  const rows = all(
    store,
    `SELECT p.plan_id, p.revision, p.sha256, p.body, p.operation_id, o.at, o.actor FROM plan_revisions p
		JOIN operations o ON o.id = p.operation_id WHERE p.plan_id = ? ORDER BY p.revision`,
    planId
  );
  const plans = rows.map((row) => JSON.parse(row.body));
  return rows.map((row, i) => ({
    revision: row.revision,
    sha256: row.sha256,
    operationId: row.operation_id,
    actor: row.actor,
    at: row.at,
    changes: i === 0 ? [] : planChanges(plans[i - 1], plans[i])
  }));
}
var roles = ["planner", "oracle", "qa", "factory", "none"];
function planStatus(store, planId) {
  if (!one(store, "SELECT 1 FROM plan_revisions WHERE plan_id = ?", planId)) {
    planRequest(store, planId);
    return {
      planId,
      revision: null,
      ...loop("needs_plan", "planner", [], [delegateHint("plan", planId)]),
      approval: null,
      gaps: [],
      pendingDecisions: [],
      latestRun: null,
      openRuns: [],
      defects: [],
      retest: null
    };
  }
  const { plan, sha256 } = planRevision(store, planId);
  const subject = `${planId}@${plan.revision}`;
  const pendingDecisions2 = all(
    store,
    "SELECT id, gap_id, kind FROM decisions WHERE plan_id = ? AND applied_revision IS NULL ORDER BY rowid",
    planId
  ).map((row) => ({ id: row.id, gapId: row.gap_id, kind: row.kind }));
  const gaps = [
    ...plan.gaps.filter((gap) => gap.status === "open" && !pendingDecisions2.some((item) => item.gapId === gap.id)).map((gap) => ({
      gapId: gap.id,
      severity: gap.severity,
      question: gap.question,
      runId: null
    })),
    ...planRunGaps(store, planId).filter((item) => !item.adopted).map((item) => ({
      gapId: item.gap.id,
      severity: item.gap.severity,
      question: item.gap.question,
      runId: item.runId
    }))
  ];
  const approval = approvalLabel(planApproval(store, plan, sha256));
  const runs = runList(store, { planId });
  const openRuns = runs.filter((run2) => run2.state === "started").map((run2) => ({ runId: run2.runId, build: run2.build, instanceId: run2.instanceId }));
  const record = planRecord(store, plan);
  const finished = runs.find((run2) => run2.runId === record.results.at(-1)?.runId);
  const latestRun = runs.at(-1) ?? null;
  const lastRetest = runs.map((run2) => runState(store, run2.runId)).filter((run2) => run2.request.retestOf).at(-1);
  const retest = lastRetest ? {
    runId: lastRetest.row.run_id,
    verdicts: retestVerdicts(lastRetest, runOutcomes(store, lastRetest.row.run_id))
  } : null;
  const { ready, latest, supplied, rejected } = record;
  const defects = record.defects.map(({ runId, finding }) => ({
    runId,
    findingId: finding.id,
    severity: finding.severity,
    testIds: finding.testIds,
    assertionIds: finding.assertionIds,
    title: finding.title
  }));
  const active = instanceList(store, plan.target.targetId).filter((instance2) => !instance2.retired);
  const instance = (runId) => {
    if (active.length < 2) return "";
    const used = runs.find((run2) => run2.runId === runId)?.instanceId;
    return ` --instance ${active.some((item) => item.instanceId === used) ? used : "<instanceId>"}`;
  };
  const rerun = (run2) => {
    const retired = !active.some((item) => item.instanceId === run2.instanceId);
    return `checkmate run begin <runId> ${subject} --build ${run2.build}${instance(run2.runId)} --partial ready_only${retired ? ` --retest-of ${run2.runId}` : ""}`;
  };
  const dependencyBuilds = () => {
    const others = [
      ...new Set(
        plan.tests.flatMap(
          (test) => test.dependsOn.filter((id2) => id2.includes(":")).map((id2) => id2.split(":")[0])
        )
      )
    ];
    return all(
      store,
      `SELECT r.application_build AS build FROM runs r JOIN results s ON s.run_id = r.run_id
			WHERE r.plan_id IN (SELECT value FROM json_each(?)) GROUP BY r.application_build ORDER BY max(r.rowid) DESC`,
      JSON.stringify(others)
    ).map((row) => row.build);
  };
  const bestBuild = (count) => {
    let best;
    let most = 0;
    for (const build of dependencyBuilds()) {
      const selected = count(build);
      if (selected > most) [best, most] = [build, selected];
    }
    return best;
  };
  const nothingToRun = (build, leftOut) => {
    const why = [
      ...ready.length ? [] : ["No test is ready"],
      ...leftOut.map((item) => `${item.testId} ${item.reason}`)
    ];
    const blocked = plan.tests.filter((test) => ready.includes(test.id)).flatMap((test) => test.dependsOn.filter((id2) => id2.includes(":") && dependencyBlock(store, id2, build)));
    if (blocked.length)
      return loop(
        "nothing_to_run",
        "qa",
        why,
        [...new Set(blocked.map((id2) => id2.split(":")[0]))].map((other) => `checkmate status ${other}`)
      );
    return loop("nothing_to_run", "oracle", why, [`checkmate plan edit ${subject} --patch`]);
  };
  const state = () => {
    if (openRuns.length)
      return loop(
        "run_in_progress",
        "qa",
        openRuns.map((run2) => `${run2.runId} is started on build ${run2.build} on instance ${run2.instanceId}`),
        openRuns.map((run2) => delegateHint("execute", run2.runId))
      );
    if (pendingDecisions2.length)
      return loop(
        "needs_revision",
        "planner",
        pendingDecisions2.map((item) => `${item.gapId} has a pending ${item.kind} decision`),
        [delegateHint("revise", planId)]
      );
    if (approval === "rejected")
      return loop(
        "plan_rejected",
        "oracle",
        [rejection(store, "plan", subject)],
        [`checkmate plan edit ${subject} --patch`]
      );
    const answer = [
      `checkmate gap answer ${planId} <gapId> --kind <kind> --value "<answer>" --source "<source>" --rationale "<why>"`
    ];
    if (approval === "pending")
      return gaps.length ? loop(
        "needs_answers",
        "oracle",
        [amount(gaps.length, "open gap"), `${subject} waits for approval`],
        answer
      ) : loop(
        "needs_approval",
        "oracle",
        [`${subject} waits for approval`],
        [`checkmate plan approve ${subject} --rationale "<why>"`]
      );
    const blocking = gaps.filter((gap) => gap.severity === "blocking");
    if (!finished) {
      const selection = readySelection(store, plan, null);
      if (selection.tests.length) {
        const build = bestBuild((item) => readySelection(store, plan, item).tests.length) ?? "<build>";
        return loop(
          "ready_to_run",
          "qa",
          [`${selection.tests.length} of ${plan.tests.length} tests are ready`],
          [`checkmate run begin <runId> ${subject} --build ${build}${instance()} --partial ready_only`]
        );
      }
      return blocking.length ? loop(
        "needs_answers",
        "oracle",
        [`No test is ready. ${amount(blocking.length, "open blocking gap")}`],
        answer
      ) : nothingToRun(null, selection.leftOut);
    }
    if (blocking.length)
      return loop("needs_answers", "oracle", [amount(blocking.length, "open blocking gap")], answer);
    if (defects.length) {
      const defective = runs.filter((run2) => defects.some((defect) => defect.runId === run2.runId));
      return loop(
        "defects_open",
        "factory",
        defective.map(
          (run2) => `${run2.runId} has ${amount(defects.filter((defect) => defect.runId === run2.runId).length, "defect")} on build ${run2.build}`
        ),
        defective.map(
          (run2) => `Build a fix, then checkmate run begin <runId> ${subject} --build <new build>${instance(run2.runId)} --partial ready_only --retest-of ${run2.runId}`
        )
      );
    }
    if (gaps.length) return loop("needs_answers", "oracle", [amount(gaps.length, "open gap")], answer);
    if (!ready.length) return nothingToRun(finished.build, readySelection(store, plan, finished.build).leftOut);
    const causes = /* @__PURE__ */ new Set();
    const reasons2 = new Map(
      ready.map((testId) => {
        const entries = latest.get(testId) ?? [];
        if (!entries.length) return [testId, [`${testId} has not run on ${subject}`]];
        return [
          testId,
          entries.flatMap((result) => {
            const outcome = selectedOutcome(result, testId);
            if (outcome === "passed" && !rejected.has(result.runId)) return [];
            causes.add(result.runId);
            if (outcome !== "passed") return [`${testId} is ${outcome} in ${result.runId}`];
            return [`${testId}'s latest pass is in rejected ${result.runId}`];
          })
        ];
      })
    );
    const incomplete = runs.filter(
      (run2) => (supplied.includes(run2.runId) || run2.runId === finished.runId) && run2.completion !== "completed"
    );
    for (const run2 of incomplete) causes.add(run2.runId);
    const why = [
      ...openRejections(store, planId).map((item) => rejection(store, "result", item.runId)),
      ...incomplete.map((run2) => `${run2.runId} is ${run2.completion}`),
      ...ready.flatMap((testId) => reasons2.get(testId))
    ];
    if (why.length) {
      const needed = incomplete.length ? ready : ready.filter((testId) => reasons2.get(testId).length);
      const selectable = (build) => readySelection(store, plan, build).tests.some((testId) => needed.includes(testId));
      const caused = runs.filter((run2) => causes.has(run2.runId));
      let next = (caused.length ? caused : [finished]).filter((run2) => selectable(run2.build)).map(rerun);
      if (!next.length) {
        const build = bestBuild(
          (item) => readySelection(store, plan, item).tests.filter((testId) => needed.includes(testId)).length
        );
        if (build)
          next = [`checkmate run begin <runId> ${subject} --build ${build}${instance()} --partial ready_only`];
      }
      if (!next.length) return nothingToRun(finished.build, readySelection(store, plan, finished.build).leftOut);
      return loop("needs_retest", "qa", why, [...new Set(next)]);
    }
    const supplying = runs.filter((run2) => supplied.includes(run2.runId));
    const waiting = supplying.filter((run2) => run2.acceptance === "pending");
    if (waiting.length)
      return loop(
        "awaits_acceptance",
        "oracle",
        waiting.map((run2) => `${run2.runId} on build ${run2.build} waits for acceptance`),
        waiting.map((run2) => `checkmate result accept ${run2.runId} --rationale "<why>"`)
      );
    const names = supplying.map((run2) => run2.runId).join(", ");
    if (supplying.every((run2) => run2.acceptance === "approved"))
      return loop("accepted", "none", [`${names} ${supplying.length === 1 ? "is" : "are"} accepted`], []);
    return loop("passed", "none", [`${names} passed. Result acceptance is not required`], []);
  };
  const loopState2 = state();
  loopState2.why = [
    .../* @__PURE__ */ new Set([
      ...loopState2.why,
      ...[...record.derived].map(
        ([testId, prerequisite]) => `${testId} deferred: prerequisite ${prerequisite} is deferred`
      )
    ])
  ];
  return {
    planId,
    revision: plan.revision,
    ...loopState2,
    approval,
    gaps,
    pendingDecisions: pendingDecisions2,
    latestRun,
    openRuns,
    defects,
    retest
  };
}
function rejection(store, kind, subject) {
  const decision = latestApproval(store, kind, subject);
  return `${subject} was rejected by ${decision.actor}: ${decision.rationale}`;
}
function openRejections(store, planId) {
  const { plan } = planRevision(store, planId);
  const runs = runList(store, { planId });
  const { ready, latest, rejected } = planRecord(store, plan);
  return runs.filter((run2) => rejected.has(run2.runId)).map((run2) => ({
    runId: run2.runId,
    testIds: ready.filter((testId) => latest.get(testId)?.some((result) => result.runId === run2.runId)),
    rationale: latestApproval(store, "result", run2.runId).rationale
  })).filter((item) => item.testIds.length);
}
function delegateHint(stage, subject) {
  return `checkmate delegate ${stage} ${subject} --allow Read --allow Bash`;
}
function loopOf(store, planId) {
  const { state, waitsOn } = planStatus(store, planId);
  return { state, waitsOn };
}
function planRecord(store, plan) {
  const results = finalizedResults(store, plan.planId);
  const rejected = rejectedRuns(store, plan.planId);
  const derived = deferredPrerequisites(plan);
  const ready = plan.tests.filter((test) => test.readiness === "ready" && !derived.has(test.id)).map((test) => test.id);
  const latest = latestOutcomes(store, plan, results);
  const supplied = results.filter((result) => ready.some((testId) => latest.get(testId)?.includes(result))).map((result) => result.runId);
  const defects = openDefects(results, rejected).filter(
    ({ finding }) => finding.testIds.some((testId) => ready.includes(testId))
  );
  return { results, rejected, ready, derived, latest, supplied, defects };
}
function testDefinition(plan, test) {
  const { action, preconditions, assertions, dependsOn, capability, operations, requirementIds } = test;
  const requirements = requirementIds.map((id2) => plan.requirements.find((item) => item.id === id2)?.text ?? null);
  return digest(
    canonical({
      action,
      preconditions,
      assertions,
      dependsOn,
      capability,
      operations,
      requirementIds,
      requirements
    })
  );
}
function latestOutcomes(store, plan, results) {
  const byRun = new Map(results.map((result) => [result.runId, result]));
  const current = new Map(plan.tests.map((test) => [test.id, testDefinition(plan, test)]));
  const tested = /* @__PURE__ */ new Map();
  const latest = /* @__PURE__ */ new Map();
  for (const result of results) {
    const revision = result.plan.revision;
    if (!tested.has(revision)) tested.set(revision, planRevision(store, plan.planId, revision).plan);
    for (const test of tested.get(revision).tests) {
      if (!result.selectedTestIds.includes(test.id) || current.get(test.id) !== testDefinition(tested.get(revision), test))
        continue;
      const kept = (latest.get(test.id) ?? []).filter((earlier) => !supersedes(result, earlier, byRun));
      latest.set(test.id, [...kept, result]);
    }
  }
  return latest;
}
function amount(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
var loopStages = {
  needs_plan: "plan",
  needs_revision: "revise",
  run_in_progress: "execute"
};
function loop(state, waitsOn, why, next) {
  return { state, waitsOn, why, next, stage: loopStages[state] ?? "none" };
}
function runList(store, filters = {}) {
  const rows = all(
    store,
    `SELECT r.*, s.completion, s.coverage, s.sha256 FROM runs r LEFT JOIN results s ON s.run_id = r.run_id
		WHERE (? IS NULL OR r.plan_id = ?) AND (? IS NULL OR r.application_build = ?) ORDER BY r.rowid`,
    filters.planId ?? null,
    filters.planId ?? null,
    filters.build ?? null,
    filters.build ?? null
  );
  return rows.map((row) => ({
    runId: row.run_id,
    planId: row.plan_id,
    revision: row.plan_revision,
    build: row.application_build,
    instanceId: row.instance_id,
    startedAt: row.started_at,
    state: row.sha256 ? "finalized" : "started",
    completion: row.completion,
    coverage: row.coverage,
    sha256: row.sha256,
    acceptance: row.sha256 ? approvalLabel(resultAcceptance(store, row, row.sha256)) : null,
    counts: Object.fromEntries(
      all(
        store,
        "SELECT outcome, count(*) AS count FROM outcomes WHERE run_id = ? GROUP BY outcome ORDER BY outcome",
        row.run_id
      ).map((count) => [count.outcome, count.count])
    )
  }));
}
function runDetail(store, runId) {
  const run2 = runState(store, runId);
  const outcomes = runOutcomes(store, runId);
  const results = runAssertions(store, runId);
  const evidence2 = runEvidence(store, runId).map((row) => ({
    id: row.id,
    testId: row.test_id,
    assertionId: row.assertion_id,
    kind: row.kind,
    name: row.name,
    mediaType: row.media_type,
    sha256: row.sha256,
    size: row.size
  }));
  const finished = runResult(store, runId);
  const attempts = all(
    store,
    "SELECT attempt, started_at, actor FROM run_attempts WHERE run_id = ? ORDER BY attempt",
    runId
  ).map((row) => ({ attempt: row.attempt, startedAt: row.started_at, actor: row.actor }));
  const tests = run2.plan.tests.filter((test) => run2.request.selectedTestIds.includes(test.id)).map((test) => {
    const closed = outcomes.get(test.id);
    return {
      testId: test.id,
      title: test.title,
      metadata: test.metadata ?? {},
      outcome: closed?.outcome ?? null,
      reason: closed?.reason ?? null,
      evidence: evidence2.filter((item) => item.testId === test.id && item.assertionId === null),
      assertions: test.assertions.map((assertion) => {
        const row = results.get(`${test.id}.${assertion.id}`);
        return {
          assertionId: assertion.id,
          check: assertion.check,
          checkKind: assertion.checkKind,
          result: row?.result ?? null,
          observed: row?.observed ?? null,
          reason: row?.reason ?? null,
          evidence: evidence2.filter(
            (item) => item.testId === test.id && item.assertionId === assertion.id
          )
        };
      })
    };
  });
  return {
    runId,
    planId: run2.row.plan_id,
    revision: run2.row.plan_revision,
    planSha256: run2.row.plan_sha256,
    target: `${run2.row.target_id}@${run2.row.target_revision}`,
    instance: findInstance(store, run2.row.target_id, run2.row.instance_id),
    build: run2.row.application_build,
    startedAt: run2.row.started_at,
    browserSession: run2.row.browser_session,
    deadlineSeconds: run2.row.deadline_seconds,
    clock: runClock(store, run2.row, finished?.result.finishedAt),
    request: run2.request,
    state: finished ? "finalized" : "started",
    attempts,
    tests,
    findings: runFindings(store, runId),
    retest: retestVerdicts(run2, outcomes),
    newGaps: runGaps(store, runId),
    result: finished ? {
      sha256: finished.sha256,
      completion: finished.result.completion,
      completionReason: finished.result.completionReason ?? null,
      coverage: finished.result.coverage,
      cleanup: finished.result.cleanup,
      finishedAt: finished.result.finishedAt,
      acceptance: approvalLabel(resultAcceptance(store, run2.row, finished.sha256)),
      latestDecision: latestApproval(store, "result", runId) ?? null
    } : null
  };
}
function findingList(store, filters = {}) {
  if (filters.planId !== void 0) planRequest(store, filters.planId);
  const rows = all(
    store,
    `SELECT r.*, f.body FROM findings f JOIN runs r ON r.run_id = f.run_id
		WHERE (? IS NULL OR r.plan_id = ?) ORDER BY f.rowid`,
    filters.planId ?? null,
    filters.planId ?? null
  );
  const open = new Set(
    filters.open ? [...new Set(rows.map((row) => row.plan_id))].flatMap(
      (planId) => openDefects(finalizedResults(store, planId), rejectedRuns(store, planId)).map(
        ({ runId, finding }) => `${runId}/${finding.id}`
      )
    ) : []
  );
  return rows.map((row) => {
    const finding = JSON.parse(row.body);
    return {
      runId: row.run_id,
      planId: row.plan_id,
      revision: row.plan_revision,
      build: row.application_build,
      instanceId: row.instance_id,
      testIds: finding.testIds,
      findingId: finding.id,
      type: finding.type,
      severity: finding.severity,
      title: finding.title,
      expected: finding.expected,
      observed: finding.observed,
      reproduction: finding.reproduction,
      requirementIds: finding.requirementIds,
      assertionIds: finding.assertionIds,
      evidenceIds: finding.evidenceIds,
      metadata: finding.metadata ?? {}
    };
  }).filter((row) => !filters.open || open.has(`${row.runId}/${row.findingId}`));
}
function operationLog(store, filters = {}) {
  const limit = filters.limit ?? 50;
  requireCondition(Number.isInteger(limit) && limit > 0 && limit <= 1e3, `Invalid limit: ${limit}. Use 1 to 1000.`);
  return all(
    store,
    `SELECT rowid, * FROM operations
		WHERE (? IS NULL OR EXISTS (SELECT 1 FROM json_each(subjects) WHERE value = ?)) AND rowid > ?
		ORDER BY rowid ${filters.after === void 0 ? "DESC" : "ASC"} LIMIT ?`,
    filters.subject ?? null,
    filters.subject ?? null,
    filters.after ?? 0,
    limit
  ).map(operationRow);
}
function operationRow(row) {
  return {
    rowid: row.rowid,
    id: row.id,
    at: row.at,
    actor: row.actor,
    command: row.command,
    status: row.status,
    subjects: JSON.parse(row.subjects),
    arguments: JSON.parse(row.arguments),
    response: JSON.parse(row.response)
  };
}
function changesAfter(store, rowid) {
  return all(
    store,
    "SELECT rowid, id, subjects FROM operations WHERE rowid > ? ORDER BY rowid",
    rowid
  ).map((row) => ({ rowid: row.rowid, id: row.id, subjects: JSON.parse(row.subjects) }));
}
function evidenceBytes(store, id2) {
  const row = one(
    store,
    "SELECT e.id, e.run_id, e.test_id, e.assertion_id, e.kind, e.name, e.media_type, e.sha256, b.size, b.bytes FROM evidence e JOIN blobs b ON b.sha256 = e.sha256 WHERE e.id = ?",
    id2
  );
  requireCondition(row, `Unknown evidence: ${id2}`);
  return {
    id: row.id,
    runId: row.run_id,
    testId: row.test_id,
    assertionId: row.assertion_id,
    kind: row.kind,
    name: row.name,
    mediaType: row.media_type,
    sha256: row.sha256,
    size: row.size,
    bytes: row.bytes
  };
}
var pageSizes = [25, 50, 100];
function listQuery(query, columns, defaults) {
  const limit = query.limit ?? 25;
  const offset = query.offset ?? 0;
  const sort = query.sort ?? defaults.sort;
  const direction = query.direction ?? (query.sort ? "asc" : defaults.direction);
  requireCondition(pageSizes.includes(limit), `Invalid limit: ${limit}. Use one of: ${pageSizes.join(", ")}.`);
  requireCondition(Number.isInteger(offset) && offset >= 0, `Invalid offset: ${offset}. Use 0 or more.`);
  requireChoice(sort, columns, "sort column");
  requireChoice(direction, ["asc", "desc"], "sort direction");
  return { limit, offset, sort, direction, q: query.q?.trim().toLowerCase() ?? "" };
}
function filterValue(filters, names) {
  const values = {};
  for (const [name, value2] of Object.entries(filters ?? {})) {
    if (value2 === void 0 || value2 === "") continue;
    requireCondition(name in names, `Unknown filter: ${name}. Use: ${Object.keys(names).join(", ")}.`);
    const choices = names[name];
    if (choices) requireChoice(value2, choices, `${name} filter`);
    values[name] = value2;
  }
  return values;
}
function pageOf(rows, query, columns, text) {
  const matched = query.q ? rows.filter(
    (row) => text(row).some(
      (field2) => String(field2 ?? "").toLowerCase().includes(query.q)
    )
  ) : rows;
  const key = columns[query.sort];
  const order = query.direction === "asc" ? 1 : -1;
  const position = new Map(matched.map((row, index2) => [row, index2]));
  const sorted2 = [...matched].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x === y) return (position.get(a) - position.get(b)) * order;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : 1) * order;
  });
  return {
    rows: sorted2.slice(query.offset, query.offset + query.limit),
    total: matched.length,
    limit: query.limit,
    offset: query.offset,
    sort: query.sort,
    direction: query.direction
  };
}
var planShows = ["all", "needs_decision", "awaiting_approval", "blocked"];
var approvalLabels = ["approved", "rejected", "pending", "not_required"];
function pagedPlans(store, query = {}) {
  const columns = {
    plan: (row) => row.planId,
    loop: (row) => row.loop.state,
    tests: (row) => row.tests.total,
    gaps: (row) => row.openGaps.length,
    approval: (row) => row.approval ?? row.status,
    blocked: (row) => row.blocked.length,
    updated: (row) => row.since
  };
  const options2 = listQuery(query, Object.keys(columns), { sort: "plan", direction: "asc" });
  const filters = filterValue(query.filters, { show: planShows, approval: approvalLabels, waits: roles });
  const rows = planList(store).filter(
    (row) => (filters.approval === void 0 || row.approval === filters.approval) && (filters.waits === void 0 || row.loop.waitsOn === filters.waits) && (filters.show !== "needs_decision" || row.openGaps.length > 0) && (filters.show !== "awaiting_approval" || row.approval === "pending") && (filters.show !== "blocked" || row.blocked.length > 0 || row.openBlockingGaps.length > 0)
  );
  return pageOf(rows, options2, columns, (row) => [
    row.revision === null ? row.planId : `${row.planId}@${row.revision}`,
    row.status,
    row.loop.state,
    `waits on ${row.loop.waitsOn}`,
    `${row.tests.total} tests ${row.tests.ready} ready ${row.tests.blocked} blocked ${row.tests.deferred} deferred`,
    ...row.openGaps,
    row.approval,
    ...row.blocked.map((block) => `${block.testId} ${block.dependency} ${block.cause}`),
    row.since
  ]);
}
var runStatuses = ["started", "pending", "approved", "rejected", "not_required"];
function runStatus(row) {
  return row.state === "started" ? "started" : row.acceptance ?? "finalized";
}
function pagedRuns(store, query = {}) {
  const columns = {
    run: (row) => row.runId,
    plan: (row) => `${row.planId}@${String(row.revision).padStart(9, "0")}`,
    build: (row) => row.build,
    instance: (row) => row.instanceId,
    completion: (row) => row.completion,
    coverage: (row) => row.coverage,
    status: (row) => runStatus(row),
    started: (row) => row.startedAt
  };
  const options2 = listQuery(query, Object.keys(columns), { sort: "started", direction: "desc" });
  const filters = filterValue(query.filters, { plan: null, build: null, status: runStatuses });
  const rows = runList(store, { planId: filters.plan, build: filters.build }).filter(
    (row) => filters.status === void 0 || runStatus(row) === filters.status
  );
  return pageOf(rows, options2, columns, (row) => [
    row.runId,
    `${row.planId}@${row.revision}`,
    row.build,
    row.instanceId,
    ...Object.entries(row.counts).map(([outcome, count]) => `${count} ${outcome}`),
    row.completion,
    row.coverage,
    runStatus(row),
    row.startedAt
  ]);
}
var logColumns = {
  time: "rowid",
  actor: "actor",
  command: "command",
  status: "status"
};
function pagedOperations(store, query = {}) {
  const options2 = listQuery(query, Object.keys(logColumns), { sort: "time", direction: "desc" });
  const filters = filterValue(query.filters, { subject: null, actor: null, command: null, status: null });
  const where = `WHERE (:subject IS NULL OR EXISTS (SELECT 1 FROM json_each(subjects) WHERE value = :subject))
		AND (:actor IS NULL OR actor = :actor) AND (:command IS NULL OR command = :command)
		AND (:status IS NULL OR status = :status)
		AND (:q = '' OR instr(lower(at || ' ' || actor || ' ' || command || ' ' || status || ' ' || subjects || ' ' || id
			|| ' ' || coalesce(response ->> '$.reasons', '')), :q) > 0)`;
  const parameters = {
    subject: filters.subject ?? null,
    actor: filters.actor ?? null,
    command: filters.command ?? null,
    status: filters.status ?? null,
    q: options2.q
  };
  const total = store.db.prepare(`SELECT count(*) AS total FROM operations ${where}`).get(parameters).total;
  const direction = options2.direction === "asc" ? "ASC" : "DESC";
  const rows = store.db.prepare(
    `SELECT rowid, * FROM operations ${where} ORDER BY ${logColumns[options2.sort]} ${direction}, rowid ${direction} LIMIT :limit OFFSET :offset`
  ).all({ ...parameters, limit: options2.limit, offset: options2.offset });
  return {
    rows: rows.map(operationRow),
    total,
    limit: options2.limit,
    offset: options2.offset,
    sort: options2.sort,
    direction: options2.direction
  };
}

// plugin/src/render.ts
var formats = ["md", "html", "json"];
var runFormats = [...formats, "junit"];
var maxInlineImage = 512 * 1024;
var maxInlineText = 16 * 1024;
var inlineImages = ["image/png", "image/jpeg", "image/webp", "image/gif"];
var inlineTexts = ["text/plain", "application/json", "text/markdown", "application/xml", "text/csv"];
var tones = {
  passed: "pass",
  approved: "pass",
  completed: "pass",
  complete: "pass",
  tested: "pass",
  resolved: "pass",
  failed: "fail",
  rejected: "fail",
  operational_error: "fail",
  error: "warn",
  inconclusive: "warn",
  interrupted: "warn",
  partial: "warn",
  pending: "warn",
  open: "warn",
  blocking: "warn",
  uncovered: "warn",
  blocked: "muted",
  not_run: "muted",
  not_checked: "muted",
  deferred: "muted",
  not_executed: "muted"
};
var none = "\u2014";
var join3 = (values) => values.length ? values.join(", ") : none;
var pairs = (metadata = {}) => join3(Object.entries(metadata).map(([key, value2]) => `${key}=${value2}`));
function markdownText(value2) {
  return value2.replace(/\\/g, "\\\\").replace(/([|[\]*_`])/g, "\\$1").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, " ");
}
function fence(text, language = "") {
  const ticks = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)));
  return `${ticks}${language}
${text}
${ticks}`;
}
function jsonFence(value2) {
  return fence(JSON.stringify(value2, null, 2), "json");
}
function indent(text) {
  return text.split("\n").map((line) => `  ${line}`).join("\n");
}
function markdown(report) {
  const parts = [`# ${markdownText(report.title)}`, markdownText(report.note)];
  for (const block of report.blocks) {
    if ("heading" in block) parts.push(`${"#".repeat(block.level ?? 2)} ${markdownText(block.heading)}`);
    else if ("text" in block) parts.push(markdownText(block.text));
    else if ("table" in block)
      parts.push(
        [
          `| ${block.table.map(markdownText).join(" | ")} |`,
          `| ${block.table.map(() => "---").join(" | ")} |`,
          ...block.rows.map((row) => `| ${row.map(markdownText).join(" | ")} |`)
        ].join("\n")
      );
    else if ("list" in block)
      parts.push(
        block.list.map((item, i) => `${block.numbered ? `${i + 1}.` : "-"} ${markdownText(item)}`).join("\n")
      );
    else if ("stats" in block)
      parts.push(
        block.stats.map((stat) => `- **${markdownText(stat.label)}:** ${markdownText(stat.value)}`).join("\n")
      );
    else if ("evidence" in block)
      parts.push(
        block.evidence.map(
          (item) => [
            `- ${markdownText(item.label)}: ${markdownText(item.name)} (${item.mediaType}, ${item.size} bytes)`,
            ...item.text === void 0 ? [] : ["", indent(fence(item.text))]
          ].join("\n")
        ).join("\n")
      );
    else
      parts.push(`<details>
<summary>Complete JSON record</summary>

${jsonFence(block.record)}

</details>`);
  }
  return parts.join("\n\n") + "\n";
}
function escapeHtml(value2) {
  return value2.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
  );
}
var styles = `
:root{--ink:#1b2130;--muted:#5d6678;--line:#dde2ea;--soft:#f4f6f9;--accent:#3b4fd8;
--pass:#1f7a4d;--pass-bg:#e5f4ec;--fail:#b42318;--fail-bg:#fdecea;--warn:#9a5b00;--warn-bg:#fdf3e1;--muted-bg:#eef0f4}
*{box-sizing:border-box}
body{font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:#fff;margin:0}
main{max-width:72rem;margin:0 auto;padding:2.5rem 1.5rem 4rem}
header{border-bottom:3px solid var(--accent);padding-bottom:1rem;margin-bottom:1.5rem}
h1{font-size:1.8rem;line-height:1.2;margin:0 0 .4rem}
h2{font-size:1.2rem;margin:2.2rem 0 .7rem;padding-bottom:.3rem;border-bottom:1px solid var(--line)}
h3{font-size:1rem;margin:1.4rem 0 .5rem}
.note{color:var(--muted);margin:0}
table{border-collapse:collapse;width:100%;margin:.4rem 0 1.2rem;font-size:.92rem}
th,td{padding:.45rem .6rem;text-align:left;vertical-align:top;border-bottom:1px solid var(--line);overflow-wrap:break-word}
.token{word-break:break-all}
th{font-weight:600;background:var(--soft);font-size:.82rem;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}
tbody tr:nth-child(even) td{background:#fafbfc}
.pill{display:inline-block;padding:.05rem .5rem;border-radius:999px;font-size:.8rem;font-weight:600;white-space:nowrap}
.pass{color:var(--pass);background:var(--pass-bg)}.fail{color:var(--fail);background:var(--fail-bg)}
.warn{color:var(--warn);background:var(--warn-bg)}.muted{color:var(--muted);background:var(--muted-bg)}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr));gap:.6rem;margin:1rem 0 1.5rem}
.stat{border:1px solid var(--line);border-radius:.5rem;padding:.6rem .8rem}
.stat b{display:block;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600}
.stat span{font-size:1.05rem;font-weight:600;overflow-wrap:anywhere}
.evidence{display:grid;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));gap:1rem;margin:.5rem 0 1.5rem}
figure{margin:0;border:1px solid var(--line);border-radius:.5rem;padding:.6rem;break-inside:avoid}
figure img{display:block;max-width:100%;height:auto;border-radius:.3rem}
figcaption{font-size:.82rem;color:var(--muted);margin-top:.4rem;overflow-wrap:anywhere}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--soft);padding:.8rem;border-radius:.4rem;font-size:.82rem;margin:0}
details{margin-top:2.5rem}summary{cursor:pointer;font-weight:600}
@page{size:A4;margin:16mm 14mm}
@media print{
body{font-size:10.5pt}main{max-width:none;padding:0}
h2{break-after:avoid}h3{break-after:avoid}tr,figure,.stat{break-inside:avoid}thead{display:table-header-group}
tbody tr:nth-child(even) td{background:none}details{display:none}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;
function cell(value2) {
  const tone2 = tones[value2];
  if (tone2) return `<span class="pill ${tone2}">${escapeHtml(value2)}</span>`;
  return value2.split(/(\s+)/).map((part) => part.length > 24 ? `<span class="token">${escapeHtml(part)}</span>` : escapeHtml(part)).join("");
}
function figure(item) {
  const body = item.image ? `<img src="${item.image}" alt="${escapeHtml(item.name)}">` : item.text !== void 0 ? `<pre>${escapeHtml(item.text)}</pre>` : "";
  return `<figure>${body}<figcaption>${escapeHtml(item.label)} \xB7 ${escapeHtml(item.name)} \xB7 ${escapeHtml(item.mediaType)} \xB7 ${item.size} bytes</figcaption></figure>`;
}
function html(report) {
  const parts = [
    `<header><h1>${escapeHtml(report.title)}</h1><p class="note">${escapeHtml(report.note)}</p></header>`
  ];
  for (const block of report.blocks) {
    if ("heading" in block) parts.push(`<h${block.level ?? 2}>${escapeHtml(block.heading)}</h${block.level ?? 2}>`);
    else if ("text" in block) parts.push(`<p>${escapeHtml(block.text)}</p>`);
    else if ("table" in block)
      parts.push(
        `<table><thead><tr>${block.table.map((head) => `<th>${escapeHtml(head)}</th>`).join("")}</tr></thead><tbody>${block.rows.map((row) => `<tr>${row.map((value2) => `<td>${cell(value2)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      );
    else if ("list" in block) {
      const tag = block.numbered ? "ol" : "ul";
      parts.push(`<${tag}>${block.list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`);
    } else if ("stats" in block)
      parts.push(
        `<div class="stats">${block.stats.map(
          (stat) => `<div class="stat"><b>${escapeHtml(stat.label)}</b><span>${cell(stat.value)}</span></div>`
        ).join("")}</div>`
      );
    else if ("evidence" in block) parts.push(`<div class="evidence">${block.evidence.map(figure).join("")}</div>`);
    else
      parts.push(
        `<details><summary>Complete JSON record</summary><pre>${escapeHtml(JSON.stringify(block.record, null, 2))}</pre></details>`
      );
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escapeHtml(report.title)}</title><style>${styles.trim()}</style></head><body><main>` + parts.join("") + "</main></body></html>\n";
}
function approvalBlock(approval, notRequired) {
  if (!approval.latest) return { text: approval.state === "not_required" ? notRequired : "No decision yet." };
  const { verdict, actor, at, rationale, sha256 } = approval.latest;
  return { table: ["Verdict", "Actor", "At", "Rationale", "Digest"], rows: [[verdict, actor, at, rationale, sha256]] };
}
function runDocument(report) {
  const { result, sha256, acceptance, plan } = report;
  const planned = new Map(plan.tests.map((test) => [test.id, test]));
  const evidence2 = new Map(result.evidence.map((entry) => [entry.id, entry]));
  const files = (ids2) => join3(ids2.map((id2) => `${evidence2.get(id2)?.name ?? id2} (${id2})`));
  const counts2 = outcomeCounts(result.tests.filter((test) => result.selectedTestIds.includes(test.testId)));
  const assertions = result.tests.flatMap((test) => test.assertions);
  const blocks = [
    {
      stats: [
        { label: "Completion", value: result.completion },
        { label: "Coverage", value: result.coverage.status },
        { label: "Acceptance", value: acceptance.state },
        { label: "Selected tests", value: String(result.selectedTestIds.length) },
        ...Object.entries(counts2).map(([outcome, count]) => ({ label: outcome, value: String(count) })),
        {
          label: "Assertions passed",
          value: `${assertions.filter((assertion) => assertion.result === "passed").length} of ${assertions.length}`
        },
        { label: "Findings", value: String(result.findings.length) },
        { label: "New gaps", value: String(result.newGaps.length) }
      ]
    },
    { heading: "Summary" },
    {
      table: ["Field", "Value"],
      rows: [
        ["Run", result.runId],
        ["Objective", plan.objective],
        ["Application build", result.applicationBuild],
        ["Plan", `${result.plan.planId}@${result.plan.revision}`],
        ["Target profile", `${result.target.targetId}@${result.target.revision}`],
        ["Instance", result.instanceId],
        ["Started", result.startedAt],
        ["Finished", result.finishedAt],
        ["Attempts", String(result.attempts)],
        ["Retest of", result.retestOf ?? none],
        ...result.completionReason ? [["Completion reason", result.completionReason]] : [],
        ["Cleanup", `${result.cleanup.status}: ${result.cleanup.reason}`],
        ["Result digest", sha256]
      ]
    },
    { heading: "Acceptance" },
    approvalBlock(acceptance, "The target policy does not require acceptance."),
    { heading: `Plan approval (${plan.planId}@${plan.revision})` },
    approvalBlock(report.planApproval, "The target policy does not require plan approval."),
    { heading: "Tests" },
    {
      table: ["Test", "Title", "Outcome", "Assertions", "Reason", "Metadata"],
      rows: result.tests.filter((test) => result.selectedTestIds.includes(test.testId)).map((test) => [
        test.testId,
        planned.get(test.testId)?.title ?? none,
        test.outcome,
        `${test.assertions.filter((assertion) => assertion.result === "passed").length} of ${test.assertions.length} passed`,
        test.reason ?? none,
        pairs(planned.get(test.testId)?.metadata)
      ])
    },
    { heading: "Assertions" },
    {
      table: ["Assertion", "Result", "Check kind", "Check", "Observed", "Reason", "Evidence"],
      rows: result.tests.flatMap(
        (test) => test.assertions.map((assertion) => [
          `${test.testId}.${assertion.assertionId}`,
          assertion.result,
          assertion.checkKind,
          assertion.check,
          assertion.observed ?? none,
          assertion.reason ?? none,
          files(assertion.evidenceIds)
        ])
      )
    },
    { heading: "Findings" }
  ];
  if (!result.findings.length) blocks.push({ text: "No findings." });
  for (const finding of result.findings) {
    blocks.push({ heading: `${finding.id} \xB7 ${finding.type} \xB7 ${finding.severity}: ${finding.title}`, level: 3 });
    blocks.push({
      table: ["Field", "Value"],
      rows: [
        ["Assertions", join3(finding.assertionIds)],
        ["Requirements", join3(finding.requirementIds)],
        ["Expected", finding.expected],
        ["Observed", finding.observed],
        ["Evidence", files(finding.evidenceIds)],
        ["Metadata", pairs(finding.metadata)]
      ]
    });
    blocks.push({ list: finding.reproduction, numbered: true });
  }
  blocks.push({ heading: "New gaps" });
  if (!result.newGaps.length) blocks.push({ text: "No new gaps." });
  else
    blocks.push({
      table: ["Gap", "Severity", "Question", "Consequence", "Requirements", "Tests"],
      rows: result.newGaps.map((gap) => [
        gap.id,
        gap.severity,
        gap.question,
        gap.consequence,
        join3(gap.requirementIds),
        join3(gap.testIds)
      ])
    });
  blocks.push({ heading: `Plan gaps and decisions (${plan.planId}@${plan.revision})` });
  if (!plan.gaps.length) blocks.push({ text: "The plan has no gaps." });
  else
    blocks.push({
      table: ["Gap", "Severity", "Status", "Question", "Decision", "Value", "Actor", "Rationale"],
      rows: plan.gaps.map((gap) => {
        const decision = plan.decisions.find((item) => item.id === gap.decisionId);
        return [
          gap.id,
          gap.severity,
          gap.status,
          gap.question,
          decision?.kind ?? none,
          decision?.value ?? none,
          decision?.actor ?? none,
          decision?.rationale ?? none
        ];
      })
    });
  if (plan.assumptions.length)
    blocks.push({
      list: plan.assumptions.map((assumption) => `Assumption ${assumption.decisionId}: ${assumption.text}`)
    });
  blocks.push({ heading: "Evidence" });
  if (!result.evidence.length) blocks.push({ text: "No evidence." });
  else {
    blocks.push({
      evidence: result.evidence.map((entry) => ({
        label: entry.assertionId ? `${entry.testId}.${entry.assertionId}` : entry.testId,
        name: entry.name,
        mediaType: entry.mediaType,
        size: entry.size,
        ...report.inline[entry.id]
      }))
    });
    blocks.push({
      table: ["Evidence", "Assertion", "Kind", "Name", "Media type", "Size", "SHA-256"],
      rows: result.evidence.map((entry) => [
        entry.id,
        entry.assertionId ? `${entry.testId}.${entry.assertionId}` : entry.testId,
        entry.kind,
        entry.name,
        entry.mediaType,
        String(entry.size),
        entry.sha256
      ])
    });
  }
  blocks.push(
    { heading: "Coverage" },
    {
      table: ["Requirement", "Text", "Status", "Tests", "Reason", "Metadata"],
      rows: result.coverage.requirements.map((row) => {
        const requirement = plan.requirements.find((item) => item.id === row.requirementId);
        return [
          row.requirementId,
          requirement?.text ?? none,
          row.status,
          join3(row.testIds),
          row.reason ?? none,
          pairs(requirement?.metadata)
        ];
      })
    },
    { record: result }
  );
  return {
    title: `Test report: ${result.runId}`,
    note: `${result.plan.planId}@${result.plan.revision} on build ${result.applicationBuild}. Generated from the Checkmate database. Completion, test outcomes, and coverage are separate.`,
    blocks
  };
}
function planReport(plan, sha256) {
  const coverage2 = new Map(plan.coverage.map((row) => [row.requirementId, row.status]));
  const blocks = [
    {
      table: ["Field", "Value"],
      rows: [
        ["Plan", plan.planId],
        ["Revision", String(plan.revision)],
        ["Previous revision", plan.previousRevision === null ? none : String(plan.previousRevision)],
        ["Target", `${plan.target.targetId}@${plan.target.revision}`],
        ["Objective", plan.objective],
        ["Plan digest", sha256]
      ]
    },
    { heading: "Requirements" },
    {
      table: ["Requirement", "Text", "Source", "Coverage", "Metadata"],
      rows: plan.requirements.map((requirement) => [
        requirement.id,
        requirement.text,
        requirement.source,
        coverage2.get(requirement.id) ?? none,
        pairs(requirement.metadata)
      ])
    },
    { heading: "Tests" },
    {
      table: ["Test", "Title", "Readiness", "Requirements", "Depends on", "Preconditions", "Action", "Metadata"],
      rows: plan.tests.map((test) => [
        test.id,
        test.title,
        test.readiness,
        join3(test.requirementIds),
        join3(test.dependsOn),
        join3(test.preconditions),
        test.action,
        pairs(test.metadata)
      ])
    },
    { heading: "Assertions" },
    {
      table: ["Assertion", "Check kind", "Check"],
      rows: plan.tests.flatMap(
        (test) => test.assertions.map((assertion) => [`${test.id}.${assertion.id}`, assertion.checkKind, assertion.check])
      )
    },
    { heading: "Gaps" }
  ];
  if (!plan.gaps.length) blocks.push({ text: "No gaps." });
  else
    blocks.push({
      table: ["Gap", "Severity", "Status", "Question", "Consequence", "Decision"],
      rows: plan.gaps.map((gap) => [
        gap.id,
        gap.severity,
        gap.status,
        gap.question,
        gap.consequence,
        gap.decisionId ?? none
      ])
    });
  blocks.push({ heading: "Decisions" });
  if (!plan.decisions.length) blocks.push({ text: "No decisions." });
  else
    blocks.push({
      table: ["Decision", "Gap", "Kind", "Value", "Actor", "Rationale", "Source"],
      rows: plan.decisions.map((decision) => [
        decision.id,
        decision.gapId,
        decision.kind,
        decision.value,
        decision.actor,
        decision.rationale,
        decision.source ?? none
      ])
    });
  blocks.push({ heading: "Assumptions" });
  if (!plan.assumptions.length) blocks.push({ text: "No accepted assumptions." });
  else blocks.push({ list: plan.assumptions.map((assumption) => `${assumption.decisionId}: ${assumption.text}`) });
  blocks.push({ record: plan });
  return {
    title: `Test plan: ${plan.planId} revision ${plan.revision}`,
    note: "Generated from the Checkmate database. Record a decision and revise the plan to change it.",
    blocks
  };
}
var xmlEntities = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
  "\n": "&#10;",
  "\r": "&#13;",
  "	": "&#9;"
};
function validText(value2) {
  return value2.replace(/[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu, "\uFFFD");
}
function xml(value2, pattern) {
  return validText(value2).replace(pattern, (character) => xmlEntities[character]);
}
function xmlText(value2) {
  return xml(value2, /[&<>\r]/g);
}
function xmlAttribute(value2) {
  return xml(value2, /[&<>"'\n\r\t]/g);
}
function xmlTag(name, attributes, content = null) {
  const fields = Object.entries(attributes).map(([key, value2]) => ` ${key}="${xmlAttribute(String(value2))}"`).join("");
  return content === null ? `<${name}${fields}/>` : `<${name}${fields}>${content}</${name}>`;
}
function xmlProperties(values) {
  if (!values.length) return "";
  return `<properties>${values.map(([name, value2]) => xmlTag("property", { name, value: String(value2) })).join("")}</properties>`;
}
function junitStatus(report, test) {
  const unpassed = test.assertions.find((assertion) => assertion.result !== "passed");
  const reason = test.reason ?? unpassed?.reason ?? unpassed?.observed ?? test.outcome;
  if (test.outcome === "passed") return "";
  if (test.outcome === "blocked" || test.outcome === "not_run")
    return xmlTag("skipped", { message: `${test.outcome}: ${reason}` });
  if (test.outcome !== "failed") return xmlTag("error", { type: test.outcome, message: reason });
  const findings2 = report.result.findings.filter((finding) => finding.testIds.includes(test.testId)).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const defect = findings2.find((finding) => finding.type === "defect");
  const text = findings2.map(
    (finding) => [
      `${finding.id} ${finding.type} ${finding.severity}: ${finding.title}`,
      `Expected: ${finding.expected}`,
      `Observed: ${finding.observed}`,
      "Reproduction:",
      ...finding.reproduction.map((step, i) => `${i + 1}. ${step}`)
    ].join("\n")
  );
  return xmlTag(
    "failure",
    { type: defect?.type ?? "failed", message: defect?.title ?? reason },
    xmlText(text.join("\n\n") || reason)
  );
}
function junit(report) {
  const { result, plan } = report;
  const tests = result.tests.filter((test) => result.selectedTestIds.includes(test.testId));
  const count = (...outcomes) => tests.filter((test) => outcomes.includes(test.outcome)).length;
  const totals = {
    tests: tests.length,
    failures: count("failed"),
    errors: count("error", "inconclusive"),
    skipped: count("blocked", "not_run"),
    time: (Date.parse(result.finishedAt) - Date.parse(result.startedAt)) / 1e3
  };
  const cases = tests.map((test) => {
    const planned = plan.tests.find((item) => item.id === test.testId);
    const properties = xmlProperties([
      ["title", planned.title],
      ["requirements", planned.requirementIds.join(",")],
      ...Object.entries(planned.metadata ?? {}).map(([key, value2]) => [
        `metadata.${key}`,
        value2
      ])
    ]);
    return xmlTag(
      "testcase",
      { classname: plan.planId, name: planned.id, time: report.times[test.testId] ?? 0 },
      properties + junitStatus(report, test)
    );
  });
  const suite = xmlTag(
    "testsuite",
    {
      name: `${result.plan.planId}@${result.plan.revision}`,
      ...totals,
      timestamp: result.startedAt.slice(0, 19)
    },
    xmlProperties([
      ["runId", result.runId],
      ["build", result.applicationBuild],
      ["instance", result.instanceId],
      ["target", `${result.target.targetId}@${result.target.revision}`],
      ["completion", result.completion],
      ["coverage", result.coverage.status]
    ]) + "\n" + cases.join("\n") + "\n"
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
${xmlTag("testsuites", { name: result.runId, ...totals }, suite)}
`;
}
function rendered(report, record, format2) {
  if (format2 === "json") return JSON.stringify(record, null, 2) + "\n";
  return validText(format2 === "md" ? markdown(report) : html(report));
}
function renderPlan(plan, sha256, format2) {
  return rendered(planReport(plan, sha256), plan, format2);
}
function renderRun(report, format2) {
  if (format2 === "junit") return junit(report);
  const { inline, times, ...record } = report;
  return rendered(runDocument(report), record, format2);
}
function exportPlan(store, reference, format2) {
  const { id: id2, revision } = revisionReference(reference, "plan reference");
  const selected = planRevision(store, id2, revision);
  return renderPlan(selected.plan, selected.sha256, requireChoice(format2, formats, "format (--format)"));
}
function runReport(store, runId) {
  const run2 = runState(store, runId);
  const finished = runResult(store, runId);
  requireCondition(finished, `Run ${runId} has no result. Finish it before you export it.`);
  const state = resultAcceptance(store, run2.row, finished.sha256);
  const approval = planApproval(store, run2.plan, run2.row.plan_sha256);
  const { planId, revision, objective, requirements, tests, gaps, decisions, assumptions } = run2.plan;
  const inline = {};
  for (const entry of finished.result.evidence) {
    const image = inlineImages.includes(entry.mediaType) && entry.size <= maxInlineImage;
    const text = inlineTexts.includes(entry.mediaType) && entry.size <= maxInlineText;
    if (!image && !text) continue;
    const bytes = Buffer.from(evidenceBytes(store, entry.id).bytes);
    inline[entry.id] = image ? { image: `data:${entry.mediaType};base64,${bytes.toString("base64")}` } : { text: bytes.toString("utf8") };
  }
  return {
    result: finished.result,
    sha256: finished.sha256,
    acceptance: { state: approvalLabel(state), latest: state.latest },
    planApproval: { state: approvalLabel(approval), latest: approval.latest },
    plan: { planId, revision, objective, requirements, tests, gaps, decisions, assumptions },
    inline,
    times: testTimes(store, runId)
  };
}
function testTimes(store, runId) {
  const rows = all(
    store,
    `SELECT o.test_id, coalesce(min(a.recorded_at), o.recorded_at) AS first, o.recorded_at AS closed
		FROM outcomes o LEFT JOIN assertion_results a ON a.run_id = o.run_id AND a.test_id = o.test_id
		WHERE o.run_id = ? GROUP BY o.test_id`,
    runId
  );
  return Object.fromEntries(
    rows.map((row) => [row.test_id, Math.max(0, Date.parse(row.closed) - Date.parse(row.first)) / 1e3])
  );
}
function exportRun(store, runId, format2) {
  return renderRun(runReport(store, runId), requireChoice(format2, runFormats, "format (--format)"));
}

// plugin/src/ui/server.ts
import { createServer } from "node:http";
import { randomBytes as randomBytes2, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync as readFileSync2 } from "node:fs";
import { fileURLToPath } from "node:url";

// plugin/src/actor.ts
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
function defaultActor(workspace, env) {
  const named = env.CHECKMATE_ACTOR?.trim();
  if (named) return named;
  try {
    const name = execFileSync("git", ["config", "user.name"], {
      cwd: workspace,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (name) return name;
  } catch {
  }
  try {
    return userInfo().username;
  } catch {
    return void 0;
  }
}

// plugin/src/ui/html.ts
var entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escape(text) {
  return text.replace(/[&<>"']/g, (character) => entities[character]);
}
function isHtml(value2) {
  return typeof value2 === "object" && value2 !== null && "html" in value2;
}
function piece(value2) {
  if (value2 === null || value2 === void 0 || value2 === false) return "";
  if (Array.isArray(value2)) return value2.map(piece).join("");
  if (isHtml(value2)) return value2.html;
  return escape(String(value2));
}
function html2(strings, ...values) {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += piece(values[i]) + strings[i + 1];
  return { html: text };
}
function join4(items, separator) {
  return html2`${items.flatMap((item, i) => i ? [separator, item] : [item])}`;
}
var statusLook = {
  passed: ["\u2713", "pass"],
  failed: ["\u2717", "fail"],
  inconclusive: ["?", "unsure"],
  not_checked: ["!", "warn"],
  blocked: ["\u2013", "block"],
  not_run: ["\u2013", "block"],
  error: ["!", "warn"],
  ready: ["\u2713", "pass"],
  deferred: ["\u2013", "block"],
  planned: ["\u2713", "pass"],
  tested: ["\u2713", "pass"],
  uncovered: ["\u2013", "block"],
  complete: ["\u2713", "pass"],
  partial: ["\u25D0", "warn"],
  not_executed: ["\u2013", "block"],
  completed: ["\u2713", "pass"],
  interrupted: ["!", "warn"],
  operational_error: ["!", "fail"],
  not_applicable: ["\u2013", "block"],
  approved: ["\u2713", "pass"],
  rejected: ["\u2717", "fail"],
  pending: ["\u25CB", "acc"],
  not_required: ["\u2013", "block"],
  started: ["\u25CF", "acc"],
  active: ["\u25CF", "pass"],
  retired: ["\u2013", "block"],
  finalized: ["\u2713", "pass"],
  open: ["\u25CB", "warn"],
  resolved: ["\u2713", "pass"],
  blocking: ["\u25CF", "fail"],
  non_blocking: ["\u25CB", "warn"],
  clarify: ["\u2713", "acc"],
  accept_assumption: ["\u2248", "acc"],
  defer: ["\u2013", "block"],
  defect: ["\u2717", "fail"],
  potential_issue: ["?", "warn"],
  low: ["\xB7", "block"],
  medium: ["!", "warn"],
  high: ["!", "fail"],
  critical: ["!!", "fail"],
  rejected_operation: ["\u2717", "fail"],
  needs_decision: ["?", "warn"],
  invalid_request: ["\u2717", "fail"],
  needs_plan: ["\u25CB", "acc"],
  run_in_progress: ["\u25CF", "acc"],
  needs_revision: ["\u25CB", "acc"],
  plan_rejected: ["\u2717", "fail"],
  needs_answers: ["?", "warn"],
  needs_approval: ["\u25CB", "acc"],
  ready_to_run: ["\u25CB", "acc"],
  nothing_to_run: ["\u2013", "block"],
  defects_open: ["\u2717", "fail"],
  needs_retest: ["!", "warn"],
  awaits_acceptance: ["\u25CB", "acc"],
  accepted: ["\u2713", "pass"]
};
function words(status) {
  return status.replace(/_/g, " ");
}
function pill(status, label = words(status)) {
  const [icon2, tone2] = statusLook[status] ?? ["\xB7", "muted"];
  return html2`<span class="st ${tone2}"><span aria-hidden="true">${icon2}</span> ${label}</span>`;
}
function icon(status) {
  const [symbol, tone2] = status ? statusLook[status] ?? ["\xB7", "muted"] : ["\xB7", "muted"];
  return html2`<span class="ic ${tone2}" role="img" aria-label="${status ? words(status) : "no result yet"}"
		>${symbol}</span
	>`;
}
function short(sha256) {
  return `${sha256.slice(0, 4)}\u2026${sha256.slice(-4)}`;
}
function age(iso, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1e3));
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}
function clock(iso) {
  const date = new Date(iso);
  const pad = (value2) => String(value2).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function time(iso, text = age(iso)) {
  return html2`<time datetime="${iso}" title="${clock(iso)}">${text}</time>`;
}
function hasMetadata(values) {
  return Object.keys(values ?? {}).length > 0;
}
function metadataList(values = {}) {
  const entries = Object.entries(values);
  return html2`<span class="kv" aria-label="Metadata"
		>${entries.map(([key, value2]) => html2`<span class="tag">${key}=${String(value2)}</span>`)}</span
	>`;
}
function plural(count, one2, many = `${one2}s`) {
  return `${count} ${count === 1 ? one2 : many}`;
}

// plugin/src/ui/layout.ts
var nextTheme = { system: "light", light: "dark", dark: "system" };
var themeIcons = html2`<svg class="ti ti-system" viewBox="0 0 16 16" aria-hidden="true">
		<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" />
		<path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
	</svg>
	<svg class="ti ti-light" viewBox="0 0 16 16" aria-hidden="true">
		<circle cx="8" cy="8" r="3" fill="currentColor" />
		<path
			d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
		/>
	</svg>
	<svg class="ti ti-dark" viewBox="0 0 16 16" aria-hidden="true">
		<path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" fill="currentColor" />
	</svg>`;
var gear = html2`<svg class="gear" viewBox="0 0 16 16" aria-hidden="true">
	<path
		d="M5.86 3.2 6.21 1.34h3.58l.35 1.86.95.55 1.79-.63 1.78 3.09-1.44 1.24v1.1l1.44 1.24-1.78 3.09-1.79-.63-.95.55-.35 1.86H6.21l-.35-1.86-.95-.55-1.79.63-1.78-3.09 1.44-1.24v-1.1L1.34 6.21l1.78-3.09 1.79.63z"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linejoin="round"
	/>
	<circle cx="8" cy="8" r="1.75" fill="none" stroke="currentColor" stroke-width="1.5" />
</svg>`;
function settingsLink(page) {
  const current = page.section === "settings" ? html2` aria-current="page"` : "";
  return html2`<a class="icon-btn" href="/settings" title="Settings" aria-label="Settings" ${current}>${gear}</a>`;
}
function mark() {
  return html2`<span class="mark" aria-hidden="true"><i></i><i></i><i class="on"></i><i></i></span>`;
}
function navLink(context, page, section, href, label, extra = "") {
  const current = page.section === section ? html2` aria-current="page"` : "";
  return html2`<li><a href="${href}" ${current}>${label}${extra}</a></li>`;
}
function themeForm(context) {
  const next = nextTheme[context.theme];
  return html2`<form method="post" action="/theme" class="theme-form" data-theme-form>
		<input type="hidden" name="csrf" value="${context.csrf}" />
		<input type="hidden" name="back" value="${context.path}" />
		<button
			class="icon-btn"
			name="theme"
			value="${next}"
			data-current="${context.theme}"
			title="Theme: ${context.theme}. Switch to ${next}."
			aria-label="Theme: ${context.theme}. Switch to ${next}."
		>
			${themeIcons}
		</button>
	</form>`;
}
function header(context, page) {
  const count = html2`<b class="count" data-region="nav-count">${context.inboxCount || ""}</b>`;
  const actor = context.actor ? html2`<a class="actor" href="/actor?back=${encodeURIComponent(context.path)}" title="Change your name"
				>actor: ${context.actor}</a
			>` : html2`<a class="actor" href="/actor?back=${encodeURIComponent(context.path)}">Set your name</a>`;
  return html2`<header class="bar">
		<div class="bar-in">
			<a class="brand" href="/">${mark()}<span>checkmate</span></a>
			<nav aria-label="Main">
				<ul class="nav">
					${navLink(context, page, "inbox", "/", "Inbox", count)}
					${navLink(context, page, "plans", "/plans", "Plans")}
					${navLink(context, page, "runs", "/runs", "Runs")} ${navLink(context, page, "log", "/log", "Log")}
				</ul>
			</nav>
			<div class="who">
				<span class="live" data-live hidden>○ Connecting…</span>
				${actor} ${themeForm(context)}
				<button
					class="icon-btn"
					type="button"
					data-shortcuts-open
					hidden
					aria-label="Keyboard shortcuts"
					title="Keyboard shortcuts (?)"
				>
					?
				</button>
				${settingsLink(page)}
			</div>
		</div>
	</header>`;
}
var shortcuts = html2`<aside class="shortcuts" data-shortcuts hidden aria-labelledby="shortcuts-title">
	<div class="shortcuts-head">
		<h2 id="shortcuts-title">Keyboard shortcuts</h2>
		<button class="icon-btn" type="button" data-shortcuts-close aria-label="Close shortcuts">×</button>
	</div>
	<dl>
		<dt><kbd>/</kbd></dt>
		<dd>Search or filter</dd>
		<dt><kbd>j</kbd> <kbd>k</kbd></dt>
		<dd>Next or previous item</dd>
		<dt><kbd>Enter</kbd></dt>
		<dd>Open the item</dd>
		<dt><kbd>g</kbd> <kbd>i</kbd></dt>
		<dd>Go to the inbox</dd>
		<dt><kbd>Esc</kbd></dt>
		<dd>Close the viewer or this panel</dd>
		<dt><kbd>?</kbd></dt>
		<dd>Show these shortcuts</dd>
	</dl>
</aside>`;
var viewer = html2`<div class="viewer" data-viewer hidden role="dialog" aria-modal="true" aria-label="Evidence viewer">
	<div class="viewer-bar">
		<span class="viewer-name" data-viewer-name></span>
		<a class="btn" data-viewer-open href="#" target="_blank" rel="noopener">Open original</a>
		<button class="btn" type="button" data-viewer-close>Close <kbd>Esc</kbd></button>
	</div>
	<div class="viewer-body"><img data-viewer-image alt="" /></div>
</div>`;
function layout(context, page) {
  const theme = context.theme === "system" ? "" : html2` data-theme="${context.theme}"`;
  return html2`<!doctype html>
		<html lang="en" ${theme}>
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="color-scheme" content="light dark" />
				<title>${page.title} · Checkmate</title>
				<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
				<link rel="preload" href="/assets/fonts/inter.woff2" as="font" type="font/woff2" crossorigin />
				<link rel="stylesheet" href="/assets/style.css" />
				<script src="/assets/client.js" defer></script>
			</head>
			<body data-subjects="${page.subjects.join(",")}" data-cursor="${context.cursor}">
				<a class="skip" href="#main">Skip to content</a>
				${header(context, page)}
				<main id="main" tabindex="-1">${page.body}</main>
				<footer class="foot">
					<span>Workspace <code>${context.workspace}</code></span>
					<span>Press <kbd>?</kbd> for keyboard shortcuts</span>
				</footer>
				${context.toast ? html2`<div class="toast" role="status" data-toast>${context.toast}</div>` : ""}
				<div class="sr-only" aria-live="polite" data-announcer></div>
				${shortcuts} ${viewer}
			</body>
		</html>`;
}
function heading(title, sub = null, extra = "") {
  return html2`<div class="page-head">
		<div>
			<h1>${title}</h1>
			${sub ? html2`<p class="sub">${sub}</p>` : ""}
		</div>
		${extra}
	</div>`;
}
function banner(tone2, content) {
  return html2`<div class="banner ${tone2}" role="${tone2 === "info" ? "status" : "alert"}">${content}</div>`;
}
var downloadNames = {
  html: ["HTML", "print-ready"],
  md: ["Markdown", ".md"],
  json: ["JSON", "data"],
  junit: ["JUnit XML", "for CI"]
};
function downloads(label, base, note, formats2 = ["html", "md", "json"]) {
  const item = (format2) => html2`<a href="${base}.${format2}" download data-download="${format2}"
			>${downloadNames[format2][0]} <span class="muted small">${downloadNames[format2][1]}</span></a
		>`;
  return html2`<details class="menu" data-menu>
		<summary class="btn small" title="${note}">${label}</summary>
		<div class="menu-list">
			${formats2.map(item)}
			<p class="menu-note">${note}</p>
		</div>
	</details>`;
}

// plugin/src/ui/forms.ts
function emptyState() {
  return { values: {}, error: null, stale: null, confirm: false };
}
function hidden(context, sha256, token = "") {
  return html2`<input type="hidden" name="csrf" value="${context.csrf}" />
		<input type="hidden" name="sha" value="${sha256}" />
		${token ? html2`<input type="hidden" name="decision" value="${token}" />` : ""}`;
}
function actorField(context, state) {
  if (context.actor) return "";
  return html2`<div class="field-group">
		<label class="lab" for="actor">Your name</label>
		<input id="actor" name="actor" required autocomplete="name" value="${state.values.actor ?? ""}" />
		<p class="help">Checkmate asks once, keeps it in a cookie, and records it with each decision.</p>
	</div>`;
}
function messages(state) {
  return html2`${state.stale ? banner("warn", state.stale) : ""}
	${state.error ? html2`<p class="form-error" role="alert">${state.error}</p>` : ""}`;
}
function rationaleField(state, placeholder2) {
  return html2`<div class="field-group">
		<label class="lab" for="rationale">Rationale</label>
		<textarea id="rationale" name="rationale" rows="4" required data-rationale placeholder="${placeholder2}">
${state.values.rationale ?? ""}</textarea>
	</div>`;
}
function confirmStep(context, verdict, state) {
  const choice = state.values.verdict === verdict.reject.value ? verdict.reject : verdict.approve;
  return html2`<form method="post" action="${verdict.action}" class="decision-form">
		${hidden(context, verdict.sha256, verdict.token)}
		<input type="hidden" name="verdict" value="${choice.value}" />
		<input type="hidden" name="rationale" value="${state.values.rationale ?? ""}" />
		${context.actor ? "" : html2`<input type="hidden" name="actor" value="${state.values.actor ?? ""}" />`}
		<div class="confirm-box">
			<p class="lab">Confirm</p>
			<p>${choice.summary}</p>
			<blockquote>${state.values.rationale ?? ""}</blockquote>
		</div>
		<div class="btns">
			<button class="btn primary" name="confirmed" value="1">${choice.confirm}</button>
			<button class="btn" name="back" value="1" formnovalidate>Back</button>
		</div>
	</form>`;
}
function chooseStep(context, verdict, state) {
  const button = (choice, primary) => html2`<button
			class="btn${primary ? " primary" : ""}"
			name="verdict"
			value="${choice.value}"
			data-needs-rationale
			data-confirm-label="${choice.confirm}"
			data-summary="${choice.summary}"
		>
			${choice.label}
		</button>`;
  return html2`<form method="post" action="${verdict.action}" class="decision-form" data-verdict-form>
		${hidden(context, verdict.sha256, verdict.token)} ${actorField(context, state)}
		${rationaleField(state, "Why do you decide this?")}
		<div class="confirm-box" data-confirm hidden>
			<p class="lab">Confirm</p>
			<p data-confirm-summary></p>
		</div>
		<div class="btns" data-choose>${button(verdict.approve, true)} ${button(verdict.reject, false)}</div>
		<div class="btns" data-confirm-buttons hidden>
			<button class="btn primary" name="confirmed" value="1" data-confirm-submit>Confirm</button>
			<button class="btn" type="button" data-confirm-back>Back</button>
		</div>
	</form>`;
}
function verdictPanel(context, verdict, state) {
  return html2`<section
		class="panel decision"
		id="decide"
		aria-labelledby="decide-title"
		data-region="decision"
		data-stale-message="${verdict.staleMessage}"
	>
		<h2 class="lab" id="decide-title">Decision</h2>
		<p class="subj">${verdict.question}</p>
		<p class="help">
			${verdict.digestLabel} sha256 <code title="${verdict.sha256}">${short(verdict.sha256)}</code>. Your decision
			is recorded in the log.
		</p>
		<div data-stale-slot>${messages(state)}</div>
		${verdict.intro ?? ""}
		${state.confirm ? confirmStep(context, verdict, state) : chooseStep(context, verdict, state)}
	</section>`;
}
var kinds = [
  {
    value: "clarify",
    label: "Clarify",
    help: "Clarify gives the expected behaviour. The agent updates the affected assertions in the next revision."
  },
  {
    value: "accept_assumption",
    label: "Accept assumption",
    help: "Accept assumption records your answer as an assumption. Tests run on it, and reports list it."
  },
  {
    value: "defer",
    label: "Defer",
    help: "Defer moves the gap out of this scope. The affected tests become deferred and do not run."
  }
];
function gapPanel(context, form, state) {
  const selected = state.values.kind ?? "clarify";
  return html2`<section
		class="panel decision"
		id="answer"
		aria-labelledby="answer-title"
		data-region="decision"
		data-stale-message="${form.staleMessage}"
	>
		<h2 class="lab" id="answer-title">Answer gap</h2>
		<p class="subj">${form.title}</p>
		<p class="help">${form.question}</p>
		<div data-stale-slot>${messages(state)}</div>
		<form method="post" action="${form.action}" class="decision-form gap-form" data-gap-form>
			${hidden(context, form.sha256)}
			<fieldset class="seg-field">
				<legend class="lab">Kind of answer</legend>
				<div class="seg">
					${kinds.map(
    (kind) => html2`<input
									type="radio"
									id="kind-${kind.value}"
									name="kind"
									value="${kind.value}"
									${selected === kind.value ? html2`checked` : ""}
								/><label for="kind-${kind.value}">${kind.label}</label>`
  )}
				</div>
			</fieldset>
			${kinds.map((kind) => html2`<p class="help kind-help" data-kind="${kind.value}">${kind.help}</p>`)}
			<div class="field-group">
				<label class="lab" for="value">Answer</label>
				<textarea id="value" name="value" rows="3" required>${state.values.value ?? ""}</textarea>
			</div>
			<div class="field-group source-field">
				<label class="lab" for="source">Source <span class="req">required for Clarify</span></label>
				<input
					id="source"
					name="source"
					value="${state.values.source ?? ""}"
					placeholder="oracle://refund-policy#window"
					data-source
				/>
				<p class="help">Where the answer comes from: a document, a ticket, or a person.</p>
			</div>
			${rationaleField(state, "Why is this the right answer?")} ${actorField(context, state)}
			<div class="btns">
				<button class="btn primary" data-needs-rationale>Record answer</button>
				<a class="btn" href="${form.cancel}">Cancel</a>
			</div>
		</form>
	</section>`;
}
function recordPanel(title, content, decided = "") {
  return html2`<section
		class="panel decision"
		aria-labelledby="decide-title"
		data-region="decision"
		${decided ? html2`data-decided-message="${decided}"` : ""}
	>
		<h2 class="lab" id="decide-title">${title}</h2>
		${content}
	</section>`;
}

// plugin/src/ui/lists.ts
function inboxItems(waiting) {
  return [
    ...waiting.gaps.map((gap) => `/plans/${gap.planId}@${gap.revision}/gaps/${gap.gapId}#answer`),
    ...waiting.plans.map((plan) => `/plans/${plan.planId}@${plan.revision}#decide`),
    ...waiting.results.map((result) => `/runs/${result.runId}#decide`)
  ];
}
function loopState(loop2) {
  const role = loop2.waitsOn === "qa" ? "QA" : loop2.waitsOn;
  return html2`<span class="loop"
		>${pill(loop2.state)}${loop2.waitsOn === "none" ? "" : html2` <span class="muted small">waits on ${role}</span>`}</span
	>`;
}
function inboxCount(waiting) {
  return waiting.gaps.length + waiting.plans.length + waiting.results.length;
}
var countOrder = ["passed", "failed", "inconclusive", "error", "blocked", "not_run"];
var countLook = {
  passed: ["\u2713", "pass"],
  failed: ["\u2717", "fail"],
  inconclusive: ["?", "unsure"],
  error: ["!", "warn"],
  blocked: ["\u2013", "block"],
  not_run: ["\u2013", "block"]
};
function counts(values) {
  const shown = countOrder.filter((key) => values[key]);
  if (!shown.length) return html2`<span class="muted">no outcomes yet</span>`;
  return html2`<span class="counts"
		>${shown.map(
    (key) => html2`<span class="st ${countLook[key][1]}" title="${values[key]} ${words(key)}"
					><span aria-hidden="true">${countLook[key][0]}</span> ${values[key]}<span class="sr-only">
						${words(key)}</span
					></span
				>`
  )}</span
	>`;
}
function group(title, items, key) {
  return html2`<section class="group" aria-labelledby="group-${key}">
		<h2 class="group-h" id="group-${key}">${title} · ${items.length}</h2>
		${items.length ? html2`<ul class="items">
						${items.map((item) => html2`<li>${item}</li>`)}
					</ul>` : html2`<p class="none">None.</p>`}
	</section>`;
}
function inboxPage(store) {
  const waiting = inbox(store);
  const total = inboxCount(waiting);
  const gaps = waiting.gaps.map(
    (gap) => html2`<a
				class="item"
				href="/plans/${gap.planId}@${gap.revision}/gaps/${gap.gapId}#answer"
				data-nav-item
				data-key="gap:${gap.planId}:${gap.gapId}"
				data-announce="New gap ${gap.planId} ${gap.gapId}"
			>
				<span class="id">${gap.planId} · ${gap.gapId}</span>
				<span class="what"
					>${gap.question}${gap.runId ? html2` <span class="muted">· from run ${gap.runId}</span>` : ""}</span
				>
				<span class="end">${pill(gap.severity)} <span class="age">${time(gap.since)}</span></span>
			</a>`
  );
  const plans = waiting.plans.map(
    (plan) => html2`<a
				class="item"
				href="/plans/${plan.planId}@${plan.revision}#decide"
				data-nav-item
				data-key="plan:${plan.planId}@${plan.revision}"
				data-announce="${plan.planId}@${plan.revision} ${plan.approval === "rejected" ? "was rejected. Change the plan." : "waits for approval"}"
			>
				<span class="id">${plan.planId}@${plan.revision}</span>
				<span class="what">${plan.summary}</span>
				<span class="end"
					>${plan.approval === "rejected" ? html2`${pill("rejected")} ` : ""}<span class="age"
						>${time(plan.since)}</span
					></span
				>
			</a>`
  );
  const results = waiting.results.map(
    (result) => html2`<a
				class="item"
				href="/runs/${result.runId}#decide"
				data-nav-item
				data-key="run:${result.runId}"
				data-announce="${result.runId} waits for acceptance"
			>
				<span class="id">${result.runId}</span>
				<span class="what"
					>${result.planId}@${result.revision} · build <code>${result.build}</code> · ${counts(result.counts)}
					· coverage ${result.coverage}</span
				>
				<span class="end"><span class="age">${time(result.since)}</span></span>
			</a>`
  );
  const requests = waiting.requests.map(
    (request) => html2`<div class="item" data-key="request:${request.planId}">
				<span class="id">${request.planId}</span>
				<span class="what"
					>${request.objective} · target <code>${request.target}</code> · run
					<code>/checkmate:plan ${request.planId}</code></span
				>
				<span class="end">${pill("requested")} <span class="age">${time(request.since)}</span></span>
			</div>`
  );
  const sub = total ? `${plural(total, "item")} ${total === 1 ? "waits" : "wait"} for you, oldest first.` : null;
  const body = total + requests.length ? html2`${group("Gaps to answer", gaps, "gaps")} ${group("Plans to approve or change", plans, "plans")}
				${group("Results to accept", results, "results")} ${group("Plans to draft", requests, "requests")}` : emptyInbox(store);
  return {
    title: "Inbox",
    section: "inbox",
    subjects: ["inbox"],
    body: html2`${heading("Inbox", sub)}
			<div class="stack" data-region="inbox" data-list>${body}</div>`
  };
}
function emptyInbox(store) {
  const latest = runList(store).slice(-3).reverse();
  return html2`<div class="empty">
		<p class="empty-title">Nothing waits for you.</p>
		${latest.length ? html2`<p>Latest runs:</p>
						<ul class="items">
							${latest.map(
    (run2) => html2`<li>
										<a class="item" href="/runs/${run2.runId}" data-nav-item
											><span class="id">${run2.runId}</span
											><span class="what"
												>${run2.planId}@${run2.revision} · build <code>${run2.build}</code></span
											><span class="end">${pill(run2.acceptance ?? run2.state)}</span></a
										>
									</li>`
  )}
						</ul>` : ""}
		<p><a href="/runs">All runs</a></p>
	</div>`;
}
var pageSizes2 = [25, 50, 100];
function listState(params, spec) {
  const size2 = Number(params.get("size"));
  const page = Math.floor(Number(params.get("page")));
  const sort = params.get("sort") ?? "";
  const direction = params.get("dir");
  const filters = {};
  for (const filter of spec.filters) {
    const value2 = params.get(filter.name)?.trim() ?? "";
    if (!value2) continue;
    if (filter.strict && !filter.choices.some(([choice]) => choice === value2)) continue;
    filters[filter.name] = value2;
  }
  return {
    q: params.get("q")?.trim() ?? "",
    size: pageSizes2.includes(size2) ? size2 : 25,
    page: page > 1 ? page : 1,
    sort: spec.columns.some((column) => column.sort === sort) ? sort : spec.sort,
    direction: direction === "asc" || direction === "desc" ? direction : spec.direction,
    filters
  };
}
function listHref(spec, state, change = {}) {
  const next = { ...state, ...change };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  for (const filter of spec.filters) if (next.filters[filter.name]) params.set(filter.name, next.filters[filter.name]);
  if (next.size !== 25) params.set("size", String(next.size));
  if (next.sort !== spec.sort) params.set("sort", next.sort);
  if (next.direction !== spec.direction) params.set("dir", next.direction);
  if (next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  return query ? `${spec.path}?${query}` : spec.path;
}
function listPage(state, load) {
  const query = (page2) => ({
    limit: state.size,
    offset: (page2 - 1) * state.size,
    sort: state.sort,
    direction: state.direction,
    q: state.q,
    filters: state.filters
  });
  const page = load(query(state.page));
  const last = Math.max(1, Math.ceil(page.total / state.size));
  if (state.page <= last) return { page, state };
  return { page: load(query(last)), state: { ...state, page: last } };
}
function options(choices, selected) {
  return choices.map(
    ([value2, label]) => html2`<option value="${value2}" ${value2 === selected ? html2`selected` : ""}>${label}</option>`
  );
}
function filterChoices(filter, selected) {
  if (!selected || filter.choices.some(([value2]) => value2 === selected)) return filter.choices;
  return [...filter.choices, [selected, selected]];
}
function filterBar(spec, state) {
  const hiddenField = (name, value2, fallback) => html2`<input type="hidden" name="${name}" value="${value2}" data-default="${fallback}" />`;
  return html2`<form class="filters" method="get" action="${spec.path}" role="search" data-list-form>
		<label class="sr-only" for="q">Search ${spec.noun}s</label>
		<input
			id="q"
			type="search"
			name="q"
			value="${state.q}"
			placeholder="${spec.search}"
			autocomplete="off"
			data-search
		/>
		${spec.filters.map(
    (filter) => html2`<label class="sr-only" for="filter-${filter.name}">${filter.label}</label>
					<select id="filter-${filter.name}" name="${filter.name}" data-default="">
						${options(filterChoices(filter, state.filters[filter.name] ?? ""), state.filters[filter.name] ?? "")}
					</select>`
  )}
		<label class="sr-only" for="size">Rows per page</label>
		<select id="size" name="size" data-default="25">
			${options(
    pageSizes2.map((size2) => [String(size2), `${size2} rows`]),
    String(state.size)
  )}
		</select>
		${hiddenField("sort", state.sort, spec.sort)} ${hiddenField("dir", state.direction, spec.direction)}
		<button class="btn" data-list-submit>Filter</button>
		<a class="btn ghost" href="${spec.path}" data-list-clear>Clear</a>
	</form>`;
}
function headerCell(spec, state, column) {
  if (!column.sort) return html2`<th scope="col">${column.label}</th>`;
  const active = state.sort === column.sort;
  const direction = active ? state.direction === "asc" ? "desc" : "asc" : column.first ?? "asc";
  const href = listHref(spec, state, { sort: column.sort, direction, page: 1 });
  const sorted2 = active ? html2` aria-sort="${state.direction === "asc" ? "ascending" : "descending"}"` : "";
  const arrow = active ? state.direction === "asc" ? "\u2191" : "\u2193" : "\u2195";
  return html2`<th scope="col" ${sorted2}>
		<a class="sort${active ? " on" : ""}" href="${href}" data-list-link
			>${column.label}<span class="arrow" aria-hidden="true">${arrow}</span></a
		>
	</th>`;
}
function pager(spec, state, total) {
  const last = Math.max(1, Math.ceil(total / state.size));
  if (last === 1) return "";
  const link = (page, label, rel) => page === state.page || page < 1 || page > last ? html2`<span class="btn small" aria-disabled="true">${label}</span>` : html2`<a class="btn small" href="${listHref(spec, state, { page })}" rel="${rel}" data-list-link
					>${label}</a
				>`;
  return html2`<nav class="pager" aria-label="Pages">
		${link(1, "\xAB First", "first")} ${link(state.page - 1, "\u2039 Previous", "prev")}
		<span class="pager-at">Page ${state.page} of ${last}</span>
		${link(state.page + 1, "Next \u203A", "next")} ${link(last, "Last \xBB", "last")}
	</nav>`;
}
function listRegion(spec, state, total, rows, tableClass = "") {
  const first = total ? (state.page - 1) * state.size + 1 : 0;
  const last = Math.min(total, state.page * state.size);
  const count = total ? `Showing ${first}\u2013${last} of ${plural(total, spec.noun)}` : `No ${spec.noun} matches these filters.`;
  return html2`<div data-region="${spec.region}" data-list-region>
		<p class="list-count" data-list-count role="status">${count}</p>
		${total ? html2`<div class="scroll">
							<table class="${tableClass}">
								<thead>
									<tr>
										${spec.columns.map((column) => headerCell(spec, state, column))}
									</tr>
								</thead>
								<tbody>
									${rows}
								</tbody>
							</table>
						</div>
						${pager(spec, state, total)}` : ""}
	</div>`;
}
var planShows2 = [
  ["", "All plans"],
  ["needs_decision", "Open gaps"],
  ["awaiting_approval", "Awaiting approval"],
  ["blocked", "Blocked"]
];
var approvals = [
  ["", "Any approval"],
  ["pending", "Pending"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["not_required", "Not required"]
];
var waits = [
  ["", "Anyone"],
  ["oracle", "Oracle"],
  ["planner", "Planner"],
  ["qa", "QA"],
  ["factory", "Factory"],
  ["none", "Nobody"]
];
function plansSpec() {
  return {
    path: "/plans",
    region: "plans",
    noun: "plan",
    search: "Search plans",
    columns: [
      { label: "Plan", sort: "plan" },
      { label: "Loop", sort: "loop" },
      { label: "Tests", sort: "tests", first: "desc" },
      { label: "Open gaps", sort: "gaps", first: "desc" },
      { label: "Approval", sort: "approval" },
      { label: "Blocks", sort: "blocked", first: "desc" },
      { label: "Updated", sort: "updated", first: "desc" }
    ],
    sort: "updated",
    direction: "desc",
    filters: [
      { name: "show", label: "Show", choices: planShows2, strict: true },
      { name: "approval", label: "Approval", choices: approvals, strict: true },
      { name: "waits", label: "Waits on", choices: waits, strict: true }
    ]
  };
}
function testSummary(tests) {
  return html2`${plural(tests.total, "test")}
		<span class="muted"
			>· ${tests.ready}
			ready${tests.blocked ? ` \xB7 ${tests.blocked} blocked` : ""}${tests.deferred ? ` \xB7 ${tests.deferred} deferred` : ""}</span
		>`;
}
function requestedPlanRow(row) {
  return html2`<tr data-key="plan:${row.planId}" data-nav-row>
		<td><span class="mono">${row.planId}</span></td>
		<td>${loopState(row.loop)}</td>
		<td><span class="muted">no revision yet</span></td>
		<td><span class="muted">none</span></td>
		<td>${pill("requested")}</td>
		<td><span class="muted">none</span></td>
		<td class="nowrap">${time(row.since)}</td>
	</tr>`;
}
function planRow(row) {
  if (row.status === "requested") return requestedPlanRow(row);
  return html2`<tr data-key="plan:${row.planId}" data-nav-row>
		<td>
			<a class="mono" href="/plans/${row.planId}@${row.revision}" data-nav-item>${row.planId}@${row.revision}</a>
		</td>
		<td>${loopState(row.loop)}</td>
		<td>${testSummary(row.tests)}</td>
		<td>
			${row.openGaps.length ? join4(
    row.openGaps.map(
      (id2) => html2`<a class="mono" href="/plans/${row.planId}@${row.revision}/gaps/${id2}"
										>${id2}${row.openBlockingGaps.includes(id2) ? html2`<span class="sr-only"> blocking</span>` : ""}</a
									>`
    ),
    ", "
  ) : html2`<span class="muted">none</span>`}
		</td>
		<td>${pill(row.approval ?? row.status)}</td>
		<td>
			${row.blocked.length ? html2`<ul class="plain">
							${row.blocked.map(
    (block) => html2`<li>
										<span class="mono">${block.testId}</span> by
										<span class="mono">${block.dependency}</span>: ${block.cause}
									</li>`
  )}
						</ul>` : html2`<span class="muted">none</span>`}
		</td>
		<td class="nowrap">${time(row.since)}</td>
	</tr>`;
}
function plansPage(store, params) {
  const spec = plansSpec();
  const { page, state } = listPage(listState(params, spec), (query) => pagedPlans(store, query));
  return {
    title: "Plans",
    section: "plans",
    subjects: ["*"],
    body: html2`${heading("Plans", "Each plan at its latest revision.")} ${filterBar(spec, state)}
		${listRegion(spec, state, page.total, page.rows.map(planRow))}`
  };
}
var runStatuses2 = [
  ["", "All runs"],
  ["started", "In progress"],
  ["pending", "Awaiting acceptance"],
  ["approved", "Accepted"],
  ["rejected", "Rejected"],
  ["not_required", "No acceptance needed"]
];
function runStatus2(row) {
  if (row.state === "started") return pill("started", "in progress");
  if (row.acceptance === "approved") return pill("approved", "accepted");
  if (row.acceptance === "pending") return pill("pending", "awaiting acceptance");
  return pill(row.acceptance ?? "finalized");
}
function distinct(values) {
  return [...new Set(values)].sort().map((value2) => [value2, value2]);
}
function runsSpec(store) {
  const runs = runList(store);
  return {
    path: "/runs",
    region: "runs",
    noun: "run",
    search: "Search runs",
    columns: [
      { label: "Run", sort: "run" },
      { label: "Plan", sort: "plan" },
      { label: "Build", sort: "build" },
      { label: "Instance", sort: "instance" },
      { label: "Tests" },
      { label: "Completion", sort: "completion" },
      { label: "Coverage", sort: "coverage" },
      { label: "Status", sort: "status" },
      { label: "Started", sort: "started", first: "desc" }
    ],
    sort: "started",
    direction: "desc",
    filters: [
      {
        name: "plan",
        label: "Plan",
        choices: [["", "All plans"], ...distinct(planList(store).map((row) => row.planId))],
        strict: false
      },
      {
        name: "build",
        label: "Build",
        choices: [["", "All builds"], ...distinct(runs.map((row) => row.build))],
        strict: false
      },
      { name: "status", label: "Status", choices: runStatuses2, strict: true }
    ]
  };
}
function runRow(row) {
  return html2`<tr data-key="run:${row.runId}" data-nav-row>
		<td><a class="mono" href="/runs/${row.runId}" data-nav-item>${row.runId}</a></td>
		<td><a class="mono" href="/plans/${row.planId}@${row.revision}">${row.planId}@${row.revision}</a></td>
		<td class="mono">${row.build}</td>
		<td class="mono">${row.instanceId}</td>
		<td>${counts(row.counts)}</td>
		<td>${row.completion ? pill(row.completion) : html2`<span class="muted">running</span>`}</td>
		<td>${row.coverage ? pill(row.coverage) : html2`<span class="muted">–</span>`}</td>
		<td>${runStatus2(row)}</td>
		<td class="nowrap">${time(row.startedAt)}</td>
	</tr>`;
}
function runsPage(store, params) {
  const spec = runsSpec(store);
  const { page, state } = listPage(listState(params, spec), (query) => pagedRuns(store, query));
  return {
    title: "Runs",
    section: "runs",
    subjects: ["*"],
    body: html2`${heading("Runs", "Every run of every plan.")} ${filterBar(spec, state)}
		${listRegion(spec, state, page.total, page.rows.map(runRow))}`
  };
}
function subjectLink(subject) {
  const [kind, id2] = subject.split(/:(.*)/);
  if (kind === "plan") return html2`<a class="mono" href="/plans/${id2}">${subject}</a>`;
  if (kind === "run") return html2`<a class="mono" href="/runs/${id2}">${subject}</a>`;
  if (kind === "target") return html2`<a class="mono" href="/settings/targets/${id2}">${subject}</a>`;
  if (kind === "inbox") return html2`<a class="mono" href="/">${subject}</a>`;
  return html2`<span class="mono">${subject}</span>`;
}
function reasons(response) {
  const list2 = response?.reasons;
  return Array.isArray(list2) ? list2.map(String) : [];
}
function logSpec(store) {
  const recent = operationLog(store, { limit: 1e3 });
  return {
    path: "/log",
    region: "log",
    noun: "operation",
    search: "Search the log",
    columns: [
      { label: "Time", sort: "time", first: "desc" },
      { label: "Actor", sort: "actor" },
      { label: "Command", sort: "command" },
      { label: "Status", sort: "status" },
      { label: "Subjects" },
      { label: "Operation" }
    ],
    sort: "time",
    direction: "desc",
    filters: [
      {
        name: "subject",
        label: "Subject",
        choices: [["", "All subjects"], ...distinct(recent.flatMap((row) => row.subjects))],
        strict: false
      },
      {
        name: "actor",
        label: "Actor",
        choices: [["", "All actors"], ...distinct(recent.map((row) => row.actor))],
        strict: false
      },
      {
        name: "command",
        label: "Command",
        choices: [["", "All commands"], ...distinct(recent.map((row) => row.command))],
        strict: false
      },
      {
        name: "status",
        label: "Status",
        choices: [["", "All statuses"], ...distinct(recent.map((row) => row.status))],
        strict: false
      }
    ]
  };
}
function logRow(row) {
  return html2`<tr data-key="op:${row.rowid}">
		<td class="nowrap">${time(row.at)}</td>
		<td>${row.actor}</td>
		<td>
			<span class="mono">${row.command}</span>
			${row.status === "rejected" ? html2`<div class="reason">${reasons(row.response).join(" ")}</div>` : ""}
		</td>
		<td>${pill(row.status === "rejected" ? "rejected_operation" : row.status, words(row.status))}</td>
		<td>
			${row.subjects.length ? join4(row.subjects.map(subjectLink), " ") : html2`<span class="muted">none</span>`}
		</td>
		<td class="mono muted">${row.id}</td>
	</tr>`;
}
function logPage(store, params) {
  const spec = logSpec(store);
  const { page, state } = listPage(listState(params, spec), (query) => pagedOperations(store, query));
  return {
    title: "Log",
    section: "log",
    subjects: ["*"],
    body: html2`${heading("Log", "Every write to the workspace.")} ${filterBar(spec, state)}
		${listRegion(spec, state, page.total, page.rows.map(logRow), "log")}`
  };
}

// plugin/src/ui/plan.ts
function testLink(planId, revision, reference) {
  const [owner, id2] = reference.includes(":") ? reference.split(":") : [null, reference];
  return owner ? html2`<a class="mono" href="/plans/${owner}#${id2}">${reference}</a>` : html2`<a class="mono" href="/plans/${planId}@${revision}#${id2}">${reference}</a>`;
}
function ids(values, link) {
  return values.length ? join4(values.map(link), ", ") : html2`<span class="muted">none</span>`;
}
function facts(rows) {
  const shown = rows.filter(([, value2]) => value2 !== false);
  return html2`<dl class="facts">
		${shown.map(
    ([label, value2]) => html2`<div>
					<dt>${label}</dt>
					<dd>${value2}</dd>
				</div>`
  )}
	</dl>`;
}
function testCard(detail, test) {
  const { planId, revision } = detail;
  return html2`<article class="test" id="${test.id}" data-key="test:${test.id}">
		<header class="test-h">
			${pill(test.readiness)}
			<a class="id" href="#${test.id}">${test.id}</a>
			<h3>${test.title}</h3>
			<span class="count">${test.capability} · ${plural(test.assertions.length, "assertion")}</span>
		</header>
		<div class="test-b">
			${facts([
    ["Requirements", ids(test.requirementIds, (id2) => html2`<a class="mono" href="#${id2}">${id2}</a>`)],
    [
      "Depends on",
      test.dependsOn.length > 0 && ids(test.dependsOn, (id2) => testLink(planId, revision, id2))
    ],
    [
      "Gaps",
      test.gapIds.length > 0 && ids(test.gapIds, (id2) => html2`<a class="mono" href="#${id2}">${id2}</a>`)
    ],
    [
      "Operations",
      test.operations.length > 0 && html2`<span class="mono">${test.operations.join(", ")}</span>`
    ],
    [
      "Preconditions",
      test.preconditions.length > 0 && html2`<ul class="plain">
							${test.preconditions.map((item) => html2`<li>${item}</li>`)}
						</ul>`
    ],
    ["Action", test.action],
    ["Metadata", hasMetadata(test.metadata) && metadataList(test.metadata)]
  ])}
		</div>
		${test.assertions.length ? html2`<ul class="checklist" aria-label="Assertions of ${test.id}">
						${test.assertions.map(
    (assertion) => html2`<li class="asr" id="${test.id}.${assertion.id}">
									<span class="box" aria-hidden="true"></span>
									<span class="aid">${assertion.id}</span>
									<span class="check">${assertion.check}</span>
									<span class="tag">${words(assertion.checkKind)}</span>
								</li>`
  )}
					</ul>` : html2`<p class="test-note">No assertions yet. A blocking gap must be answered first.</p>`}
	</article>`;
}
function decisionFor(plan, gap) {
  return plan.decisions.find((decision) => decision.id === gap.decisionId);
}
function gapRow(detail, gap) {
  const decision = decisionFor(detail.plan, gap);
  const pending = detail.pendingDecisions.find((item) => item.gapId === gap.id);
  const answerable = gap.status === "open" && !pending && detail.revision === detail.latestRevision;
  const affects = [...gap.requirementIds, ...gap.testIds];
  const head = html2`<span class="id mono">${gap.id}</span>
		${pill(gap.severity)} ${pill(gap.status)}
		<span class="gap-refs muted"
			>${affects.length ? `affects ${affects.join(", ")}` : "affects the whole plan"}</span
		>`;
  const content = html2`<p class="muted">${gap.consequence}</p>
		${decision ? html2`<p class="gap-d">
						${pill(decision.kind)} ${decision.value} <span class="muted">· ${decision.actor}</span>
					</p>` : ""}
		${pending ? html2`<p class="gap-d">
						${pill("pending", "decision pending")} ${words(pending.kind)}: ${pending.value}
						<span class="muted">· ${pending.actor} · applies in the next revision</span>
					</p>` : ""}
		${answerable ? html2`<p>
						<a class="btn small" href="/plans/${detail.planId}@${detail.revision}/gaps/${gap.id}"
							>Answer ${gap.id}</a
						>
					</p>` : ""}`;
  if (gap.status === "open")
    return html2`<li class="gap" id="${gap.id}" data-key="gap:${gap.id}">
			<div class="gap-h">${head}</div>
			<p class="gap-q">${gap.question}</p>
			${content}
		</li>`;
  return html2`<li class="gap closed" id="${gap.id}" data-key="gap:${gap.id}">
		<details data-open-key="gap:${gap.id}">
			<summary>
				<span class="gap-h">${head}</span>
				<span class="gap-q">${gap.question}</span>
			</summary>
			<div class="gap-b">${content}</div>
		</details>
	</li>`;
}
function gapsList(detail) {
  const gaps = detail.plan.gaps;
  if (!gaps.length) return html2`<p class="empty-line">No gaps.</p>`;
  const open = gaps.filter((gap) => gap.status === "open");
  const closed = gaps.filter((gap) => gap.status !== "open");
  return html2`<ul class="gaps">
		${[...open, ...closed].map((gap) => gapRow(detail, gap))}
	</ul>`;
}
function runsTable(detail) {
  if (!detail.runs.length) return html2`<p class="empty-line">No run uses this plan yet.</p>`;
  return html2`<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col">Run</th>
					<th scope="col">Revision</th>
					<th scope="col">Build</th>
					<th scope="col">Instance</th>
					<th scope="col">Tests</th>
					<th scope="col">Completion</th>
					<th scope="col">Acceptance</th>
					<th scope="col">Started</th>
				</tr>
			</thead>
			<tbody>
				${[...detail.runs].reverse().map(
    (run2) => html2`<tr data-key="run:${run2.runId}">
							<td><a class="mono" href="/runs/${run2.runId}">${run2.runId}</a></td>
							<td>
								<a class="mono" href="/plans/${detail.planId}@${run2.revision}">@${run2.revision}</a>
							</td>
							<td class="mono">${run2.build}</td>
							<td class="mono">${run2.instanceId}</td>
							<td>${counts(run2.counts)}</td>
							<td>${run2.completion ? pill(run2.completion) : html2`<span class="muted">running</span>`}</td>
							<td>${runStatus2(run2)}</td>
							<td class="nowrap">${time(run2.startedAt)}</td>
						</tr>`
  )}
			</tbody>
		</table>
	</div>`;
}
function requirementsTable(plan) {
  return html2`<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col">ID</th>
					<th scope="col">Requirement</th>
					<th scope="col">Tests</th>
					<th scope="col">Coverage</th>
				</tr>
			</thead>
			<tbody>
				${plan.requirements.map((requirement) => {
    const coverage2 = plan.coverage.find((row) => row.requirementId === requirement.id);
    return html2`<tr id="${requirement.id}">
						<td class="mono">${requirement.id}</td>
						<td>
							${requirement.text}
							<div class="muted small">Source <code>${requirement.source}</code></div>
							${hasMetadata(requirement.metadata) ? html2`<div class="small">${metadataList(requirement.metadata)}</div>` : ""}
						</td>
						<td>${ids(coverage2?.testIds ?? [], (id2) => html2`<a class="mono" href="#${id2}">${id2}</a>`)}</td>
						<td>${coverage2 ? pill(coverage2.status) : ""}</td>
					</tr>`;
  })}
			</tbody>
		</table>
	</div>`;
}
function decisionsList(plan) {
  if (!plan.decisions.length && !plan.assumptions.length)
    return html2`<p class="empty-line">No decision applied yet.</p>`;
  return html2`<ul class="records">
			${plan.decisions.map(
    (decision) => html2`<li>
						<div class="record-h">
							${pill(decision.kind)} <a class="mono" href="#${decision.gapId}">${decision.gapId}</a>
							<span class="muted">by ${decision.actor}</span>
							<span class="mono muted small">${decision.id}</span>
						</div>
						<p>${decision.value}</p>
						<p class="muted small">
							Rationale:
							${decision.rationale}${decision.source ? html2` · Source <code>${decision.source}</code>` : ""}
						</p>
					</li>`
  )}
		</ul>
		${plan.assumptions.length ? html2`<h3 class="minor">Assumptions</h3>
						<ul class="plain">
							${plan.assumptions.map((item) => html2`<li>${item.text}</li>`)}
						</ul>` : ""}`;
}
function changeLine(line) {
  const arrow = line.indexOf(" \u2192 ");
  const colon = line.indexOf(": ");
  if (arrow < 0 || colon < 0 || colon > arrow) return html2`<li><code>${line}</code></li>`;
  return html2`<li>
		<code>${line.slice(0, colon)}</code>
		<span class="was">${line.slice(colon + 2, arrow)}</span>
		<span aria-hidden="true" class="arrow">→</span><span class="sr-only">changed to</span>
		<span class="now">${line.slice(arrow + 3)}</span>
	</li>`;
}
var historyShown = 6;
function planHistoryList(store, detail, all2) {
  const revisions = planHistory(store, detail.planId).reverse();
  const shown = all2 ? revisions : revisions.slice(0, historyShown);
  const hidden3 = revisions.length - shown.length;
  const subject = `${detail.planId}@${detail.revision}`;
  return html2`<div class="history-wrap" data-history>
		<ol class="history${hidden3 ? " clipped" : ""}">
			${shown.map(
    (item, index2) => html2`<li class="${item.revision === detail.revision ? "current" : ""}">
						<details ${index2 === 0 ? html2`open` : ""} data-open-key="revision:${item.revision}">
							<summary class="record-h">
								<span class="mono rev">${detail.planId}@${item.revision}</span>
								<span class="muted">by ${item.actor} · ${time(item.at)}</span>
								<code class="muted small" title="${item.sha256}">${short(item.sha256)}</code>
								<span class="muted small"
									>${item.changes.length ? plural(item.changes.length, "change") : "first revision"}</span
								>
							</summary>
							<div class="history-b">
								${item.changes.length ? html2`<ul class="changes">
												${item.changes.map(changeLine)}
											</ul>` : html2`<p class="muted small">First revision.</p>`}
								<p class="small">
									<a href="/plans/${detail.planId}@${item.revision}"
										>Open ${detail.planId}@${item.revision}</a
									>
								</p>
							</div>
						</details>
					</li>`
  )}
		</ol>
		${hidden3 ? html2`<a
						class="history-more"
						href="/plans/${subject}?history=all#history"
						data-history-more="/plans/${subject}/history"
						><span class="btn small">Show full history · ${plural(hidden3, "earlier revision")}</span></a
					>` : ""}
	</div>`;
}
function approvalPanel(store, context, detail, state) {
  const subject = `${detail.planId}@${detail.revision}`;
  const latest = detail.approval.latest;
  if (detail.approval.policy === "none")
    return recordPanel("Approval", html2`<p class="help">The target policy does not require plan approval.</p>`);
  if (latest && latest.sha256 === detail.sha256 && !state)
    return recordPanel(
      "Approval",
      html2`<p class="subj">${pill(latest.verdict)} ${subject}</p>
				<p class="help">
					By ${latest.actor} · ${time(latest.at)} · sha256 <code>${short(latest.sha256)}</code>
				</p>
				<blockquote>${latest.rationale}</blockquote>
				${latest.sha256 !== detail.sha256 ? banner("warn", "This decision was for another digest.") : ""}`,
      `${subject} was ${latest.verdict} by ${latest.actor}. Review it before you decide.`
    );
  return verdictPanel(
    context,
    {
      action: `/plans/${subject}`,
      subject,
      question: `Approve ${subject}?`,
      sha256: detail.sha256,
      token: decisionToken(store, "plan", subject),
      digestLabel: "Plan",
      approve: {
        value: "approve",
        label: `Approve ${subject}`,
        confirm: "Confirm approval",
        summary: `Approve ${subject}. Runs can then use this revision.`
      },
      reject: {
        value: "reject",
        label: "Reject",
        confirm: "Confirm rejection",
        summary: `Reject ${subject}. The agent must revise the plan.`
      },
      staleMessage: `${detail.planId} changed. Review it before you decide.`,
      intro: html2`<p class="help">${planSummaryLine(detail.plan)}</p>`
    },
    state ?? emptyState()
  );
}
function planSummaryLine(plan) {
  const count = (readiness) => plan.tests.filter((test) => test.readiness === readiness).length;
  const open = plan.gaps.filter((gap) => gap.status === "open").length;
  return `${plural(plan.tests.length, "test")}: ${count("ready")} ready, ${count("blocked")} blocked, ${count("deferred")} deferred. ${plural(open, "open gap")}.`;
}
function newerBanner(detail) {
  if (detail.revision === detail.latestRevision) return "";
  return banner(
    "info",
    html2`Revision ${detail.latestRevision} is available.
			<a href="/plans/${detail.planId}@${detail.latestRevision}"
				>Review ${detail.planId}@${detail.latestRevision}</a
			>`
  );
}
function side(content) {
  return html2`<aside class="side" aria-label="Decision">
		${content}
		<p class="back"><a href="/">← Back to inbox</a></p>
	</aside>`;
}
function planPage(store, context, planId, revision, state = null, allHistory = false) {
  const detail = planDetail(store, planId, revision);
  const { plan } = detail;
  const subject = `${planId}@${revision}`;
  const latest = detail.revision === detail.latestRevision;
  const meta = html2`<div class="meta">
		${loopState(planStatus(store, planId))} ${pill(detail.approval.state)}
		<span class="pill">target <span class="mono">${plan.target.targetId}@${plan.target.revision}</span></span>
		<span class="pill" title="${detail.sha256}">sha256 <span class="mono">${short(detail.sha256)}</span></span>
		<span class="head-actions">
			${latest ? html2`<a class="btn small" href="/plans/${subject}/edit">Edit plan</a>` : ""}
			${downloads("Export", `/plans/${subject}/export`, "The HTML export is print-ready. Open it and print to PDF.")}
		</span>
	</div>`;
  const pending = detail.pendingDecisions.length ? banner(
    "info",
    html2`${plural(detail.pendingDecisions.length, "decision")}
				${detail.pendingDecisions.length === 1 ? "waits" : "wait"} for the next revision:
				${detail.pendingDecisions.map((item) => `${item.gapId} ${words(item.kind)}`).join(", ")}.`
  ) : "";
  const body = html2`${heading(subject, plan.objective, meta)}
		<div data-region="banners">${newerBanner(detail)} ${pending}</div>
		<div class="split">
			<div class="main-col">
				<nav class="jump" aria-label="On this page">
					<a href="#tests">Tests</a><a href="#gaps">Gaps</a><a href="#requirements">Requirements</a
					><a href="#runs">Runs</a><a href="#decisions">Decisions</a><a href="#history">History</a>
				</nav>
				<section aria-labelledby="tests" data-region="tests">
					<h2 id="tests">
						Tests <span class="n">${plan.tests.length}</span>
						${latest ? html2`<a class="h-link" href="/plans/${subject}/edit#edit-tests">Edit</a>` : ""}
					</h2>
					<div class="stack">${plan.tests.map((test) => testCard(detail, test))}</div>
				</section>
				<section aria-labelledby="gaps" data-region="gaps">
					<h2 id="gaps">Gaps <span class="n">${plan.gaps.length}</span></h2>
					${gapsList(detail)}
				</section>
				<section aria-labelledby="requirements">
					<h2 id="requirements">
						Requirements and coverage
						${latest ? html2`<a class="h-link" href="/plans/${subject}/edit#edit-requirements">Edit</a>` : ""}
					</h2>
					${requirementsTable(plan)}
				</section>
				<section aria-labelledby="runs" data-region="plan-runs">
					<h2 id="runs">Runs <span class="n">${detail.runs.length}</span></h2>
					${runsTable(detail)}
				</section>
				<section aria-labelledby="decisions">
					<h2 id="decisions">Decisions</h2>
					${decisionsList(plan)}
				</section>
				<section aria-labelledby="history" data-region="history">
					<h2 id="history">History</h2>
					${planHistoryList(store, detail, allHistory)}
				</section>
			</div>
			${side(approvalPanel(store, context, detail, state))}
		</div>`;
  return {
    title: subject,
    section: "plans",
    subjects: [`plan:${planId}`, "inbox", ...detail.runs.map((run2) => `run:${run2.runId}`)],
    body
  };
}
function gapPage(store, context, planId, revision, gapId, state = null) {
  const detail = planDetail(store, planId, revision);
  const { plan } = detail;
  const latest = detail.revision === detail.latestRevision;
  const fromRun = plan.gaps.some((item) => item.id === gapId) || !latest ? null : unadoptedRunGap(store, planId, gapId);
  const gap = plan.gaps.find((item) => item.id === gapId) ?? fromRun?.gap;
  if (!gap) throw new Error(`Unknown gap ${gapId} in ${planId}@${revision}`);
  const subject = `${planId}@${revision}`;
  const pending = detail.pendingDecisions.find((item) => item.gapId === gap.id);
  const decision = decisionFor(plan, gap);
  const tests = plan.tests.filter((test) => gapsAffecting([gap], test).length > 0);
  const requirements = plan.requirements.filter((requirement) => gap.requirementIds.includes(requirement.id));
  const runBanner = fromRun ? banner(
    "info",
    html2`This gap comes from run <a class="mono" href="/runs/${fromRun.runId}">${fromRun.runId}</a>. Your
					answer adds it to ${planId}.`
  ) : "";
  let panel;
  if (state || latest && gap.status === "open" && !pending)
    panel = gapPanel(
      context,
      {
        action: `/plans/${subject}/gaps/${gap.id}`,
        cancel: `/plans/${subject}#${gap.id}`,
        sha256: detail.sha256,
        title: html2`${planId} · ${gap.id} · ${words(gap.severity)}`,
        question: gap.question,
        staleMessage: `${planId} changed. Review it before you answer.`
      },
      state ?? emptyState()
    );
  else if (pending)
    panel = recordPanel(
      "Answer recorded",
      html2`<p class="subj">${pill(pending.kind)} ${gap.id}</p>
				<blockquote>${pending.value}</blockquote>
				<p class="help">By ${pending.actor}. The agent applies it in the next revision of ${planId}.</p>`
    );
  else if (decision)
    panel = recordPanel(
      "Decision",
      html2`<p class="subj">${pill(decision.kind)} ${gap.id}</p>
				<blockquote>${decision.value}</blockquote>
				<p class="help">By ${decision.actor}. Rationale: ${decision.rationale}</p>`
    );
  else
    panel = recordPanel(
      "Answer gap",
      html2`<p class="help">Answer this gap on the latest revision.</p>
				<p>
					<a class="btn" href="/plans/${planId}@${detail.latestRevision}/gaps/${gap.id}"
						>Open ${planId}@${detail.latestRevision}</a
					>
				</p>`
    );
  const meta = html2`<div class="meta">
		${pill(gap.severity)} ${pill(gap.status)} <a class="pill" href="/plans/${subject}">${subject}</a>
	</div>`;
  const body = html2`${heading(html2`${planId} · ${gap.id}`, gap.question, meta)}
		<div data-region="banners">${newerBanner(detail)} ${runBanner}</div>
		<div class="split">
			<div class="main-col">
				<section aria-labelledby="consequence">
					<h2 id="consequence">Consequence</h2>
					<p class="lead">${gap.consequence}</p>
				</section>
				${requirements.length ? html2`<section aria-labelledby="gap-requirements">
								<h2 id="gap-requirements">Requirements</h2>
								<ul class="records">
									${requirements.map(
    (requirement) => html2`<li>
												<div class="record-h"><span class="mono">${requirement.id}</span></div>
												<p>${requirement.text}</p>
												<p class="muted small">Source <code>${requirement.source}</code></p>
											</li>`
  )}
								</ul>
							</section>` : ""}
				<section aria-labelledby="gap-tests">
					<h2 id="gap-tests">Affected tests <span class="n">${tests.length}</span></h2>
					${tests.length ? html2`<div class="stack">${tests.map((test) => testCard(detail, test))}</div>` : html2`<p class="empty-line">No test names this gap.</p>`}
				</section>
			</div>
			${side(panel)}
		</div>`;
  return {
    title: `${planId} ${gap.id}`,
    section: "inbox",
    subjects: [`plan:${planId}`, "inbox", ...fromRun ? [`run:${fromRun.runId}`] : []],
    body
  };
}
function unadoptedRunGap(store, planId, gapId) {
  const found = planRunGaps(store, planId).filter((item) => item.gap.id === gapId && !item.adopted);
  return found.length === 1 ? found[0] : null;
}

// plugin/src/ui/edit.ts
function words2(values) {
  return values.split(/[\s,]+/).map((value2) => value2.trim()).filter(Boolean);
}
function lines(values) {
  return values.split("\n").map((value2) => value2.trim()).filter(Boolean);
}
function checkKind(value2, fallback) {
  return value2 === "deterministic" || value2 === "agent_observation" ? value2 : fallback;
}
function candidateFromForm(base, form) {
  const text = (name, fallback) => (form.get(name) ?? fallback).trim();
  const covered = new Set(form.getAll("cover"));
  return {
    requirements: base.requirements.map((requirement, i) => ({
      ...requirement,
      text: text(`r${i}.text`, requirement.text),
      source: text(`r${i}.source`, requirement.source)
    })),
    tests: base.tests.map((test, i) => ({
      ...test,
      title: text(`t${i}.title`, test.title),
      capability: text(`t${i}.capability`, test.capability),
      operations: words2(form.get(`t${i}.operations`) ?? test.operations.join(", ")),
      dependsOn: words2(form.get(`t${i}.dependsOn`) ?? test.dependsOn.join(", ")),
      preconditions: lines(form.get(`t${i}.preconditions`) ?? test.preconditions.join("\n")),
      action: text(`t${i}.action`, test.action),
      requirementIds: base.requirements.filter((requirement) => covered.has(`${test.id} ${requirement.id}`)).map((requirement) => requirement.id),
      assertions: test.assertions.map((assertion, j2) => ({
        ...assertion,
        check: text(`t${i}.a${j2}.check`, assertion.check),
        checkKind: checkKind(form.get(`t${i}.a${j2}.kind`), assertion.checkKind)
      }))
    })),
    gaps: base.gaps
  };
}
function candidateJson(candidate) {
  return JSON.stringify(candidate, null, 2);
}
function pathName(candidate, path) {
  const [, list2, index2, ...rest] = path.split("/");
  const items = list2 === "requirements" ? candidate.requirements : list2 === "tests" ? candidate.tests : candidate.gaps;
  return [items[Number(index2)]?.id ?? index2, ...rest].join(".");
}
function changeLines(before, after) {
  return jsonPatch(before, after).map((operation) => `${pathName(before, operation.path)}: ${JSON.stringify(operation.value ?? null)}`).join("\n");
}
function ownChanges(form, fresh) {
  const json = form.get("json") ?? "";
  try {
    const orig = JSON.parse(form.get("orig") ?? "");
    if (form.get("mode") === "json") return changeLines(orig, JSON.parse(json));
    return changeLines(orig, candidateFromForm(orig, form));
  } catch {
    return form.get("mode") === "json" ? json : changeLines(fresh, candidateFromForm(fresh, form));
  }
}
function unsavedPanel(unsaved) {
  return html2`<section class="panel unsaved" aria-labelledby="unsaved-title">
		<h2 class="lab" id="unsaved-title">Your changes (not saved)</h2>
		<p class="help">
			The editor below shows the latest version. These are the values that you changed. Apply the changes again,
			then save.
		</p>
		<pre class="code">${unsaved || "You changed no values."}</pre>
	</section>`;
}
function field(label, name, value2, help2 = "") {
  return html2`<div class="field-group">
		<label class="lab" for="${name}">${label}</label>
		<input id="${name}" name="${name}" value="${value2}" />
		${help2 ? html2`<p class="help">${help2}</p>` : ""}
	</div>`;
}
function area(label, name, value2, rows, help2 = "") {
  return html2`<div class="field-group">
		<label class="lab" for="${name}">${label}</label>
		<textarea id="${name}" name="${name}" rows="${rows}">${value2}</textarea>
		${help2 ? html2`<p class="help">${help2}</p>` : ""}
	</div>`;
}
function requirementFields(requirement, i) {
  return html2`<fieldset class="edit-card" id="edit-${requirement.id}">
		<legend class="mono">${requirement.id}</legend>
		${area("Text", `r${i}.text`, requirement.text, 2)}
		${field("Source", `r${i}.source`, requirement.source, "Where the requirement comes from.")}
	</fieldset>`;
}
function testFields(test, i) {
  return html2`<fieldset class="edit-card" id="edit-${test.id}">
		<legend><span class="mono">${test.id}</span> ${test.title}</legend>
		${field("Title", `t${i}.title`, test.title)}
		<div class="edit-row">
			${field("Capability", `t${i}.capability`, test.capability)}
			${field("Operations", `t${i}.operations`, test.operations.join(", "), "Separate with commas.")}
		</div>
		${field(
    "Depends on",
    `t${i}.dependsOn`,
    test.dependsOn.join(", "),
    "Test IDs, separated with commas. Use plan:T1 for a test in another plan."
  )}
		${area("Preconditions", `t${i}.preconditions`, test.preconditions.join("\n"), 2, "One per line.")}
		${area("Action", `t${i}.action`, test.action, 2)}
		<div class="field-group">
			<p class="lab">Assertions</p>
			${test.assertions.length ? html2`<ul class="edit-asrs">
							${test.assertions.map(
    (assertion, j2) => html2`<li>
										<label class="aid" for="t${i}.a${j2}.check">${assertion.id}</label>
										<textarea id="t${i}.a${j2}.check" name="t${i}.a${j2}.check" rows="1">
${assertion.check}</textarea>
										<label class="sr-only" for="t${i}.a${j2}.kind"
											>Check kind of ${assertion.id}</label
										>
										<select id="t${i}.a${j2}.kind" name="t${i}.a${j2}.kind">
											${["deterministic", "agent_observation"].map(
      (kind) => html2`<option
														value="${kind}"
														${kind === assertion.checkKind ? html2`selected` : ""}
													>
														${kind.replace("_", " ")}
													</option>`
    )}
										</select>
									</li>`
  )}
						</ul>` : html2`<p class="help">No assertions. Add them in the JSON editor.</p>`}
		</div>
	</fieldset>`;
}
function coverageMatrix(candidate) {
  return html2`<div class="scroll">
		<table class="matrix">
			<thead>
				<tr>
					<th scope="col">Requirement</th>
					${candidate.tests.map((test) => html2`<th scope="col" class="mono">${test.id}</th>`)}
				</tr>
			</thead>
			<tbody>
				${candidate.requirements.map(
    (requirement) => html2`<tr>
							<th scope="row">
								<span class="mono">${requirement.id}</span>
								<span class="muted small matrix-text">${requirement.text}</span>
							</th>
							${candidate.tests.map(
      (test) => html2`<td>
										<input
											type="checkbox"
											name="cover"
											value="${test.id} ${requirement.id}"
											aria-label="${test.id} covers ${requirement.id}"
											${test.requirementIds.includes(requirement.id) ? html2`checked` : ""}
										/>
									</td>`
    )}
						</tr>`
  )}
			</tbody>
		</table>
	</div>`;
}
function hidden2(context, sha256, mode, orig) {
  return html2`<input type="hidden" name="csrf" value="${context.csrf}" />
		<input type="hidden" name="sha" value="${sha256}" />
		<input type="hidden" name="mode" value="${mode}" />
		<input type="hidden" name="orig" value="${orig}" />`;
}
function actorLine(context, state, path, mode) {
  if (context.actor)
    return html2`<p class="help">
			Saving as <strong>${context.actor}</strong>.
			<a href="/actor?back=${encodeURIComponent(path)}">Change name</a>
		</p>`;
  return html2`<div class="field-group">
		<label class="lab" for="actor-${mode}">Your name</label>
		<input id="actor-${mode}" name="actor" required autocomplete="name" value="${state.actor}" />
		<p class="help">Checkmate records it with the edit.</p>
	</div>`;
}
function editPage(store, context, planId, revision, state = null) {
  const detail = planDetail(store, planId, revision);
  const subject = `${planId}@${revision}`;
  const path = `/plans/${subject}/edit`;
  const title = `Edit ${subject}`;
  if (detail.revision !== detail.latestRevision)
    return {
      title,
      section: "plans",
      subjects: [`plan:${planId}`],
      body: html2`${heading(title, detail.plan.objective)}
			${banner(
        "info",
        html2`Only the latest revision can change.
					<a href="/plans/${planId}@${detail.latestRevision}/edit"
						>Edit ${planId}@${detail.latestRevision}</a
					>`
      )}`
    };
  const frozen = frozenRevision(store, planId, revision);
  const needsApproval = detail.approval.policy !== "none";
  const next = revision + 1;
  const save2 = frozen ? `Save as ${planId}@${next}` : "Save changes";
  const why = frozen === "run" ? `A run uses ${subject}.` : `${subject} is approved.`;
  const notice = frozen ? banner(
    "warn",
    html2`<strong
						>${why} Saving creates revision ${next}${needsApproval ? ", which needs approval" : ""}.</strong
					>
					${subject} stays as it is.`
  ) : banner(
    "info",
    html2`<strong>Edits change this revision in place.</strong> ${subject} is not approved and no run uses
					it.`
  );
  const shown = state ?? {
    mode: "form",
    candidate: planCandidate(detail.plan),
    json: candidateJson(planCandidate(detail.plan)),
    actor: "",
    error: null,
    stale: null,
    unsaved: null,
    orig: JSON.stringify(planCandidate(detail.plan))
  };
  const messages2 = html2`${shown.stale ? banner("warn", shown.stale) : ""}
	${shown.error ? html2`<p class="form-error" role="alert">${shown.error}</p>` : ""}`;
  const buttons = (mode) => html2`<div class="btns">
				<button class="btn primary">${save2}</button>
				<a class="btn" href="/plans/${subject}">Cancel</a>
			</div>
			${actorLine(context, shown, path, mode)}`;
  const body = html2`${heading(
    title,
    detail.plan.objective,
    html2`<div class="meta">
				<a class="pill" href="/plans/${subject}">${subject}</a>
				<span class="pill" title="${detail.sha256}"
					>sha256 <span class="mono">${short(detail.sha256)}</span></span
				>
			</div>`
  )}
		${shown.unsaved === null ? "" : unsavedPanel(shown.unsaved)}
		<div data-region="edit" data-stale-message="${planId} changed. Review it before you save.">
			<div data-stale-slot>${notice} ${messages2}</div>
			<form method="post" action="${path}" class="edit-form" data-edit-form>
				${hidden2(context, detail.sha256, "form", shown.orig)}
				<section aria-labelledby="edit-requirements">
					<h2 id="edit-requirements">
						Requirements <span class="n">${shown.candidate.requirements.length}</span>
					</h2>
					<div class="stack">${shown.candidate.requirements.map(requirementFields)}</div>
				</section>
				<section aria-labelledby="edit-tests">
					<h2 id="edit-tests">Tests <span class="n">${shown.candidate.tests.length}</span></h2>
					<div class="stack">${shown.candidate.tests.map(testFields)}</div>
				</section>
				<section aria-labelledby="edit-coverage">
					<h2 id="edit-coverage">Coverage</h2>
					<p class="help">Mark the requirements that each test covers. Each test covers one or more.</p>
					${coverageMatrix(shown.candidate)}
				</section>
				<div class="edit-save">${buttons("form")}</div>
			</form>
			<details class="edit-json" ${shown.mode === "json" ? html2`open` : ""}>
				<summary>Edit as JSON</summary>
				<form method="post" action="${path}" class="edit-form" data-edit-form>
					${hidden2(context, detail.sha256, "json", shown.orig)}
					<p class="help">
						Add or remove requirements, tests, assertions, and gaps. The JSON has the fields of a plan
						candidate:
						<code>requirements</code>, <code>tests</code>, and <code>gaps</code>.
					</p>
					<label class="sr-only" for="json">Plan candidate JSON</label>
					<textarea id="json" name="json" rows="24" class="code" spellcheck="false">${shown.json}</textarea>
					${buttons("json")}
				</form>
			</details>
		</div>`;
  return { title, section: "plans", subjects: [`plan:${planId}`], body };
}

// plugin/src/ui/run.ts
var imageTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
var textTypes = ["text/plain", "application/json", "text/markdown", "application/xml", "text/csv"];
var inlineLimit = 64 * 1024;
function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function evidenceItem(store, item) {
  const href = `/evidence/${item.id}`;
  const caption = html2`<span class="ev-name">${item.name}</span> <span class="muted">${size(item.size)}</span>`;
  if (imageTypes.includes(item.mediaType))
    return html2`<figure class="ev ev-image">
			<a href="${href}" data-view-image data-name="${item.name}">
				<img src="${href}" alt="Evidence ${item.name}" loading="lazy" />
			</a>
			<figcaption>${caption}</figcaption>
		</figure>`;
  if (textTypes.includes(item.mediaType) && item.size <= inlineLimit) {
    const text = new TextDecoder().decode(evidenceBytes(store, item.id).bytes);
    return html2`<figure class="ev ev-text">
			<figcaption>${caption} <a href="${href}" download="${item.name}">Download</a></figcaption>
			<pre tabindex="0">${text}</pre>
		</figure>`;
  }
  return html2`<a class="chip" href="${href}" download="${item.name}">↓ ${item.name} · ${size(item.size)}</a>`;
}
function evidenceChips(items) {
  if (!items.length) return "";
  return html2`<p class="evidence">
		${items.map(
    (item) => html2`<a
					class="chip"
					href="/evidence/${item.id}"
					${imageTypes.includes(item.mediaType) ? html2`data-view-image data-name="${item.name}"` : html2`download="${item.name}"`}
					>${item.name} · ${size(item.size)}</a
				>`
  )}
	</p>`;
}
function evidenceList(store, items) {
  if (!items.length) return "";
  return html2`<div class="evidence">${items.map((item) => evidenceItem(store, item))}</div>`;
}
function tone(result) {
  if (result === "failed") return "failed";
  if (result === "inconclusive") return "unsure";
  if (result === "not_checked") return "warn";
  return "";
}
function findingRefs(detail, reference) {
  const findings2 = detail.findings.filter((finding) => finding.assertionIds.includes(reference));
  if (!findings2.length) return "";
  return html2` ·
	${join4(
    findings2.map((finding) => html2`<a href="#${finding.id}">finding ${finding.id}</a>`),
    ", "
  )}`;
}
function assertionRow(store, detail, test, assertion) {
  const reference = `${test.testId}.${assertion.assertionId}`;
  if (!assertion.result)
    return html2`<li class="asr waiting" id="${reference}" data-key="${reference}">
			<div class="asr-row">
				${icon(null)}<span class="aid">${assertion.assertionId}</span>
				<div class="asr-text">
					${assertion.check}
					<div class="obs">No result yet.</div>
				</div>
			</div>
		</li>`;
  const open = assertion.result !== "passed";
  return html2`<li
		class="asr ${tone(assertion.result)}"
		id="${reference}"
		data-key="${reference}"
		data-announce="${reference} ${words(assertion.result)}"
	>
		<details ${open ? html2`open` : ""} data-open-key="${reference}">
			<summary class="asr-row">
				${icon(assertion.result)}<span class="aid">${assertion.assertionId}</span>
				<div class="asr-text">
					${assertion.check}
					${assertion.observed ? html2`<div class="obs">
									Observed: <code>${assertion.observed}</code>${findingRefs(detail, reference)}
								</div>` : ""}
				</div>
			</summary>
			<div class="asr-body">
				${assertion.reason ? html2`<p class="reason"><strong>Reason</strong> ${assertion.reason}</p>` : ""}
				<p class="muted small">${words(assertion.checkKind)} · ${words(assertion.result)}</p>
				${evidenceList(store, assertion.evidence)}
			</div>
		</details>
	</li>`;
}
function testState(test, detail) {
  if (test.outcome) return pill(test.outcome);
  if (detail.state === "finalized") return pill("not_run");
  return test.assertions.some((assertion) => assertion.result) ? pill("started", "running") : pill("pending", "waiting");
}
function testCard2(store, detail, test) {
  const passed = test.assertions.filter((assertion) => assertion.result === "passed").length;
  const recorded = test.assertions.filter((assertion) => assertion.result).length;
  const announce = test.outcome ? `${test.testId} closed: ${words(test.outcome)}` : `${test.testId} running`;
  return html2`<article class="test" id="${test.testId}" data-key="test:${test.testId}" data-announce="${announce}">
		<header class="test-h">
			${testState(test, detail)}
			<a class="id" href="#${test.testId}">${test.testId}</a>
			<h3>${test.title}</h3>
			<span class="count"
				>${passed} of ${test.assertions.length}
				passed${recorded < test.assertions.length ? ` \xB7 ${test.assertions.length - recorded} without result` : ""}</span
			>
		</header>
		${hasMetadata(test.metadata) ? html2`<p class="test-note">${metadataList(test.metadata)}</p>` : ""}
		${test.reason ? html2`<p class="test-note">${test.reason}</p>` : ""}
		${test.evidence.length ? html2`<div class="test-ev">${evidenceList(store, test.evidence)}</div>` : ""}
		<ul class="asrs">
			${test.assertions.map((assertion) => assertionRow(store, detail, test, assertion))}
		</ul>
	</article>`;
}
function outcomeCounts2(detail) {
  const values = {};
  for (const test of detail.tests) if (test.outcome) values[test.outcome] = (values[test.outcome] ?? 0) + 1;
  return values;
}
function strip(detail) {
  const result = detail.result;
  return html2`<div class="strip" data-region="summary">
		<div><small>Completion</small><strong>${result ? words(result.completion) : "running"}</strong></div>
		<div><small>Coverage</small><strong>${result ? words(result.coverage.status) : "\u2013"}</strong></div>
		<div><small>Tests</small><strong>${counts(outcomeCounts2(detail))}</strong></div>
		<div><small>Cleanup</small><strong>${result ? words(result.cleanup.status) : "\u2013"}</strong></div>
	</div>`;
}
function findings(store, detail) {
  if (!detail.findings.length) return html2`<p class="empty-line">No findings.</p>`;
  const evidence2 = detail.tests.flatMap((test) => [
    ...test.evidence,
    ...test.assertions.flatMap((assertion) => assertion.evidence)
  ]);
  return html2`<div class="stack">
		${detail.findings.map(
    (finding) => html2`<article class="finding" id="${finding.id}" data-key="finding:${finding.id}">
					<header class="test-h">
						${pill(finding.type)} <span class="id">${finding.id}</span>
						<h3>${finding.title}</h3>
						<span class="count">${pill(finding.severity)}</span>
					</header>
					<div class="test-b">
						<div class="compare">
							<div>
								<small>Expected</small>
								<p>${finding.expected}</p>
							</div>
							<div>
								<small>Observed</small>
								<p>${finding.observed}</p>
							</div>
						</div>
						${finding.reproduction.length ? html2`<h4 class="minor">Reproduction</h4>
										<ol class="steps">
											${finding.reproduction.map((step) => html2`<li>${step}</li>`)}
										</ol>` : ""}
						<p class="muted small">
							Assertions
							${join4(
      finding.assertionIds.map((id2) => html2`<a class="mono" href="#${id2}">${id2}</a>`),
      ", "
    )}${finding.requirementIds.length ? ` \xB7 requirements ${finding.requirementIds.join(", ")}` : ""}
						</p>
						${hasMetadata(finding.metadata) ? html2`<p>${metadataList(finding.metadata)}</p>` : ""}
						${evidenceChips(evidence2.filter((item) => finding.evidenceIds.includes(item.id)))}
					</div>
				</article>`
  )}
	</div>`;
}
function adoptForm(context, detail, gapId, sha256) {
  return html2`<form method="post" action="/runs/${detail.runId}/gaps/${gapId}" class="inline-form">
		<input type="hidden" name="csrf" value="${context.csrf}" />
		<input type="hidden" name="sha" value="${sha256}" />
		${context.actor ? "" : html2`<input
						name="actor"
						required
						autocomplete="name"
						placeholder="Your name"
						aria-label="Your name"
					/>`}
		<button class="btn small">Bring into plan</button>
	</form>`;
}
function newGaps(store, context, detail, adoptError) {
  if (!detail.newGaps.length) return html2`<p class="empty-line">No new gaps.</p>`;
  const revision = planRevision(store, detail.planId);
  const latest = `${detail.planId}@${revision.plan.revision}`;
  const adopted = planRunGaps(store, detail.planId).filter((item) => item.runId === detail.runId && item.adopted).map((item) => item.gap.id);
  return html2`<ul class="gaps">
		${detail.newGaps.map(
    (gap) => html2`<li class="gap" id="${gap.id}" data-key="gap:${gap.id}">
					<div class="gap-h">
						<span class="id mono">${gap.id}</span> ${pill(gap.severity)} ${pill(gap.status)}
						<span class="gap-refs muted"
							>affects ${[...gap.requirementIds, ...gap.testIds].join(", ") || "the plan"}</span
						>
					</div>
					<p class="gap-q">${gap.question}</p>
					<p class="muted">${gap.consequence}</p>
					<div class="actions">
						${adopted.includes(gap.id) ? html2`${pill("resolved", "in plan")}
										<a href="/plans/${latest}#${gap.id}">${latest}</a>` : html2`<a class="btn small" href="/plans/${latest}/gaps/${gap.id}#answer">Answer</a>
										${adoptForm(context, detail, gap.id, revision.sha256)}`}
					</div>
					${adoptError?.gapId === gap.id ? html2`<p class="form-error" role="alert">${adoptError.message}</p>` : ""}
				</li>`
  )}
	</ul>`;
}
function coverage(store, detail) {
  const result = detail.result;
  if (!result) return html2`<p class="empty-line">Coverage is known when the run finishes.</p>`;
  const plan = planDetail(store, detail.planId, detail.revision).plan;
  const requirements = new Map(plan.requirements.map((item) => [item.id, item]));
  return html2`<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col">ID</th>
					<th scope="col">Requirement</th>
					<th scope="col">Tests</th>
					<th scope="col">Coverage</th>
				</tr>
			</thead>
			<tbody>
				${result.coverage.requirements.map(
    (row) => html2`<tr>
							<td class="mono">${row.requirementId}</td>
							<td>
								${requirements.get(row.requirementId)?.text ?? ""}
								${row.reason ? html2`<div class="muted small">${row.reason}</div>` : ""}
								${hasMetadata(requirements.get(row.requirementId)?.metadata) ? html2`<div class="small">
												${metadataList(requirements.get(row.requirementId)?.metadata)}
											</div>` : ""}
							</td>
							<td class="mono">${row.testIds.join(", ") || "\u2013"}</td>
							<td>${pill(row.status)}</td>
						</tr>`
  )}
			</tbody>
		</table>
	</div>`;
}
function cleanup(detail) {
  const result = detail.result;
  return html2`<dl class="facts">
		<div>
			<dt>Cleanup</dt>
			<dd>
				${result ? html2`${pill(result.cleanup.status)} ${result.cleanup.reason}` : html2`<span class="muted">Not finished.</span>`}
			</dd>
		</div>
		<div>
			<dt>Attempts</dt>
			<dd>
				<ul class="plain">
					${detail.attempts.map(
    (attempt) => html2`<li>Attempt ${attempt.attempt} · ${clock(attempt.startedAt)} · ${attempt.actor}</li>`
  )}
				</ul>
			</dd>
		</div>
		<div>
			<dt>Browser session</dt>
			<dd class="mono">${detail.browserSession}</dd>
		</div>
		<div>
			<dt>Target</dt>
			<dd class="mono">${detail.target}</dd>
		</div>
		<div>
			<dt>Instance</dt>
			<dd>
				<a
					class="mono"
					href="/settings/targets/${detail.instance.targetId}#instance-${detail.instance.instanceId}"
					>${detail.instance.instanceId}</a
				>${detail.instance.environment ? html2` · ${detail.instance.environment}` : ""}${detail.instance.retired ? html2` · ${pill("retired")}` : ""}
			</dd>
		</div>
		${detail.request.retestOf ? html2`<div>
						<dt>Retest of</dt>
						<dd><a class="mono" href="/runs/${detail.request.retestOf}">${detail.request.retestOf}</a></dd>
					</div>` : ""}
	</dl>`;
}
function inconclusiveList(detail) {
  const rows = detail.tests.flatMap(
    (test) => test.assertions.filter((assertion) => assertion.result === "inconclusive").map((assertion) => ({
      reference: `${test.testId}.${assertion.assertionId}`,
      reason: assertion.reason ?? ""
    }))
  );
  if (!rows.length) return "";
  return html2`<div class="field-group">
		<p class="lab">Inconclusive · ${rows.length}</p>
		<ul class="plist">
			${rows.map(
    (row) => html2`<li>
						<a href="#${row.reference}"><code>${row.reference}</code></a> ${row.reason}
					</li>`
  )}
		</ul>
	</div>`;
}
function decisionPanel(store, context, detail, state) {
  const result = detail.result;
  if (!result)
    return recordPanel(
      "Decision",
      html2`<p class="subj">${detail.runId} is in progress.</p>
				<p class="help">The decision opens when the run finishes. This page updates live.</p>`
    );
  if (result.acceptance === "not_required")
    return recordPanel("Decision", html2`<p class="help">The target policy does not require result acceptance.</p>`);
  const latest = result.latestDecision;
  if (latest && !state)
    return recordPanel(
      "Decision",
      html2`<p class="subj">
					${pill(latest.verdict, latest.verdict === "approved" ? "accepted" : "rejected")} ${detail.runId}
				</p>
				<p class="help">
					By ${latest.actor} · ${time(latest.at)} · sha256 <code>${short(latest.sha256)}</code>
				</p>
				<blockquote>${latest.rationale}</blockquote>`,
      `${detail.runId} was ${latest.verdict === "approved" ? "accepted" : "rejected"} by ${latest.actor}. Review it before you decide.`
    );
  return verdictPanel(
    context,
    {
      action: `/runs/${detail.runId}`,
      subject: detail.runId,
      question: `Accept ${detail.runId}?`,
      sha256: result.sha256,
      token: decisionToken(store, "result", detail.runId),
      digestLabel: "Result",
      approve: {
        value: "accept",
        label: `Accept ${detail.runId}`,
        confirm: "Confirm acceptance",
        summary: `Accept ${detail.runId} as the record of build ${detail.build}.`
      },
      reject: {
        value: "reject",
        label: "Reject",
        confirm: "Confirm rejection",
        summary: `Reject ${detail.runId}. Dependent plans stay blocked.`
      },
      staleMessage: `${detail.runId} has a new result. Review it before you decide.`,
      intro: inconclusiveList(detail)
    },
    state ?? emptyState()
  );
}
function runBadge(detail) {
  const acceptance = detail.result?.acceptance;
  if (!acceptance) return pill("started", "in progress");
  if (acceptance === "approved") return pill("approved", "accepted");
  if (acceptance === "pending") return pill("pending", "awaiting acceptance");
  return pill(acceptance);
}
function runPage(store, context, runId, state = null, adoptError = null) {
  const detail = runDetail(store, runId);
  const sub = html2`<a class="mono" href="/plans/${detail.planId}@${detail.revision}"
			>${detail.planId}@${detail.revision}</a
		>
		· build <code>${detail.build}</code> · instance <code>${detail.instance.instanceId}</code> · started
		${clock(detail.startedAt)} · ${plural(detail.attempts.length, "attempt")}
		${detail.result ? html2`· finished ${time(detail.result.finishedAt)} ago` : ""}`;
  const badge = runBadge(detail);
  const report = detail.result ? downloads(
    "Download report",
    `/runs/${runId}/report`,
    "The HTML report is self-contained and print-ready. Open it and print to PDF. JUnit XML is for CI.",
    ["html", "md", "json", "junit"]
  ) : html2`<span class="muted small">The report is ready when the run finishes.</span>`;
  const body = html2`${heading(
    runId,
    sub,
    html2`<div class="meta" data-region="state">${badge} <span class="head-actions">${report}</span></div>`
  )}
		<div class="split">
			<div class="main-col">
				${strip(detail)}
				<nav class="jump" aria-label="On this page">
					<a href="#tests">Tests</a><a href="#findings">Findings</a><a href="#new-gaps">New gaps</a
					><a href="#coverage">Coverage</a><a href="#cleanup">Cleanup</a>
				</nav>
				<section aria-labelledby="tests" data-region="tests">
					<h2 id="tests">Tests <span class="n">${detail.tests.length}</span></h2>
					<div class="stack">${detail.tests.map((test) => testCard2(store, detail, test))}</div>
				</section>
				<section aria-labelledby="findings" data-region="findings">
					<h2 id="findings">Findings <span class="n">${detail.findings.length}</span></h2>
					${findings(store, detail)}
				</section>
				<section aria-labelledby="new-gaps" data-region="new-gaps">
					<h2 id="new-gaps">New gaps <span class="n">${detail.newGaps.length}</span></h2>
					${newGaps(store, context, detail, adoptError)}
				</section>
				<section aria-labelledby="coverage" data-region="coverage">
					<h2 id="coverage">Coverage</h2>
					${coverage(store, detail)}
				</section>
				<section aria-labelledby="cleanup" data-region="cleanup">
					<h2 id="cleanup">Cleanup and attempts</h2>
					${cleanup(detail)}
				</section>
			</div>
			<aside class="side" aria-label="Decision">
				${decisionPanel(store, context, detail, state)}
				<p class="back"><a href="/">← Back to inbox</a></p>
			</aside>
		</div>`;
  return { title: runId, section: "runs", subjects: [`run:${runId}`, "inbox"], body };
}

// plugin/src/ui/settings.ts
var settingsPages = [{ path: "/settings/targets", label: "Targets" }];
function settingsNav(current) {
  return html2`<nav class="settings-nav" aria-label="Settings pages">
		<ul class="nav">
			${settingsPages.map(
    (page) => html2`<li>
						<a href="${page.path}" ${page.path === current ? html2`aria-current="page"` : ""}
							>${page.label}</a
						>
					</li>`
  )}
		</ul>
	</nav>`;
}
function settingsPage(current, title, subjects, body, status) {
  return {
    title,
    section: "settings",
    subjects,
    status,
    body: html2`${settingsNav(current)} ${body}`
  };
}
function none2(text = "none") {
  return html2`<span class="muted">${text}</span>`;
}
function words3(items) {
  return items.length ? join4(
    items.map((item) => html2`<code>${item}</code>`),
    " "
  ) : none2();
}
function targetsPage(store) {
  const targets = targetList(store);
  const rows = targets.map(
    (target) => html2`<tr data-key="target:${target.targetId}" data-nav-row>
				<td>
					<a class="mono" href="/settings/targets/${target.targetId}" data-nav-item>${target.targetId}</a>
				</td>
				<td class="mono">${target.revision === null ? none2("no profile yet") : `@${target.revision}`}</td>
				<td>${words3(target.capabilities)}</td>
				<td>${words3(target.entryPoints)}</td>
				<td>${target.activeInstances}</td>
			</tr>`
  );
  const body = html2`${heading("Targets", "Each target with its latest revision and its active instances.")}
		<div data-region="targets" data-list>
			${targets.length ? html2`<div class="scroll">
							<table>
								<thead>
									<tr>
										<th scope="col">Target</th>
										<th scope="col">Revision</th>
										<th scope="col">Capabilities</th>
										<th scope="col">Entry points</th>
										<th scope="col">Active instances</th>
									</tr>
								</thead>
								<tbody>
									${rows}
								</tbody>
							</table>
						</div>` : html2`<div class="empty">
							<p class="empty-title">No target yet.</p>
							<p>Record one with <code>checkmate target open</code>.</p>
						</div>`}
		</div>`;
  return settingsPage("/settings/targets", "Targets", ["*"], body);
}
function entryPointsTable(entryPoints) {
  return html2`<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col">Entry point</th>
					<th scope="col">Kind</th>
					<th scope="col">Purpose</th>
				</tr>
			</thead>
			<tbody>
				${entryPoints.map(
    (entry) => html2`<tr>
							<td class="mono">${entry.name}</td>
							<td class="mono">${entry.kind}</td>
							<td>${entry.purpose}</td>
						</tr>`
  )}
			</tbody>
		</table>
	</div>`;
}
function toolsTable(profile) {
  if (!profile.tools.length) return html2`<p class="empty-line">No tools.</p>`;
  return html2`<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col">Tool</th>
					<th scope="col">Kind</th>
					<th scope="col">Version</th>
					<th scope="col">At setup</th>
					<th scope="col">Purpose</th>
				</tr>
			</thead>
			<tbody>
				${profile.tools.map(
    (tool) => html2`<tr>
							<td class="mono">${tool.name}</td>
							<td class="mono">${tool.kind}</td>
							<td class="mono">${tool.version ?? "\u2013"}</td>
							<td>${tool.reachable ? pill("passed", "reachable") : pill("failed", "unreachable")}</td>
							<td>${tool.purpose}</td>
						</tr>`
  )}
			</tbody>
		</table>
	</div>`;
}
function profileFacts(profile) {
  const approvals2 = profile.approvals ?? { plan: "required", result: "required" };
  return html2`<dl class="facts">
		<div>
			<dt>Capabilities</dt>
			<dd>${words3(profile.capabilities)}</dd>
		</div>
		<div>
			<dt>Operations</dt>
			<dd>${words3(profile.allowedOperations)}</dd>
		</div>
		<div>
			<dt>Authentication</dt>
			<dd>
				<code>${profile.authentication.kind}</code> · references ${words3(profile.authentication.references)}
			</dd>
		</div>
		<div>
			<dt>Approvals</dt>
			<dd>plan <code>${approvals2.plan}</code> · result <code>${approvals2.result}</code></dd>
		</div>
		<div>
			<dt>Startup</dt>
			<dd>
				${profile.startup.owner}${profile.startup.command ? html2` · <code>${profile.startup.command.join(" ")}</code>` : ""}
			</dd>
		</div>
		<div>
			<dt>Cleanup</dt>
			<dd>${profile.cleanup}</dd>
		</div>
		${profile.reset ? html2`<div>
						<dt>Reset</dt>
						<dd>
							${profile.reset.owner}${profile.reset.command ? html2` · <code>${profile.reset.command.join(" ")}</code>` : ""}
						</dd>
					</div>` : ""}
		<div>
			<dt>Ready</dt>
			<dd>${profile.readyForLiveExecution ? pill("ready") : pill("blocked", "not ready")}</dd>
		</div>
	</dl>`;
}
function historyList(store, targetId, shown) {
  const revisions = targetHistory(store, targetId).reverse();
  if (!revisions.length) return html2`<p class="empty-line">No profile yet.</p>`;
  return html2`<ol class="history">
		${revisions.map(
    (item) => html2`<li class="${item.revision === shown ? "current" : ""}">
					<div class="record-h">
						<a class="mono rev" href="/settings/targets/${targetId}?revision=${item.revision}"
							>${targetId}@${item.revision}</a
						>
						<span class="muted">by ${item.actor} · ${time(item.at)}</span>
						<code class="muted small" title="${item.sha256}">${short(item.sha256)}</code>
						<span class="muted small"
							>${item.changed.length ? html2`changed ${item.changed.join(", ")}` : "first revision"}</span
						>
					</div>
				</li>`
  )}
	</ol>`;
}
function entryList(instance) {
  return html2`<dl class="entries">
		${Object.entries(instance.entries).map(
    ([name, value2]) => html2`<div>
					<dt class="mono">${name}</dt>
					<dd>
						<code
							>${join4(
      value2.split(" ").map((word) => html2`<span class="word">${word}</span>`),
      " "
    )}</code
						>
					</dd>
				</div>`
  )}
	</dl>`;
}
function actorInput(context, id2) {
  if (context.actor) return "";
  return html2`<div class="field-group">
		<label class="lab" for="${id2}">Your name</label>
		<input id="${id2}" name="actor" required autocomplete="name" />
	</div>`;
}
function retireControl(context, targetId, instance, retire) {
  if (instance.retired) return html2`<span class="muted small">retired by ${instance.retired.actor}</span>`;
  const failed = retire?.instanceId === instance.instanceId ? retire.error : null;
  return html2`<details class="retire" ${failed ? html2`open` : ""} data-open-key="retire:${instance.instanceId}">
		<summary class="btn small" aria-label="Retire ${instance.instanceId}">Retire</summary>
		<form
			method="post"
			action="/settings/targets/${targetId}/instances/${instance.instanceId}/retire"
			class="confirm-box"
		>
			<input type="hidden" name="csrf" value="${context.csrf}" />
			<input type="hidden" name="confirmed" value="1" />
			<p>Retire <code>${instance.instanceId}</code>? No new run can start on it. Its runs stay as they are.</p>
			${failed ? html2`<p class="form-error" role="alert">${failed}</p>` : ""}
			${actorInput(context, `retire-actor-${instance.instanceId}`)}
			<div class="btns"><button class="btn primary">Confirm retire</button></div>
		</form>
	</details>`;
}
function instancesTable(context, targetId, instances, retire) {
  if (!instances.length) return html2`<p class="empty-line">No instance yet. Add one to start runs.</p>`;
  return html2`<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col">Instance</th>
					<th scope="col">Entries</th>
					<th scope="col">Environment</th>
					<th scope="col">References</th>
					<th scope="col">Added</th>
					<th scope="col">Status</th>
					<th scope="col"><span class="sr-only">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				${instances.map(
    (instance) => html2`<tr id="instance-${instance.instanceId}" data-key="instance:${instance.instanceId}">
							<td class="mono">${instance.instanceId}</td>
							<td>${entryList(instance)}</td>
							<td>${instance.environment ?? none2()}</td>
							<td>${words3(instance.references)}</td>
							<td>${instance.addedBy} · ${time(instance.addedAt)}</td>
							<td>${instance.retired ? pill("retired") : pill("active")}</td>
							<td>${retireControl(context, targetId, instance, retire)}</td>
						</tr>`
  )}
			</tbody>
		</table>
	</div>`;
}
function addForm(context, targetId, entryPoints, form) {
  const value2 = (name) => form?.values[name] ?? "";
  return html2`<section
		class="panel decision"
		aria-labelledby="add-instance"
		data-region="instance-form"
		data-stale-message="${targetId} changed. Review it before you add the instance."
	>
		<h2 class="lab" id="add-instance">Add instance</h2>
		<p class="help">
			An instance is one place where the target runs. Adding one needs no new revision and no approval.
		</p>
		<div data-stale-slot>${form?.error ? html2`<p class="form-error" role="alert">${form.error}</p>` : ""}</div>
		<form method="post" action="/settings/targets/${targetId}/instances" class="decision-form">
			<input type="hidden" name="csrf" value="${context.csrf}" />
			<div class="field-group">
				<label class="lab" for="instance-id">Instance ID</label>
				<input
					id="instance-id"
					name="instanceId"
					required
					pattern="[A-Za-z0-9][A-Za-z0-9_\\-]{0,95}"
					value="${value2("instanceId")}"
					placeholder="staging"
				/>
				<p class="help">Letters, digits, _ or -. An instance ID is not used again.</p>
			</div>
			${entryPoints.map(
    (entry) => html2`<div class="field-group">
						<label class="lab" for="entry-${entry.name}"
							>${entry.name} <span class="req">${entry.kind}</span></label
						>
						<input
							id="entry-${entry.name}"
							name="entry.${entry.name}"
							required
							value="${value2(`entry.${entry.name}`)}"
							aria-describedby="entry-${entry.name}-help"
						/>
						<p class="help" id="entry-${entry.name}-help">${entry.purpose}</p>
					</div>`
  )}
			<div class="field-group">
				<label class="lab" for="environment">Environment <span class="req">optional</span></label>
				<input id="environment" name="environment" value="${value2("environment")}" placeholder="UAT sandbox" />
			</div>
			<div class="field-group">
				<label class="lab" for="references">References <span class="req">optional</span></label>
				<textarea id="references" name="references" rows="2" aria-describedby="references-help">
${value2("references")}</textarea>
				<p class="help" id="references-help">One per line, for example an authentication alias. No secrets.</p>
			</div>
			${actorInput(context, "instance-actor")}
			<div class="btns"><button class="btn primary">Add instance</button></div>
		</form>
	</section>`;
}
function targetPage(store, context, targetId, revision, form = null, retire = null) {
  const request = targetRequest(store, targetId);
  const latest = targetHistory(store, targetId).at(-1)?.revision ?? null;
  const shown = latest === null ? null : targetRevision(store, targetId, revision ?? latest);
  const instances = instanceList(store, targetId);
  const active = instances.filter((instance) => !instance.retired).length;
  const instancesText = plural(active, "active instance");
  const older = html2` · <a href="/settings/targets/${targetId}">latest is ${latest}</a>`;
  const revisionText = shown ? `Revision ${shown.revision}` : "";
  const sub = shown ? html2`${revisionText}${shown.revision === latest ? " (latest)" : older} · ${instancesText}` : html2`No profile yet. Run <code>checkmate delegate setup ${targetId}</code>. ${instancesText}.`;
  const shape = shown ? html2`<section aria-labelledby="tools">
					<h2 id="tools">Tools <span class="n">${shown.profile.tools.length}</span></h2>
					${toolsTable(shown.profile)}
				</section>
				<section aria-labelledby="profile">
					<h2 id="profile">Profile</h2>
					${profileFacts(shown.profile)}
				</section>` : banner("info", html2`The setup request is recorded. The profile is not saved yet.`);
  const body = html2`${heading(
    targetId,
    sub,
    html2`<div class="meta">
				${shown ? html2`<span class="pill" title="${shown.sha256}">sha256 <span class="mono">${short(shown.sha256)}</span></span>` : ""}
			</div>`
  )}
		<div class="split">
			<div class="main-col">
				<nav class="jump" aria-label="On this page">
					<a href="#entry-points">Entry points</a
					><a href="#instances">Instances</a
					>${shown ? html2`<a href="#tools">Tools</a><a href="#profile">Profile</a>` : ""}<a href="#history"
						>History</a
					>
				</nav>
				<section aria-labelledby="entry-points">
					<h2 id="entry-points">Entry points <span class="n">${request.entryPoints.length}</span></h2>
					${entryPointsTable(request.entryPoints)}
				</section>
				<section aria-labelledby="instances" data-region="instances">
					<h2 id="instances">Instances <span class="n">${instances.length}</span></h2>
					${retire && !instances.some((instance) => instance.instanceId === retire.instanceId && !instance.retired) ? html2`<p class="form-error" role="alert">${retire.error}</p>` : ""}
					${instancesTable(context, targetId, instances, retire)}
				</section>
				${shape}
				<section aria-labelledby="history" data-region="target-history">
					<h2 id="history">History</h2>
					${historyList(store, targetId, shown?.revision ?? 0)}
				</section>
			</div>
			<aside class="side" aria-label="Add instance">
				${addForm(context, targetId, request.entryPoints, form)}
				<p class="back"><a href="/settings/targets">← All targets</a></p>
			</aside>
		</div>`;
  return settingsPage(
    "/settings/targets",
    targetId,
    [`target:${targetId}`],
    body,
    form?.error || retire ? 422 : void 0
  );
}
function instanceFromForm(entryPoints, form) {
  const environment = form.get("environment")?.trim() ?? "";
  const references2 = (form.get("references") ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  return {
    entries: Object.fromEntries(
      entryPoints.map((entry) => [entry.name, (form.get(`entry.${entry.name}`) ?? "").trim()])
    ),
    ...environment ? { environment } : {},
    references: references2
  };
}

// plugin/src/ui/server.ts
var id = "[A-Za-z0-9][A-Za-z0-9_-]{0,95}";
var routes = {
  plan: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})$`),
  latestPlan: new RegExp(`^/plans/(${id})$`),
  gap: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/gaps/(${id})$`),
  edit: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/edit$`),
  history: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/history$`),
  planExport: new RegExp(`^/plans/(${id})@([1-9][0-9]{0,8})/export\\.(html|md|json)$`),
  run: new RegExp(`^/runs/(${id})$`),
  runGap: new RegExp(`^/runs/(${id})/gaps/(${id})$`),
  report: new RegExp(`^/runs/(${id})/report\\.(html|md|json|junit)$`),
  evidence: /^\/evidence\/([0-9A-Z]{26})$/,
  target: new RegExp(`^/settings/targets/(${id})$`),
  addInstance: new RegExp(`^/settings/targets/(${id})/instances$`),
  retireInstance: new RegExp(`^/settings/targets/(${id})/instances/(${id})/retire$`),
  font: /^\/assets\/fonts\/(inter|space-grotesk|jetbrains-mono)\.woff2$/
};
var contentSecurityPolicy = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'self'";
var inlineImages2 = ["image/png", "image/jpeg", "image/webp", "image/gif"];
var documentTypes = {
  html: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
  junit: "application/xml; charset=utf-8"
};
var themes = ["system", "light", "dark"];
var maxForm = 256 * 1024;
function directory(candidates, file) {
  for (const candidate of candidates) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(path + file)) return path;
  }
  throw new Error(`Checkmate UI files are missing: ${file} not found in ${candidates.join(", ")}`);
}
function assets() {
  const files = directory(["./assets/", "../src/ui/assets/", "../plugin/src/ui/assets/"], "style.css");
  const fonts = `${files}fonts/`;
  const read = (name) => readFileSync2(files + name);
  return {
    "/assets/style.css": { type: "text/css; charset=utf-8", body: read("style.css") },
    "/assets/client.js": { type: "text/javascript; charset=utf-8", body: read("client.js") },
    "/assets/favicon.svg": { type: "image/svg+xml", body: read("favicon.svg") },
    font: (name) => readFileSync2(`${fonts}${name}.woff2`)
  };
}
function securityHeaders() {
  return {
    "Content-Security-Policy": contentSecurityPolicy,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY"
  };
}
function send(res, status, type, body, headers = {}) {
  res.writeHead(status, { ...securityHeaders(), "Content-Type": type, "Cache-Control": "no-store", ...headers });
  res.end(body);
}
function redirect(res, location, cookies = []) {
  res.writeHead(303, { ...securityHeaders(), Location: location, "Set-Cookie": cookies });
  res.end();
}
function parseCookies(header2) {
  const cookies = {};
  for (const part of (header2 ?? "").split(";")) {
    const index2 = part.indexOf("=");
    if (index2 < 0) continue;
    try {
      cookies[part.slice(0, index2).trim()] = decodeURIComponent(part.slice(index2 + 1).trim());
    } catch {
    }
  }
  return cookies;
}
function cookie(name, value2, maxAge = 60 * 60 * 24 * 365) {
  return `${name}=${encodeURIComponent(value2)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict`;
}
function readForm(req) {
  return new Promise((resolve3, reject) => {
    const chunks = [];
    let length = 0;
    req.on("data", (chunk) => {
      length += chunk.length;
      if (length <= maxForm) chunks.push(chunk);
    });
    req.on(
      "end",
      () => resolve3(length > maxForm ? null : new URLSearchParams(Buffer.concat(chunks).toString("utf8")))
    );
    req.on("error", reject);
  });
}
function same2(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function safeBack(value2) {
  if (!value2) return "/";
  try {
    const decoded = decodeURIComponent(value2);
    return /^\/[^/\\]/.test(decoded) && /^[\x21-\x7e]+$/.test(decoded) && !decoded.includes("\\") ? value2 : "/";
  } catch {
    return "/";
  }
}
function attachmentName(name) {
  const plain = name.replace(/[^A-Za-z0-9._-]/g, "_");
  return `filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
function notFoundError(message) {
  return /^Unknown|has no revision|not found/i.test(message);
}
function plainMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
async function startUi(options2) {
  const files = assets();
  const store = openStore(options2.workspace);
  const watch = openReadOnlyStore(options2.workspace);
  const csrf = randomBytes2(24).toString("hex");
  const fallbackActor = options2.defaultActor ?? defaultActor(options2.workspace, process.env) ?? "";
  const clients = /* @__PURE__ */ new Set();
  let port = 0;
  const latestRowid = (source) => operationLog(source, { limit: 1 })[0]?.rowid ?? 0;
  const dataVersion = () => Number(watch.db.prepare("PRAGMA data_version").get()?.data_version ?? 0);
  let version2 = dataVersion();
  let cursor = latestRowid(watch);
  function deliver(client, change) {
    if (change.rowid <= client.last) return;
    const matched = client.subjects.has("*") ? change.subjects : change.subjects.filter((subject) => client.subjects.has(subject));
    if (!matched.length && !client.subjects.has("*")) return;
    client.last = change.rowid;
    client.res.write(`id: ${change.rowid}
data: ${matched.join(",") || "*"}

`);
  }
  const poll = setInterval(() => {
    const current = dataVersion();
    if (current === version2) return;
    version2 = current;
    const changes = changesAfter(watch, cursor);
    if (!changes.length) return;
    cursor = changes[changes.length - 1].rowid;
    for (const client of clients) for (const change of changes) deliver(client, change);
  }, 250);
  const heartbeat = setInterval(() => {
    for (const client of clients) client.res.write(": heartbeat\n\n");
  }, 15e3);
  function context(request, path = request.url.pathname + request.url.search) {
    const theme = themes.includes(request.cookies.checkmate_theme) ? request.cookies.checkmate_theme : "system";
    return {
      path,
      csrf,
      actor: request.cookies.checkmate_actor?.trim() || fallbackActor || null,
      theme,
      toast: (request.req.headers["sec-fetch-mode"] ?? "navigate") === "navigate" ? request.cookies.checkmate_toast || null : null,
      inboxCount: inboxCount(inbox(store)),
      cursor: latestRowid(store),
      workspace: options2.workspace
    };
  }
  function render(request, page, extraCookies = []) {
    const shown = context(request);
    const cookies = [...extraCookies];
    if (shown.toast) cookies.push(cookie("checkmate_toast", "", 0));
    send(request.res, page.status ?? 200, "text/html; charset=utf-8", layout(shown, page).html, {
      "Set-Cookie": cookies,
      Vary: "Cookie"
    });
  }
  function errorPage(request, status, title, message) {
    render(request, {
      title,
      section: null,
      subjects: ["inbox"],
      status,
      body: html2`${heading(title, message)}
				<p class="actions">
					<a class="btn primary" href="/">Back to inbox</a> <a class="btn" href="/plans">Plans</a>
					<a class="btn" href="/runs">Runs</a>
				</p>`
    });
  }
  function nextItem(flash, actorCookie) {
    const next = inboxItems(inbox(store))[0] ?? "/";
    return { location: next, cookies: [...actorCookie, cookie("checkmate_toast", flash, 60)] };
  }
  function serveEvidence(request, evidenceId) {
    let evidence2;
    try {
      evidence2 = evidenceBytes(store, evidenceId);
    } catch {
      return errorPage(request, 404, "Evidence not found", `Checkmate has no evidence ${evidenceId}.`);
    }
    const inline = inlineImages2.includes(evidence2.mediaType) || evidence2.mediaType === "text/plain";
    send(request.res, 200, evidence2.mediaType, evidence2.bytes, {
      "Content-Disposition": `${inline ? "inline" : "attachment"}; ${attachmentName(evidence2.name)}`,
      "Cache-Control": "private, max-age=31536000, immutable"
    });
  }
  function download(request, body, format2, name) {
    send(request.res, 200, documentTypes[format2], body, {
      "Content-Disposition": `attachment; ${attachmentName(name)}`
    });
  }
  function events(request) {
    const subjects = new Set(
      (request.url.searchParams.get("subjects") ?? "").split(",").map((subject) => subject.trim()).filter(Boolean)
    );
    const header2 = request.req.headers["last-event-id"];
    const after = Number(header2 ?? request.url.searchParams.get("after") ?? Number.NaN);
    request.res.writeHead(200, {
      ...securityHeaders(),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    request.res.write("retry: 2000\n\n");
    const client = { res: request.res, subjects, last: -1 };
    if (Number.isInteger(after) && after >= 0) {
      client.last = after;
      for (const change of changesAfter(watch, after)) deliver(client, change);
    } else client.last = cursor;
    clients.add(client);
    request.req.on("close", () => clients.delete(client));
  }
  function get(request) {
    const { pathname, searchParams } = request.url;
    const asset = files[pathname];
    if (asset && typeof asset === "object")
      return send(request.res, 200, asset.type, asset.body, { "Cache-Control": "no-cache" });
    const font = routes.font.exec(pathname);
    if (font)
      return send(request.res, 200, "font/woff2", files.font(font[1]), {
        "Cache-Control": "public, max-age=31536000, immutable"
      });
    if (pathname === "/events") return events(request);
    const evidence2 = routes.evidence.exec(pathname);
    if (evidence2) return serveEvidence(request, evidence2[1]);
    const shown = context(request);
    if (pathname === "/") return render(request, inboxPage(store));
    if (pathname === "/plans") return render(request, plansPage(store, searchParams));
    if (pathname === "/runs") return render(request, runsPage(store, searchParams));
    if (pathname === "/log") return render(request, logPage(store, searchParams));
    if (pathname === "/actor") return render(request, actorPage(shown, safeBack(searchParams.get("back"))));
    if (pathname === "/settings") return redirect(request.res, "/settings/targets");
    if (pathname === "/settings/targets") return render(request, targetsPage(store));
    const target = routes.target.exec(pathname);
    if (target) {
      const revision = searchParams.get("revision");
      const number = revision && /^[1-9][0-9]{0,8}$/.test(revision) ? Number(revision) : null;
      return render(request, targetPage(store, shown, target[1], number));
    }
    const latest = routes.latestPlan.exec(pathname);
    if (latest) {
      const detail = planDetail(store, latest[1]);
      return redirect(request.res, `/plans/${latest[1]}@${detail.latestRevision}`);
    }
    const plan = routes.plan.exec(pathname);
    if (plan)
      return render(
        request,
        planPage(store, shown, plan[1], Number(plan[2]), null, searchParams.get("history") === "all")
      );
    const edit = routes.edit.exec(pathname);
    if (edit) return render(request, editPage(store, shown, edit[1], Number(edit[2])));
    const history = routes.history.exec(pathname);
    if (history) {
      const detail = planDetail(store, history[1], Number(history[2]));
      return send(request.res, 200, "text/html; charset=utf-8", planHistoryList(store, detail, true).html);
    }
    const planExport = routes.planExport.exec(pathname);
    if (planExport) {
      const [, planId, revision, format2] = planExport;
      const body = exportPlan(store, `${planId}@${revision}`, format2);
      return download(request, body, format2, `${planId}-${revision}-plan.${format2}`);
    }
    const report = routes.report.exec(pathname);
    if (report) {
      const [, runId, format2] = report;
      if (!runDetail(store, runId).result)
        return errorPage(
          request,
          409,
          "Report not ready",
          `${runId} is in progress. The report is ready when it finishes.`
        );
      const name = format2 === "junit" ? `${runId}-junit.xml` : `${runId}-report.${format2}`;
      return download(request, exportRun(store, runId, format2), format2, name);
    }
    const gap = routes.gap.exec(pathname);
    if (gap) return render(request, gapPage(store, shown, gap[1], Number(gap[2]), gap[3]));
    const run2 = routes.run.exec(pathname);
    if (run2) return render(request, runPage(store, shown, run2[1]));
    return errorPage(request, 404, "Page not found", `Checkmate has no page at ${pathname}. Start from the inbox.`);
  }
  function actorPage(shown, back) {
    return {
      title: "Your name",
      section: null,
      subjects: ["inbox"],
      body: html2`${heading("Your name", "Checkmate records this name with each decision you make in this browser.")}
				<form method="post" action="/actor" class="panel narrow">
					<input type="hidden" name="csrf" value="${csrf}" />
					<input type="hidden" name="back" value="${back}" />
					<label class="lab" for="actor-name">Name</label>
					<input id="actor-name" name="actor" required autocomplete="name" value="${shown.actor ?? ""}" />
					<div class="btns">
						<button class="btn primary">Save name</button> <a class="btn" href="${back}">Cancel</a>
					</div>
				</form>`
    };
  }
  function actorFrom(request, form) {
    const typed = form.get("actor")?.trim() ?? "";
    const actor = typed || request.cookies.checkmate_actor?.trim() || fallbackActor;
    return { actor, cookies: typed ? [cookie("checkmate_actor", typed)] : [] };
  }
  function values(form, names) {
    return Object.fromEntries(names.map((name) => [name, form.get(name) ?? ""]));
  }
  function refuse(request, page, cookies = []) {
    const shown = page();
    render(request, { ...shown, status: shown.status ?? 422 }, cookies);
  }
  function answer(request, form, planId, revision, gapId) {
    const state = {
      ...emptyState(),
      values: values(form, ["kind", "value", "source", "rationale", "actor"])
    };
    const { actor, cookies } = actorFrom(request, form);
    const kind = state.values.kind;
    const page = () => gapPage(store, context(request), planId, revision, gapId, state);
    const check = (condition, message) => {
      if (!condition) state.error ??= message;
    };
    check(Boolean(actor), "Enter your name. Checkmate records it with your answer.");
    check(["clarify", "accept_assumption", "defer"].includes(kind), "Choose Clarify, Accept assumption, or Defer.");
    check(Boolean(state.values.value.trim()), "Write the answer.");
    check(
      kind !== "clarify" || Boolean(state.values.source.trim()),
      "A clarification needs a source. Name where the answer comes from."
    );
    check(Boolean(state.values.rationale.trim()), "Write a rationale. Checkmate records it with your answer.");
    if (state.error) return refuse(request, page, cookies);
    try {
      answerGap(store, actor, {
        planId,
        gapId,
        kind,
        value: state.values.value.trim(),
        source: kind === "clarify" ? state.values.source.trim() : null,
        rationale: state.values.rationale.trim(),
        expectSha256: form.get("sha") ?? ""
      });
    } catch (error) {
      const latest = planDetail(store, planId);
      if (latest.sha256 !== form.get("sha"))
        state.stale = html2`<strong>${planId} has a newer revision (${latest.latestRevision}).</strong> Your
					answer was not recorded. Your text is kept below.
					<a href="/plans/${planId}@${latest.latestRevision}/gaps/${gapId}"
						>Review revision ${latest.latestRevision}</a
					>, then send again.`;
      else state.error = plainMessage(error);
      return refuse(request, page, cookies);
    }
    const next = nextItem(`Answered ${planId} \xB7 ${gapId}`, cookies);
    redirect(request.res, next.location, next.cookies);
  }
  function verdictState(form) {
    return { ...emptyState(), values: values(form, ["verdict", "rationale", "actor"]) };
  }
  function decide(request, form, choices, page, record, staleCheck) {
    const state = verdictState(form);
    const { actor, cookies } = actorFrom(request, form);
    const view = () => page(state);
    const sha = form.get("sha") ?? "";
    const token = form.get("decision") ?? "";
    state.stale = staleCheck(sha, token);
    if (state.stale) return refuse(request, view, cookies);
    if (form.get("back")) return refuse(request, () => ({ ...view(), status: 200 }), cookies);
    if (!choices.includes(state.values.verdict)) state.error = "Choose a decision.";
    else if (!actor) state.error = "Enter your name. Checkmate records it with your decision.";
    else if (!state.values.rationale.trim())
      state.error = "Write a rationale. Checkmate records it with your decision.";
    if (state.error) return refuse(request, view, cookies);
    if (form.get("confirmed") !== "1") {
      state.confirm = true;
      return refuse(request, () => ({ ...view(), status: 200 }), cookies);
    }
    let flash;
    try {
      flash = record(actor, state.values.verdict, state.values.rationale.trim(), sha, token);
    } catch (error) {
      state.stale = staleCheck(sha, token);
      if (!state.stale) state.error = plainMessage(error);
      return refuse(request, view, cookies);
    }
    const next = nextItem(flash, cookies);
    redirect(request.res, next.location, next.cookies);
  }
  function decidedBanner(subject, latest, verdicts) {
    const what = latest ? html2`${subject} was ${verdicts[latest.verdict]} by ${latest.actor} after you opened this page.` : html2`${subject} has another decision now.`;
    return html2`<strong>${what}</strong> Your decision was not recorded. Your text is kept below. Review the
			decision, then send again.`;
  }
  function decidePlan2(request, form, planId, revision) {
    const subject = `${planId}@${revision}`;
    decide(
      request,
      form,
      ["approve", "reject"],
      (state) => planPage(store, context(request), planId, revision, state),
      (actor, verdict, rationale, sha, token) => {
        const input = { reference: subject, rationale, expectSha256: sha, expectDecision: token };
        if (verdict === "approve") approvePlan(store, actor, input);
        else rejectPlan(store, actor, input);
        return `${verdict === "approve" ? "Approved" : "Rejected"} ${subject}`;
      },
      (sha, token) => {
        const detail = planDetail(store, planId, revision);
        if (detail.sha256 !== sha)
          return html2`<strong>${subject} has another digest now.</strong> Your decision was not recorded. Your
						text is kept below. Review the plan, then send again.`;
        if (decisionToken(store, "plan", subject) === token) return null;
        return decidedBanner(subject, latestApproval(store, "plan", subject), {
          approved: "approved",
          rejected: "rejected"
        });
      }
    );
  }
  function decideRun(request, form, runId) {
    decide(
      request,
      form,
      ["accept", "reject"],
      (state) => runPage(store, context(request), runId, state),
      (actor, verdict, rationale, sha, token) => {
        const input = { runId, rationale, expectSha256: sha, expectDecision: token };
        if (verdict === "accept") acceptResult(store, actor, input);
        else rejectResult(store, actor, input);
        return `${verdict === "accept" ? "Accepted" : "Rejected"} ${runId}`;
      },
      (sha, token) => {
        const result = runDetail(store, runId).result;
        if (!result) return null;
        if (result.sha256 !== sha)
          return html2`<strong>${runId} has a new result.</strong> Your decision was not recorded. Your text is
						kept below. Review the result, then send again.`;
        if (decisionToken(store, "result", runId) === token) return null;
        return decidedBanner(runId, latestApproval(store, "result", runId), {
          approved: "accepted",
          rejected: "rejected"
        });
      }
    );
  }
  function adopt(request, form, runId, gapId) {
    const { actor, cookies } = actorFrom(request, form);
    const planId = runDetail(store, runId).planId;
    const sha = form.get("sha") ?? "";
    const page = (message) => () => runPage(store, context(request), runId, null, { gapId, message });
    if (!actor) return refuse(request, page("Enter your name. Checkmate records it with the change."), cookies);
    const latest = planDetail(store, planId);
    let adopted;
    try {
      adopted = adoptGaps(store, actor, {
        reference: `${planId}@${latest.latestRevision}`,
        runId,
        gapIds: [gapId],
        expectSha256: sha
      });
    } catch (error) {
      const message = latest.sha256 === sha ? plainMessage(error) : html2`<strong>${planId} changed after you opened this page.</strong> ${gapId} was not brought into
							the plan. Review the plan, then send again.`;
      return refuse(request, page(message), cookies);
    }
    redirect(request.res, `/runs/${runId}#${gapId}`, [
      ...cookies,
      cookie("checkmate_toast", `Brought ${gapId} into ${adopted.subject}`, 60)
    ]);
  }
  function saveEdit(request, form, planId, revision) {
    const { actor, cookies } = actorFrom(request, form);
    const subject = `${planId}@${revision}`;
    const detail = planDetail(store, planId, revision);
    const base = planCandidate(detail.plan);
    const mode = form.get("mode") === "json" ? "json" : "form";
    const sha = form.get("sha") ?? "";
    const state = {
      mode,
      candidate: base,
      json: form.get("json") ?? "",
      actor: form.get("actor") ?? "",
      error: null,
      stale: null,
      unsaved: null,
      orig: form.get("orig") ?? JSON.stringify(base)
    };
    const page = () => editPage(store, context(request), planId, revision, state);
    let candidate;
    if (mode === "json") {
      try {
        candidate = JSON.parse(state.json);
      } catch (error) {
        state.error = `The JSON is not valid: ${plainMessage(error)}`;
      }
    } else {
      state.candidate = candidateFromForm(base, form);
      state.json = candidateJson(state.candidate);
      candidate = state.candidate;
    }
    if (!actor) state.error ??= "Enter your name. Checkmate records it with the edit.";
    if (state.error) return refuse(request, page, cookies);
    let saved;
    try {
      saved = editPlan(store, actor, { reference: subject, candidate, expectSha256: sha }).data;
    } catch (error) {
      const latest = planDetail(store, planId);
      if (latest.latestRevision === revision && latest.sha256 === sha) {
        state.error = plainMessage(error);
        return refuse(request, page, cookies);
      }
      const fresh = planCandidate(latest.plan);
      state.unsaved = ownChanges(form, fresh);
      state.orig = JSON.stringify(fresh);
      state.candidate = fresh;
      state.json = candidateJson(fresh);
      state.stale = html2`<strong>${planId} changed after you opened the editor.</strong> Your edits were not
				saved. The editor shows ${planId}@${latest.latestRevision} as it is now. Your changes are listed above
				it.`;
      return refuse(
        request,
        () => editPage(store, context(request), planId, latest.latestRevision, state),
        cookies
      );
    }
    const saving = `${planId}@${saved.revision}`;
    const flash = saved.edit === "in_place" ? `Saved ${saving} in place` : `Saved ${saving}${planDetail(store, planId).approval.policy === "none" ? "" : ". It needs approval."}`;
    redirect(request.res, `/plans/${saving}`, [...cookies, cookie("checkmate_toast", flash, 60)]);
  }
  function saveInstance(request, form, targetId) {
    const { actor, cookies } = actorFrom(request, form);
    const entryPoints = targetRequest(store, targetId).entryPoints;
    const state = {
      values: values(form, [
        "instanceId",
        "environment",
        "references",
        ...entryPoints.map((entry) => `entry.${entry.name}`)
      ]),
      error: null
    };
    const page = () => targetPage(store, context(request), targetId, null, state);
    const instanceId = state.values.instanceId.trim();
    if (!actor) state.error = "Enter your name. Checkmate records it with the instance.";
    else if (!instanceId) state.error = "Enter an instance ID.";
    if (state.error) return refuse(request, page, cookies);
    try {
      addInstance(store, actor, { targetId, instanceId, instance: instanceFromForm(entryPoints, form) });
    } catch (error) {
      state.error = plainMessage(error);
      return refuse(request, page, cookies);
    }
    redirect(request.res, `/settings/targets/${targetId}#instance-${instanceId}`, [
      ...cookies,
      cookie("checkmate_toast", `Added instance ${instanceId} to ${targetId}`, 60)
    ]);
  }
  function retire(request, form, targetId, instanceId) {
    const { actor, cookies } = actorFrom(request, form);
    const page = (error) => () => targetPage(store, context(request), targetId, null, null, { instanceId, error });
    if (form.get("confirmed") !== "1")
      return refuse(request, page("Confirm that you want to retire the instance."), cookies);
    if (!actor) return refuse(request, page("Enter your name. Checkmate records it with the change."), cookies);
    try {
      retireInstance(store, actor, { targetId, instanceId });
    } catch (error) {
      return refuse(request, page(plainMessage(error)), cookies);
    }
    redirect(request.res, `/settings/targets/${targetId}#instance-${instanceId}`, [
      ...cookies,
      cookie("checkmate_toast", `Retired instance ${instanceId} of ${targetId}`, 60)
    ]);
  }
  async function post(request) {
    const origin = request.req.headers.origin;
    if (origin !== void 0 && origin !== `http://${request.req.headers.host}`)
      return send(
        request.res,
        403,
        "text/plain; charset=utf-8",
        "Refused: the request comes from another origin."
      );
    const form = await readForm(request.req);
    if (!form)
      return errorPage(
        request,
        413,
        "Form too large",
        "The form has more than 256 KiB of text. Checkmate did not record it. Go back, make the text shorter, then send the form again."
      );
    if (!same2(form.get("csrf") ?? "", csrf))
      return errorPage(
        request,
        403,
        "Form expired",
        "This form came from an earlier start of the UI. Load the page again, then send the form again."
      );
    const { pathname } = request.url;
    if (pathname === "/theme") {
      const theme = form.get("theme");
      return redirect(request.res, safeBack(form.get("back")), [
        cookie("checkmate_theme", themes.includes(theme) ? theme : "system")
      ]);
    }
    if (pathname === "/actor") {
      const name = form.get("actor")?.trim() ?? "";
      if (!name)
        return errorPage(request, 422, "Your name", "Enter a name. Checkmate records it with each decision.");
      return redirect(request.res, safeBack(form.get("back")), [cookie("checkmate_actor", name)]);
    }
    const edit = routes.edit.exec(pathname);
    if (edit) return saveEdit(request, form, edit[1], Number(edit[2]));
    const gap = routes.gap.exec(pathname);
    if (gap) return answer(request, form, gap[1], Number(gap[2]), gap[3]);
    const plan = routes.plan.exec(pathname);
    if (plan) return decidePlan2(request, form, plan[1], Number(plan[2]));
    const run2 = routes.run.exec(pathname);
    if (run2) return decideRun(request, form, run2[1]);
    const runGap = routes.runGap.exec(pathname);
    if (runGap) return adopt(request, form, runGap[1], runGap[2]);
    const added = routes.addInstance.exec(pathname);
    if (added) return saveInstance(request, form, added[1]);
    const retired = routes.retireInstance.exec(pathname);
    if (retired) return retire(request, form, retired[1], retired[2]);
    return errorPage(request, 404, "Page not found", `Checkmate has no form at ${pathname}.`);
  }
  async function handle(req, res) {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
      return send(
        res,
        421,
        "text/plain; charset=utf-8",
        "Refused: unknown host. Open the URL that checkmate ui printed."
      );
    const request = {
      req,
      res,
      url: new URL(req.url ?? "/", `http://${host}`),
      cookies: parseCookies(req.headers.cookie)
    };
    try {
      if (req.method === "GET" || req.method === "HEAD") return get(request);
      if (req.method === "POST") return await post(request);
      send(res, 405, "text/plain; charset=utf-8", "Method not allowed.", { Allow: "GET, POST" });
    } catch (error) {
      const message = plainMessage(error);
      if (res.headersSent) return res.end();
      if (notFoundError(message)) return errorPage(request, 404, "Not found", message);
      errorPage(request, 500, "Something went wrong", `Checkmate could not finish the request: ${message}`);
    }
  }
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise((resolve3, reject) => {
    server.once("error", reject);
    server.listen(options2.port ?? 0, "127.0.0.1", () => resolve3());
  });
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: async () => {
      clearInterval(poll);
      clearInterval(heartbeat);
      for (const client of clients) client.res.end();
      clients.clear();
      await new Promise((resolve3) => {
        server.close(() => resolve3());
        server.closeAllConnections();
      });
      closeStore(watch);
      closeStore(store);
    }
  };
}

// plugin/src/cli.ts
import { mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync } from "node:fs";
import { dirname, resolve as resolve2 } from "node:path";
import { constants } from "node:sqlite";
var testFields2 = [
  "title",
  "readiness",
  "capability",
  "operations",
  "requirementIds",
  "gapIds",
  "dependsOn",
  "preconditions",
  "action",
  "assertions"
];
function value(args, name) {
  const found = args[name];
  return typeof found === "string" ? found : void 0;
}
function list(args, name) {
  const found = args[name];
  return Array.isArray(found) ? found : void 0;
}
function integer(args, name) {
  const text = value(args, name);
  return text === void 0 ? void 0 : Number(text);
}
function optionValue(token, kind, text) {
  if (Array.isArray(kind))
    requireCondition(kind.includes(text), `Invalid ${token}: ${text}. Use one of: ${kind.join(", ")}.`);
  else if (typeof kind === "object" && "min" in kind)
    requireCondition(
      /^[0-9]+$/.test(text) && Number(text) >= kind.min && Number(text) <= kind.max,
      `Invalid ${token}: ${text}. Use a whole number from ${kind.min} to ${kind.max}.`
    );
}
function evidence(args, context) {
  return list(args, "evidence")?.map((spec) => {
    const match = /^-(?::(.+))?$/.exec(spec);
    return match ? { text: context.text(), kind: match[1] } : spec;
  });
}
function toolSpec(spec) {
  const match = /^(.+?):(cli|mcp|skill):(.+)$/.exec(spec);
  requireCondition(match, `Invalid --tool: ${spec}. Use <name>:<cli|mcp|skill>:<purpose>.`);
  return { name: match[1], kind: match[2], purpose: match[3] };
}
function entryPointSpec(spec) {
  const match = /^([^:]+):([^:]+):(.+)$/.exec(spec);
  requireCondition(
    match && entryPointKinds.includes(match[2]),
    `Invalid --entry-point: ${spec}. Use <name>:<url|command|value>:<purpose>.`
  );
  return { name: match[1], kind: match[2], purpose: match[3] };
}
function instanceInput(args, stdin) {
  const entries = list(args, "entry");
  const environment = value(args, "environment");
  const references2 = list(args, "reference");
  if (entries === void 0) {
    requireCondition(
      environment === void 0 && !references2,
      "Give --entry with --environment and --reference, or send the instance on standard input"
    );
    return stdin();
  }
  const values = {};
  for (const entry of entries) {
    const at = entry.indexOf("=");
    requireCondition(at > 0, `Invalid --entry: ${entry}. Use <entryPoint>=<value>.`);
    const name = entry.slice(0, at);
    requireCondition(!(name in values), `Entry point ${name} is given twice`);
    values[name] = entry.slice(at + 1);
  }
  return {
    entries: values,
    ...environment === void 0 ? {} : { environment },
    ...references2 ? { references: references2 } : {}
  };
}
function instanceLines(instance) {
  return [
    ...Object.entries(instance.entries).map(([name, entry]) => ["entry", name, entry]),
    ...instance.environment ? [["environment", instance.environment]] : [],
    ...instance.references.map((reference) => ["reference", reference])
  ];
}
function planRequestInput(args, stdin) {
  const objective = value(args, "objective");
  const sources = list(args, "source");
  const instructions = value(args, "instructions");
  if (objective === void 0) {
    requireCondition(
      !sources && instructions === void 0,
      "Give --objective with --source and --instructions, or send the request on standard input"
    );
    return stdin();
  }
  return { objective, context: { sources: sources ?? [], ...instructions === void 0 ? {} : { instructions } } };
}
function leftOutLines(reply) {
  const leftOut = reply.data.leftOut ?? [];
  return leftOut.map((item) => [item.testId, "left_out", item.reason]);
}
function short2(sha256) {
  return typeof sha256 === "string" ? sha256.slice(0, 8) : sha256;
}
var commands = {
  init: {
    positionals: [],
    run: (store) => completed(".checkmate/checkmate.db", { path: store.path })
  },
  inbox: {
    positionals: [],
    run: (store) => completed("inbox", inbox(store)),
    print: (reply) => {
      const waiting = reply.data;
      return {
        facts: {
          gaps: waiting.gaps.length,
          plans: waiting.plans.length,
          results: waiting.results.length,
          requests: waiting.requests.length
        },
        lines: [
          ...waiting.gaps.map(
            (gap) => gap.runId ? [
              `${gap.planId}@${gap.revision}/${gap.gapId}`,
              "run_gap",
              gap.severity,
              gap.runId,
              gap.question
            ] : [`${gap.planId}@${gap.revision}/${gap.gapId}`, "gap", gap.severity, gap.question]
          ),
          ...waiting.plans.map((plan) => [
            `${plan.planId}@${plan.revision}`,
            "plan",
            short2(plan.sha256),
            plan.summary
          ]),
          ...waiting.results.map((result) => [
            result.runId,
            "result",
            `${result.planId}@${result.revision}`,
            result.build,
            result.coverage,
            Object.entries(result.counts).map(([outcome, count]) => `${outcome}=${count}`)
          ]),
          ...waiting.requests.map((request) => [
            request.planId,
            "requested",
            request.target,
            request.objective
          ])
        ]
      };
    }
  },
  status: {
    positionals: ["planId"],
    run: (store, args) => {
      const planId = value(args, "planId");
      return completed(planId, planStatus(store, planId));
    },
    print: (reply) => {
      const status = reply.data;
      return {
        facts: {
          state: status.state,
          waitsOn: status.waitsOn,
          revision: status.revision ?? void 0,
          approval: status.approval ?? void 0,
          run: status.latestRun?.runId
        },
        lines: [
          ...status.why.map((line) => ["why", line]),
          ...status.next.map((line) => ["next", line]),
          ...status.openRuns.map((run2) => [
            run2.runId,
            "started",
            `build=${run2.build}`,
            `instance=${run2.instanceId}`
          ]),
          ...status.gaps.map(
            (gap) => gap.runId ? [gap.gapId, "run_gap", gap.severity, gap.runId, gap.question] : [gap.gapId, "gap", gap.severity, gap.question]
          ),
          ...status.pendingDecisions.map((decision) => [
            decision.id,
            "pending",
            decision.gapId,
            decision.kind
          ]),
          ...status.defects.map((defect) => [
            defect.findingId,
            "defect",
            defect.runId,
            defect.severity,
            defect.assertionIds,
            defect.title
          ]),
          ...(status.retest?.verdicts ?? []).map((item) => [
            `${item.runId}/${item.findingId}`,
            "retest",
            status.retest.runId,
            item.verdict,
            item.title
          ])
        ]
      };
    }
  },
  "target open": {
    positionals: ["targetId"],
    flags: { "entry-point": "repeat", capabilities: "list", operations: "list", tool: "repeat" },
    required: ["entry-point", "capabilities", "operations"],
    write: true,
    run: (store, args, { actor }) => openTarget(store, actor, {
      targetId: value(args, "targetId"),
      entryPoints: (list(args, "entry-point") ?? []).map(entryPointSpec),
      capabilities: list(args, "capabilities") ?? [],
      allowedOperations: list(args, "operations") ?? [],
      tools: (list(args, "tool") ?? []).map(toolSpec)
    }),
    print: (reply) => ({ facts: { recorded: reply.data.recorded } })
  },
  "target request": {
    positionals: ["targetId"],
    run: (store, args) => showTargetRequest(store, value(args, "targetId")),
    print: (reply) => {
      const request = reply.data.request;
      return {
        lines: [
          ...request.entryPoints.map((entry) => ["entryPoint", entry.name, entry.kind, entry.purpose]),
          ["capabilities", request.capabilities],
          ["operations", request.allowedOperations],
          ...request.tools.map((tool) => ["tool", tool.name, tool.kind, tool.purpose])
        ]
      };
    }
  },
  "target save": {
    positionals: ["targetId"],
    write: true,
    stdin: true,
    run: (store, args, { actor, stdin }) => saveTarget(store, actor, { targetId: value(args, "targetId"), profile: stdin() }),
    print: (reply) => ({ facts: { sha256: short2(reply.data.sha256), recorded: reply.data.recorded } })
  },
  "target list": {
    positionals: [],
    run: (store) => completed("targets", { targets: targetList(store) }),
    print: (reply) => ({
      facts: { count: reply.data.targets.length },
      lines: reply.data.targets.map((target) => [
        target.revision === null ? target.targetId : `${target.targetId}@${target.revision}`,
        `capabilities=${cell2(target.capabilities)}`,
        `instances=${target.activeInstances}`
      ])
    })
  },
  "target show": {
    positionals: ["reference"],
    flags: { instance: "value" },
    run: (store, args) => showTarget(store, value(args, "reference"), value(args, "instance")),
    print: (reply) => {
      const profile = reply.data.profile;
      const approvals2 = reply.data.approvals;
      const instance = reply.data.instance;
      return {
        facts: {
          sha256: short2(reply.data.sha256),
          ready: profile.readyForLiveExecution,
          instance: instance?.instanceId,
          retired: instance ? Boolean(instance.retired) : void 0
        },
        lines: [
          ...profile.entryPoints.map((entry) => ["entryPoint", entry.name, entry.kind, entry.purpose]),
          ["authentication", profile.authentication.kind, profile.authentication.references],
          ["capabilities", profile.capabilities],
          ["operations", profile.allowedOperations],
          ["approvals", `plan=${approvals2.plan}`, `result=${approvals2.result}`],
          ["startup", profile.startup.owner, ...profile.startup.command ?? [null]],
          ["cleanup", profile.cleanup],
          ...profile.reset ? [["reset", profile.reset.owner, ...profile.reset.command ?? [null]]] : [],
          ...profile.tools.map((tool) => [
            "tool",
            tool.name,
            tool.kind,
            tool.version ?? "-",
            tool.reachable ? "reachable" : "unreachable",
            tool.purpose
          ]),
          ...reply.data.instances.map((item) => [
            "instance",
            item.instanceId,
            item.environment ?? "-"
          ]),
          ...instance ? instanceLines(instance) : []
        ]
      };
    }
  },
  "target instance add": {
    positionals: ["targetId", "instanceId"],
    flags: { entry: "repeat", environment: "value", reference: "repeat" },
    write: true,
    stdin: true,
    run: (store, args, { actor, stdin }) => addInstance(store, actor, {
      targetId: value(args, "targetId"),
      instanceId: value(args, "instanceId"),
      instance: instanceInput(args, stdin)
    }),
    print: (reply) => ({
      facts: { recorded: reply.data.recorded },
      lines: Object.entries(reply.data.entries).map(([name, entry]) => [
        "entry",
        name,
        entry
      ])
    })
  },
  "target instance retire": {
    positionals: ["targetId", "instanceId"],
    write: true,
    run: (store, args, { actor }) => retireInstance(store, actor, {
      targetId: value(args, "targetId"),
      instanceId: value(args, "instanceId")
    }),
    print: (reply) => {
      const started = reply.data.startedRuns ?? [];
      return {
        facts: { recorded: reply.data.recorded },
        lines: started.length ? [["warning", `Started runs use this instance: ${started.join(", ")}. Its sandbox may be gone.`]] : []
      };
    }
  },
  "target instance list": {
    positionals: ["targetId"],
    run: (store, args) => {
      const targetId = value(args, "targetId");
      return completed(targetId, { instances: instanceList(store, targetId) });
    },
    print: (reply) => ({
      facts: { count: reply.data.instances.length },
      lines: reply.data.instances.map((instance) => [
        instance.instanceId,
        instance.retired ? "retired" : "active",
        instance.environment ?? "-",
        {
          preformatted: Object.entries(instance.entries).map(([name, entry]) => `${name}=${/[\s,="\\]/.test(entry) ? JSON.stringify(entry) : entry}`).join(",")
        }
      ])
    })
  },
  "plan open": {
    positionals: ["planId"],
    flags: { target: "value", objective: "value", source: "repeat", instructions: "value" },
    required: ["target"],
    write: true,
    stdin: true,
    run: (store, args, { actor, stdin }) => openPlan(store, actor, {
      planId: value(args, "planId"),
      target: value(args, "target"),
      request: planRequestInput(args, stdin)
    }),
    print: (reply) => ({ facts: { target: reply.data.target, recorded: reply.data.recorded } })
  },
  "plan request": {
    positionals: ["planId"],
    run: (store, args) => showPlanRequest(store, value(args, "planId")),
    print: (reply) => {
      const data = reply.data;
      return {
        facts: { target: data.target },
        lines: [
          ["objective", data.objective],
          ...data.requirements.map((requirement) => [requirement.id, requirement.text, requirement.source]),
          ...data.context.sources.map((source) => ["source", source]),
          ...data.context.instructions ? [["instructions", data.context.instructions]] : [],
          ...data.sourceContext.map((context) => ["context", context.uri, context.content]),
          ...data.tools.map((tool) => ["tool", tool.name, tool.kind, tool.purpose]),
          ["capabilities", data.capabilities],
          ["operations", data.allowedOperations]
        ]
      };
    }
  },
  "plan save": {
    positionals: ["planId"],
    write: true,
    stdin: true,
    run: (store, args, { actor, stdin }) => savePlan(store, actor, { planId: value(args, "planId"), candidate: stdin() }),
    print: (reply) => ({ facts: { sha256: short2(reply.data.sha256) } })
  },
  "plan show": {
    positionals: ["reference"],
    flags: { tests: "list", fields: "list", gaps: ["open", "all"] },
    run: (store, args) => showPlan(store, args),
    print: printPlan
  },
  "plan list": {
    positionals: [],
    flags: { "needs-decision": "switch", "awaiting-approval": "switch", blocked: "switch", "waits-on": roles },
    run: (store, args) => {
      const waitsOn = value(args, "waits-on");
      const plans = planList(store).filter(
        (plan) => (!args["needs-decision"] || plan.openBlockingGaps.length > 0) && (!args["awaiting-approval"] || plan.approval === "pending") && (!args.blocked || plan.blocked.length > 0) && (waitsOn === void 0 || plan.loop.waitsOn === waitsOn)
      );
      return completed("plans", { plans });
    },
    print: (reply) => ({
      facts: { count: reply.data.plans.length },
      lines: reply.data.plans.map(
        (plan) => plan.status === "requested" ? [plan.planId, "status=requested", `state=${plan.loop.state}`, `waitsOn=${plan.loop.waitsOn}`] : [
          `${plan.planId}@${plan.revision}`,
          `gaps=${cell2(plan.openBlockingGaps)}`,
          `approval=${plan.approval}`,
          `blocked=${cell2(plan.blocked.map((block) => `${block.testId}<-${block.dependency}: ${block.cause}`))}`,
          `state=${plan.loop.state}`,
          `waitsOn=${plan.loop.waitsOn}`
        ]
      )
    })
  },
  "plan diff": {
    positionals: ["planId", "from", "to"],
    run: (store, args) => diffPlan(store, { planId: value(args, "planId"), from: value(args, "from"), to: value(args, "to") }),
    print: (reply) => {
      const patch = reply.data.patch;
      return {
        facts: { operations: patch.length },
        lines: [
          ...reply.data.changes.map((change) => ["change", change]),
          ...patch.map(
            (operation) => operation.op === "remove" ? [operation.op, operation.path] : [operation.op, operation.path, JSON.stringify(operation.value)]
          )
        ]
      };
    }
  },
  "gap answer": {
    positionals: ["planId", "gapId"],
    flags: { kind: decisionKinds, value: "value", source: "value", rationale: "value", "expect-sha": "value" },
    required: ["kind", "value", "rationale"],
    write: true,
    run: (store, args, { actor }) => answerGap(store, actor, {
      planId: value(args, "planId"),
      gapId: value(args, "gapId"),
      kind: value(args, "kind"),
      value: value(args, "value"),
      source: value(args, "source") ?? null,
      rationale: value(args, "rationale"),
      expectSha256: value(args, "expect-sha")
    }),
    print: (reply) => {
      const adopted = reply.data.adopted;
      return {
        facts: {
          decision: reply.data.decisionId,
          gap: reply.data.gapId,
          from: adopted?.runId,
          revision: adopted?.revision,
          edit: adopted?.edit
        }
      };
    }
  },
  "plan pending": {
    positionals: ["planId"],
    run: (store, args) => showPending(store, value(args, "planId")),
    print: (reply) => {
      const data = reply.data;
      return {
        facts: { sha256: short2(data.sha256), decisions: data.decisions.length },
        lines: [
          ...data.decisions.map((decision) => [
            decision.id,
            decision.gapId,
            decision.kind,
            decision.value,
            decision.rationale
          ]),
          ...data.gaps.map((gap) => [gap.id, gap.severity, gap.status, gap.question]),
          ...data.tests.flatMap(testLines)
        ]
      };
    }
  },
  "plan revise": {
    positionals: ["planId"],
    flags: { "expect-sha": "value" },
    write: true,
    stdin: true,
    run: (store, args, { actor, stdin }) => revisePlan(store, actor, {
      planId: value(args, "planId"),
      delta: stdin(),
      expectSha256: value(args, "expect-sha")
    }),
    print: (reply) => ({ facts: { sha256: short2(reply.data.sha256) } })
  },
  "plan edit": {
    positionals: ["reference"],
    flags: { patch: "switch", "expect-sha": "value" },
    write: true,
    stdin: true,
    run: (store, args, { actor, stdin }) => {
      const reference = value(args, "reference");
      const expectSha256 = value(args, "expect-sha");
      return args.patch ? patchPlan(store, actor, { reference, patch: stdin(), expectSha256 }) : editPlan(store, actor, { reference, candidate: stdin(), expectSha256 });
    },
    print: (reply) => ({ facts: { sha256: short2(reply.data.sha256), edit: reply.data.edit } })
  },
  "plan adopt-gaps": {
    positionals: ["reference"],
    flags: { run: "value", gaps: "list", "expect-sha": "value" },
    required: ["run"],
    write: true,
    run: (store, args, { actor }) => adoptGaps(store, actor, {
      reference: value(args, "reference"),
      runId: value(args, "run"),
      gapIds: list(args, "gaps"),
      expectSha256: value(args, "expect-sha")
    }),
    print: (reply) => ({
      facts: { sha256: short2(reply.data.sha256), edit: reply.data.edit, adopted: reply.data.adopted }
    })
  },
  "plan approve": verdictCommand(
    "reference",
    (store, actor, reference, rationale, expectSha256) => approvePlan(store, actor, { reference, rationale, expectSha256 })
  ),
  "plan reject": verdictCommand(
    "reference",
    (store, actor, reference, rationale, expectSha256) => rejectPlan(store, actor, { reference, rationale, expectSha256 })
  ),
  "run gate": {
    positionals: ["reference"],
    flags: { tests: "list", build: "value", partial: partialModes, "retest-of": "value" },
    required: ["build"],
    run: (store, args) => gate(store, {
      reference: value(args, "reference"),
      tests: list(args, "tests"),
      build: value(args, "build"),
      partial: value(args, "partial"),
      retestOf: value(args, "retest-of") ?? null
    }).reply,
    print: (reply) => ({
      facts: { sha256: short2(reply.data.sha256), tests: reply.data.tests },
      lines: leftOutLines(reply)
    })
  },
  "run begin": {
    positionals: ["runId", "reference"],
    flags: {
      tests: "list",
      build: "value",
      instance: "value",
      partial: partialModes,
      "on-new-blocker": newBlockerPolicies,
      timeout: { min: 1, max: 3600 },
      "retest-of": "value"
    },
    required: ["build"],
    write: true,
    run: (store, args, { actor }) => beginRun(store, actor, {
      runId: value(args, "runId"),
      reference: value(args, "reference"),
      tests: list(args, "tests"),
      build: value(args, "build"),
      instance: value(args, "instance"),
      partial: value(args, "partial"),
      onNewBlocker: value(args, "on-new-blocker"),
      timeoutSeconds: integer(args, "timeout"),
      retestOf: value(args, "retest-of") ?? null
    }),
    print: (reply) => ({
      facts: {
        instance: reply.data.instanceId,
        tests: reply.data.tests,
        startedAt: reply.data.startedAt,
        browserSession: reply.data.browserSession,
        deadlineSeconds: reply.data.deadlineSeconds,
        deadline: reply.data.deadline,
        evidenceDirectory: reply.data.evidenceDirectory
      },
      lines: leftOutLines(reply)
    })
  },
  "run check": {
    positionals: ["runId", "testId", "assertionId"],
    flags: { result: assertionResults, observed: "value", reason: "value", evidence: "repeat" },
    required: ["result"],
    write: true,
    run: (store, args, context) => checkAssertion(store, context.actor, {
      runId: value(args, "runId"),
      testId: value(args, "testId"),
      assertionId: value(args, "assertionId"),
      result: value(args, "result"),
      observed: value(args, "observed"),
      reason: value(args, "reason"),
      evidence: evidence(args, context)
    }),
    print: (reply) => ({
      facts: { [`${reply.data.testId}.${reply.data.assertionId}`]: reply.data.result },
      lines: reply.data.evidenceIds.map((id2) => [id2, "evidence"])
    })
  },
  "run close": {
    positionals: ["runId", "testId"],
    flags: { outcome: closeOutcomes, reason: "value", evidence: "repeat" },
    write: true,
    run: (store, args, context) => closeTest(store, context.actor, {
      runId: value(args, "runId"),
      testId: value(args, "testId"),
      outcome: value(args, "outcome"),
      reason: value(args, "reason"),
      evidence: evidence(args, context)
    }),
    print: (reply) => ({
      facts: { [String(reply.data.testId)]: reply.data.outcome },
      lines: reply.data.reason ? [["reason", reply.data.reason]] : []
    })
  },
  "run finding": {
    positionals: ["runId"],
    write: true,
    stdin: true,
    run: (store, args, { actor, stdin }) => recordFinding(store, actor, { runId: value(args, "runId"), finding: stdin() }),
    print: (reply) => ({ facts: { finding: reply.data.findingId, tests: reply.data.testIds } })
  },
  "run gap": {
    positionals: ["runId"],
    write: true,
    stdin: true,
    run: (store, args, { actor, stdin }) => recordGap(store, actor, { runId: value(args, "runId"), gap: stdin() }),
    print: (reply) => ({ facts: { gap: reply.data.gapId } })
  },
  "run finish": {
    positionals: ["runId"],
    flags: { completion: completions, reason: "value", cleanup: cleanupStatuses, "cleanup-reason": "value" },
    required: ["completion", "cleanup", "cleanup-reason"],
    write: true,
    run: (store, args, { actor }) => finishRun(store, actor, {
      runId: value(args, "runId"),
      completion: value(args, "completion"),
      reason: value(args, "reason"),
      cleanup: value(args, "cleanup"),
      cleanupReason: value(args, "cleanup-reason")
    }),
    print: (reply) => ({
      facts: { coverage: reply.data.coverage, sha256: short2(reply.data.sha256) },
      lines: Object.entries(reply.data.counts)
    })
  },
  "run resume": {
    positionals: ["runId"],
    flags: { error: "list", reason: "value" },
    write: true,
    run: (store, args, { actor }) => resumeRun(store, actor, {
      runId: value(args, "runId"),
      error: list(args, "error"),
      reason: value(args, "reason")
    }),
    print: (reply) => {
      const data = reply.data;
      return {
        facts: {
          attempt: data.attempt,
          browserSession: data.browserSession,
          deadline: data.deadline,
          evidenceDirectory: data.evidenceDirectory
        },
        lines: [
          ...data.closed.map((id2) => [id2, "error"]),
          ...data.tests.flatMap((test) => [
            [test.testId, "unclosed", test.warning],
            ...test.assertions.map((assertion) => [
              `${test.testId}.${assertion.id}`,
              assertion.checkKind,
              assertion.check
            ])
          ])
        ]
      };
    }
  },
  "run show": {
    positionals: ["runId"],
    flags: { tests: "list" },
    run: (store, args) => {
      const detail = runDetail(store, value(args, "runId"));
      const selected = list(args, "tests");
      for (const id2 of selected ?? [])
        requireCondition(
          detail.tests.some((test) => test.testId === id2),
          `Test ${id2} is not selected in run ${detail.runId}`
        );
      const tests = detail.tests.filter((test) => !selected || selected.includes(test.testId));
      return completed(detail.runId, { ...detail, tests });
    },
    print: (reply) => {
      const detail = reply.data;
      return {
        facts: {
          state: detail.state,
          plan: `${detail.planId}@${detail.revision}`,
          build: detail.build,
          instance: detail.instance.instanceId,
          completion: detail.result?.completion,
          coverage: detail.result?.coverage.status,
          acceptance: detail.result?.acceptance
        },
        lines: [
          [
            "time",
            `deadline=${detail.clock.deadline}`,
            `elapsed=${detail.clock.elapsedSeconds}s`,
            `remaining=${detail.clock.remainingSeconds}s`
          ],
          ...detail.tests.flatMap((test) => [
            [test.testId, test.outcome ?? "open", test.title, ...test.reason ? [test.reason] : []],
            ...test.assertions.map((assertion) => [
              `${test.testId}.${assertion.assertionId}`,
              assertion.result ?? "unchecked",
              assertion.observed ?? assertion.check,
              ...assertion.reason ? [assertion.reason] : []
            ])
          ]),
          ...detail.findings.map((finding) => [
            finding.id,
            finding.type,
            finding.severity,
            finding.assertionIds,
            finding.title
          ]),
          ...detail.retest.map((item) => [
            `${item.runId}/${item.findingId}`,
            "retest",
            item.verdict,
            item.testIds,
            item.title
          ]),
          ...detail.newGaps.map((gap) => [gap.id, gap.severity, gap.status, gap.question]),
          ...decisionLines(detail.result?.latestDecision)
        ]
      };
    }
  },
  "run list": {
    positionals: [],
    flags: { plan: "value", build: "value" },
    run: (store, args) => completed("runs", { runs: runList(store, { planId: value(args, "plan"), build: value(args, "build") }) }),
    print: (reply) => ({
      facts: { count: reply.data.runs.length },
      lines: reply.data.runs.map((run2) => [
        run2.runId,
        `${run2.planId}@${run2.revision}`,
        run2.build,
        run2.instanceId,
        run2.state,
        run2.completion,
        run2.coverage,
        run2.acceptance
      ])
    })
  },
  "finding list": {
    positionals: [],
    flags: { plan: "value", open: "switch" },
    run: (store, args) => completed("findings", {
      findings: findingList(store, { planId: value(args, "plan"), open: Boolean(args.open) })
    }),
    print: (reply) => ({
      facts: { count: reply.data.findings.length },
      lines: reply.data.findings.map((finding) => [
        `${finding.runId}/${finding.findingId}`,
        `${finding.planId}@${finding.revision}`,
        finding.build,
        finding.instanceId,
        finding.type,
        finding.severity,
        finding.testIds,
        Object.entries(finding.metadata).map(([key, field2]) => `${key}=${field2}`).join("; ") || null,
        finding.title
      ])
    })
  },
  "result accept": verdictCommand(
    "runId",
    (store, actor, runId, rationale, expectSha256) => acceptResult(store, actor, { runId, rationale, expectSha256 })
  ),
  "result reject": verdictCommand(
    "runId",
    (store, actor, runId, rationale, expectSha256) => rejectResult(store, actor, { runId, rationale, expectSha256 })
  ),
  "evidence get": {
    positionals: ["evidenceId"],
    flags: { out: "value" },
    required: ["out"],
    run: (store, args) => {
      const evidence2 = evidenceBytes(store, value(args, "evidenceId"));
      const out = writeOutput(store, value(args, "out"), evidence2.bytes);
      const { bytes, ...data } = evidence2;
      return completed(evidence2.id, { ...data, out });
    },
    print: (reply) => ({ facts: { out: reply.data.out, size: reply.data.size, mediaType: reply.data.mediaType } })
  },
  "export plan": exportCommand("reference", formats, exportPlan),
  "export run": exportCommand("runId", runFormats, exportRun),
  log: {
    positionals: [],
    flags: { subject: "value", limit: { min: 1, max: 1e3 }, after: { min: 0, max: Number.MAX_SAFE_INTEGER } },
    check: (args) => {
      const subject = value(args, "subject");
      requireCondition(
        subject === void 0 || subject === "inbox" || /^(target|plan|run):./.test(subject),
        `Invalid --subject: ${subject}. Use target:<targetId>, plan:<planId>, run:<runId>, or inbox.`
      );
    },
    run: (store, args) => {
      return completed("log", {
        operations: operationLog(store, {
          subject: value(args, "subject"),
          limit: integer(args, "limit"),
          after: integer(args, "after")
        })
      });
    },
    print: (reply) => ({
      lines: reply.data.operations.map((operation) => [
        operation.id,
        operation.at,
        operation.actor,
        operation.command,
        operation.status,
        operation.subjects,
        ...rationaleOf(operation.arguments),
        operation.rowid
      ])
    })
  },
  query: {
    positionals: ["sql"],
    readOnly: true,
    run: (store, args) => {
      const statement = queryStatement(store, value(args, "sql"));
      const columns = statement.columns().map((column) => column.name);
      const rows = readOnly(() => statement.all()).map(
        (row) => Object.fromEntries(
          columns.map((column) => {
            const field2 = row[column];
            return [column, field2 instanceof Uint8Array ? `<blob ${field2.length} bytes>` : field2];
          })
        )
      );
      return completed("query", { columns, rows });
    },
    print: (reply) => {
      const columns = reply.data.columns;
      const rows = reply.data.rows;
      return {
        facts: { rows: rows.length },
        lines: [columns, ...rows.map((row) => columns.map((name) => row[name]))]
      };
    }
  }
};
var readOnlyReason = "query is read-only. Use the Checkmate commands to change the record.";
var readPragmas = [
  "table_info",
  "table_xinfo",
  "table_list",
  "index_list",
  "index_info",
  "index_xinfo",
  "foreign_key_list",
  "foreign_key_check",
  "integrity_check",
  "quick_check"
];
function readOnly(read) {
  try {
    return read();
  } catch (error) {
    if (error instanceof Error && "errcode" in error && [8, 23].includes(Number(error.errcode)))
      throw new Error(readOnlyReason, { cause: error });
    throw error;
  }
}
function queryStatement(store, sql) {
  store.db.setAuthorizer(
    (action, name, argument) => action === constants.SQLITE_PRAGMA && argument !== null && !readPragmas.includes(name) ? constants.SQLITE_DENY : constants.SQLITE_OK
  );
  const statement = readOnly(() => store.db.prepare(sql));
  requireCondition(statement.columns().length > 0, readOnlyReason);
  const rest = sql.slice(statement.sourceSQL.length);
  requireCondition(
    /^(\s|--[^\n]*|\/\*[\s\S]*?\*\/)*$/.test(rest),
    "query runs one SQL statement. Send each statement in its own query."
  );
  return statement;
}
function exportCommand(positional, choices, render) {
  return {
    positionals: [positional],
    flags: { format: choices, out: "value" },
    required: ["format"],
    run: (store, args) => {
      const subject = value(args, positional);
      const format2 = value(args, "format");
      const content = render(store, subject, format2);
      const out = value(args, "out");
      if (out === void 0) return completed(subject, { format: format2, content });
      return completed(subject, { format: format2, out: writeOutput(store, out, content) });
    },
    print: (reply) => ({ facts: { out: reply.data.out } })
  };
}
function verdictCommand(positional, decide) {
  return {
    positionals: [positional],
    flags: { rationale: "value", "expect-sha": "value" },
    required: ["rationale"],
    write: true,
    run: (store, args, { actor }) => decide(store, actor, value(args, positional), value(args, "rationale"), value(args, "expect-sha")),
    print: (reply) => ({ facts: { verdict: reply.data.verdict, sha256: short2(reply.data.sha256) } })
  };
}
function showPlan(store, args) {
  const { id: id2, revision } = revisionReference(value(args, "reference"), "plan reference");
  const detail = planDetail(store, id2, revision);
  const subject = `${id2}@${detail.revision}`;
  const tests = list(args, "tests");
  const fields = list(args, "fields");
  const gaps = requireChoice(value(args, "gaps") ?? "all", ["open", "all"], "gaps filter (--gaps)");
  if (!tests && !fields) {
    const plan = {
      ...detail.plan,
      gaps: detail.plan.gaps.filter((gap) => gaps === "all" || gap.status === "open")
    };
    return completed(subject, { ...detail, plan });
  }
  for (const test of tests ?? [])
    requireCondition(
      detail.plan.tests.some((item) => item.id === test),
      `Unknown test in ${subject}: ${test}`
    );
  for (const field2 of fields ?? [])
    requireCondition(testFields2.includes(field2), `Unknown field: ${field2}. Use: ${testFields2.join(", ")}`);
  const picked = detail.plan.tests.filter((test) => !tests || tests.includes(test.id)).map(
    (test) => Object.fromEntries([
      ["id", test.id],
      ...(fields ?? ["readiness", "capability", "title"]).map((field2) => [
        field2,
        test[field2]
      ])
    ])
  );
  return completed(subject, {
    planId: id2,
    revision: detail.revision,
    sha256: detail.sha256,
    fields: fields ?? ["readiness", "capability", "title"],
    tests: picked
  });
}
function decisionLines(decision) {
  return decision ? [["decision", decision.verdict, decision.actor, decision.at, decision.rationale]] : [];
}
function rationaleOf(input) {
  const rationale = input.rationale;
  return typeof rationale === "string" && rationale ? [rationale] : [];
}
function testLines(test) {
  return [
    [test.id, test.readiness, test.capability, test.title],
    [test.id, "action", test.action],
    ...test.preconditions.map((precondition) => [test.id, "precondition", precondition]),
    ...test.assertions.map((assertion) => [`${test.id}.${assertion.id}`, assertion.checkKind, assertion.check])
  ];
}
function printPlan(reply) {
  const facts2 = { sha256: short2(reply.data.sha256) };
  if (reply.data.fields) {
    const fields = reply.data.fields;
    const tests = reply.data.tests;
    return {
      facts: facts2,
      lines: tests.flatMap((test) => [
        [test.id, ...fields.filter((field2) => field2 !== "assertions").map((field2) => test[field2])],
        ...fields.includes("assertions") ? test.assertions.map((assertion) => [
          `${test.id}.${assertion.id}`,
          assertion.checkKind,
          assertion.check
        ]) : []
      ])
    };
  }
  const detail = reply.data;
  const { plan } = detail;
  const coverage2 = new Map(plan.coverage.map((row) => [row.requirementId, row.status]));
  return {
    facts: {
      ...facts2,
      approval: detail.approval.state,
      ...detail.latestRevision !== detail.revision ? { latest: detail.latestRevision } : {}
    },
    lines: [
      ...plan.requirements.map((requirement) => [requirement.id, coverage2.get(requirement.id), requirement.text]),
      ...plan.tests.map((test) => [test.id, test.readiness, test.capability, test.title]),
      ...plan.gaps.map((gap) => [gap.id, gap.severity, gap.status, gap.question]),
      ...plan.decisions.map((decision) => [
        decision.id,
        decision.gapId,
        decision.kind,
        decision.value,
        decision.rationale
      ]),
      ...detail.pendingDecisions.map((decision) => [
        decision.id,
        decision.gapId,
        `pending ${decision.kind}`,
        decision.value,
        decision.rationale
      ]),
      ...decisionLines(detail.approval.latest)
    ]
  };
}
function writeOutput(store, out, content) {
  const path = resolve2(store.workspace, out);
  mkdirSync3(dirname(path), { recursive: true });
  try {
    writeFileSync(path, content, { flag: "wx" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new Error(`Output file exists: ${out}. Choose a new path.`, { cause: error });
    throw error;
  }
  return out;
}
function cell2(field2) {
  if (field2 === null || field2 === void 0) return "-";
  if (Array.isArray(field2)) return field2.length ? field2.map(cell2).join(",") : "-";
  if (typeof field2 === "object" && "preformatted" in field2) return String(field2.preformatted);
  if (typeof field2 === "object") return JSON.stringify(field2);
  return String(field2).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}
function compact(reply, printed) {
  const facts2 = Object.entries(printed.facts ?? {}).filter(([, field2]) => field2 !== void 0).map(([key, field2]) => `${key}=${cell2(field2)}`);
  return [
    [reply.status, reply.subject, ...facts2].join(" "),
    ...(printed.lines ?? []).map((line) => line.map(cell2).join("	")),
    ...reply.reasons.map((reason) => `reason: ${cell2(reason)}`)
  ].join("\n");
}
function format(reply, json, print) {
  if (json)
    return JSON.stringify({ status: reply.status, subject: reply.subject, reasons: reply.reasons, ...reply.data });
  return compact(reply, print ? print(reply) : {});
}
var globalFlags = { workspace: "value", json: "switch" };
function commandName(argv) {
  const words4 = [];
  for (const word of argv.slice(0, 3)) {
    if (word.startsWith("--")) break;
    words4.push(word);
  }
  for (let count = words4.length; count > 0; count--)
    if (commands[words4.slice(0, count).join(" ")]) return words4.slice(0, count).join(" ");
  throw new Error(`Unknown command: ${words4.join(" ") || "(none)"}. Run checkmate --help.`);
}
function parse(name, tokens) {
  const command = commands[name];
  const flags = {
    ...globalFlags,
    ...command.flags,
    ...command.write ? { actor: "value" } : {}
  };
  const args = {};
  const positionals = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const flag = token.slice(2);
    const kind = flags[flag];
    if (!kind) throw new Error(`Unknown option ${token} for ${name}. ${usage(name)}`);
    if (kind === "switch") {
      args[flag] = true;
      continue;
    }
    const next = tokens[++i];
    if (next === void 0 || next.startsWith("--")) throw new Error(`Missing value for ${token}`);
    optionValue(token, kind, next);
    if (kind !== "list" && kind !== "repeat") {
      if (flag in args) throw new Error(`Option ${token} is given twice`);
      args[flag] = next;
    } else if (kind === "list") {
      if (flag in args) throw new Error(`Option ${token} is given twice`);
      args[flag] = next.split(",").map((item) => item.trim()).filter(Boolean);
    } else args[flag] = [...args[flag] ?? [], next];
  }
  if (positionals.length !== command.positionals.length) throw new Error(usage(name));
  for (const flag of command.required ?? []) if (!(flag in args)) throw new Error(`Missing --${flag}. ${usage(name)}`);
  command.positionals.forEach((positional, i) => args[positional] = positionals[i]);
  command.check?.(args);
  return args;
}
function placeholder(kind) {
  if (Array.isArray(kind)) return kind.join("|");
  if (typeof kind === "object") return "n";
  return kind === "list" ? "a,b" : "value";
}
function usage(name) {
  const command = commands[name];
  const flags = Object.entries(command.flags ?? {}).map(([flag, kind]) => {
    const text = kind === "switch" ? `--${flag}` : `--${flag} <${placeholder(kind)}>`;
    return command.required?.includes(flag) ? text : `[${text}]`;
  });
  return [
    "Usage: checkmate",
    name,
    ...command.positionals.map((positional) => `<${positional}>`),
    ...flags,
    ...command.write ? ["[--actor <name>]"] : [],
    ...command.stdin ? ["< payload.json"] : []
  ].join(" ");
}
var uiUsage = "Usage: checkmate ui [--port <value>]";
function help() {
  return [
    ...Object.keys(commands).map((name) => usage(name).replace("Usage: ", "")),
    uiUsage.replace("Usage: ", ""),
    "Options for every command: --workspace <path>, --json"
  ].join("\n");
}
function commandHelp(argv) {
  const words4 = argv.slice(
    0,
    argv.findIndex((word) => word.startsWith("--"))
  );
  for (let count = words4.length; count > 0; count--) {
    const prefix = words4.slice(0, count).join(" ");
    if (prefix === "ui") return completed("ui", { usage: [uiUsage.replace("Usage: ", "")] });
    const names = Object.keys(commands).filter((name) => name === prefix || name.startsWith(`${prefix} `));
    if (names.length) return completed(prefix, { usage: names.map((name) => usage(name).replace("Usage: ", "")) });
  }
  const reason = `Unknown command: ${words4.join(" ") || "(none)"}. Run checkmate --help.`;
  return { status: "invalid_request", subject: "checkmate", reasons: [reason], data: { usage: [] } };
}
function version() {
  return JSON.parse(readFileSync3(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8")).version;
}
function readJson(text) {
  requireCondition(text.trim().length > 0, "Missing JSON payload on standard input");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Standard input is not valid JSON: ${error.message}`, { cause: error });
  }
}
function run(argv, io) {
  if (argv[0] === "--version") return { code: 0, output: version() };
  if (!argv.length || argv[0] === "--help") return { code: 0, output: help() };
  const json = argv.includes("--json");
  if (argv.includes("--help")) {
    const reply = commandHelp(argv);
    const code = reply.status === "completed" ? 0 : 1;
    return {
      code,
      output: format(reply, json, (help2) => ({ lines: help2.data.usage.map((line) => [line]) }))
    };
  }
  let name = "checkmate";
  let args;
  try {
    name = commandName(argv);
    args = parse(name, argv.slice(name.split(" ").length));
  } catch (error) {
    const reply = { status: "invalid_request", subject: name, reasons: [error.message], data: {} };
    return { code: 1, output: format(reply, json) };
  }
  const command = commands[name];
  const subject = command.positionals.length && name !== "query" ? String(args[command.positionals[0]]) : name;
  const workspace = resolve2(io.cwd, value(args, "workspace") ?? ".");
  let store;
  try {
    store = command.readOnly ? openReadOnlyStore(workspace) : openStore(workspace);
    const actor = command.write ? value(args, "actor") ?? defaultActor(workspace, io.env) : void 0;
    const reply = command.run(store, args, { actor, stdin: () => readJson(io.stdin()), text: io.stdin });
    const code = reply.status === "completed" || reply.status === "needs_decision" ? 0 : 1;
    if (!json && typeof reply.data.content === "string")
      return { code, output: reply.data.content.replace(/\n$/, "") };
    return { code, output: format(reply, json, command.print) };
  } catch (error) {
    const reply = isBusy(error) ? { status: "operational_error", subject, reasons: [error.message, busyReason], data: {} } : { status: "rejected", subject, reasons: [error.message], data: {} };
    return { code: 1, output: format(reply, json) };
  } finally {
    if (store) closeStore(store);
  }
}
function uiOptions(tokens, cwd) {
  const values = {};
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--json") continue;
    const flag = token.startsWith("--") ? token.slice(2) : "";
    if (!["workspace", "port"].includes(flag)) throw new Error(`Unknown argument ${token} for ui. ${uiUsage}`);
    const next = tokens[++i];
    if (next === void 0 || next.startsWith("--")) throw new Error(`Missing value for ${token}`);
    if (flag in values) throw new Error(`Option ${token} is given twice`);
    values[flag] = next;
  }
  const port = values.port === void 0 ? void 0 : Number(values.port);
  requireCondition(
    port === void 0 || /^[0-9]+$/.test(values.port) && port <= 65535,
    `Invalid --port: ${values.port}. Use 0 to 65535.`
  );
  return { workspace: resolve2(cwd, values.workspace ?? "."), port };
}
async function serveUi(tokens) {
  const json = tokens.includes("--json");
  let options2;
  try {
    options2 = uiOptions(tokens, process.cwd());
  } catch (error) {
    const reply = { status: "invalid_request", subject: "ui", reasons: [error.message], data: {} };
    process.stdout.write(format(reply, json) + "\n");
    process.exitCode = 1;
    return;
  }
  const ui = await startUi(options2);
  process.stdout.write(
    format(completed("ui", { url: ui.url }), json, (reply) => ({ facts: { url: reply.data.url } })) + "\n"
  );
  const stop = async () => {
    await ui.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
async function main(argv) {
  if (argv[0] === "ui" && !argv.includes("--help")) return serveUi(argv.slice(1));
  const outcome = run(argv, {
    cwd: process.cwd(),
    env: process.env,
    stdin: () => readFileSync3(0, "utf8")
  });
  process.stdout.write(outcome.output + "\n");
  process.exitCode = outcome.code;
}

// plugin/bin/checkmate.ts
await main(process.argv.slice(2));
