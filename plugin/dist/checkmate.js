#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __export = (target, all2) => {
  for (var name in all2)
    __defProp(target, name, { get: all2[name], enumerable: true });
};

// plugin/src/store.ts
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
var contractVersion = "toolkit-2";
var schemaVersion = "5";
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
CREATE TABLE changes (
	change_id TEXT PRIMARY KEY,
	target_id TEXT NOT NULL REFERENCES target_requests(target_id),
	instance_id TEXT,
	operation_id TEXT NOT NULL ${operationReference},
	FOREIGN KEY (target_id, instance_id) REFERENCES instances(target_id, instance_id)
) STRICT;
CREATE TABLE journal_entries (
	change_id TEXT NOT NULL REFERENCES changes(change_id),
	entry_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	build TEXT,
	body TEXT NOT NULL,
	actor TEXT NOT NULL,
	operation_id TEXT NOT NULL ${operationReference}
) STRICT;
`;
var tableNames = [...tables.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1]);
var triggers = tableNames.map(
  (table) => `CREATE TRIGGER ${table}_update BEFORE UPDATE ON ${table}
	BEGIN SELECT RAISE(ABORT, 'Rows of ${table} are immutable'); END;
CREATE TRIGGER ${table}_delete BEFORE DELETE ON ${table}
	BEGIN SELECT RAISE(ABORT, 'Rows of ${table} are immutable'); END;`
).join("\n");
function completed(subject, data = {}) {
  return { status: "completed", subject, reasons: [], data };
}
function databasePath(workspace) {
  return join(workspace, ".checkmate", "checkmate.db");
}
var busyReason = "Another command holds the database lock. Nothing changed. Run the command again.";
function isBusy(error) {
  return error instanceof Error && "errcode" in error && [5, 6].includes(Number(error.errcode) & 255);
}
function busyTimeout(value2 = process.env.CHECKMATE_BUSY_TIMEOUT_MS) {
  const milliseconds = Number(value2);
  return value2 !== void 0 && /^[1-9][0-9]*$/.test(value2) && milliseconds <= 2147483647 ? milliseconds : 3e4;
}
function createStore(workspace) {
  mkdirSync(join(workspace, ".checkmate"), { recursive: true });
  return connect(workspace);
}
function openStore(workspace) {
  if (!existsSync(databasePath(workspace))) throw new Error(`No Checkmate store at ${databasePath(workspace)}.`);
  return connect(workspace);
}
function connect(workspace) {
  const path = databasePath(workspace);
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = ${busyTimeout()}`);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("BEGIN IMMEDIATE");
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get()) {
      db.exec(tables);
      db.exec(triggers);
      const insert2 = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
      insert2.run("contractVersion", contractVersion);
      insert2.run("schemaVersion", schemaVersion);
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
  instance: () => te,
  journalCriterion: () => re,
  journalDefect: () => ie,
  journalEntry: () => ne,
  journalIssue: () => ae,
  journalNote: () => oe,
  journalObservation: () => pe,
  journalQuestion: () => le,
  journalVerdict: () => me,
  profile: () => ue
});
var q = (n, r) => () => {
  try {
    return r || n((r = { exports: {} }).exports, r), r.exports;
  } catch (g) {
    throw r = 0, g;
  }
};
var Z = q((A) => {
  "use strict";
  Object.defineProperty(A, "__esModule", { value: true });
  function z(n) {
    let r = n.length, g = 0, k = 0, w;
    for (; k < r; ) g++, w = n.charCodeAt(k++), w >= 55296 && w <= 56319 && k < r && (w = n.charCodeAt(k), (w & 64512) === 56320 && k++);
    return g;
  }
  A.default = z;
  z.code = 'require("ajv/dist/runtime/ucs2length").default';
});
var T = q((ee, $) => {
  "use strict";
  $.exports = function n(r, g) {
    if (r === g) return true;
    if (r && g && typeof r == "object" && typeof g == "object") {
      if (r.constructor !== g.constructor) return false;
      var k, w, e;
      if (Array.isArray(r)) {
        if (k = r.length, k != g.length) return false;
        for (w = k; w-- !== 0; ) if (!n(r[w], g[w])) return false;
        return true;
      }
      if (r.constructor === RegExp) return r.source === g.source && r.flags === g.flags;
      if (r.valueOf !== Object.prototype.valueOf) return r.valueOf() === g.valueOf();
      if (r.toString !== Object.prototype.toString) return r.toString() === g.toString();
      if (e = Object.keys(r), k = e.length, k !== Object.keys(g).length) return false;
      for (w = k; w-- !== 0; ) if (!Object.prototype.hasOwnProperty.call(g, e[w])) return false;
      for (w = k; w-- !== 0; ) {
        var s = e[w];
        if (!n(r[s], g[s])) return false;
      }
      return true;
    }
    return r !== r && g !== g;
  };
});
var x = q((O) => {
  "use strict";
  Object.defineProperty(O, "__esModule", { value: true });
  var _ = T();
  _.code = 'require("ajv/dist/runtime/equal").default';
  O.default = _;
});
var te = V;
var P = new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$", "u");
var c = Z().default;
function V(n, { instancePath: r = "", parentData: g, parentDataProperty: k, rootData: w = n } = {}) {
  let e = null, s = 0;
  if (n && typeof n == "object" && !Array.isArray(n)) {
    if (n.entries === void 0) {
      let a = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entries" }, message: "must have required property 'entries'" };
      e === null ? e = [a] : e.push(a), s++;
    }
    for (let a in n) if (!(a === "entries" || a === "environment" || a === "references")) {
      let t = { instancePath: r, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: a }, message: "must NOT have additional properties" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.entries !== void 0) {
      let a = n.entries;
      if (a && typeof a == "object" && !Array.isArray(a)) {
        if (Object.keys(a).length < 1) {
          let t = { instancePath: r + "/entries", schemaPath: "#/properties/entries/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
          e === null ? e = [t] : e.push(t), s++;
        }
        for (let t in a) {
          let i = s;
          if (typeof t == "string" && !P.test(t)) {
            let m = { instancePath: r + "/entries", schemaPath: "#/properties/entries/propertyNames/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"', propertyName: t };
            e === null ? e = [m] : e.push(m), s++;
          }
          var o = i === s;
          if (!o) {
            let m = { instancePath: r + "/entries", schemaPath: "#/properties/entries/propertyNames", keyword: "propertyNames", params: { propertyName: t }, message: "property name must be valid" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        for (let t in a) {
          let i = a[t];
          if (typeof i == "string") {
            if (c(i) > 2e3) {
              let m = { instancePath: r + "/entries/" + t.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/entries/additionalProperties/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
              e === null ? e = [m] : e.push(m), s++;
            }
            if (c(i) < 1) {
              let m = { instancePath: r + "/entries/" + t.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/entries/additionalProperties/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: r + "/entries/" + t.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/entries/additionalProperties/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
      } else {
        let t = { instancePath: r + "/entries", schemaPath: "#/properties/entries/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [t] : e.push(t), s++;
      }
    }
    if (n.environment !== void 0) {
      let a = n.environment;
      if (typeof a == "string") {
        if (c(a) > 500) {
          let t = { instancePath: r + "/environment", schemaPath: "#/properties/environment/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
          e === null ? e = [t] : e.push(t), s++;
        }
        if (c(a) < 1) {
          let t = { instancePath: r + "/environment", schemaPath: "#/properties/environment/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [t] : e.push(t), s++;
        }
      } else {
        let t = { instancePath: r + "/environment", schemaPath: "#/properties/environment/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [t] : e.push(t), s++;
      }
    }
    if (n.references !== void 0) {
      let a = n.references;
      if (Array.isArray(a)) {
        if (a.length < 0) {
          let d = { instancePath: r + "/references", schemaPath: "#/properties/references/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [d] : e.push(d), s++;
        }
        let t = a.length;
        for (let d = 0; d < t; d++) {
          let p = a[d];
          if (typeof p == "string") {
            if (c(p) > 200) {
              let h = { instancePath: r + "/references/" + d, schemaPath: "#/properties/references/items/maxLength", keyword: "maxLength", params: { limit: 200 }, message: "must NOT have more than 200 characters" };
              e === null ? e = [h] : e.push(h), s++;
            }
            if (c(p) < 1) {
              let h = { instancePath: r + "/references/" + d, schemaPath: "#/properties/references/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              e === null ? e = [h] : e.push(h), s++;
            }
          } else {
            let h = { instancePath: r + "/references/" + d, schemaPath: "#/properties/references/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [h] : e.push(h), s++;
          }
        }
        let i = a.length, m;
        if (i > 1) {
          let d = {};
          for (; i--; ) {
            let p = a[i];
            if (typeof p == "string") {
              if (typeof d[p] == "number") {
                m = d[p];
                let h = { instancePath: r + "/references", schemaPath: "#/properties/references/uniqueItems", keyword: "uniqueItems", params: { i, j: m }, message: "must NOT have duplicate items (items ## " + m + " and " + i + " are identical)" };
                e === null ? e = [h] : e.push(h), s++;
                break;
              }
              d[p] = i;
            }
          }
        }
      } else {
        let t = { instancePath: r + "/references", schemaPath: "#/properties/references/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [t] : e.push(t), s++;
      }
    }
  } else {
    let a = { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [a] : e.push(a), s++;
  }
  return V.errors = e, s === 0;
}
var re = E;
var b = new RegExp("^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$", "u");
function E(n, { instancePath: r = "", parentData: g, parentDataProperty: k, rootData: w = n } = {}) {
  let e = null, s = 0;
  if (n && typeof n == "object" && !Array.isArray(n)) {
    if (n.kind === void 0) {
      let o = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (n.text === void 0) {
      let o = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "text" }, message: "must have required property 'text'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    for (let o in n) if (!(o === "kind" || o === "id" || o === "build" || o === "supersedes" || o === "text" || o === "source" || o === "area")) {
      let a = { instancePath: r, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: o }, message: "must NOT have additional properties" };
      e === null ? e = [a] : e.push(a), s++;
    }
    if (n.kind !== void 0 && n.kind !== "criterion") {
      let o = { instancePath: r + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "criterion" }, message: "must be equal to constant" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (n.id !== void 0) {
      let o = n.id;
      if (typeof o == "string") {
        if (!P.test(o)) {
          let a = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.build !== void 0) {
      let o = n.build;
      if (typeof o == "string") {
        if (!b.test(o)) {
          let a = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$"' };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.supersedes !== void 0) {
      let o = n.supersedes;
      if (typeof o == "string") {
        if (!P.test(o)) {
          let a = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.text !== void 0) {
      let o = n.text;
      if (typeof o == "string") {
        if (c(o) < 1) {
          let a = { instancePath: r + "/text", schemaPath: "#/properties/text/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/text", schemaPath: "#/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.source !== void 0) {
      let o = n.source;
      if (typeof o == "string") {
        if (c(o) < 1) {
          let a = { instancePath: r + "/source", schemaPath: "#/properties/source/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/source", schemaPath: "#/properties/source/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.area !== void 0) {
      let o = n.area;
      if (typeof o == "string") {
        if (c(o) < 1) {
          let a = { instancePath: r + "/area", schemaPath: "journal-entry.schema.json#/definitions/area/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/area", schemaPath: "journal-entry.schema.json#/definitions/area/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
  } else {
    let o = { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [o] : e.push(o), s++;
  }
  return E.errors = e, s === 0;
}
var ie = C;
var N = { $schema: "http://json-schema.org/draft-07/schema#", $id: "journal-defect.schema.json", description: "A thing that is wrong on this build. With saw, value, or via, it is also the observation that shows it: do not log that observation again.", type: "object", properties: { kind: { const: "defect" }, id: { $ref: "journal-entry.schema.json#/definitions/id" }, build: { $ref: "journal-entry.schema.json#/definitions/build" }, supersedes: { $ref: "journal-entry.schema.json#/definitions/supersedes" }, title: { description: "What is wrong.", type: "string", minLength: 1 }, expected: { description: "The correct result and its source.", type: "string", minLength: 1 }, actual: { description: "What you saw.", type: "string", minLength: 1 }, severity: { description: "The severity.", enum: ["critical", "high", "medium", "low"] }, about: { $ref: "journal-entry.schema.json#/definitions/about" }, steps: { $ref: "journal-entry.schema.json#/definitions/steps" }, saw: { $ref: "journal-entry.schema.json#/definitions/saw" }, value: { $ref: "journal-entry.schema.json#/definitions/value" }, via: { $ref: "journal-entry.schema.json#/definitions/via" }, evidence: { description: "The file that shows the defect (a screenshot, a response, a log), or the text that you saw.", $ref: "journal-entry.schema.json#/definitions/evidence" }, links: { description: "The IDs of the observations or criteria that show it.", type: "array", items: { type: "string", minLength: 1 } }, suspected: { description: "true when you are not sure.", type: "boolean" }, question: { description: "The question that settles a suspected defect.", type: "string", minLength: 1 } }, required: ["kind", "build", "title", "expected", "actual", "severity"], additionalProperties: false };
var W = { description: "The entry point that you used.", enum: ["ui", "api", "code", "other"] };
var L = Object.prototype.hasOwnProperty;
function C(n, { instancePath: r = "", parentData: g, parentDataProperty: k, rootData: w = n } = {}) {
  let e = null, s = 0;
  if (n && typeof n == "object" && !Array.isArray(n)) {
    if (n.kind === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.build === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "build" }, message: "must have required property 'build'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.title === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "title" }, message: "must have required property 'title'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.expected === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "expected" }, message: "must have required property 'expected'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.actual === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "actual" }, message: "must have required property 'actual'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.severity === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "severity" }, message: "must have required property 'severity'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    for (let t in n) if (!L.call(N.properties, t)) {
      let i = { instancePath: r, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: t }, message: "must NOT have additional properties" };
      e === null ? e = [i] : e.push(i), s++;
    }
    if (n.kind !== void 0 && n.kind !== "defect") {
      let t = { instancePath: r + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "defect" }, message: "must be equal to constant" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.id !== void 0) {
      let t = n.id;
      if (typeof t == "string") {
        if (!P.test(t)) {
          let i = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.build !== void 0) {
      let t = n.build;
      if (typeof t == "string") {
        if (!b.test(t)) {
          let i = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$"' };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.supersedes !== void 0) {
      let t = n.supersedes;
      if (typeof t == "string") {
        if (!P.test(t)) {
          let i = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.title !== void 0) {
      let t = n.title;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let i = { instancePath: r + "/title", schemaPath: "#/properties/title/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/title", schemaPath: "#/properties/title/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.expected !== void 0) {
      let t = n.expected;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let i = { instancePath: r + "/expected", schemaPath: "#/properties/expected/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/expected", schemaPath: "#/properties/expected/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.actual !== void 0) {
      let t = n.actual;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let i = { instancePath: r + "/actual", schemaPath: "#/properties/actual/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/actual", schemaPath: "#/properties/actual/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.severity !== void 0) {
      let t = n.severity;
      if (!(t === "critical" || t === "high" || t === "medium" || t === "low")) {
        let i = { instancePath: r + "/severity", schemaPath: "#/properties/severity/enum", keyword: "enum", params: { allowedValues: N.properties.severity.enum }, message: "must be equal to one of the allowed values" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.about !== void 0) {
      let t = n.about;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let i = { instancePath: r + "/about", schemaPath: "journal-entry.schema.json#/definitions/about/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/about", schemaPath: "journal-entry.schema.json#/definitions/about/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.steps !== void 0) {
      let t = n.steps, i = s, m = false, d = s;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let p = { instancePath: r + "/steps", schemaPath: "journal-entry.schema.json#/definitions/steps/anyOf/0/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [p] : e.push(p), s++;
        }
      } else {
        let p = { instancePath: r + "/steps", schemaPath: "journal-entry.schema.json#/definitions/steps/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [p] : e.push(p), s++;
      }
      var o = d === s;
      if (m = m || o, !m) {
        let p = s;
        if (Array.isArray(t)) {
          if (t.length < 1) {
            let u = { instancePath: r + "/steps", schemaPath: "journal-entry.schema.json#/definitions/steps/anyOf/1/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
            e === null ? e = [u] : e.push(u), s++;
          }
          let l = t.length;
          for (let u = 0; u < l; u++) {
            let f = t[u];
            if (typeof f == "string") {
              if (c(f) < 1) {
                let y = { instancePath: r + "/steps/" + u, schemaPath: "journal-entry.schema.json#/definitions/steps/anyOf/1/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                e === null ? e = [y] : e.push(y), s++;
              }
            } else {
              let y = { instancePath: r + "/steps/" + u, schemaPath: "journal-entry.schema.json#/definitions/steps/anyOf/1/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              e === null ? e = [y] : e.push(y), s++;
            }
          }
        } else {
          let l = { instancePath: r + "/steps", schemaPath: "journal-entry.schema.json#/definitions/steps/anyOf/1/type", keyword: "type", params: { type: "array" }, message: "must be array" };
          e === null ? e = [l] : e.push(l), s++;
        }
        var o = p === s;
        m = m || o;
      }
      if (m) s = i, e !== null && (i ? e.length = i : e = null);
      else {
        let p = { instancePath: r + "/steps", schemaPath: "journal-entry.schema.json#/definitions/steps/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
        e === null ? e = [p] : e.push(p), s++;
      }
    }
    if (n.saw !== void 0) {
      let t = n.saw;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let i = { instancePath: r + "/saw", schemaPath: "journal-entry.schema.json#/definitions/saw/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/saw", schemaPath: "journal-entry.schema.json#/definitions/saw/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.value !== void 0) {
      let t = n.value;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let i = { instancePath: r + "/value", schemaPath: "journal-entry.schema.json#/definitions/value/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/value", schemaPath: "journal-entry.schema.json#/definitions/value/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.via !== void 0) {
      let t = n.via;
      if (!(t === "ui" || t === "api" || t === "code" || t === "other")) {
        let i = { instancePath: r + "/via", schemaPath: "journal-entry.schema.json#/definitions/via/enum", keyword: "enum", params: { allowedValues: W.enum }, message: "must be equal to one of the allowed values" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.evidence !== void 0) {
      let t = n.evidence, i = s, m = false, d = s;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let p = { instancePath: r + "/evidence", schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/0/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [p] : e.push(p), s++;
        }
      } else {
        let p = { instancePath: r + "/evidence", schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [p] : e.push(p), s++;
      }
      var a = d === s;
      if (m = m || a, !m) {
        let p = s;
        if (Array.isArray(t)) {
          if (t.length < 1) {
            let u = { instancePath: r + "/evidence", schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/1/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
            e === null ? e = [u] : e.push(u), s++;
          }
          let l = t.length;
          for (let u = 0; u < l; u++) {
            let f = t[u];
            if (typeof f == "string") {
              if (c(f) < 1) {
                let y = { instancePath: r + "/evidence/" + u, schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/1/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                e === null ? e = [y] : e.push(y), s++;
              }
            } else {
              let y = { instancePath: r + "/evidence/" + u, schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/1/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              e === null ? e = [y] : e.push(y), s++;
            }
          }
        } else {
          let l = { instancePath: r + "/evidence", schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/1/type", keyword: "type", params: { type: "array" }, message: "must be array" };
          e === null ? e = [l] : e.push(l), s++;
        }
        var a = p === s;
        m = m || a;
      }
      if (m) s = i, e !== null && (i ? e.length = i : e = null);
      else {
        let p = { instancePath: r + "/evidence", schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
        e === null ? e = [p] : e.push(p), s++;
      }
    }
    if (n.links !== void 0) {
      let t = n.links;
      if (Array.isArray(t)) {
        let i = t.length;
        for (let m = 0; m < i; m++) {
          let d = t[m];
          if (typeof d == "string") {
            if (c(d) < 1) {
              let p = { instancePath: r + "/links/" + m, schemaPath: "#/properties/links/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              e === null ? e = [p] : e.push(p), s++;
            }
          } else {
            let p = { instancePath: r + "/links/" + m, schemaPath: "#/properties/links/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [p] : e.push(p), s++;
          }
        }
      } else {
        let i = { instancePath: r + "/links", schemaPath: "#/properties/links/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.suspected !== void 0 && typeof n.suspected != "boolean") {
      let t = { instancePath: r + "/suspected", schemaPath: "#/properties/suspected/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.question !== void 0) {
      let t = n.question;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let i = { instancePath: r + "/question", schemaPath: "#/properties/question/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/question", schemaPath: "#/properties/question/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
  } else {
    let t = { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [t] : e.push(t), s++;
  }
  return C.errors = e, s === 0;
}
var ne = F;
var Q = { $schema: "http://json-schema.org/draft-07/schema#", $id: "journal-entry.schema.json", description: "Checkmate saves each valid entry, and refuses each invalid entry alone. Nothing is deleted.", type: "object", properties: { kind: { description: "The kind.", enum: ["criterion", "observation", "defect", "question", "verdict", "note", "issue"] }, id: { $ref: "journal-entry.schema.json#/definitions/id" }, build: { $ref: "journal-entry.schema.json#/definitions/build" }, supersedes: { $ref: "journal-entry.schema.json#/definitions/supersedes" } }, required: ["kind"], examples: [[{ kind: "criterion", id: "C1", text: "5 or more items get 10% off.", source: "ticket.md#AC2" }, { kind: "observation", id: "O1", about: "C1", steps: "Add 4 pens in the cart", saw: "Total 40.00", value: "40.00", verdict: "ok", via: "ui" }, { kind: "defect", id: "D1", title: "No discount at 5 items", expected: "45.00 (AC2)", actual: "Total 50.00", severity: "high", links: ["C1"], steps: "Add 5 pens in the cart", value: "50.00", via: "ui", evidence: "evidence/cart-5.png" }]], definitions: { id: { description: "Your ID, for example D1. Without it, Checkmate gives one.", type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, build: { description: "The build that you tested, for example base or b1. Give it here or with --build.", type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$" }, supersedes: { description: "The ID of an earlier entry of the same kind. This entry replaces it and keeps its ID.", type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, about: { description: "A criterion ID, a question ID, a diff area, or free text.", type: "string", minLength: 1 }, area: { description: "A changed area, for example src/cart.js.", type: "string", minLength: 1 }, steps: { description: "What you did.", anyOf: [{ type: "string", minLength: 1 }, { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 }] }, saw: { description: "What you saw.", type: "string", minLength: 1 }, value: { description: "The exact value to compare on a later build, for example 45.00 or HTTP 409.", type: "string", minLength: 1 }, via: { description: "The entry point that you used.", enum: ["ui", "api", "code", "other"] }, evidence: { description: "A workspace file or the text that you saw, or an array of them.", anyOf: [{ type: "string", minLength: 1 }, { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 }] } } };
function F(n, { instancePath: r = "", parentData: g, parentDataProperty: k, rootData: w = n } = {}) {
  let e = null, s = 0;
  if (n && typeof n == "object" && !Array.isArray(n)) {
    if (n.kind === void 0) {
      let o = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (n.kind !== void 0) {
      let o = n.kind;
      if (!(o === "criterion" || o === "observation" || o === "defect" || o === "question" || o === "verdict" || o === "note" || o === "issue")) {
        let a = { instancePath: r + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: Q.properties.kind.enum }, message: "must be equal to one of the allowed values" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.id !== void 0) {
      let o = n.id;
      if (typeof o == "string") {
        if (!P.test(o)) {
          let a = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.build !== void 0) {
      let o = n.build;
      if (typeof o == "string") {
        if (!b.test(o)) {
          let a = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$"' };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.supersedes !== void 0) {
      let o = n.supersedes;
      if (typeof o == "string") {
        if (!P.test(o)) {
          let a = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
  } else {
    let o = { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [o] : e.push(o), s++;
  }
  return F.errors = e, s === 0;
}
var ae = M;
var B = { $schema: "http://json-schema.org/draft-07/schema#", $id: "journal-issue.schema.json", description: "One defect that one or more defect entries report. A defect that is in no issue is its own issue. On a later build, the status of the issue is the result of most verdicts on that build. With a tie, it is fixed and disputed. With one verdict, it is that result and single. An observation of the verifier with confirms or refutes on that build sets the status.", type: "object", properties: { kind: { const: "issue" }, id: { $ref: "journal-entry.schema.json#/definitions/id" }, build: { $ref: "journal-entry.schema.json#/definitions/build" }, supersedes: { $ref: "journal-entry.schema.json#/definitions/supersedes" }, title: { description: "What is wrong, in one line.", type: "string", minLength: 1 }, severity: { description: "The severity.", enum: ["critical", "high", "medium", "low"] }, reports: { description: "The full IDs of the defect entries that describe this defect, for example a1/D1.", type: "array", items: { type: "string", minLength: 1 }, minItems: 1 }, note: { description: "Why these reports are one defect.", type: "string", minLength: 1 } }, required: ["kind", "title", "severity", "reports"], additionalProperties: false, examples: [{ kind: "issue", title: "No discount at 5 items", severity: "high", reports: ["a1/D1", "a3/D2"], note: "The same total of 50.00 for 5 items." }] };
function M(n, { instancePath: r = "", parentData: g, parentDataProperty: k, rootData: w = n } = {}) {
  let e = null, s = 0;
  if (n && typeof n == "object" && !Array.isArray(n)) {
    if (n.kind === void 0) {
      let o = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (n.title === void 0) {
      let o = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "title" }, message: "must have required property 'title'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (n.severity === void 0) {
      let o = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "severity" }, message: "must have required property 'severity'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (n.reports === void 0) {
      let o = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "reports" }, message: "must have required property 'reports'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    for (let o in n) if (!(o === "kind" || o === "id" || o === "build" || o === "supersedes" || o === "title" || o === "severity" || o === "reports" || o === "note")) {
      let a = { instancePath: r, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: o }, message: "must NOT have additional properties" };
      e === null ? e = [a] : e.push(a), s++;
    }
    if (n.kind !== void 0 && n.kind !== "issue") {
      let o = { instancePath: r + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "issue" }, message: "must be equal to constant" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (n.id !== void 0) {
      let o = n.id;
      if (typeof o == "string") {
        if (!P.test(o)) {
          let a = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.build !== void 0) {
      let o = n.build;
      if (typeof o == "string") {
        if (!b.test(o)) {
          let a = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$"' };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.supersedes !== void 0) {
      let o = n.supersedes;
      if (typeof o == "string") {
        if (!P.test(o)) {
          let a = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.title !== void 0) {
      let o = n.title;
      if (typeof o == "string") {
        if (c(o) < 1) {
          let a = { instancePath: r + "/title", schemaPath: "#/properties/title/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/title", schemaPath: "#/properties/title/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.severity !== void 0) {
      let o = n.severity;
      if (!(o === "critical" || o === "high" || o === "medium" || o === "low")) {
        let a = { instancePath: r + "/severity", schemaPath: "#/properties/severity/enum", keyword: "enum", params: { allowedValues: B.properties.severity.enum }, message: "must be equal to one of the allowed values" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.reports !== void 0) {
      let o = n.reports;
      if (Array.isArray(o)) {
        if (o.length < 1) {
          let t = { instancePath: r + "/reports", schemaPath: "#/properties/reports/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [t] : e.push(t), s++;
        }
        let a = o.length;
        for (let t = 0; t < a; t++) {
          let i = o[t];
          if (typeof i == "string") {
            if (c(i) < 1) {
              let m = { instancePath: r + "/reports/" + t, schemaPath: "#/properties/reports/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              e === null ? e = [m] : e.push(m), s++;
            }
          } else {
            let m = { instancePath: r + "/reports/" + t, schemaPath: "#/properties/reports/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
      } else {
        let a = { instancePath: r + "/reports", schemaPath: "#/properties/reports/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.note !== void 0) {
      let o = n.note;
      if (typeof o == "string") {
        if (c(o) < 1) {
          let a = { instancePath: r + "/note", schemaPath: "#/properties/note/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/note", schemaPath: "#/properties/note/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
  } else {
    let o = { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [o] : e.push(o), s++;
  }
  return M.errors = e, s === 0;
}
var oe = R;
function R(n, { instancePath: r = "", parentData: g, parentDataProperty: k, rootData: w = n } = {}) {
  let e = null, s = 0;
  if (n && typeof n == "object" && !Array.isArray(n)) {
    if (n.kind === void 0) {
      let o = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (n.text === void 0) {
      let o = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "text" }, message: "must have required property 'text'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    for (let o in n) if (!(o === "kind" || o === "id" || o === "build" || o === "supersedes" || o === "text" || o === "about" || o === "area")) {
      let a = { instancePath: r, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: o }, message: "must NOT have additional properties" };
      e === null ? e = [a] : e.push(a), s++;
    }
    if (n.kind !== void 0 && n.kind !== "note") {
      let o = { instancePath: r + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "note" }, message: "must be equal to constant" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (n.id !== void 0) {
      let o = n.id;
      if (typeof o == "string") {
        if (!P.test(o)) {
          let a = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.build !== void 0) {
      let o = n.build;
      if (typeof o == "string") {
        if (!b.test(o)) {
          let a = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$"' };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.supersedes !== void 0) {
      let o = n.supersedes;
      if (typeof o == "string") {
        if (!P.test(o)) {
          let a = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.text !== void 0) {
      let o = n.text;
      if (typeof o == "string") {
        if (c(o) < 1) {
          let a = { instancePath: r + "/text", schemaPath: "#/properties/text/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/text", schemaPath: "#/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.about !== void 0) {
      let o = n.about;
      if (typeof o == "string") {
        if (c(o) < 1) {
          let a = { instancePath: r + "/about", schemaPath: "journal-entry.schema.json#/definitions/about/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/about", schemaPath: "journal-entry.schema.json#/definitions/about/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.area !== void 0) {
      let o = n.area;
      if (typeof o == "string") {
        if (c(o) < 1) {
          let a = { instancePath: r + "/area", schemaPath: "journal-entry.schema.json#/definitions/area/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/area", schemaPath: "journal-entry.schema.json#/definitions/area/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
  } else {
    let o = { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [o] : e.push(o), s++;
  }
  return R.errors = e, s === 0;
}
var pe = S;
var I = { $schema: "http://json-schema.org/draft-07/schema#", $id: "journal-observation.schema.json", description: "What you did and what you saw. A value on base makes a baseline. Checkmate compares it on each later build.", type: "object", properties: { kind: { const: "observation" }, id: { $ref: "journal-entry.schema.json#/definitions/id" }, build: { $ref: "journal-entry.schema.json#/definitions/build" }, supersedes: { $ref: "journal-entry.schema.json#/definitions/supersedes" }, about: { $ref: "journal-entry.schema.json#/definitions/about" }, steps: { $ref: "journal-entry.schema.json#/definitions/steps" }, saw: { $ref: "journal-entry.schema.json#/definitions/saw" }, value: { $ref: "journal-entry.schema.json#/definitions/value" }, repeats: { description: "The ID of an earlier observation that you did again. Without it, Checkmate links a value to the one earlier value with the same about and steps, or the same ID without the build name (total-b1, total-base). none: no link.", type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_/-]{0,191}$" }, verdict: { description: "ok when the result is correct. wrong when it is not.", enum: ["ok", "wrong"] }, via: { $ref: "journal-entry.schema.json#/definitions/via" }, evidence: { $ref: "journal-entry.schema.json#/definitions/evidence" }, confirms: { description: "The ID of an issue or a defect that you did again and saw, for example a1/D3. On the build where it was found, it confirms the issue. On a later build, it sets the status of the issue on that build to not_fixed.", type: "string", minLength: 1 }, refutes: { description: "The ID of an issue or a defect that you did again and did not see. On the build where it was found, it refutes the issue. On a later build, it sets the status of the issue on that build to fixed.", type: "string", minLength: 1 } }, required: ["kind", "build", "saw"], additionalProperties: false, examples: [{ kind: "observation", confirms: "a1/D3", steps: "Add 5 pens in the cart", saw: "Total 50.00, no discount", via: "ui", evidence: "evidence/cart-5.png" }] };
var J = new RegExp("^[A-Za-z0-9][A-Za-z0-9_/-]{0,191}$", "u");
function S(n, { instancePath: r = "", parentData: g, parentDataProperty: k, rootData: w = n } = {}) {
  let e = null, s = 0;
  if (n && typeof n == "object" && !Array.isArray(n)) {
    if (n.kind === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.build === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "build" }, message: "must have required property 'build'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.saw === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "saw" }, message: "must have required property 'saw'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    for (let t in n) if (!L.call(I.properties, t)) {
      let i = { instancePath: r, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: t }, message: "must NOT have additional properties" };
      e === null ? e = [i] : e.push(i), s++;
    }
    if (n.kind !== void 0 && n.kind !== "observation") {
      let t = { instancePath: r + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "observation" }, message: "must be equal to constant" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.id !== void 0) {
      let t = n.id;
      if (typeof t == "string") {
        if (!P.test(t)) {
          let i = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.build !== void 0) {
      let t = n.build;
      if (typeof t == "string") {
        if (!b.test(t)) {
          let i = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$"' };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.supersedes !== void 0) {
      let t = n.supersedes;
      if (typeof t == "string") {
        if (!P.test(t)) {
          let i = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.about !== void 0) {
      let t = n.about;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let i = { instancePath: r + "/about", schemaPath: "journal-entry.schema.json#/definitions/about/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/about", schemaPath: "journal-entry.schema.json#/definitions/about/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.steps !== void 0) {
      let t = n.steps, i = s, m = false, d = s;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let p = { instancePath: r + "/steps", schemaPath: "journal-entry.schema.json#/definitions/steps/anyOf/0/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [p] : e.push(p), s++;
        }
      } else {
        let p = { instancePath: r + "/steps", schemaPath: "journal-entry.schema.json#/definitions/steps/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [p] : e.push(p), s++;
      }
      var o = d === s;
      if (m = m || o, !m) {
        let p = s;
        if (Array.isArray(t)) {
          if (t.length < 1) {
            let u = { instancePath: r + "/steps", schemaPath: "journal-entry.schema.json#/definitions/steps/anyOf/1/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
            e === null ? e = [u] : e.push(u), s++;
          }
          let l = t.length;
          for (let u = 0; u < l; u++) {
            let f = t[u];
            if (typeof f == "string") {
              if (c(f) < 1) {
                let y = { instancePath: r + "/steps/" + u, schemaPath: "journal-entry.schema.json#/definitions/steps/anyOf/1/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                e === null ? e = [y] : e.push(y), s++;
              }
            } else {
              let y = { instancePath: r + "/steps/" + u, schemaPath: "journal-entry.schema.json#/definitions/steps/anyOf/1/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              e === null ? e = [y] : e.push(y), s++;
            }
          }
        } else {
          let l = { instancePath: r + "/steps", schemaPath: "journal-entry.schema.json#/definitions/steps/anyOf/1/type", keyword: "type", params: { type: "array" }, message: "must be array" };
          e === null ? e = [l] : e.push(l), s++;
        }
        var o = p === s;
        m = m || o;
      }
      if (m) s = i, e !== null && (i ? e.length = i : e = null);
      else {
        let p = { instancePath: r + "/steps", schemaPath: "journal-entry.schema.json#/definitions/steps/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
        e === null ? e = [p] : e.push(p), s++;
      }
    }
    if (n.saw !== void 0) {
      let t = n.saw;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let i = { instancePath: r + "/saw", schemaPath: "journal-entry.schema.json#/definitions/saw/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/saw", schemaPath: "journal-entry.schema.json#/definitions/saw/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.value !== void 0) {
      let t = n.value;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let i = { instancePath: r + "/value", schemaPath: "journal-entry.schema.json#/definitions/value/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/value", schemaPath: "journal-entry.schema.json#/definitions/value/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.repeats !== void 0) {
      let t = n.repeats;
      if (typeof t == "string") {
        if (!J.test(t)) {
          let i = { instancePath: r + "/repeats", schemaPath: "#/properties/repeats/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_/-]{0,191}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_/-]{0,191}$"' };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/repeats", schemaPath: "#/properties/repeats/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.verdict !== void 0) {
      let t = n.verdict;
      if (!(t === "ok" || t === "wrong")) {
        let i = { instancePath: r + "/verdict", schemaPath: "#/properties/verdict/enum", keyword: "enum", params: { allowedValues: I.properties.verdict.enum }, message: "must be equal to one of the allowed values" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.via !== void 0) {
      let t = n.via;
      if (!(t === "ui" || t === "api" || t === "code" || t === "other")) {
        let i = { instancePath: r + "/via", schemaPath: "journal-entry.schema.json#/definitions/via/enum", keyword: "enum", params: { allowedValues: W.enum }, message: "must be equal to one of the allowed values" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.evidence !== void 0) {
      let t = n.evidence, i = s, m = false, d = s;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let p = { instancePath: r + "/evidence", schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/0/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [p] : e.push(p), s++;
        }
      } else {
        let p = { instancePath: r + "/evidence", schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [p] : e.push(p), s++;
      }
      var a = d === s;
      if (m = m || a, !m) {
        let p = s;
        if (Array.isArray(t)) {
          if (t.length < 1) {
            let u = { instancePath: r + "/evidence", schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/1/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
            e === null ? e = [u] : e.push(u), s++;
          }
          let l = t.length;
          for (let u = 0; u < l; u++) {
            let f = t[u];
            if (typeof f == "string") {
              if (c(f) < 1) {
                let y = { instancePath: r + "/evidence/" + u, schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/1/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                e === null ? e = [y] : e.push(y), s++;
              }
            } else {
              let y = { instancePath: r + "/evidence/" + u, schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/1/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              e === null ? e = [y] : e.push(y), s++;
            }
          }
        } else {
          let l = { instancePath: r + "/evidence", schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/1/type", keyword: "type", params: { type: "array" }, message: "must be array" };
          e === null ? e = [l] : e.push(l), s++;
        }
        var a = p === s;
        m = m || a;
      }
      if (m) s = i, e !== null && (i ? e.length = i : e = null);
      else {
        let p = { instancePath: r + "/evidence", schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
        e === null ? e = [p] : e.push(p), s++;
      }
    }
    if (n.confirms !== void 0) {
      let t = n.confirms;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let i = { instancePath: r + "/confirms", schemaPath: "#/properties/confirms/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/confirms", schemaPath: "#/properties/confirms/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.refutes !== void 0) {
      let t = n.refutes;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let i = { instancePath: r + "/refutes", schemaPath: "#/properties/refutes/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/refutes", schemaPath: "#/properties/refutes/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
  } else {
    let t = { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [t] : e.push(t), s++;
  }
  return S.errors = e, s === 0;
}
var le = G;
function G(n, { instancePath: r = "", parentData: g, parentDataProperty: k, rootData: w = n } = {}) {
  let e = null, s = 0;
  if (n && typeof n == "object" && !Array.isArray(n)) {
    if (n.kind === void 0) {
      let o = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (n.question === void 0) {
      let o = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "question" }, message: "must have required property 'question'" };
      e === null ? e = [o] : e.push(o), s++;
    }
    for (let o in n) if (!(o === "kind" || o === "id" || o === "build" || o === "supersedes" || o === "question" || o === "about")) {
      let a = { instancePath: r, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: o }, message: "must NOT have additional properties" };
      e === null ? e = [a] : e.push(a), s++;
    }
    if (n.kind !== void 0 && n.kind !== "question") {
      let o = { instancePath: r + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "question" }, message: "must be equal to constant" };
      e === null ? e = [o] : e.push(o), s++;
    }
    if (n.id !== void 0) {
      let o = n.id;
      if (typeof o == "string") {
        if (!P.test(o)) {
          let a = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.build !== void 0) {
      let o = n.build;
      if (typeof o == "string") {
        if (!b.test(o)) {
          let a = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$"' };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.supersedes !== void 0) {
      let o = n.supersedes;
      if (typeof o == "string") {
        if (!P.test(o)) {
          let a = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.question !== void 0) {
      let o = n.question;
      if (typeof o == "string") {
        if (c(o) < 1) {
          let a = { instancePath: r + "/question", schemaPath: "#/properties/question/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/question", schemaPath: "#/properties/question/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
    if (n.about !== void 0) {
      let o = n.about;
      if (typeof o == "string") {
        if (c(o) < 1) {
          let a = { instancePath: r + "/about", schemaPath: "journal-entry.schema.json#/definitions/about/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [a] : e.push(a), s++;
        }
      } else {
        let a = { instancePath: r + "/about", schemaPath: "journal-entry.schema.json#/definitions/about/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [a] : e.push(a), s++;
      }
    }
  } else {
    let o = { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [o] : e.push(o), s++;
  }
  return G.errors = e, s === 0;
}
var me = H;
var K = { $schema: "http://json-schema.org/draft-07/schema#", $id: "journal-verdict.schema.json", description: "The retest of an earlier defect on this build.", type: "object", properties: { kind: { const: "verdict" }, id: { $ref: "journal-entry.schema.json#/definitions/id" }, build: { $ref: "journal-entry.schema.json#/definitions/build" }, supersedes: { $ref: "journal-entry.schema.json#/definitions/supersedes" }, defect: { description: "The ID of the earlier defect or issue.", type: "string", minLength: 1 }, result: { description: "The result of the retest.", enum: ["fixed", "not_fixed"] }, saw: { description: "What you saw.", type: "string", minLength: 1 }, evidence: { $ref: "journal-entry.schema.json#/definitions/evidence" } }, required: ["kind", "build", "defect", "result"], additionalProperties: false };
function H(n, { instancePath: r = "", parentData: g, parentDataProperty: k, rootData: w = n } = {}) {
  let e = null, s = 0;
  if (n && typeof n == "object" && !Array.isArray(n)) {
    if (n.kind === void 0) {
      let a = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      e === null ? e = [a] : e.push(a), s++;
    }
    if (n.build === void 0) {
      let a = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "build" }, message: "must have required property 'build'" };
      e === null ? e = [a] : e.push(a), s++;
    }
    if (n.defect === void 0) {
      let a = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "defect" }, message: "must have required property 'defect'" };
      e === null ? e = [a] : e.push(a), s++;
    }
    if (n.result === void 0) {
      let a = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "result" }, message: "must have required property 'result'" };
      e === null ? e = [a] : e.push(a), s++;
    }
    for (let a in n) if (!(a === "kind" || a === "id" || a === "build" || a === "supersedes" || a === "defect" || a === "result" || a === "saw" || a === "evidence")) {
      let t = { instancePath: r, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: a }, message: "must NOT have additional properties" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.kind !== void 0 && n.kind !== "verdict") {
      let a = { instancePath: r + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "verdict" }, message: "must be equal to constant" };
      e === null ? e = [a] : e.push(a), s++;
    }
    if (n.id !== void 0) {
      let a = n.id;
      if (typeof a == "string") {
        if (!P.test(a)) {
          let t = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [t] : e.push(t), s++;
        }
      } else {
        let t = { instancePath: r + "/id", schemaPath: "journal-entry.schema.json#/definitions/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [t] : e.push(t), s++;
      }
    }
    if (n.build !== void 0) {
      let a = n.build;
      if (typeof a == "string") {
        if (!b.test(a)) {
          let t = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$"' };
          e === null ? e = [t] : e.push(t), s++;
        }
      } else {
        let t = { instancePath: r + "/build", schemaPath: "journal-entry.schema.json#/definitions/build/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [t] : e.push(t), s++;
      }
    }
    if (n.supersedes !== void 0) {
      let a = n.supersedes;
      if (typeof a == "string") {
        if (!P.test(a)) {
          let t = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [t] : e.push(t), s++;
        }
      } else {
        let t = { instancePath: r + "/supersedes", schemaPath: "journal-entry.schema.json#/definitions/supersedes/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [t] : e.push(t), s++;
      }
    }
    if (n.defect !== void 0) {
      let a = n.defect;
      if (typeof a == "string") {
        if (c(a) < 1) {
          let t = { instancePath: r + "/defect", schemaPath: "#/properties/defect/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [t] : e.push(t), s++;
        }
      } else {
        let t = { instancePath: r + "/defect", schemaPath: "#/properties/defect/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [t] : e.push(t), s++;
      }
    }
    if (n.result !== void 0) {
      let a = n.result;
      if (!(a === "fixed" || a === "not_fixed")) {
        let t = { instancePath: r + "/result", schemaPath: "#/properties/result/enum", keyword: "enum", params: { allowedValues: K.properties.result.enum }, message: "must be equal to one of the allowed values" };
        e === null ? e = [t] : e.push(t), s++;
      }
    }
    if (n.saw !== void 0) {
      let a = n.saw;
      if (typeof a == "string") {
        if (c(a) < 1) {
          let t = { instancePath: r + "/saw", schemaPath: "#/properties/saw/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [t] : e.push(t), s++;
        }
      } else {
        let t = { instancePath: r + "/saw", schemaPath: "#/properties/saw/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [t] : e.push(t), s++;
      }
    }
    if (n.evidence !== void 0) {
      let a = n.evidence, t = s, i = false, m = s;
      if (typeof a == "string") {
        if (c(a) < 1) {
          let d = { instancePath: r + "/evidence", schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/0/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [d] : e.push(d), s++;
        }
      } else {
        let d = { instancePath: r + "/evidence", schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [d] : e.push(d), s++;
      }
      var o = m === s;
      if (i = i || o, !i) {
        let d = s;
        if (Array.isArray(a)) {
          if (a.length < 1) {
            let l = { instancePath: r + "/evidence", schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/1/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
            e === null ? e = [l] : e.push(l), s++;
          }
          let h = a.length;
          for (let l = 0; l < h; l++) {
            let u = a[l];
            if (typeof u == "string") {
              if (c(u) < 1) {
                let f = { instancePath: r + "/evidence/" + l, schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/1/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                e === null ? e = [f] : e.push(f), s++;
              }
            } else {
              let f = { instancePath: r + "/evidence/" + l, schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/1/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              e === null ? e = [f] : e.push(f), s++;
            }
          }
        } else {
          let h = { instancePath: r + "/evidence", schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf/1/type", keyword: "type", params: { type: "array" }, message: "must be array" };
          e === null ? e = [h] : e.push(h), s++;
        }
        var o = d === s;
        i = i || o;
      }
      if (i) s = t, e !== null && (t ? e.length = t : e = null);
      else {
        let d = { instancePath: r + "/evidence", schemaPath: "journal-entry.schema.json#/definitions/evidence/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
        e === null ? e = [d] : e.push(d), s++;
      }
    }
  } else {
    let a = { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [a] : e.push(a), s++;
  }
  return H.errors = e, s === 0;
}
var ue = Y;
var j = { $schema: "http://json-schema.org/draft-07/schema#", $id: "profile.schema.json", type: "object", properties: { contractVersion: { const: "toolkit-2" }, targetId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, revision: { type: "integer", minimum: 1 }, entryPoints: { type: "array", items: { type: "object", properties: { name: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, kind: { enum: ["url", "command", "value"] }, purpose: { type: "string", minLength: 1 } }, required: ["name", "kind", "purpose"], additionalProperties: false }, minItems: 1, uniqueItems: true }, capabilities: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, tools: { type: "array", items: { type: "object", properties: { name: { type: "string", minLength: 1 }, kind: { enum: ["cli", "mcp", "skill"] }, purpose: { type: "string", minLength: 1 }, version: { type: "string", minLength: 1 }, reachable: { type: "boolean" } }, required: ["name", "kind", "purpose", "reachable"], additionalProperties: false }, minItems: 0, uniqueItems: true }, authentication: { type: "object", properties: { kind: { enum: ["none", "environment", "browser_session"] }, references: { type: "array", items: { type: "string", minLength: 1 }, minItems: 0, uniqueItems: true } }, required: ["kind", "references"], additionalProperties: false }, allowedOperations: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, minItems: 1, uniqueItems: true }, startup: { type: "object", properties: { owner: { enum: ["factory", "checkmate"] }, command: { anyOf: [{ type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true }, { type: "null" }] } }, required: ["owner", "command"], additionalProperties: false }, cleanup: { type: "string", minLength: 1 }, reset: { type: "object", properties: { owner: { enum: ["factory", "checkmate"] }, command: { anyOf: [{ type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true }, { type: "null" }] } }, required: ["owner", "command"], additionalProperties: false }, readyForLiveExecution: { type: "boolean" }, approvals: { type: "object", properties: { plan: { enum: ["required", "none"] }, result: { enum: ["required", "none"] } }, required: ["plan", "result"], additionalProperties: false } }, required: ["contractVersion", "targetId", "revision", "entryPoints", "capabilities", "tools", "authentication", "allowedOperations", "startup", "cleanup", "readyForLiveExecution"], additionalProperties: false };
var D = x().default;
function Y(n, { instancePath: r = "", parentData: g, parentDataProperty: k, rootData: w = n } = {}) {
  let e = null, s = 0;
  if (n && typeof n == "object" && !Array.isArray(n)) {
    if (n.contractVersion === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "contractVersion" }, message: "must have required property 'contractVersion'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.targetId === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "targetId" }, message: "must have required property 'targetId'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.revision === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "revision" }, message: "must have required property 'revision'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.entryPoints === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entryPoints" }, message: "must have required property 'entryPoints'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.capabilities === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "capabilities" }, message: "must have required property 'capabilities'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.tools === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "tools" }, message: "must have required property 'tools'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.authentication === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "authentication" }, message: "must have required property 'authentication'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.allowedOperations === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "allowedOperations" }, message: "must have required property 'allowedOperations'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.startup === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "startup" }, message: "must have required property 'startup'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.cleanup === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "cleanup" }, message: "must have required property 'cleanup'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.readyForLiveExecution === void 0) {
      let t = { instancePath: r, schemaPath: "#/required", keyword: "required", params: { missingProperty: "readyForLiveExecution" }, message: "must have required property 'readyForLiveExecution'" };
      e === null ? e = [t] : e.push(t), s++;
    }
    for (let t in n) if (!L.call(j.properties, t)) {
      let i = { instancePath: r, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: t }, message: "must NOT have additional properties" };
      e === null ? e = [i] : e.push(i), s++;
    }
    if (n.contractVersion !== void 0 && n.contractVersion !== "toolkit-2") {
      let t = { instancePath: r + "/contractVersion", schemaPath: "#/properties/contractVersion/const", keyword: "const", params: { allowedValue: "toolkit-2" }, message: "must be equal to constant" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.targetId !== void 0) {
      let t = n.targetId;
      if (typeof t == "string") {
        if (!P.test(t)) {
          let i = { instancePath: r + "/targetId", schemaPath: "#/properties/targetId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/targetId", schemaPath: "#/properties/targetId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.revision !== void 0) {
      let t = n.revision;
      if (!(typeof t == "number" && !(t % 1) && !isNaN(t) && isFinite(t))) {
        let i = { instancePath: r + "/revision", schemaPath: "#/properties/revision/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        e === null ? e = [i] : e.push(i), s++;
      }
      if (typeof t == "number" && isFinite(t) && (t < 1 || isNaN(t))) {
        let i = { instancePath: r + "/revision", schemaPath: "#/properties/revision/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.entryPoints !== void 0) {
      let t = n.entryPoints;
      if (Array.isArray(t)) {
        if (t.length < 1) {
          let p = { instancePath: r + "/entryPoints", schemaPath: "#/properties/entryPoints/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [p] : e.push(p), s++;
        }
        let i = t.length;
        for (let p = 0; p < i; p++) {
          let h = t[p];
          if (h && typeof h == "object" && !Array.isArray(h)) {
            if (h.name === void 0) {
              let l = { instancePath: r + "/entryPoints/" + p, schemaPath: "#/properties/entryPoints/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
              e === null ? e = [l] : e.push(l), s++;
            }
            if (h.kind === void 0) {
              let l = { instancePath: r + "/entryPoints/" + p, schemaPath: "#/properties/entryPoints/items/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
              e === null ? e = [l] : e.push(l), s++;
            }
            if (h.purpose === void 0) {
              let l = { instancePath: r + "/entryPoints/" + p, schemaPath: "#/properties/entryPoints/items/required", keyword: "required", params: { missingProperty: "purpose" }, message: "must have required property 'purpose'" };
              e === null ? e = [l] : e.push(l), s++;
            }
            for (let l in h) if (!(l === "name" || l === "kind" || l === "purpose")) {
              let u = { instancePath: r + "/entryPoints/" + p, schemaPath: "#/properties/entryPoints/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: l }, message: "must NOT have additional properties" };
              e === null ? e = [u] : e.push(u), s++;
            }
            if (h.name !== void 0) {
              let l = h.name;
              if (typeof l == "string") {
                if (!P.test(l)) {
                  let u = { instancePath: r + "/entryPoints/" + p + "/name", schemaPath: "#/properties/entryPoints/items/properties/name/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
                  e === null ? e = [u] : e.push(u), s++;
                }
              } else {
                let u = { instancePath: r + "/entryPoints/" + p + "/name", schemaPath: "#/properties/entryPoints/items/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [u] : e.push(u), s++;
              }
            }
            if (h.kind !== void 0) {
              let l = h.kind;
              if (!(l === "url" || l === "command" || l === "value")) {
                let u = { instancePath: r + "/entryPoints/" + p + "/kind", schemaPath: "#/properties/entryPoints/items/properties/kind/enum", keyword: "enum", params: { allowedValues: j.properties.entryPoints.items.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [u] : e.push(u), s++;
              }
            }
            if (h.purpose !== void 0) {
              let l = h.purpose;
              if (typeof l == "string") {
                if (c(l) < 1) {
                  let u = { instancePath: r + "/entryPoints/" + p + "/purpose", schemaPath: "#/properties/entryPoints/items/properties/purpose/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [u] : e.push(u), s++;
                }
              } else {
                let u = { instancePath: r + "/entryPoints/" + p + "/purpose", schemaPath: "#/properties/entryPoints/items/properties/purpose/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [u] : e.push(u), s++;
              }
            }
          } else {
            let l = { instancePath: r + "/entryPoints/" + p, schemaPath: "#/properties/entryPoints/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
        let m = t.length, d;
        if (m > 1) {
          e: for (; m--; ) for (d = m; d--; ) if (D(t[m], t[d])) {
            let p = { instancePath: r + "/entryPoints", schemaPath: "#/properties/entryPoints/uniqueItems", keyword: "uniqueItems", params: { i: m, j: d }, message: "must NOT have duplicate items (items ## " + d + " and " + m + " are identical)" };
            e === null ? e = [p] : e.push(p), s++;
            break e;
          }
        }
      } else {
        let i = { instancePath: r + "/entryPoints", schemaPath: "#/properties/entryPoints/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.capabilities !== void 0) {
      let t = n.capabilities;
      if (Array.isArray(t)) {
        if (t.length < 1) {
          let p = { instancePath: r + "/capabilities", schemaPath: "#/properties/capabilities/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [p] : e.push(p), s++;
        }
        let i = t.length;
        for (let p = 0; p < i; p++) {
          let h = t[p];
          if (typeof h == "string") {
            if (!P.test(h)) {
              let l = { instancePath: r + "/capabilities/" + p, schemaPath: "#/properties/capabilities/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [l] : e.push(l), s++;
            }
          } else {
            let l = { instancePath: r + "/capabilities/" + p, schemaPath: "#/properties/capabilities/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
        let m = t.length, d;
        if (m > 1) {
          let p = {};
          for (; m--; ) {
            let h = t[m];
            if (typeof h == "string") {
              if (typeof p[h] == "number") {
                d = p[h];
                let l = { instancePath: r + "/capabilities", schemaPath: "#/properties/capabilities/uniqueItems", keyword: "uniqueItems", params: { i: m, j: d }, message: "must NOT have duplicate items (items ## " + d + " and " + m + " are identical)" };
                e === null ? e = [l] : e.push(l), s++;
                break;
              }
              p[h] = m;
            }
          }
        }
      } else {
        let i = { instancePath: r + "/capabilities", schemaPath: "#/properties/capabilities/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.tools !== void 0) {
      let t = n.tools;
      if (Array.isArray(t)) {
        if (t.length < 0) {
          let p = { instancePath: r + "/tools", schemaPath: "#/properties/tools/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
          e === null ? e = [p] : e.push(p), s++;
        }
        let i = t.length;
        for (let p = 0; p < i; p++) {
          let h = t[p];
          if (h && typeof h == "object" && !Array.isArray(h)) {
            if (h.name === void 0) {
              let l = { instancePath: r + "/tools/" + p, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
              e === null ? e = [l] : e.push(l), s++;
            }
            if (h.kind === void 0) {
              let l = { instancePath: r + "/tools/" + p, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
              e === null ? e = [l] : e.push(l), s++;
            }
            if (h.purpose === void 0) {
              let l = { instancePath: r + "/tools/" + p, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "purpose" }, message: "must have required property 'purpose'" };
              e === null ? e = [l] : e.push(l), s++;
            }
            if (h.reachable === void 0) {
              let l = { instancePath: r + "/tools/" + p, schemaPath: "#/properties/tools/items/required", keyword: "required", params: { missingProperty: "reachable" }, message: "must have required property 'reachable'" };
              e === null ? e = [l] : e.push(l), s++;
            }
            for (let l in h) if (!(l === "name" || l === "kind" || l === "purpose" || l === "version" || l === "reachable")) {
              let u = { instancePath: r + "/tools/" + p, schemaPath: "#/properties/tools/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: l }, message: "must NOT have additional properties" };
              e === null ? e = [u] : e.push(u), s++;
            }
            if (h.name !== void 0) {
              let l = h.name;
              if (typeof l == "string") {
                if (c(l) < 1) {
                  let u = { instancePath: r + "/tools/" + p + "/name", schemaPath: "#/properties/tools/items/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [u] : e.push(u), s++;
                }
              } else {
                let u = { instancePath: r + "/tools/" + p + "/name", schemaPath: "#/properties/tools/items/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [u] : e.push(u), s++;
              }
            }
            if (h.kind !== void 0) {
              let l = h.kind;
              if (!(l === "cli" || l === "mcp" || l === "skill")) {
                let u = { instancePath: r + "/tools/" + p + "/kind", schemaPath: "#/properties/tools/items/properties/kind/enum", keyword: "enum", params: { allowedValues: j.properties.tools.items.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                e === null ? e = [u] : e.push(u), s++;
              }
            }
            if (h.purpose !== void 0) {
              let l = h.purpose;
              if (typeof l == "string") {
                if (c(l) < 1) {
                  let u = { instancePath: r + "/tools/" + p + "/purpose", schemaPath: "#/properties/tools/items/properties/purpose/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [u] : e.push(u), s++;
                }
              } else {
                let u = { instancePath: r + "/tools/" + p + "/purpose", schemaPath: "#/properties/tools/items/properties/purpose/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [u] : e.push(u), s++;
              }
            }
            if (h.version !== void 0) {
              let l = h.version;
              if (typeof l == "string") {
                if (c(l) < 1) {
                  let u = { instancePath: r + "/tools/" + p + "/version", schemaPath: "#/properties/tools/items/properties/version/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [u] : e.push(u), s++;
                }
              } else {
                let u = { instancePath: r + "/tools/" + p + "/version", schemaPath: "#/properties/tools/items/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [u] : e.push(u), s++;
              }
            }
            if (h.reachable !== void 0 && typeof h.reachable != "boolean") {
              let l = { instancePath: r + "/tools/" + p + "/reachable", schemaPath: "#/properties/tools/items/properties/reachable/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
              e === null ? e = [l] : e.push(l), s++;
            }
          } else {
            let l = { instancePath: r + "/tools/" + p, schemaPath: "#/properties/tools/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
        let m = t.length, d;
        if (m > 1) {
          e: for (; m--; ) for (d = m; d--; ) if (D(t[m], t[d])) {
            let p = { instancePath: r + "/tools", schemaPath: "#/properties/tools/uniqueItems", keyword: "uniqueItems", params: { i: m, j: d }, message: "must NOT have duplicate items (items ## " + d + " and " + m + " are identical)" };
            e === null ? e = [p] : e.push(p), s++;
            break e;
          }
        }
      } else {
        let i = { instancePath: r + "/tools", schemaPath: "#/properties/tools/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.authentication !== void 0) {
      let t = n.authentication;
      if (t && typeof t == "object" && !Array.isArray(t)) {
        if (t.kind === void 0) {
          let i = { instancePath: r + "/authentication", schemaPath: "#/properties/authentication/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        if (t.references === void 0) {
          let i = { instancePath: r + "/authentication", schemaPath: "#/properties/authentication/required", keyword: "required", params: { missingProperty: "references" }, message: "must have required property 'references'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        for (let i in t) if (!(i === "kind" || i === "references")) {
          let m = { instancePath: r + "/authentication", schemaPath: "#/properties/authentication/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: i }, message: "must NOT have additional properties" };
          e === null ? e = [m] : e.push(m), s++;
        }
        if (t.kind !== void 0) {
          let i = t.kind;
          if (!(i === "none" || i === "environment" || i === "browser_session")) {
            let m = { instancePath: r + "/authentication/kind", schemaPath: "#/properties/authentication/properties/kind/enum", keyword: "enum", params: { allowedValues: j.properties.authentication.properties.kind.enum }, message: "must be equal to one of the allowed values" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        if (t.references !== void 0) {
          let i = t.references;
          if (Array.isArray(i)) {
            if (i.length < 0) {
              let h = { instancePath: r + "/authentication/references", schemaPath: "#/properties/authentication/properties/references/minItems", keyword: "minItems", params: { limit: 0 }, message: "must NOT have fewer than 0 items" };
              e === null ? e = [h] : e.push(h), s++;
            }
            let m = i.length;
            for (let h = 0; h < m; h++) {
              let l = i[h];
              if (typeof l == "string") {
                if (c(l) < 1) {
                  let u = { instancePath: r + "/authentication/references/" + h, schemaPath: "#/properties/authentication/properties/references/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [u] : e.push(u), s++;
                }
              } else {
                let u = { instancePath: r + "/authentication/references/" + h, schemaPath: "#/properties/authentication/properties/references/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [u] : e.push(u), s++;
              }
            }
            let d = i.length, p;
            if (d > 1) {
              let h = {};
              for (; d--; ) {
                let l = i[d];
                if (typeof l == "string") {
                  if (typeof h[l] == "number") {
                    p = h[l];
                    let u = { instancePath: r + "/authentication/references", schemaPath: "#/properties/authentication/properties/references/uniqueItems", keyword: "uniqueItems", params: { i: d, j: p }, message: "must NOT have duplicate items (items ## " + p + " and " + d + " are identical)" };
                    e === null ? e = [u] : e.push(u), s++;
                    break;
                  }
                  h[l] = d;
                }
              }
            }
          } else {
            let m = { instancePath: r + "/authentication/references", schemaPath: "#/properties/authentication/properties/references/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
      } else {
        let i = { instancePath: r + "/authentication", schemaPath: "#/properties/authentication/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.allowedOperations !== void 0) {
      let t = n.allowedOperations;
      if (Array.isArray(t)) {
        if (t.length < 1) {
          let p = { instancePath: r + "/allowedOperations", schemaPath: "#/properties/allowedOperations/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          e === null ? e = [p] : e.push(p), s++;
        }
        let i = t.length;
        for (let p = 0; p < i; p++) {
          let h = t[p];
          if (typeof h == "string") {
            if (!P.test(h)) {
              let l = { instancePath: r + "/allowedOperations/" + p, schemaPath: "#/properties/allowedOperations/items/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$" }, message: 'must match pattern "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"' };
              e === null ? e = [l] : e.push(l), s++;
            }
          } else {
            let l = { instancePath: r + "/allowedOperations/" + p, schemaPath: "#/properties/allowedOperations/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            e === null ? e = [l] : e.push(l), s++;
          }
        }
        let m = t.length, d;
        if (m > 1) {
          let p = {};
          for (; m--; ) {
            let h = t[m];
            if (typeof h == "string") {
              if (typeof p[h] == "number") {
                d = p[h];
                let l = { instancePath: r + "/allowedOperations", schemaPath: "#/properties/allowedOperations/uniqueItems", keyword: "uniqueItems", params: { i: m, j: d }, message: "must NOT have duplicate items (items ## " + d + " and " + m + " are identical)" };
                e === null ? e = [l] : e.push(l), s++;
                break;
              }
              p[h] = m;
            }
          }
        }
      } else {
        let i = { instancePath: r + "/allowedOperations", schemaPath: "#/properties/allowedOperations/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.startup !== void 0) {
      let t = n.startup;
      if (t && typeof t == "object" && !Array.isArray(t)) {
        if (t.owner === void 0) {
          let i = { instancePath: r + "/startup", schemaPath: "#/properties/startup/required", keyword: "required", params: { missingProperty: "owner" }, message: "must have required property 'owner'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        if (t.command === void 0) {
          let i = { instancePath: r + "/startup", schemaPath: "#/properties/startup/required", keyword: "required", params: { missingProperty: "command" }, message: "must have required property 'command'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        for (let i in t) if (!(i === "owner" || i === "command")) {
          let m = { instancePath: r + "/startup", schemaPath: "#/properties/startup/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: i }, message: "must NOT have additional properties" };
          e === null ? e = [m] : e.push(m), s++;
        }
        if (t.owner !== void 0) {
          let i = t.owner;
          if (!(i === "factory" || i === "checkmate")) {
            let m = { instancePath: r + "/startup/owner", schemaPath: "#/properties/startup/properties/owner/enum", keyword: "enum", params: { allowedValues: j.properties.startup.properties.owner.enum }, message: "must be equal to one of the allowed values" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        if (t.command !== void 0) {
          let i = t.command, m = s, d = false, p = s;
          if (Array.isArray(i)) {
            if (i.length < 1) {
              let f = { instancePath: r + "/startup/command", schemaPath: "#/properties/startup/properties/command/anyOf/0/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
              e === null ? e = [f] : e.push(f), s++;
            }
            let h = i.length;
            for (let f = 0; f < h; f++) {
              let y = i[f];
              if (typeof y == "string") {
                if (c(y) < 1) {
                  let v = { instancePath: r + "/startup/command/" + f, schemaPath: "#/properties/startup/properties/command/anyOf/0/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [v] : e.push(v), s++;
                }
              } else {
                let v = { instancePath: r + "/startup/command/" + f, schemaPath: "#/properties/startup/properties/command/anyOf/0/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [v] : e.push(v), s++;
              }
            }
            let l = i.length, u;
            if (l > 1) {
              let f = {};
              for (; l--; ) {
                let y = i[l];
                if (typeof y == "string") {
                  if (typeof f[y] == "number") {
                    u = f[y];
                    let v = { instancePath: r + "/startup/command", schemaPath: "#/properties/startup/properties/command/anyOf/0/uniqueItems", keyword: "uniqueItems", params: { i: l, j: u }, message: "must NOT have duplicate items (items ## " + u + " and " + l + " are identical)" };
                    e === null ? e = [v] : e.push(v), s++;
                    break;
                  }
                  f[y] = l;
                }
              }
            }
          } else {
            let h = { instancePath: r + "/startup/command", schemaPath: "#/properties/startup/properties/command/anyOf/0/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            e === null ? e = [h] : e.push(h), s++;
          }
          var o = p === s;
          if (d = d || o, !d) {
            let h = s;
            if (i !== null) {
              let u = { instancePath: r + "/startup/command", schemaPath: "#/properties/startup/properties/command/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
              e === null ? e = [u] : e.push(u), s++;
            }
            var o = h === s;
            d = d || o;
          }
          if (d) s = m, e !== null && (m ? e.length = m : e = null);
          else {
            let h = { instancePath: r + "/startup/command", schemaPath: "#/properties/startup/properties/command/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
            e === null ? e = [h] : e.push(h), s++;
          }
        }
      } else {
        let i = { instancePath: r + "/startup", schemaPath: "#/properties/startup/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.cleanup !== void 0) {
      let t = n.cleanup;
      if (typeof t == "string") {
        if (c(t) < 1) {
          let i = { instancePath: r + "/cleanup", schemaPath: "#/properties/cleanup/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          e === null ? e = [i] : e.push(i), s++;
        }
      } else {
        let i = { instancePath: r + "/cleanup", schemaPath: "#/properties/cleanup/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.reset !== void 0) {
      let t = n.reset;
      if (t && typeof t == "object" && !Array.isArray(t)) {
        if (t.owner === void 0) {
          let i = { instancePath: r + "/reset", schemaPath: "#/properties/reset/required", keyword: "required", params: { missingProperty: "owner" }, message: "must have required property 'owner'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        if (t.command === void 0) {
          let i = { instancePath: r + "/reset", schemaPath: "#/properties/reset/required", keyword: "required", params: { missingProperty: "command" }, message: "must have required property 'command'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        for (let i in t) if (!(i === "owner" || i === "command")) {
          let m = { instancePath: r + "/reset", schemaPath: "#/properties/reset/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: i }, message: "must NOT have additional properties" };
          e === null ? e = [m] : e.push(m), s++;
        }
        if (t.owner !== void 0) {
          let i = t.owner;
          if (!(i === "factory" || i === "checkmate")) {
            let m = { instancePath: r + "/reset/owner", schemaPath: "#/properties/reset/properties/owner/enum", keyword: "enum", params: { allowedValues: j.properties.reset.properties.owner.enum }, message: "must be equal to one of the allowed values" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        if (t.command !== void 0) {
          let i = t.command, m = s, d = false, p = s;
          if (Array.isArray(i)) {
            if (i.length < 1) {
              let f = { instancePath: r + "/reset/command", schemaPath: "#/properties/reset/properties/command/anyOf/0/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
              e === null ? e = [f] : e.push(f), s++;
            }
            let h = i.length;
            for (let f = 0; f < h; f++) {
              let y = i[f];
              if (typeof y == "string") {
                if (c(y) < 1) {
                  let v = { instancePath: r + "/reset/command/" + f, schemaPath: "#/properties/reset/properties/command/anyOf/0/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  e === null ? e = [v] : e.push(v), s++;
                }
              } else {
                let v = { instancePath: r + "/reset/command/" + f, schemaPath: "#/properties/reset/properties/command/anyOf/0/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                e === null ? e = [v] : e.push(v), s++;
              }
            }
            let l = i.length, u;
            if (l > 1) {
              let f = {};
              for (; l--; ) {
                let y = i[l];
                if (typeof y == "string") {
                  if (typeof f[y] == "number") {
                    u = f[y];
                    let v = { instancePath: r + "/reset/command", schemaPath: "#/properties/reset/properties/command/anyOf/0/uniqueItems", keyword: "uniqueItems", params: { i: l, j: u }, message: "must NOT have duplicate items (items ## " + u + " and " + l + " are identical)" };
                    e === null ? e = [v] : e.push(v), s++;
                    break;
                  }
                  f[y] = l;
                }
              }
            }
          } else {
            let h = { instancePath: r + "/reset/command", schemaPath: "#/properties/reset/properties/command/anyOf/0/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            e === null ? e = [h] : e.push(h), s++;
          }
          var a = p === s;
          if (d = d || a, !d) {
            let h = s;
            if (i !== null) {
              let u = { instancePath: r + "/reset/command", schemaPath: "#/properties/reset/properties/command/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
              e === null ? e = [u] : e.push(u), s++;
            }
            var a = h === s;
            d = d || a;
          }
          if (d) s = m, e !== null && (m ? e.length = m : e = null);
          else {
            let h = { instancePath: r + "/reset/command", schemaPath: "#/properties/reset/properties/command/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
            e === null ? e = [h] : e.push(h), s++;
          }
        }
      } else {
        let i = { instancePath: r + "/reset", schemaPath: "#/properties/reset/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
    if (n.readyForLiveExecution !== void 0 && typeof n.readyForLiveExecution != "boolean") {
      let t = { instancePath: r + "/readyForLiveExecution", schemaPath: "#/properties/readyForLiveExecution/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      e === null ? e = [t] : e.push(t), s++;
    }
    if (n.approvals !== void 0) {
      let t = n.approvals;
      if (t && typeof t == "object" && !Array.isArray(t)) {
        if (t.plan === void 0) {
          let i = { instancePath: r + "/approvals", schemaPath: "#/properties/approvals/required", keyword: "required", params: { missingProperty: "plan" }, message: "must have required property 'plan'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        if (t.result === void 0) {
          let i = { instancePath: r + "/approvals", schemaPath: "#/properties/approvals/required", keyword: "required", params: { missingProperty: "result" }, message: "must have required property 'result'" };
          e === null ? e = [i] : e.push(i), s++;
        }
        for (let i in t) if (!(i === "plan" || i === "result")) {
          let m = { instancePath: r + "/approvals", schemaPath: "#/properties/approvals/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: i }, message: "must NOT have additional properties" };
          e === null ? e = [m] : e.push(m), s++;
        }
        if (t.plan !== void 0) {
          let i = t.plan;
          if (!(i === "required" || i === "none")) {
            let m = { instancePath: r + "/approvals/plan", schemaPath: "#/properties/approvals/properties/plan/enum", keyword: "enum", params: { allowedValues: j.properties.approvals.properties.plan.enum }, message: "must be equal to one of the allowed values" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
        if (t.result !== void 0) {
          let i = t.result;
          if (!(i === "required" || i === "none")) {
            let m = { instancePath: r + "/approvals/result", schemaPath: "#/properties/approvals/properties/result/enum", keyword: "enum", params: { allowedValues: j.properties.approvals.properties.result.enum }, message: "must be equal to one of the allowed values" };
            e === null ? e = [m] : e.push(m), s++;
          }
        }
      } else {
        let i = { instancePath: r + "/approvals", schemaPath: "#/properties/approvals/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        e === null ? e = [i] : e.push(i), s++;
      }
    }
  } else {
    let t = { instancePath: r, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    e === null ? e = [t] : e.push(t), s++;
  }
  return Y.errors = e, s === 0;
}

// plugin/src/contracts.ts
var identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
var Refusal = class extends Error {
  kind;
  hint;
  constructor(kind, message, hint) {
    super(message);
    this.kind = kind;
    this.hint = hint;
  }
};
var refusalReasons = {
  malformed: "Refused: malformed request.",
  prohibited: "Refused: prohibited in the current state."
};
function refused(status, subject, error) {
  const refusal = status === "invalid_request" ? "malformed" : error instanceof Refusal ? error.kind : "prohibited";
  const hint = error instanceof Refusal ? error.hint : void 0;
  return {
    status,
    subject,
    reasons: [refusalReasons[refusal], error instanceof Error ? error.message : String(error)],
    refusal,
    ...hint ? { hint } : {},
    data: {}
  };
}
function requireCondition(condition, message, hint) {
  if (!condition) throw new Refusal("prohibited", message, hint);
}
function requireWellFormed(condition, message, hint) {
  if (!condition) throw new Refusal("malformed", message, hint);
}
function same(a, b2) {
  return canonical(a) === canonical(b2);
}
function schemaProblems(name, value2, prefix = name) {
  const check = validators_exports[name.replace(/-./g, (match) => match[1].toUpperCase())];
  if (check(value2)) return [];
  return unionErrors(check.errors ?? []).filter((error) => error.keyword !== "propertyNames").map((error) => ({
    field: String(
      error.instancePath.split("/")[1] ?? error.params.missingProperty ?? error.params.additionalProperty ?? ""
    ),
    text: schemaError(`${prefix}${error.instancePath}`, error),
    unknown: error.keyword === "additionalProperties",
    ...error.keyword === "enum" ? { choices: (error.params.allowedValues ?? []).map(String) } : {}
  }));
}
function schemaErrors(name, value2, prefix = name) {
  return schemaProblems(name, value2, prefix).map((problem) => problem.text);
}
function validate(name, value2, hint) {
  const errors = schemaErrors(name, value2);
  requireWellFormed(
    !errors.length,
    `Invalid ${name}: ${errors.join(", ")}`,
    hint ?? `Fix each named field and send the ${name} again. The schema is contracts/${name}.schema.json in the plugin.`
  );
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
  if (error.keyword === "required") return `${path} needs field "${error.params.missingProperty}"`;
  if (error.keyword === "enum") return `${path} must be one of: ${error.params.allowedValues?.join(", ")}`;
  if (error.propertyName !== void 0) return `${path} field name "${error.propertyName}" ${error.message}`;
  return `${path} ${error.message}`;
}
function requireIdentifier(value2, name) {
  requireWellFormed(
    typeof value2 === "string" && identifier.test(value2),
    `Invalid ${name}: ${String(value2)}. Use 1 to 96 letters, digits, _ or -, starting with a letter or digit.`
  );
  return value2;
}
function requireText(value2, name) {
  requireWellFormed(typeof value2 === "string" && value2.trim().length > 0, `Missing ${name}`);
  return value2;
}
function requireChoice(value2, choices, name) {
  requireWellFormed(
    choices.includes(value2),
    `Invalid ${name}: ${String(value2)}. Use one of: ${choices.join(", ")}.`
  );
  return value2;
}
function revisionReference(text, name) {
  const [id2, revision, ...rest] = text.split("@");
  requireIdentifier(id2, name);
  requireWellFormed(
    !rest.length && (revision === void 0 || /^[1-9][0-9]*$/.test(revision)),
    `Invalid ${name}: ${text}. Use <id> or <id>@<revision>.`
  );
  return { id: id2, revision: revision === void 0 ? null : Number(revision) };
}
function index(items, key, name, hint) {
  const map = /* @__PURE__ */ new Map();
  for (const item of items) {
    requireWellFormed(!map.has(item[key]), `Duplicate ${name}: ${String(item[key])}`, hint);
    map.set(item[key], item);
  }
  return map;
}
function profileCheck(value2) {
  const profile = validate("profile", value2);
  index(profile.tools, "name", "tool");
  index(profile.entryPoints, "name", "entry point");
  for (const tool of profile.tools)
    requireWellFormed(
      tool.version === void 0 || !/resolve-and-pin|unknown/i.test(tool.version),
      `Record the actual version of ${tool.name}, or leave version out`
    );
  return profile;
}
function approvalPolicy(profile) {
  return profile.approvals ?? { plan: "required", result: "required" };
}
function unusedId(prefix, used) {
  let number = 1;
  while (used.includes(`${prefix}${number}`)) number++;
  return `${prefix}${number}`;
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
  requireCondition(
    row,
    `Unknown target profile: ${targetId}${revision === null ? "" : `@${revision}`}`,
    `Run checkmate target list to read the saved targets of this workspace: ${store.workspace}.`
  );
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
  const names2 = Object.keys(instance.entries);
  const missing = entryPoints.filter((entry) => !names2.includes(entry.name)).map((entry) => entry.name);
  const unknown = names2.filter((name) => !entryPoints.some((entry) => entry.name === name));
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
  const references = (instance.references ?? []).map((reference) => requireText(reference, "reference").trim());
  const repeated = references.find((reference, i) => references.indexOf(reference) !== i);
  requireCondition(repeated === void 0, `Reference ${repeated} is given twice`);
  return {
    entries,
    ...instance.environment === void 0 ? {} : { environment: requireText(instance.environment, "environment").trim() },
    references
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
    return {
      reply: completed(subject, { instanceId: input.instanceId, recorded: true }),
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

// plugin/contracts/journal-entry.schema.json
var journal_entry_schema_default = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "journal-entry.schema.json",
  description: "Checkmate saves each valid entry, and refuses each invalid entry alone. Nothing is deleted.",
  type: "object",
  properties: {
    kind: {
      description: "The kind.",
      enum: ["criterion", "observation", "defect", "question", "verdict", "note", "issue"]
    },
    id: {
      $ref: "journal-entry.schema.json#/definitions/id"
    },
    build: {
      $ref: "journal-entry.schema.json#/definitions/build"
    },
    supersedes: {
      $ref: "journal-entry.schema.json#/definitions/supersedes"
    }
  },
  required: ["kind"],
  examples: [
    [
      {
        kind: "criterion",
        id: "C1",
        text: "5 or more items get 10% off.",
        source: "ticket.md#AC2"
      },
      {
        kind: "observation",
        id: "O1",
        about: "C1",
        steps: "Add 4 pens in the cart",
        saw: "Total 40.00",
        value: "40.00",
        verdict: "ok",
        via: "ui"
      },
      {
        kind: "defect",
        id: "D1",
        title: "No discount at 5 items",
        expected: "45.00 (AC2)",
        actual: "Total 50.00",
        severity: "high",
        links: ["C1"],
        steps: "Add 5 pens in the cart",
        value: "50.00",
        via: "ui",
        evidence: "evidence/cart-5.png"
      }
    ]
  ],
  definitions: {
    id: {
      description: "Your ID, for example D1. Without it, Checkmate gives one.",
      type: "string",
      pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"
    },
    build: {
      description: "The build that you tested, for example base or b1. Give it here or with --build.",
      type: "string",
      pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$"
    },
    supersedes: {
      description: "The ID of an earlier entry of the same kind. This entry replaces it and keeps its ID.",
      type: "string",
      pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"
    },
    about: {
      description: "A criterion ID, a question ID, a diff area, or free text.",
      type: "string",
      minLength: 1
    },
    area: {
      description: "A changed area, for example src/cart.js.",
      type: "string",
      minLength: 1
    },
    steps: {
      description: "What you did.",
      anyOf: [
        {
          type: "string",
          minLength: 1
        },
        {
          type: "array",
          items: {
            type: "string",
            minLength: 1
          },
          minItems: 1
        }
      ]
    },
    saw: {
      description: "What you saw.",
      type: "string",
      minLength: 1
    },
    value: {
      description: "The exact value to compare on a later build, for example 45.00 or HTTP 409.",
      type: "string",
      minLength: 1
    },
    via: {
      description: "The entry point that you used.",
      enum: ["ui", "api", "code", "other"]
    },
    evidence: {
      description: "A workspace file or the text that you saw, or an array of them.",
      anyOf: [
        {
          type: "string",
          minLength: 1
        },
        {
          type: "array",
          items: {
            type: "string",
            minLength: 1
          },
          minItems: 1
        }
      ]
    }
  }
};

// plugin/contracts/journal-criterion.schema.json
var journal_criterion_schema_default = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "journal-criterion.schema.json",
  description: "A rule or an acceptance criterion that the change must meet.",
  type: "object",
  properties: {
    kind: {
      const: "criterion"
    },
    id: {
      $ref: "journal-entry.schema.json#/definitions/id"
    },
    build: {
      $ref: "journal-entry.schema.json#/definitions/build"
    },
    supersedes: {
      $ref: "journal-entry.schema.json#/definitions/supersedes"
    },
    text: {
      description: "The rule.",
      type: "string",
      minLength: 1
    },
    source: {
      description: "Where the rule comes from, for example ticket.md#AC2 or a question ID.",
      type: "string",
      minLength: 1
    },
    area: {
      $ref: "journal-entry.schema.json#/definitions/area"
    }
  },
  required: ["kind", "text"],
  additionalProperties: false
};

// plugin/contracts/journal-observation.schema.json
var journal_observation_schema_default = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "journal-observation.schema.json",
  description: "What you did and what you saw. A value on base makes a baseline. Checkmate compares it on each later build.",
  type: "object",
  properties: {
    kind: {
      const: "observation"
    },
    id: {
      $ref: "journal-entry.schema.json#/definitions/id"
    },
    build: {
      $ref: "journal-entry.schema.json#/definitions/build"
    },
    supersedes: {
      $ref: "journal-entry.schema.json#/definitions/supersedes"
    },
    about: {
      $ref: "journal-entry.schema.json#/definitions/about"
    },
    steps: {
      $ref: "journal-entry.schema.json#/definitions/steps"
    },
    saw: {
      $ref: "journal-entry.schema.json#/definitions/saw"
    },
    value: {
      $ref: "journal-entry.schema.json#/definitions/value"
    },
    repeats: {
      description: "The ID of an earlier observation that you did again. Without it, Checkmate links a value to the one earlier value with the same about and steps, or the same ID without the build name (total-b1, total-base). none: no link.",
      type: "string",
      pattern: "^[A-Za-z0-9][A-Za-z0-9_/-]{0,191}$"
    },
    verdict: {
      description: "ok when the result is correct. wrong when it is not.",
      enum: ["ok", "wrong"]
    },
    via: {
      $ref: "journal-entry.schema.json#/definitions/via"
    },
    evidence: {
      $ref: "journal-entry.schema.json#/definitions/evidence"
    },
    confirms: {
      description: "The ID of an issue or a defect that you did again and saw, for example a1/D3. On the build where it was found, it confirms the issue. On a later build, it sets the status of the issue on that build to not_fixed.",
      type: "string",
      minLength: 1
    },
    refutes: {
      description: "The ID of an issue or a defect that you did again and did not see. On the build where it was found, it refutes the issue. On a later build, it sets the status of the issue on that build to fixed.",
      type: "string",
      minLength: 1
    }
  },
  required: ["kind", "build", "saw"],
  additionalProperties: false,
  examples: [
    {
      kind: "observation",
      confirms: "a1/D3",
      steps: "Add 5 pens in the cart",
      saw: "Total 50.00, no discount",
      via: "ui",
      evidence: "evidence/cart-5.png"
    }
  ]
};

// plugin/contracts/journal-defect.schema.json
var journal_defect_schema_default = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "journal-defect.schema.json",
  description: "A thing that is wrong on this build. With saw, value, or via, it is also the observation that shows it: do not log that observation again.",
  type: "object",
  properties: {
    kind: {
      const: "defect"
    },
    id: {
      $ref: "journal-entry.schema.json#/definitions/id"
    },
    build: {
      $ref: "journal-entry.schema.json#/definitions/build"
    },
    supersedes: {
      $ref: "journal-entry.schema.json#/definitions/supersedes"
    },
    title: {
      description: "What is wrong.",
      type: "string",
      minLength: 1
    },
    expected: {
      description: "The correct result and its source.",
      type: "string",
      minLength: 1
    },
    actual: {
      description: "What you saw.",
      type: "string",
      minLength: 1
    },
    severity: {
      description: "The severity.",
      enum: ["critical", "high", "medium", "low"]
    },
    about: {
      $ref: "journal-entry.schema.json#/definitions/about"
    },
    steps: {
      $ref: "journal-entry.schema.json#/definitions/steps"
    },
    saw: {
      $ref: "journal-entry.schema.json#/definitions/saw"
    },
    value: {
      $ref: "journal-entry.schema.json#/definitions/value"
    },
    via: {
      $ref: "journal-entry.schema.json#/definitions/via"
    },
    evidence: {
      description: "The file that shows the defect (a screenshot, a response, a log), or the text that you saw.",
      $ref: "journal-entry.schema.json#/definitions/evidence"
    },
    links: {
      description: "The IDs of the observations or criteria that show it.",
      type: "array",
      items: {
        type: "string",
        minLength: 1
      }
    },
    suspected: {
      description: "true when you are not sure.",
      type: "boolean"
    },
    question: {
      description: "The question that settles a suspected defect.",
      type: "string",
      minLength: 1
    }
  },
  required: ["kind", "build", "title", "expected", "actual", "severity"],
  additionalProperties: false
};

// plugin/contracts/journal-question.schema.json
var journal_question_schema_default = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "journal-question.schema.json",
  description: "A question for the PM. The PM answers before the next build. Ask one question in each entry. Ask about each rule, limit, and case that the sources leave open.",
  type: "object",
  properties: {
    kind: {
      const: "question"
    },
    id: {
      $ref: "journal-entry.schema.json#/definitions/id"
    },
    build: {
      $ref: "journal-entry.schema.json#/definitions/build"
    },
    supersedes: {
      $ref: "journal-entry.schema.json#/definitions/supersedes"
    },
    question: {
      description: "The question.",
      type: "string",
      minLength: 1
    },
    about: {
      $ref: "journal-entry.schema.json#/definitions/about"
    }
  },
  required: ["kind", "question"],
  additionalProperties: false
};

// plugin/contracts/journal-verdict.schema.json
var journal_verdict_schema_default = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "journal-verdict.schema.json",
  description: "The retest of an earlier defect on this build.",
  type: "object",
  properties: {
    kind: {
      const: "verdict"
    },
    id: {
      $ref: "journal-entry.schema.json#/definitions/id"
    },
    build: {
      $ref: "journal-entry.schema.json#/definitions/build"
    },
    supersedes: {
      $ref: "journal-entry.schema.json#/definitions/supersedes"
    },
    defect: {
      description: "The ID of the earlier defect or issue.",
      type: "string",
      minLength: 1
    },
    result: {
      description: "The result of the retest.",
      enum: ["fixed", "not_fixed"]
    },
    saw: {
      description: "What you saw.",
      type: "string",
      minLength: 1
    },
    evidence: {
      $ref: "journal-entry.schema.json#/definitions/evidence"
    }
  },
  required: ["kind", "build", "defect", "result"],
  additionalProperties: false
};

// plugin/contracts/journal-note.schema.json
var journal_note_schema_default = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "journal-note.schema.json",
  description: "Anything else, for example where you explored.",
  type: "object",
  properties: {
    kind: {
      const: "note"
    },
    id: {
      $ref: "journal-entry.schema.json#/definitions/id"
    },
    build: {
      $ref: "journal-entry.schema.json#/definitions/build"
    },
    supersedes: {
      $ref: "journal-entry.schema.json#/definitions/supersedes"
    },
    text: {
      description: "The note.",
      type: "string",
      minLength: 1
    },
    about: {
      $ref: "journal-entry.schema.json#/definitions/about"
    },
    area: {
      $ref: "journal-entry.schema.json#/definitions/area"
    }
  },
  required: ["kind", "text"],
  additionalProperties: false
};

// plugin/contracts/journal-issue.schema.json
var journal_issue_schema_default = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "journal-issue.schema.json",
  description: "One defect that one or more defect entries report. A defect that is in no issue is its own issue. On a later build, the status of the issue is the result of most verdicts on that build. With a tie, it is fixed and disputed. With one verdict, it is that result and single. An observation of the verifier with confirms or refutes on that build sets the status.",
  type: "object",
  properties: {
    kind: {
      const: "issue"
    },
    id: {
      $ref: "journal-entry.schema.json#/definitions/id"
    },
    build: {
      $ref: "journal-entry.schema.json#/definitions/build"
    },
    supersedes: {
      $ref: "journal-entry.schema.json#/definitions/supersedes"
    },
    title: {
      description: "What is wrong, in one line.",
      type: "string",
      minLength: 1
    },
    severity: {
      description: "The severity.",
      enum: ["critical", "high", "medium", "low"]
    },
    reports: {
      description: "The full IDs of the defect entries that describe this defect, for example a1/D1.",
      type: "array",
      items: {
        type: "string",
        minLength: 1
      },
      minItems: 1
    },
    note: {
      description: "Why these reports are one defect.",
      type: "string",
      minLength: 1
    }
  },
  required: ["kind", "title", "severity", "reports"],
  additionalProperties: false,
  examples: [
    {
      kind: "issue",
      title: "No discount at 5 items",
      severity: "high",
      reports: ["a1/D1", "a3/D2"],
      note: "The same total of 50.00 for 5 items."
    }
  ]
};

// plugin/src/journal.ts
import { existsSync as existsSync2, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
var entryKinds = ["criterion", "observation", "defect", "question", "verdict", "note", "issue"];
var prefixes = {
  criterion: "C",
  observation: "O",
  defect: "D",
  question: "Q",
  verdict: "V",
  note: "N",
  issue: "I",
  answer: "A",
  decision: "R"
};
var capabilityEntryPoints = {
  browser: { via: "ui", idea: "Use the main flows in the browser, as a user does." },
  http: { via: "api", idea: "Send the requests of the main flows to the API, also with invalid input." }
};
var fieldsHint = "Fix the named fields.";
var jsonHint = "Use double quotes for keys and strings. Put a backslash before each quote inside a string.";
var openEnd = /\b(not (yet )?(tested|verified|captured|covered|tried|exercised)|untested|unverified|skipped|todo|to-do|tbd|did ?n[o']t (test|try|check|verify))\b/i;
var sourceWords = new Set(
  "nodecision not decided yet use follow see refer read check the a an and or to existing current ticket tickets doc docs documentation spec specs specification as written is per of in on answer none unknown n/a na pm only rely says say".split(
    " "
  )
);
var sourceMarkers = [
  "nodecision",
  "decided",
  "ticket",
  "tickets",
  "doc",
  "docs",
  "documentation",
  "spec",
  "specs",
  "specification",
  "unknown",
  "none"
];
var maxEvidenceBytes = 32 * 1024 * 1024;
var viaNames = { ui: "the UI", api: "the API", code: "the code", other: "other means" };
var fewBaselines = 3;
var nonTesters = ["merge", "verify"];
var sharedKinds = ["answer", "decision"];
var normalised = (text) => text.trim().replace(/\s+/g, " ").replace(
  /\d+(\.\d+)?/g,
  (number) => number.replace(/^0+(?=\d)/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
);
var shortName = (actor) => actor.slice(actor.lastIndexOf(":") + 1);
var isTester = (actor) => actor !== void 0 && actor.startsWith("qa:") && !nonTesters.includes(shortName(actor));
var refOf = (actor, id2) => `${shortName(actor)}/${id2}`;
var bareOf = (ref) => ref.slice(ref.lastIndexOf("/") + 1);
function changeRow(store, changeId) {
  const row = one(
    store,
    "SELECT change_id, target_id, instance_id FROM changes WHERE change_id = ?",
    changeId
  );
  if (!row) {
    const ids = all(store, "SELECT change_id FROM changes ORDER BY rowid").map(
      (item) => item.change_id
    );
    throw new Refusal(
      "prohibited",
      `Unknown change: ${changeId}. The store ${store.path} has ${ids.length ? `the changes ${ids.join(", ")}` : "no change"}.`,
      "Check the change ID and the directory. To use the store of another project, run the command in that project directory, or set CHECKMATE_WORKSPACE to it, or pass --workspace <path>."
    );
  }
  return { changeId: row.change_id, targetId: row.target_id, instanceId: row.instance_id };
}
function withRefs(entry, name) {
  return {
    ...entry,
    ...entry.about !== void 0 && {
      about: entry.about.split(/([\s,;]+)/).map(name).join("")
    },
    ...entry.links && { links: entry.links.map(name) },
    ...entry.reports && { reports: entry.reports.map(name) },
    ...entry.defect !== void 0 && { defect: name(entry.defect) },
    ...entry.repeats !== void 0 && { repeats: name(entry.repeats) },
    ...entry.confirms !== void 0 && { confirms: name(entry.confirms) },
    ...entry.refutes !== void 0 && { refutes: name(entry.refutes) },
    ...entry.kind === "answer" && { question: name(entry.question) }
  };
}
function journal(store, changeId, viewer) {
  const opened = changeRow(store, changeId);
  const rows = all(
    store,
    `SELECT e.rowid AS seq, e.body, e.actor, o.at FROM journal_entries e LEFT JOIN operations o ON o.id = e.operation_id
		WHERE e.change_id = ? ORDER BY e.rowid`,
    changeId
  ).map((row) => {
    const body = JSON.parse(row.body);
    return { ...body, seq: row.seq, actor: row.actor, at: row.at, ref: refOf(row.actor, body.id) };
  });
  const latest = /* @__PURE__ */ new Map();
  for (const row of rows) latest.set(row.ref, row);
  const seen = (row) => !isTester(viewer) || row.actor === viewer || !isTester(row.actor) || sharedKinds.includes(row.kind);
  const shown = [...latest.values()].filter(seen);
  const full = (row, word) => latest.has(word) ? word : latest.has(refOf(row.actor, word)) ? refOf(row.actor, word) : word;
  const team = shown.map((row) => ({ ...withRefs(row, (word) => full(row, word)), id: row.ref }));
  const uses = /* @__PURE__ */ new Map();
  for (const row of shown) uses.set(row.id, (uses.get(row.id) ?? 0) + 1);
  const idOf = (ref) => {
    const target = latest.get(ref);
    return target && seen(target) && uses.get(target.id) === 1 ? target.id : ref;
  };
  const entries = team.map((entry) => ({
    ...withRefs(entry, (word) => latest.has(word) ? idOf(word) : word),
    id: idOf(entry.id)
  }));
  const visible = rows.filter(seen);
  const named = [...new Set(visible.flatMap((row) => row.build ? [row.build] : []))];
  const builds = named.includes("base") ? ["base", ...named.filter((build) => build !== "base")] : named;
  const vias = targetRequest(store, opened.targetId).capabilities.flatMap((name) => capabilityEntryPoints[name] ?? []);
  const testers = new Set(shown.filter((row) => isTester(row.actor)).map((row) => row.actor));
  return { ...opened, viewer, rows: visible, entries, team, builds, vias, testers: testers.size };
}
function lookup(state, actor) {
  const keys = /* @__PURE__ */ new Map();
  for (const entry of state.team) keys.set(entry.id, entry);
  state.entries.forEach((entry, index2) => keys.set(entry.id, state.team[index2]));
  for (const entry of state.team) if (entry.actor === actor) keys.set(bareOf(entry.id), entry);
  return keys;
}
var storedRef = (target, actor) => target.actor === actor ? bareOf(target.id) : target.id;
var ofKind = (state, kind) => state.entries.filter((entry) => entry.kind === kind);
var words = (about) => (about ?? "").split(/[\s,;]+/).filter(Boolean);
var isAbout = (entry, id2) => entry.about === id2 || words(entry.about).includes(id2);
var sameValue = (a, b2) => normalised(a) === normalised(b2);
var observed = (entry) => entry.saw !== void 0 || entry.value !== void 0 || entry.via !== void 0;
function observationsOf(state) {
  const criteria = new Set(ofKind(state, "criterion").map((entry) => entry.id));
  return state.entries.flatMap((entry) => {
    if (entry.kind === "observation") return [entry];
    if (entry.kind !== "defect") return [];
    const aboutCriterion = words(entry.about).some((id2) => criteria.has(id2));
    if (!observed(entry) && !aboutCriterion) return [];
    const about = [...words(entry.about), ...(entry.links ?? []).filter((id2) => criteria.has(id2))].join(" ");
    return [{ ...entry, saw: entry.saw ?? entry.actual, verdict: "wrong", ...about && { about } }];
  });
}
function answerOf(state, questionId) {
  return ofKind(state, "answer").filter((entry) => entry.question === questionId).at(-1);
}
function openDefects(state) {
  const verdicts = ofKind(state, "verdict");
  return ofKind(state, "defect").filter(
    (defect) => verdicts.filter((verdict) => verdict.defect === defect.id).at(-1)?.result !== "fixed"
  );
}
function openChange(store, actor, input) {
  return write(store, { actor, command: "open", subject: input.changeId, input }, (operationId) => {
    const changeId = requireIdentifier(input.changeId, "change ID");
    targetRequest(store, input.target);
    if (input.instance !== void 0) findInstance(store, input.target, input.instance);
    requireCondition(
      !one(store, "SELECT 1 FROM changes WHERE change_id = ?", changeId),
      `Change ${changeId} is open.`,
      `Run checkmate show ${changeId} to read it. Use a new change ID for another change.`
    );
    execute(
      store,
      "INSERT INTO changes (change_id, target_id, instance_id, operation_id) VALUES (?, ?, ?, ?)",
      changeId,
      input.target,
      input.instance ?? null,
      operationId
    );
    return {
      reply: completed(changeId, {
        changeId,
        targetId: input.target,
        instanceId: input.instance ?? null,
        next: [`After a test session, run checkmate record ${changeId} from outside that session.`]
      }),
      subjects: [`change:${changeId}`]
    };
  });
}
function evidenceFile(store, name) {
  requireWellFormed(name && !isAbsolute(name), `Evidence path must be relative to the workspace: ${name}`);
  const real = realpathSync(resolve(store.workspace, name));
  requireWellFormed(
    real.startsWith(realpathSync(store.workspace) + sep),
    `Evidence file must be inside the workspace: ${name}`
  );
  const stats = statSync(real);
  requireWellFormed(stats.isFile(), `Evidence must be a file: ${name}`);
  requireWellFormed(stats.size <= maxEvidenceBytes, `Evidence file exceeds 32 MiB: ${name}`);
  return readFileSync(real);
}
function entriesFile(store, name, cwd) {
  const path = resolve(cwd, name);
  requireWellFormed(
    existsSync2(path),
    `No entries file: ${name}`,
    "Give --from the path of a JSON file in the workspace."
  );
  requireWellFormed(
    realpathSync(path).startsWith(realpathSync(store.workspace) + sep),
    `Entries file must be inside the workspace: ${name}`,
    "Write the file in the workspace, then give its path to --from."
  );
  return readFileSync(path, "utf8");
}
function evidenceOf(store, spec, cwd) {
  const found = [resolve(cwd, spec), resolve(store.workspace, spec)].find((path) => existsSync2(path));
  if (found) {
    const name = relative(store.workspace, found);
    const bytes = evidenceFile(store, name);
    const sha256 = digest(bytes);
    execute(
      store,
      "INSERT OR IGNORE INTO blobs (sha256, size, bytes) VALUES (?, ?, ?)",
      sha256,
      bytes.length,
      bytes
    );
    return { path: name, sha256, size: bytes.length };
  }
  if (/\s|:\/\//.test(spec.trim()) || !/[/\\]|\.[A-Za-z][A-Za-z0-9]{0,4}$/.test(spec)) return { text: spec };
  throw new Refusal(
    "malformed",
    `Evidence file not found: ${spec}`,
    "Save the file in the workspace first. Or give the text of what you saw."
  );
}
var Unreadable = class {
  reason;
  text;
  constructor(reason, text) {
    this.reason = reason;
    this.text = text;
  }
};
var EntryRefusal = class extends Refusal {
  field;
  fix;
  constructor(field, message, hint, fix) {
    super("malformed", message, hint);
    this.field = field;
    this.fix = fix;
  }
};
function unfenced(text) {
  const fenced = /^\s*```[\w-]*[ \t]*\n([\s\S]*?)\n\s*```\s*$/.exec(text);
  return fenced ? fenced[1] : text;
}
function withoutTrailingCommas(text) {
  const closing = /\s*[}\]]/y;
  let out = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      out += char;
      if (char === "\\") out += text[++i] ?? "";
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    closing.lastIndex = i + 1;
    if (char === "," && closing.test(text)) continue;
    out += char;
  }
  return out;
}
function topLevelParts(text) {
  const found = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === "\\") i++;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") depth--;
    const closed = depth === 0 && (char === "}" || char === "]");
    if (closed || depth === 0 && char === ",") {
      found.push(text.slice(start, closed ? i + 1 : i));
      start = i + 1;
    }
  }
  found.push(text.slice(start));
  return found.map((part) => part.trim()).filter(Boolean);
}
function readEntries(text) {
  requireWellFormed(
    text.trim().length > 0,
    "Missing JSON payload on standard input",
    "Send the entries on standard input, in a quoted heredoc: checkmate log <changeId> --build <build> <<'EOF', the JSON, then EOF"
  );
  const body = withoutTrailingCommas(unfenced(text)).trim();
  try {
    return JSON.parse(body);
  } catch (error) {
    const parts = topLevelParts(body.startsWith("[") && body.endsWith("]") ? body.slice(1, -1) : body);
    if (parts.length < 2)
      throw new Refusal("malformed", `Standard input is not valid JSON: ${error.message}`, jsonHint);
    return parts.flatMap((part) => {
      try {
        return [JSON.parse(part)].flat();
      } catch (error2) {
        return [new Unreadable(error2.message, part)];
      }
    });
  }
}
function entryList(entries) {
  if (Array.isArray(entries)) return entries;
  const wrapper = entries;
  if (wrapper && typeof wrapper === "object" && wrapper.kind === void 0 && Array.isArray(wrapper.entries))
    return wrapper.entries;
  return [entries];
}
function checkedEntry(store, raw, path, build, state, actor, cwd) {
  if (raw instanceof Unreadable)
    throw new EntryRefusal(
      path,
      `${path} is not valid JSON (${raw.reason}): ${raw.text.slice(0, 80)}`,
      `${jsonHint} Send this entry again.`
    );
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new EntryRefusal(path, `${path} is not a JSON object.`, 'Send each entry as a JSON object with "kind".', {
      kind: entryKinds.join("|")
    });
  const given = raw;
  const draft = { ...given };
  if (draft.build === void 0 && build !== void 0) draft.build = build;
  const problems = schemaProblems("journal-entry", draft, path);
  const kind = String(draft.kind);
  if (!problems.length) problems.push(...schemaProblems(`journal-${kind}`, draft, path));
  if (problems.length) {
    const fix = { ...given };
    for (const problem of problems)
      if (problem.unknown) delete fix[problem.field];
      else fix[problem.field] = problem.choices?.join("|") ?? `<${problem.field}>`;
    throw new EntryRefusal(
      [...new Set(problems.map((problem) => `${path}.${problem.field}`))].join(", "),
      problems.map((problem) => problem.text).join(", "),
      problems.some((problem) => problem.field === "build") ? "Give the build in the entry, or with --build on the call." : fieldsHint,
      fix
    );
  }
  const entry = draft;
  const known = lookup(state, actor);
  const used = [...known.keys()];
  if (entry.supersedes !== void 0) {
    const earlier = known.get(entry.supersedes);
    if (earlier?.actor !== actor || earlier.kind !== kind || entry.id !== void 0 && entry.id !== bareOf(earlier.id)) {
      const { supersedes: _, ...fix } = given;
      throw new EntryRefusal(
        `${path}.supersedes`,
        `${path}.supersedes names no earlier ${kind}: ${entry.supersedes}.`,
        `Use the ID of an earlier ${kind}, and leave out "id". Run checkmate show to read the IDs.`,
        fix
      );
    }
    entry.id = bareOf(earlier.id);
    entry.supersedes = entry.id;
  } else if (entry.id !== void 0) {
    if (known.has(entry.id)) {
      const free = unusedId(prefixes[entry.kind], used);
      throw new EntryRefusal(
        `${path}.id`,
        `${path}.id ${entry.id} is in use.`,
        `To replace that entry, give "supersedes": "${entry.id}". Or use a new ID, for example ${free}.`,
        { ...given, id: free }
      );
    }
  } else entry.id = unusedId(prefixes[entry.kind], used);
  const refer = (id2, kinds, field, fix) => {
    const target = known.get(id2);
    if (target && kinds.includes(target.kind)) return storedRef(target, actor);
    throw new EntryRefusal(
      `${path}.${field}`,
      `${path}.${field} names no ${kinds.join(" or ")}: ${id2}.`,
      `Use the ID of an earlier ${kinds.join(" or ")}. Run checkmate show to read the IDs.`,
      { ...given, [field]: fix }
    );
  };
  const idsOf = (kinds) => state.entries.filter((item) => kinds.includes(item.kind)).map((item) => item.id).slice(-6).join("|") || `<${kinds.join(" or ")} ID>`;
  const defectOrIssue = ["defect", "issue"];
  if (entry.defect !== void 0) entry.defect = refer(entry.defect, defectOrIssue, "defect", idsOf(["defect"]));
  if (entry.confirms !== void 0)
    entry.confirms = refer(entry.confirms, defectOrIssue, "confirms", idsOf(defectOrIssue));
  if (entry.refutes !== void 0)
    entry.refutes = refer(entry.refutes, defectOrIssue, "refutes", idsOf(defectOrIssue));
  if (entry.repeats !== void 0 && entry.repeats !== "none")
    entry.repeats = refer(entry.repeats, ["observation"], "repeats", idsOf(["observation"]));
  const listed = (field, kinds) => {
    const ids = entry[field];
    if (!ids) return;
    const fix = ids.filter((item) => kinds.includes(known.get(item)?.kind));
    entry[field] = ids.map((item) => refer(item, kinds, field, field === "links" ? fix : idsOf(kinds)));
  };
  listed("links", ["observation", "criterion"]);
  listed("reports", ["defect"]);
  if (entry.about !== void 0)
    entry.about = entry.about.split(/([\s,;]+)/).map((word) => {
      const target = known.get(word);
      return target ? storedRef(target, actor) : word;
    }).join("");
  const { evidence, ...rest } = entry;
  if (evidence === void 0) return rest;
  try {
    return { ...rest, evidence: [evidence].flat().map((spec) => evidenceOf(store, spec, cwd)) };
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    throw new EntryRefusal(`${path}.evidence`, error.message, error.hint ?? "", {
      ...given,
      evidence: "<a file in the workspace, or the text that you saw>"
    });
  }
}
var stepsOf = (entry) => normalised([entry.steps ?? []].flat().join(" ").toLowerCase());
var aboutOf = (entry) => normalised((entry.about ?? "").toLowerCase());
var escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var stemOf = (entry) => entry.id.replace(new RegExp(`[-_.]${escaped(entry.build ?? "")}$`, "i"), "");
function baselineMatch(entry, entries, builds) {
  const position = builds.indexOf(entry.build ?? "");
  const order = (item) => builds.indexOf(item.build ?? "");
  const observations = entries.filter((item) => item.kind === "observation");
  const byId = new Map(observations.map((item) => [item.id, item]));
  const earlier = observations.filter(
    (item) => item.value !== void 0 && order(item) >= 0 && order(item) < position
  );
  const stem = stemOf(entry);
  const rule = (item) => stem !== entry.id && stemOf(item) === stem ? "the same ID without the build name" : stepsOf(entry) && stepsOf(item) === stepsOf(entry) && aboutOf(item) === aboutOf(entry) ? "the same about and steps" : void 0;
  const matches = earlier.filter(rule);
  const roots = [...new Set(matches.map((item) => rootOf(item, byId).id))];
  if (roots.length !== 1) return { ambiguous: roots };
  const chain = earlier.filter((item) => rootOf(item, byId).id === roots[0]).sort((a, b2) => order(a) - order(b2));
  const latest = chain.at(-1);
  return { to: latest, rule: rule(latest) ?? rule(matches[0]), ambiguous: [] };
}
function insert(store, changeId, entry, actor, operationId) {
  execute(
    store,
    "INSERT INTO journal_entries (change_id, entry_id, kind, build, body, actor, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    changeId,
    entry.id,
    entry.kind,
    entry.build ?? null,
    canonical(entry),
    actor,
    operationId
  );
}
var fixText = (item) => item.fix ? ` Send: ${JSON.stringify(item.fix)}` : "";
function logEntries(store, actor, input) {
  const { cwd, ...logged } = input;
  const operation = { actor, command: "log", subject: input.changeId, input: logged };
  return write(store, operation, (operationId, _, actor2) => {
    const { changeId } = changeRow(store, input.changeId);
    const list2 = entryList(input.entries);
    requireCondition(list2.length, "The array has no entry.", "Send one entry, or an array of entries.");
    const saved = [];
    const refused2 = [];
    for (const [index2, raw] of list2.entries()) {
      const state = journal(store, changeId, actor2);
      const builds = [...state.builds];
      let entry;
      try {
        entry = checkedEntry(store, raw, `[${index2}]`, input.build, state, actor2, cwd ?? store.workspace);
      } catch (error) {
        if (!(error instanceof EntryRefusal)) throw error;
        refused2.push({ index: index2, field: error.field, reason: error.message, hint: error.hint, fix: error.fix });
        continue;
      }
      if (entry.build !== void 0 && !builds.includes(entry.build))
        if (entry.build === "base") builds.unshift("base");
        else builds.push(entry.build);
      if (entry.repeats === "none") delete entry.repeats;
      else if (["observation", "defect"].includes(entry.kind) && entry.value !== void 0 && entry.repeats === void 0) {
        const match = baselineMatch(entry, state.entries, builds);
        if (match.to) {
          entry.repeats = storedRef(lookup(state, actor2).get(match.to.id), actor2);
          entry.linked = match.rule;
        }
      }
      insert(store, changeId, entry, actor2, operationId);
      saved.push({ index: index2, id: entry.id, kind: entry.kind, build: entry.build ?? null });
    }
    if (!saved.length)
      throw new Refusal(
        "malformed",
        refused2.map((item) => `${item.reason}.${fixText(item)}`).join(" "),
        [...new Set(refused2.flatMap((item) => item.hint ?? []))].join(" ")
      );
    return {
      reply: completed(changeId, { saved, refused: refused2 }),
      subjects: [`change:${changeId}`]
    };
  });
}
function rootOf(entry, byId) {
  let at = entry;
  const seen = /* @__PURE__ */ new Set();
  while (at.repeats && byId.has(at.repeats) && !seen.has(at.id)) {
    seen.add(at.id);
    at = byId.get(at.repeats);
  }
  return at;
}
var short = (text) => (text ?? "").length > 120 ? `${(text ?? "").slice(0, 117)}...` : text ?? "";
function decides(answer) {
  const words4 = answer.toLowerCase().replace(/\bno (decision|answer)\b/g, "nodecision").split(/[^a-z/]+/).filter(Boolean);
  return !(words4.every((word) => sourceWords.has(word)) && words4.some((word) => sourceMarkers.includes(word)));
}
function gapList(state, build) {
  const gaps = [];
  const keys = /* @__PURE__ */ new Set();
  const add = (key, kind, subject, idea) => {
    if (keys.has(key)) return;
    keys.add(key);
    gaps.push({ kind, subject, idea });
  };
  const order = (entry) => state.builds.indexOf(entry.build ?? "");
  const position = state.builds.includes(build) ? state.builds.indexOf(build) : state.builds.length;
  const earlier = (entry) => entry.build !== void 0 && order(entry) >= 0 && order(entry) < position;
  const first = (state.builds[0] ?? build) === build;
  const observations = ofKind(state, "observation");
  const here = observationsOf(state).filter((entry) => entry.build === build);
  const defects = ofKind(state, "defect");
  const notes = ofKind(state, "note");
  const criteria = ofKind(state, "criterion");
  const areas = [...new Set([...criteria, ...notes].flatMap((entry) => entry.area ?? []))];
  const aboutArea = (entry, area) => Boolean(entry.about?.includes(area)) || criteria.some((criterion) => criterion.area === area && isAbout(entry, criterion.id));
  const explained = (id2) => defects.some((defect) => defect.id === id2 || defect.links?.includes(id2)) || notes.some((note) => isAbout(note, id2));
  const byId = new Map(observations.map((entry) => [entry.id, entry]));
  const baselines = observations.filter((entry) => entry.value !== void 0 && !entry.repeats && earlier(entry));
  const repeatsOf = (baseline) => here.filter((entry) => entry.id !== baseline.id && rootOf(entry, byId).id === baseline.id);
  const missingVia = (seen) => state.vias.find(({ via }) => !seen.some((entry) => entry.via === via));
  const usedVias = (seen) => [...new Set(seen.flatMap((entry) => entry.via ? [viaNames[entry.via] ?? entry.via] : []))].join(" and ");
  for (const baseline of baselines) {
    const previous = observations.filter((entry) => entry.value !== void 0 && earlier(entry) && rootOf(entry, byId).id === baseline.id).sort((a, b2) => order(a) - order(b2)).at(-1);
    for (const entry of repeatsOf(baseline).filter((item) => item.value !== void 0))
      if (!sameValue(entry.value, previous.value) && !explained(entry.id))
        add(
          entry.id,
          "difference",
          `${entry.id} repeats ${baseline.id}: ${previous.build} "${previous.value}", ${build} "${entry.value}"`,
          `Explain or report: log a note with "about": "${entry.id}", or a defect with "links": ["${entry.id}"].`
        );
  }
  for (const baseline of baselines.filter((entry) => !repeatsOf(entry).length))
    add(
      baseline.id,
      "baseline",
      `${baseline.id} on ${baseline.build}: ${baseline.value}`,
      `Do it again on ${build}: ${short([baseline.steps ?? baseline.saw].flat().join(" "))}. Log the value with "repeats": "${baseline.id}".`
    );
  if (first) {
    const measured = here.filter((entry) => entry.kind === "observation" && entry.value !== void 0);
    if (measured.length < fewBaselines)
      add(
        "baselines",
        "baselines",
        `${measured.length} baseline${measured.length === 1 ? "" : "s"} on ${build}`,
        "Existing rules near the change can break. Give a value to an observation of each: the same totals and calculations, validation and error messages, lists, exports, and counters that show the changed data, permissions, and the rules in the docs for the same page or endpoint."
      );
    for (const area of areas.filter((item) => !measured.some((entry) => aboutArea(entry, item))))
      add(
        `baseline ${area}`,
        "baseline_area",
        area,
        `No baseline is about this area. Measure an existing rule of it on ${build}, and log an observation with "about": "${area}" and "value".`
      );
  }
  for (const entry of here.filter(
    (item) => item.kind === "observation" && item.verdict === "wrong" && !explained(item.id)
  ))
    add(
      entry.id,
      "wrong",
      `${entry.id} ${short(entry.saw)}`,
      `Marked wrong without a defect. Log a defect with "links": ["${entry.id}"].`
    );
  for (const defect of defects.filter((entry) => entry.build === build)) {
    const seen = [
      ...observed(defect) ? [defect] : [],
      ...observations.filter((entry) => defect.links?.includes(entry.id) || isAbout(entry, defect.id))
    ];
    const subject = `${defect.id} ${defect.title}`;
    const verify = `Try it on the running app, and log an observation with "about": "${defect.id}".`;
    if (defect.suspected && !seen.some((entry) => entry.via !== "code"))
      add(
        defect.id,
        "unverified",
        subject,
        `Suspected, and no observation shows it on the running app. ${verify}`
      );
    else if (seen.length && seen.every((entry) => entry.via === "code"))
      add(defect.id, "unverified", subject, `Only code observations show it. ${verify}`);
  }
  for (const defect of defects.filter((entry) => entry.build === build && !entry.evidence?.length))
    add(
      defect.id,
      "evidence",
      `${defect.id} ${defect.title}`,
      `No evidence. Log it again with "supersedes": "${defect.id}" and "evidence".`
    );
  for (const entry of state.entries.filter(
    (item) => (item.kind === "note" || item.kind === "observation") && (item.build === build || item.build === void 0) && openEnd.test(item.text ?? item.saw ?? "") && !state.entries.some((other) => other.id !== item.id && isAbout(other, item.id))
  ))
    add(
      entry.id,
      "open_end",
      `${entry.id} ${short(entry.text ?? entry.saw)}`,
      `Your record says that this is open. Test it and log an observation with "about": "${entry.id}".`
    );
  const verdicts = ofKind(state, "verdict");
  for (const defect of defects.filter(earlier)) {
    const of = verdicts.filter((verdict) => verdict.defect === defect.id);
    if (of.some((verdict) => verdict.build === build)) continue;
    if (of.some((verdict) => verdict.result === "fixed" && earlier(verdict))) continue;
    add(
      defect.id,
      "retest",
      `${defect.id} ${defect.title}`,
      `Do its steps again on ${build}. Log a verdict with "defect": "${defect.id}", the result, and evidence.`
    );
  }
  if (!here.length) add(build, "build", build, `No observation on ${build} yet. Test it and log what you see.`);
  if (build === "base")
    for (const entry of here.filter((item) => item.kind === "observation" && item.value === void 0))
      add(
        entry.id,
        "value",
        `${entry.id} ${short(entry.saw)}`,
        `Add a value to make this a baseline: log it again with "supersedes": "${entry.id}" and "value".`
      );
  if (build !== "base") {
    if (!criteria.length)
      add(
        "criteria",
        "criteria",
        "no criterion",
        "You can log the rules of the ticket and the docs as criterion entries. Then each rule shows its open items."
      );
    for (const criterion of criteria) {
      const seen = here.filter((entry) => isAbout(entry, criterion.id));
      const subject = `${criterion.id} ${criterion.text}`;
      const other = missingVia(seen);
      if (!seen.length)
        add(
          criterion.id,
          "criterion",
          subject,
          `No observation on ${build}. Test it and log an observation with "about": "${criterion.id}".`
        );
      else if (seen.length === 1 || seen.every((entry) => entry.verdict === "ok"))
        add(
          criterion.id,
          "happy_path",
          subject,
          `${seen.length === 1 ? "One observation" : "Only ok observations"}${other && usedVias(seen) ? `, only through ${usedVias(seen)}` : ""}. Try a boundary value, invalid input, ${other ? viaNames[other.via] : "the other entry point"}, or the state after a change.`
        );
    }
    for (const area of areas.filter((item) => !here.some((entry) => aboutArea(entry, item))))
      add(
        area,
        "area",
        area,
        `No observation on ${build} is about this changed area. Read its diff and test what it changes.`
      );
    for (const question of ofKind(state, "question")) {
      const answer = answerOf(state, question.id);
      if (answer && decides(answer.answer) && !here.some((entry) => isAbout(entry, question.id)))
        add(
          question.id,
          "answer",
          `${question.id} ${short(answer.answer)}`,
          `No observation on ${build} uses this PM answer. Test it and log an observation with "about": "${question.id}".`
        );
    }
  }
  for (const { via, idea } of state.vias)
    if (!here.some((entry) => entry.via === via))
      add(`via ${via}`, "entry_point", `no observation on ${build} used ${viaNames[via]}`, idea);
  for (const criterion of criteria) {
    const seen = here.filter((entry) => isAbout(entry, criterion.id));
    const other = missingVia(seen);
    if (seen.length && other && usedVias(seen))
      add(criterion.id, "entry_point", `${criterion.id} was observed only through ${usedVias(seen)}`, other.idea);
  }
  if (isTester(state.viewer) || !state.testers) return gaps;
  for (const issue of issueList(state).filter((item) => state.builds.indexOf(item.build) <= position)) {
    const subject = `${issue.id} ${issue.title}`;
    if (!issue.confirmed && !issue.refuted)
      add(
        `unconfirmed ${issue.id}`,
        "unconfirmed",
        subject,
        `One tester reported it, and no other actor confirmed it. Run checkmate verify ${state.changeId} --build ${issue.build}.`
      );
    const statuses = Object.entries(issue.statuses);
    const fixedBefore = statuses.some(([at, on]) => on.status === "fixed" && state.builds.indexOf(at) < position);
    if (issue.statuses[build]?.status === "no verdict" && !fixedBefore)
      add(
        `no_verdict ${issue.id}`,
        "no_verdict",
        subject,
        `No verdict on ${build} names it or one of its reports.`
      );
  }
  return gaps;
}
var evidenceScore = (entry) => (entry.evidence?.length ?? 0) * 2 + (entry.steps ? 1 : 0);
function issueList(state) {
  const team = state.team;
  const defects = new Map(team.filter((entry) => entry.kind === "defect").map((entry) => [entry.id, entry]));
  const recorded = team.filter((entry) => entry.kind === "issue");
  const grouped = new Set(recorded.flatMap((issue) => issue.reports ?? []));
  const groups = [
    ...recorded.map((issue) => ({ issue, reports: (issue.reports ?? []).filter((id2) => defects.has(id2)) })),
    ...[...defects.values()].filter((defect) => !grouped.has(defect.id)).map((defect) => ({ issue: defect, reports: [defect.id] }))
  ].filter((group) => group.reports.length);
  const order = (build) => state.builds.indexOf(build ?? "");
  return groups.map(({ issue, reports }) => {
    const found = reports.map((id2) => defects.get(id2));
    const actors = [...new Set(found.map((defect) => defect.actor))];
    const names2 = [issue.id, ...reports];
    const checks = team.filter(
      (entry) => entry.kind === "observation" && !actors.includes(entry.actor) && names2.some((name) => entry.confirms === name || entry.refutes === name)
    ).sort((a, b2) => a.seq - b2.seq);
    const checkOn = (build) => checks.filter((entry) => entry.build === build).at(-1);
    const confirms = (check) => names2.includes(check.confirms ?? "");
    const best = found.reduce((top, defect) => evidenceScore(defect) > evidenceScore(top) ? defect : top);
    const first = Math.min(...found.map((defect) => order(defect.build)));
    const firstCheck = checkOn(state.builds[first]);
    const verified = !firstCheck ? "none" : confirms(firstCheck) ? "confirmed" : "refuted";
    const confirmed = actors.length > 1 || verified === "confirmed";
    const verdicts = team.filter((entry) => entry.kind === "verdict" && names2.includes(entry.defect ?? "")).sort((a, b2) => a.seq - b2.seq);
    const statusOn = (build) => {
      const results = /* @__PURE__ */ new Map();
      for (const verdict of verdicts.filter((entry) => entry.build === build))
        results.set(verdict.actor, verdict.result);
      const count = (result) => [...results.values()].filter((item) => item === result).length;
      const votes = { fixed: count("fixed"), not_fixed: count("not_fixed") };
      const check = checkOn(build);
      if (check) return { status: confirms(check) ? "not_fixed" : "fixed", votes, basis: "verified" };
      if (!results.size) return { status: "no verdict", votes, basis: "none" };
      if (votes.fixed === votes.not_fixed) return { status: "fixed", votes, basis: "disputed" };
      const status = votes.fixed > votes.not_fixed ? "fixed" : "not_fixed";
      return { status, votes, basis: results.size === 1 ? "single" : "majority" };
    };
    const statuses = Object.fromEntries(
      state.builds.filter((_, index2) => index2 > first).map((build) => [build, statusOn(build)])
    );
    return {
      id: issue.id,
      title: issue.title,
      severity: issue.severity,
      build: state.builds[first],
      expected: best.expected,
      actual: best.actual,
      steps: best.steps ?? null,
      evidence: best.evidence ?? [],
      reports,
      reporters: actors.length,
      actors: actors.map(shortName),
      confirmed,
      refuted: !confirmed && verified === "refuted",
      verified,
      statuses,
      note: issue.note ?? null
    };
  });
}
var issueStatus = (issue) => issue.confirmed ? "confirmed" : issue.refuted ? "refuted" : "unconfirmed";
function changeIssues(store, changeId, build) {
  const state = journal(store, changeId);
  const issues = issueList(state).filter((issue) => build === void 0 || issueBuilds(state, issue).includes(build));
  return completed(state.changeId, { issues });
}
function issueBuilds(state, issue) {
  return state.team.filter((entry) => issue.reports.includes(entry.id)).map((entry) => entry.build);
}
var stopWords = new Set(
  "the and for with not but was are from that this when has have its into than then there should instead".split(" ")
);
var wordsIn = (text) => new Set(
  text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !stopWords.has(word))
);
var wordsOf = (entry) => wordsIn(`${entry.title} ${entry.actual}`);
var stepText = (entry) => [entry.steps ?? []].flat().join(" ");
var overlap = (a, b2) => [...a].filter((word) => b2.has(word)).length / ((/* @__PURE__ */ new Set([...a, ...b2])).size || 1);
var similarWords = 0.5;
var someWords = 0.25;
var mergeLimit = 60;
function pathsOf(entry) {
  const tokens = stepText(entry).toLowerCase().split(/[\s"'()]+/).map(
    (token) => token.replace(/^[a-z]+:\/\/[^/]+/, "").split("?")[0].replace(/[.,;:]+$/, "")
  );
  return new Set(tokens.filter((token) => /^\/[a-z]/.test(token)));
}
function likeness(a, b2) {
  if (overlap(wordsOf(a), wordsOf(b2)) < someWords) return void 0;
  if (!a.steps || !b2.steps) return "some of the same words in title and actual";
  const path = [...pathsOf(a)].find((item) => pathsOf(b2).has(item));
  if (path) return `some of the same words, and the same path ${path}`;
  if (overlap(wordsIn(stepText(a)), wordsIn(stepText(b2))) >= someWords) return "some of the same words and steps";
  return void 0;
}
function criteriaOf(defect, team) {
  const linked = (defect.links ?? []).flatMap((id2) => {
    const target = team.get(id2);
    if (target?.kind === "criterion") return [id2];
    return words(target?.about).filter((word) => team.get(word)?.kind === "criterion");
  });
  const own = words(defect.about).filter((word) => team.get(word)?.kind === "criterion");
  return [.../* @__PURE__ */ new Set([...linked, ...own])];
}
function mergeBuild(store, changeId, build) {
  const state = journal(store, changeId);
  const team = new Map(state.team.map((entry) => [entry.id, entry]));
  const defects = state.team.filter((entry) => entry.kind === "defect" && entry.build === build);
  const listed = defects.map((defect) => ({
    id: defect.id,
    severity: defect.severity,
    title: short(defect.title),
    expected: short(defect.expected),
    actual: short(defect.actual),
    criteria: criteriaOf(defect, team)
  }));
  const onBuild = issueList(state).filter((issue) => issueBuilds(state, issue).includes(build));
  const issues = onBuild.filter((issue) => issue.reports.length > 1 || issue.id !== issue.reports[0]);
  const together = (ids) => issues.some((issue) => ids.every((id2) => issue.reports.includes(id2)));
  const groups = [];
  const suggest = (reports2, reason) => {
    const actors = new Set(reports2.map((id2) => team.get(id2).actor));
    const key = [...reports2].sort().join(",");
    if (actors.size < 2 || together(reports2) || groups.some((group) => [...group.reports].sort().join(",") === key))
      return;
    groups.push({ reports: reports2, reason });
  };
  for (const criterion of [...new Set(listed.flatMap((defect) => defect.criteria))])
    suggest(
      listed.filter((defect) => defect.criteria.includes(criterion)).map((defect) => defect.id),
      `the same criterion ${criterion}`
    );
  const clusters = [];
  const vocabulary = new Map(defects.map((defect) => [defect.id, wordsOf(defect)]));
  for (const [index2, a] of defects.entries())
    for (const b2 of defects.slice(index2 + 1)) {
      if (a.actor === b2.actor || overlap(vocabulary.get(a.id), vocabulary.get(b2.id)) < similarWords) continue;
      const joined = clusters.filter((cluster2) => cluster2.includes(a.id) || cluster2.includes(b2.id));
      const cluster = [.../* @__PURE__ */ new Set([...joined.flat(), a.id, b2.id])];
      clusters.splice(0, clusters.length, ...clusters.filter((item) => !joined.includes(item)), cluster);
    }
  for (const cluster of clusters) suggest(cluster, "many of the same words in title and actual");
  const suggested = new Set(groups.flatMap((group) => group.reports));
  const singles = onBuild.filter((issue) => issue.reporters === 1 && !issue.reports.some((id2) => suggested.has(id2)));
  const larger = [
    ...issues.filter((issue) => issue.reporters > 1).map((issue) => ({ into: issue.id, reports: issue.reports })),
    ...groups.map((group) => ({ into: group.reports.join(","), reports: group.reports }))
  ];
  const candidates = singles.flatMap(
    (single) => larger.flatMap(({ into, reports: reports2 }) => {
      const reason = single.reports.flatMap((id2) => reports2.map((other) => likeness(team.get(id2), team.get(other)))).find(Boolean);
      return reason ? [{ report: single.id, into, reason }] : [];
    })
  );
  const grouped = new Set(issues.flatMap((issue) => issue.reports));
  const reports = groups[0]?.reports ?? defects.slice(0, 2).map((defect) => defect.id);
  const example = { ...journal_issue_schema_default.examples[0], ...reports.length ? { reports } : {} };
  return completed(state.changeId, {
    build,
    total: listed.length,
    defects: listed.slice(0, mergeLimit),
    groups: groups.slice(0, mergeLimit),
    candidates: candidates.slice(0, mergeLimit),
    issues: issues.map(({ id: id2, title, reports: reports2 }) => ({ id: id2, title: short(title), reports: reports2 })),
    ungrouped: defects.filter((defect) => !grouped.has(defect.id)).map((defect) => defect.id),
    command: `checkmate log ${state.changeId} --build ${build}`,
    example
  });
}
function verifyReason(state, issue, build) {
  if (issue.reporters === 1 && issue.verified === "none" && issueBuilds(state, issue).includes(build))
    return "one reporter";
  const basis = issue.statuses[build]?.basis;
  if (basis === "disputed" || basis === "single") return `${basis} verdict`;
  return void 0;
}
function verifyBuild(store, changeId, build) {
  const state = journal(store, changeId);
  const items = issueList(state).flatMap((issue) => {
    const reason = verifyReason(state, issue, build);
    return reason ? [{ ...issue, reason }] : [];
  });
  return completed(state.changeId, {
    build,
    items,
    command: `checkmate log ${state.changeId} --build ${build}`,
    example: journal_observation_schema_default.examples[0]
  });
}
function picked(gaps, limit, perKind) {
  const chosen = /* @__PURE__ */ new Set();
  const count = (kind) => [...chosen].filter((gap) => gap.kind === kind).length;
  for (const gap of gaps) if (chosen.size < limit && !count(gap.kind)) chosen.add(gap);
  for (const gap of gaps) if (chosen.size < limit && count(gap.kind) < perKind) chosen.add(gap);
  return gaps.filter((gap) => chosen.has(gap));
}
function openItems(state, build, limit, perKind = limit) {
  const gaps = gapList(state, build);
  const counts = {};
  for (const gap of gaps) counts[gap.kind] = (counts[gap.kind] ?? 0) + 1;
  return { build, total: gaps.length, counts, gaps: picked(gaps, limit, perKind) };
}
function buildOf(state, build) {
  return build ?? state.builds.at(-1) ?? "base";
}
function changeGaps(store, changeId, build, viewer) {
  const state = journal(store, changeId, viewer);
  const every = viewer === void 0;
  const open = openItems(state, buildOf(state, build), every ? Infinity : 40, every ? Infinity : 8);
  return completed(state.changeId, { ...open, tester: isTester(viewer) });
}
function answerQuestion(store, actor, input) {
  return write(store, { actor, command: "answer", subject: input.changeId, input }, (operationId, _, actor2) => {
    const state = journal(store, input.changeId, actor2);
    const known = lookup(state, actor2);
    const question = known.get(input.questionId);
    requireCondition(
      question?.kind === "question",
      `Unknown question: ${input.questionId}.`,
      `Use one of: ${ofKind(state, "question").map((entry2) => entry2.id).join(", ") || "no question yet"}.`
    );
    const entry = {
      kind: "answer",
      id: unusedId("A", [...known.keys()]),
      question: storedRef(question, actor2),
      answer: requireText(input.answer, "answer (--answer)")
    };
    insert(store, state.changeId, entry, actor2, operationId);
    return {
      reply: completed(state.changeId, { id: entry.id, question: input.questionId }),
      subjects: [`change:${state.changeId}`]
    };
  });
}
function decideBuild(store, actor, input) {
  const command = input.decision === "accepted" ? "accept" : "reject";
  return write(store, { actor, command, subject: input.changeId, input }, (operationId, _, actor2) => {
    const state = journal(store, input.changeId);
    requireCondition(
      state.builds.includes(input.build),
      `Build ${input.build} has no entry in change ${state.changeId}.`,
      `Use one of: ${state.builds.join(", ") || "no build yet"}.`
    );
    const gaps = gapList(state, input.build);
    const entry = {
      kind: "decision",
      id: unusedId("R", [...lookup(state, actor2).keys()]),
      build: input.build,
      decision: input.decision,
      rationale: requireText(input.rationale, "rationale (--rationale)"),
      gaps: gaps.length
    };
    insert(store, state.changeId, entry, actor2, operationId);
    return {
      reply: completed(state.changeId, { id: entry.id, build: input.build, decision: input.decision, gaps }),
      subjects: [`change:${state.changeId}`]
    };
  });
}
function matrix(state) {
  const observations = observationsOf(state);
  const criteria = ofKind(state, "criterion");
  const free = observations.filter((entry) => !criteria.some((criterion) => isAbout(entry, criterion.id)));
  const rows = [
    ...criteria.map((criterion) => ({
      about: criterion.id,
      of: observations.filter((entry) => isAbout(entry, criterion.id))
    })),
    ...[...new Set(free.map((entry) => entry.about ?? "-"))].map((about) => ({
      about,
      of: free.filter((entry) => (entry.about ?? "-") === about)
    }))
  ];
  return rows.map(({ about, of }) => {
    const cells = Object.fromEntries(
      state.builds.map((build) => {
        const seen = of.filter((entry) => entry.build === build);
        const count = (verdict) => seen.filter((entry) => entry.verdict === verdict).length;
        return [build, { ok: count("ok"), wrong: count("wrong"), seen: count(void 0) }];
      })
    );
    return { about, cells };
  });
}
function questionList(state) {
  return ofKind(state, "question").map((question) => {
    const answer = answerOf(state, question.id);
    return {
      id: question.id,
      question: question.question,
      status: answer ? "answered" : "open",
      answer: answer?.answer ?? null
    };
  });
}
function defectList(state) {
  const verdicts = ofKind(state, "verdict");
  return ofKind(state, "defect").map((defect) => ({
    id: defect.id,
    build: defect.build,
    severity: defect.severity,
    title: defect.title,
    suspected: defect.suspected ?? false,
    verdicts: verdicts.filter((verdict) => verdict.defect === defect.id).map((verdict) => ({ id: verdict.id, build: verdict.build, result: verdict.result }))
  }));
}
function changeState(store, changeId, viewer) {
  const state = journal(store, changeId, viewer);
  return {
    changeId: state.changeId,
    targetId: state.targetId,
    instanceId: state.instanceId,
    builds: state.builds,
    criteria: ofKind(state, "criterion").map(({ id: id2, text, source }) => ({
      id: id2,
      text,
      source: source ?? null
    })),
    matrix: matrix(state),
    defects: defectList(state),
    openDefects: openDefects(state).map((defect) => defect.id),
    questions: questionList(state),
    decisions: ofKind(state, "decision").map(({ id: id2, build, decision, rationale, gaps }) => ({
      id: id2,
      build,
      decision,
      rationale,
      gaps
    }))
  };
}
function showChange(store, changeId, viewer) {
  const state = changeState(store, changeId, viewer);
  return completed(state.changeId, state);
}
function exportChange(store, changeId, viewer) {
  const state = journal(store, changeId, viewer);
  const record = {
    ...changeState(store, changeId, viewer),
    entries: state.entries,
    history: state.rows,
    gaps: Object.fromEntries(state.builds.map((build) => [build, gapList(state, build)])),
    issues: issueList(state)
  };
  return JSON.stringify(record, null, "	") + "\n";
}

// plugin/src/guide.ts
var files = {
  "journal-entry.schema.json": journal_entry_schema_default,
  "journal-criterion.schema.json": journal_criterion_schema_default,
  "journal-observation.schema.json": journal_observation_schema_default,
  "journal-defect.schema.json": journal_defect_schema_default,
  "journal-question.schema.json": journal_question_schema_default,
  "journal-verdict.schema.json": journal_verdict_schema_default,
  "journal-note.schema.json": journal_note_schema_default,
  "journal-issue.schema.json": journal_issue_schema_default
};
function resolved(node, file) {
  if (!node.$ref) return [node, file];
  const [path, pointer] = node.$ref.split("#");
  const target = path || file;
  let found = files[target];
  for (const key of pointer.split("/").filter(Boolean)) found = found[key];
  const [inner, at] = resolved(found, target);
  const { $ref, ...own } = node;
  return [{ ...inner, ...own }, at];
}
function fieldsOf(node, file, prefix) {
  return Object.entries(node.properties ?? {}).flatMap(([name, child]) => {
    const [field, at] = resolved(child, file);
    const [items, itemsAt] = field.items ? resolved(field.items, at) : [void 0, at];
    const path = `${prefix}${name}`;
    const type = field.enum ? field.enum.join("|") : items ? `${items.properties ? "object" : items.type ?? "entry"}[]` : field.type ?? "value";
    const row = {
      path,
      type,
      required: Boolean(node.required?.includes(name)),
      description: field.description ?? ""
    };
    const nested = items?.properties ? fieldsOf(items, itemsAt, `${path}[].`) : field.properties ? fieldsOf(field, at, `${path}.`) : [];
    return [row, ...nested];
  });
}
var commonFields = ["kind", "id", "build", "supersedes"];
var teamKinds = ["issue"];
var teamFields = ["confirms", "refutes"];
var guideRoles = ["tester", "recorder", "merger", "verifier"];
function kindSchema(kind, keep) {
  const own = `journal-${kind}.schema.json`;
  return {
    kind,
    about: files[own].description,
    fields: fieldsOf(files[own], own, "").filter((field) => !commonFields.includes(field.path) && keep(field))
  };
}
function commonSchema(kinds) {
  const file = "journal-entry.schema.json";
  return fieldsOf(files[file], file, "").map(
    (field) => field.path === "kind" ? { ...field, type: kinds.join("|") } : field
  );
}
function journalSchema() {
  const entry = files["journal-entry.schema.json"];
  const kinds = entryKinds.filter((kind) => !teamKinds.includes(kind));
  return {
    about: entry.description,
    common: commonSchema(kinds),
    kinds: kinds.map((kind) => kindSchema(kind, (field) => !teamFields.includes(field.path))),
    example: entry.examples[0]
  };
}
function mergerSchema() {
  return {
    about: files["journal-entry.schema.json"].description,
    common: commonSchema(["issue"]),
    kinds: [kindSchema("issue", () => true)],
    example: journal_issue_schema_default.examples[0]
  };
}
function verifierSchema() {
  const kept = ["about", "steps", "saw", "via", "evidence", ...teamFields];
  return {
    about: files["journal-entry.schema.json"].description,
    common: commonSchema(["observation"]),
    kinds: [kindSchema("observation", (field) => kept.includes(field.path))],
    example: journal_observation_schema_default.examples[0]
  };
}
function roleSteps(changeId, role) {
  if (role === "merger")
    return [
      "Do not test. Merge what the testers found.",
      `Run checkmate merge ${changeId} --build <build> to read the defects of all testers.`,
      "Find the defects that two or more reports describe. The suggest lines are ideas, not rules.",
      "Check each defect that only one tester reported against the larger issues before you leave it alone.",
      "Do not combine two defects that have different expected results or different triggers.",
      `Log one issue for each of them: checkmate log ${changeId} --build <build>, with the JSON on standard input in a quoted heredoc.`,
      'A defect that is in no issue is its own issue. To change an issue, log it again with "supersedes".',
      `Run checkmate merge ${changeId} --build <build> again to read the suggestions that remain.`
    ];
  return [
    `Run checkmate verify ${changeId} --build <build> to read the items to verify.`,
    "Reproduce each item on the running application.",
    'Log one observation for each item, with "confirms" or "refutes" and "saw": what you saw.',
    "Do not explore beyond the list."
  ];
}
function journalSteps(changeId, shell) {
  const checkmate = shell?.command ?? "checkmate";
  return [
    shell ? `Log what you did and saw. Write the entries as one JSON array to a new file in ${shell.files} with the Write tool. Then run ${checkmate} log ${changeId} --build <build> --from ${shell.files}/<file>.json. Do not use a heredoc.` : `Log what you did and saw: checkmate log ${changeId} --build <build>, with one entry or a JSON array on standard input in a quoted heredoc.`,
    'With a repository or a merge request, log each changed area that you tested as a note with "area".',
    `Then run ${checkmate} gaps ${changeId} --build <build>. Its lines are ideas, not rules. ${checkmate} show ${changeId} prints the record.`
  ];
}
function recorderPrompt(changeId, build, shell) {
  const checkmate = shell?.command ?? "checkmate";
  return [
    `Now record this session in Checkmate, the QA record of the team (change ${changeId}${build ? `, build ${build}` : ""}). Run \`${checkmate} guide ${changeId}\` first. \`${checkmate} show ${changeId}\` prints what the record already holds.`,
    ...build ? [`Give \`--build ${build}\` to each \`${checkmate} log\` call.`] : [],
    ...shell ? [
      `Write the entries to a file in ${shell.files} with the Write tool, and log them with \`${checkmate} log ${changeId} --from <file>\`. Do not use a heredoc.`
    ] : [],
    "Record what you did and found, your questions for the PM, and the answers that you received. Do not test again for the record, and do not change the files of the project."
  ].join("\n");
}
function guideJournal(store, changeId, role = "tester", viewer, build, shell) {
  const change = changeId ?? "<changeId>";
  if (role === "recorder") {
    if (changeId !== void 0) changeState(store, changeId);
    return completed(changeId ?? "guide", { format: "text", content: recorderPrompt(change, build, shell) });
  }
  if (role !== "tester") {
    if (changeId !== void 0) changeState(store, changeId);
    return completed(changeId ?? "guide", {
      steps: roleSteps(change, role),
      ...role === "merger" ? mergerSchema() : verifierSchema(),
      command: `checkmate log ${change} --build b1`,
      answers: [],
      openDefects: []
    });
  }
  const state = changeId === void 0 ? void 0 : changeState(store, changeId, viewer);
  return completed(changeId ?? "guide", {
    steps: journalSteps(change, shell),
    ...journalSchema(),
    ...shell ? {
      command: `${shell.command} log ${change} --build b1 --from ${shell.files}/entries.json`,
      from: `${shell.files}/entries.json`
    } : { command: `checkmate log ${change} --build b1` },
    answers: (state?.questions ?? []).filter((question) => question.answer !== null),
    openDefects: (state?.defects ?? []).filter((defect) => state.openDefects.includes(defect.id))
  });
}

// plugin/src/views.ts
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
function filterValue(filters, names2) {
  const values = {};
  for (const [name, value2] of Object.entries(filters ?? {})) {
    if (value2 === void 0 || value2 === "") continue;
    requireCondition(name in names2, `Unknown filter: ${name}. Use: ${Object.keys(names2).join(", ")}.`);
    const choices = names2[name];
    if (choices) requireChoice(value2, choices, `${name} filter`);
    values[name] = value2;
  }
  return values;
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

// plugin/src/recorder.ts
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, mkdirSync as mkdirSync2, readdirSync, realpathSync as realpathSync2, rmSync, statSync as statSync2 } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join as join2 } from "node:path";
var defaultRecorderTimeout = 600;
var maxOutputBytes = 4 * 1024 * 1024;
var longestProjectName = 200;
function names(directory2) {
  try {
    return readdirSync(directory2);
  } catch {
    return [];
  }
}
function executableOnPath(name, env) {
  for (const directory2 of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const path = join2(directory2, name);
    try {
      accessSync(path, constants.X_OK);
      if (statSync2(path).isFile()) return path;
    } catch {
    }
  }
  return void 0;
}
function claudeProjectFolders(workspace, env) {
  const projects = join2(env.CLAUDE_CONFIG_DIR?.trim() || join2(homedir(), ".claude"), "projects");
  const name = realpathSync2(workspace).replace(/[^a-zA-Z0-9]/g, "-");
  if (name.length <= longestProjectName) return [join2(projects, name)];
  const prefix = `${name.slice(0, longestProjectName)}-`;
  return names(projects).filter((folder) => folder.startsWith(prefix)).map((folder) => join2(projects, folder));
}
function earlierRecorders(store) {
  return all(
    store,
    "SELECT json_extract(arguments, '$.recorder') AS recorder FROM operations WHERE command = 'record'"
  ).flatMap((row) => row.recorder ? [row.recorder] : []);
}
function latestSession(folders, skip) {
  return folders.flatMap(
    (folder) => names(folder).filter((name) => /^[0-9a-f-]{36}\.jsonl$/i.test(name)).map((name) => ({ id: name.slice(0, -".jsonl".length), at: statSync2(join2(folder, name)).mtimeMs }))
  ).filter((session) => !skip.has(session.id)).sort((a, b2) => b2.at - a.at)[0]?.id;
}
function lastEntry(store) {
  return one(store, "SELECT coalesce(max(rowid), 0) AS seq FROM journal_entries").seq;
}
function addedEntries(store, changeId, actor, after) {
  const rows = all(
    store,
    "SELECT kind, count(*) AS count FROM journal_entries WHERE change_id = ? AND actor = ? AND rowid > ? GROUP BY kind ORDER BY min(rowid)",
    changeId,
    actor,
    after
  );
  return Object.fromEntries(rows.map((row) => [row.kind, row.count]));
}
function claudeResult(output) {
  try {
    const parsed = JSON.parse(output);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function excerpt(text) {
  const line = typeof text === "string" ? text.trim().split("\n")[0].slice(0, 200) : "";
  return line ? `: ${line}` : "";
}
function prepare(store, actor, input, env) {
  const writer = actor?.trim();
  if (!writer) throw new Error("A write needs an actor. Use --actor <name> or set CHECKMATE_ACTOR.");
  if (env.CHECKMATE_RECORDER)
    throw new Refusal(
      "prohibited",
      "A recorder cannot start another recorder. CHECKMATE_RECORDER is set. Nothing changed.",
      "Run checkmate record from outside the recorder session, after the test session."
    );
  changeState(store, input.changeId);
  const claude = executableOnPath("claude", env);
  if (!claude)
    throw new Refusal(
      "prohibited",
      "No claude executable on PATH. Nothing changed.",
      "Install Claude Code, or add the directory of claude to PATH. Then run the command again."
    );
  const folders = claudeProjectFolders(store.workspace, env);
  const skip = /* @__PURE__ */ new Set([
    ...earlierRecorders(store),
    ...env.CLAUDE_CODE_SESSION_ID ? [env.CLAUDE_CODE_SESSION_ID] : []
  ]);
  const session = input.session ?? latestSession(folders, skip);
  if (!session)
    throw new Refusal(
      "prohibited",
      `No Claude Code session of ${store.workspace} in ${folders.join(", ") || "the projects folder of Claude Code"}. Nothing changed.`,
      `Pass the ID of the test session: checkmate record ${input.changeId} --session <sessionId>. claude -p --output-format json gives it in session_id.`
    );
  return { claude, session, recorder: randomUUID(), actor: writer };
}
function recorderArgs(session, recorder, checkmate, files2) {
  return [
    "-p",
    "--resume",
    session,
    "--fork-session",
    "--session-id",
    recorder,
    "--output-format",
    "json",
    "--permission-prompts",
    "none",
    "--allowedTools",
    `Bash(${checkmate} *)`,
    "Read",
    `Edit(/${files2}/**)`
  ];
}
function recordSession(store, actor, input, host) {
  const operation = { actor, command: "record", subject: input.changeId, input };
  let plan;
  try {
    plan = prepare(store, actor, input, host.env);
  } catch (error) {
    return write(store, operation, () => {
      throw error;
    });
  }
  const checkmate = host.script ? `node ${host.script}` : "checkmate";
  const files2 = join2(realpathSync2(store.workspace), ".checkmate", "tmp", `record-${plan.recorder}`);
  mkdirSync2(files2, { recursive: true });
  const after = lastEntry(store);
  const child = spawnSync(plan.claude, recorderArgs(plan.session, plan.recorder, checkmate, files2), {
    cwd: store.workspace,
    env: {
      ...host.env,
      CHECKMATE_WORKSPACE: store.workspace,
      CHECKMATE_ACTOR: plan.actor,
      CHECKMATE_RECORDER: "1",
      CHECKMATE_RECORDER_COMMAND: checkmate,
      CHECKMATE_RECORDER_FILES: files2
    },
    input: recorderPrompt(input.changeId, input.build, { command: checkmate, files: files2 }),
    encoding: "utf8",
    timeout: input.timeoutSeconds * 1e3,
    killSignal: "SIGTERM",
    maxBuffer: maxOutputBytes
  });
  rmSync(files2, { recursive: true, force: true });
  const added = addedEntries(store, input.changeId, plan.actor, after);
  const entries = Object.values(added).reduce((sum, count) => sum + count, 0);
  const result = claudeResult(child.stdout ?? "");
  const code = child.error && "code" in child.error ? String(child.error.code) : void 0;
  const [status, reason] = code === "ETIMEDOUT" ? ["interrupted", `The recorder did not end in ${input.timeoutSeconds} seconds. Checkmate stopped it.`] : code ? ["operational_error", `The recorder failed: ${code}.`] : child.status !== 0 ? [
    "operational_error",
    `The recorder exited with ${child.signal ? `signal ${child.signal}` : `code ${child.status}`}${excerpt(child.stderr || result.result)}`
  ] : result.is_error === true ? ["operational_error", `The recorder ended with an error${excerpt(result.result)}`] : !entries ? ["operational_error", `The recorder added no entry to ${input.changeId}.`] : ["completed", void 0];
  const reply = {
    status,
    subject: input.changeId,
    reasons: reason ? [reason] : [],
    ...reason ? {
      hint: `The entries that the recorder added stay. To read what it did, run claude --resume ${plan.recorder}. Then run checkmate record ${input.changeId} again.`
    } : {},
    data: {
      changeId: input.changeId,
      build: input.build ?? null,
      session: plan.session,
      recorder: typeof result.session_id === "string" ? result.session_id : plan.recorder,
      added,
      entries,
      ...typeof result.total_cost_usd === "number" ? { costUsd: result.total_cost_usd } : {},
      ...typeof result.duration_ms === "number" ? { durationMs: result.duration_ms } : {}
    }
  };
  return write(store, { ...operation, input: { ...input, session: plan.session, recorder: plan.recorder } }, () => ({
    reply,
    subjects: [`change:${input.changeId}`]
  }));
}

// plugin/src/ui/server.ts
import { createServer } from "node:http";
import { randomBytes as randomBytes2, timingSafeEqual } from "node:crypto";
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "node:fs";
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
function html(strings, ...values) {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += piece(values[i]) + strings[i + 1];
  return { html: text };
}
function join3(items, separator) {
  return html`${items.flatMap((item, i) => i ? [separator, item] : [item])}`;
}
var statusLook = {
  passed: ["\u2713", "pass"],
  failed: ["\u2717", "fail"],
  blocked: ["\u2013", "block"],
  ready: ["\u2713", "pass"],
  completed: ["\u2713", "pass"],
  interrupted: ["!", "warn"],
  operational_error: ["!", "fail"],
  rejected: ["\u2717", "fail"],
  active: ["\u25CF", "pass"],
  retired: ["\u2013", "block"],
  rejected_operation: ["\u2717", "fail"],
  needs_decision: ["?", "warn"],
  invalid_request: ["\u2717", "fail"]
};
function words2(status) {
  return status.replace(/_/g, " ");
}
function pill(status, label = words2(status)) {
  const [icon, tone] = statusLook[status] ?? ["\xB7", "muted"];
  return html`<span class="st ${tone}"><span aria-hidden="true">${icon}</span> ${label}</span>`;
}
function short2(sha256) {
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
  return html`<time datetime="${iso}" title="${clock(iso)}">${text}</time>`;
}
function plural(count, one2, many = `${one2}s`) {
  return `${count} ${count === 1 ? one2 : many}`;
}

// plugin/src/ui/layout.ts
var nextTheme = { system: "light", light: "dark", dark: "system" };
var themeIcons = html`<svg class="ti ti-system" viewBox="0 0 16 16" aria-hidden="true">
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
var gear = html`<svg class="gear" viewBox="0 0 16 16" aria-hidden="true">
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
  const current = page.section === "settings" ? html` aria-current="page"` : "";
  return html`<a class="icon-btn" href="/settings" title="Settings" aria-label="Settings" ${current}>${gear}</a>`;
}
function mark() {
  return html`<span class="mark" aria-hidden="true"><i></i><i></i><i class="on"></i><i></i></span>`;
}
function navLink(page, section, href, label) {
  const current = page.section === section ? html` aria-current="page"` : "";
  return html`<li><a href="${href}" ${current}>${label}</a></li>`;
}
function themeForm(context) {
  const next = nextTheme[context.theme];
  return html`<form method="post" action="/theme" class="theme-form" data-theme-form>
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
  const actor = context.actor ? html`<a class="actor" href="/actor?back=${encodeURIComponent(context.path)}" title="Change your name"
				>actor: ${context.actor}</a
			>` : html`<a class="actor" href="/actor?back=${encodeURIComponent(context.path)}">Set your name</a>`;
  return html`<header class="bar">
		<div class="bar-in">
			<a class="brand" href="/">${mark()}<span>checkmate</span></a>
			<nav aria-label="Main">
				<ul class="nav">
					${navLink(page, "log", "/log", "Log")}
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
var shortcuts = html`<aside class="shortcuts" data-shortcuts hidden aria-labelledby="shortcuts-title">
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
		<dt><kbd>Esc</kbd></dt>
		<dd>Close this panel</dd>
		<dt><kbd>?</kbd></dt>
		<dd>Show these shortcuts</dd>
	</dl>
</aside>`;
function layout(context, page) {
  const theme = context.theme === "system" ? "" : html` data-theme="${context.theme}"`;
  return html`<!doctype html>
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
				${context.toast ? html`<div class="toast" role="status" data-toast>${context.toast}</div>` : ""}
				<div class="sr-only" aria-live="polite" data-announcer></div>
				${shortcuts}
			</body>
		</html>`;
}
function heading(title, sub = null, extra = "") {
  return html`<div class="page-head">
		<div>
			<h1>${title}</h1>
			${sub ? html`<p class="sub">${sub}</p>` : ""}
		</div>
		${extra}
	</div>`;
}
function banner(tone, content) {
  return html`<div class="banner ${tone}" role="${tone === "info" ? "status" : "alert"}">${content}</div>`;
}

// plugin/src/ui/lists.ts
var pageSizes2 = [25, 50, 100];
function listState(params, spec) {
  const size = Number(params.get("size"));
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
    size: pageSizes2.includes(size) ? size : 25,
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
    ([value2, label]) => html`<option value="${value2}" ${value2 === selected ? html`selected` : ""}>${label}</option>`
  );
}
function filterChoices(filter, selected) {
  if (!selected || filter.choices.some(([value2]) => value2 === selected)) return filter.choices;
  return [...filter.choices, [selected, selected]];
}
function filterBar(spec, state) {
  const hiddenField = (name, value2, fallback) => html`<input type="hidden" name="${name}" value="${value2}" data-default="${fallback}" />`;
  return html`<form class="filters" method="get" action="${spec.path}" role="search" data-list-form>
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
    (filter) => html`<label class="sr-only" for="filter-${filter.name}">${filter.label}</label>
					<select id="filter-${filter.name}" name="${filter.name}" data-default="">
						${options(filterChoices(filter, state.filters[filter.name] ?? ""), state.filters[filter.name] ?? "")}
					</select>`
  )}
		<label class="sr-only" for="size">Rows per page</label>
		<select id="size" name="size" data-default="25">
			${options(
    pageSizes2.map((size) => [String(size), `${size} rows`]),
    String(state.size)
  )}
		</select>
		${hiddenField("sort", state.sort, spec.sort)} ${hiddenField("dir", state.direction, spec.direction)}
		<button class="btn" data-list-submit>Filter</button>
		<a class="btn ghost" href="${spec.path}" data-list-clear>Clear</a>
	</form>`;
}
function headerCell(spec, state, column) {
  if (!column.sort) return html`<th scope="col">${column.label}</th>`;
  const active = state.sort === column.sort;
  const direction = active ? state.direction === "asc" ? "desc" : "asc" : column.first ?? "asc";
  const href = listHref(spec, state, { sort: column.sort, direction, page: 1 });
  const sorted2 = active ? html` aria-sort="${state.direction === "asc" ? "ascending" : "descending"}"` : "";
  const arrow = active ? state.direction === "asc" ? "\u2191" : "\u2193" : "\u2195";
  return html`<th scope="col" ${sorted2}>
		<a class="sort${active ? " on" : ""}" href="${href}" data-list-link
			>${column.label}<span class="arrow" aria-hidden="true">${arrow}</span></a
		>
	</th>`;
}
function pager(spec, state, total) {
  const last = Math.max(1, Math.ceil(total / state.size));
  if (last === 1) return "";
  const link = (page, label, rel) => page === state.page || page < 1 || page > last ? html`<span class="btn small" aria-disabled="true">${label}</span>` : html`<a class="btn small" href="${listHref(spec, state, { page })}" rel="${rel}" data-list-link
					>${label}</a
				>`;
  return html`<nav class="pager" aria-label="Pages">
		${link(1, "\xAB First", "first")} ${link(state.page - 1, "\u2039 Previous", "prev")}
		<span class="pager-at">Page ${state.page} of ${last}</span>
		${link(state.page + 1, "Next \u203A", "next")} ${link(last, "Last \xBB", "last")}
	</nav>`;
}
function listRegion(spec, state, total, rows, tableClass = "") {
  const first = total ? (state.page - 1) * state.size + 1 : 0;
  const last = Math.min(total, state.page * state.size);
  const count = total ? `Showing ${first}\u2013${last} of ${plural(total, spec.noun)}` : `No ${spec.noun} matches these filters.`;
  return html`<div data-region="${spec.region}" data-list-region>
		<p class="list-count" data-list-count role="status">${count}</p>
		${total ? html`<div class="scroll">
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
function distinct(values) {
  return [...new Set(values)].sort().map((value2) => [value2, value2]);
}
function subjectLink(subject) {
  const [kind, id2] = subject.split(/:(.*)/);
  if (kind === "target") return html`<a class="mono" href="/settings/targets/${id2}">${subject}</a>`;
  return html`<span class="mono">${subject}</span>`;
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
  return html`<tr data-key="op:${row.rowid}">
		<td class="nowrap">${time(row.at)}</td>
		<td>${row.actor}</td>
		<td>
			<span class="mono">${row.command}</span>
			${row.status === "rejected" ? html`<div class="reason">${reasons(row.response).join(" ")}</div>` : ""}
		</td>
		<td>${pill(row.status === "rejected" ? "rejected_operation" : row.status, words2(row.status))}</td>
		<td>
			${row.subjects.length ? join3(row.subjects.map(subjectLink), " ") : html`<span class="muted">none</span>`}
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
    body: html`${heading("Log", "Every write to the workspace.")} ${filterBar(spec, state)}
		${listRegion(spec, state, page.total, page.rows.map(logRow), "log")}`
  };
}

// plugin/src/ui/settings.ts
var settingsPages = [{ path: "/settings/targets", label: "Targets" }];
function settingsNav(current) {
  return html`<nav class="settings-nav" aria-label="Settings pages">
		<ul class="nav">
			${settingsPages.map(
    (page) => html`<li>
						<a href="${page.path}" ${page.path === current ? html`aria-current="page"` : ""}
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
    body: html`${settingsNav(current)} ${body}`
  };
}
function none(text = "none") {
  return html`<span class="muted">${text}</span>`;
}
function words3(items) {
  return items.length ? join3(
    items.map((item) => html`<code>${item}</code>`),
    " "
  ) : none();
}
function targetsPage(store) {
  const targets = targetList(store);
  const rows = targets.map(
    (target) => html`<tr data-key="target:${target.targetId}" data-nav-row>
				<td>
					<a class="mono" href="/settings/targets/${target.targetId}" data-nav-item>${target.targetId}</a>
				</td>
				<td class="mono">${target.revision === null ? none("no profile yet") : `@${target.revision}`}</td>
				<td>${words3(target.capabilities)}</td>
				<td>${words3(target.entryPoints)}</td>
				<td>${target.activeInstances}</td>
			</tr>`
  );
  const body = html`${heading("Targets", "Each target with its latest revision and its active instances.")}
		<div data-region="targets" data-list>
			${targets.length ? html`<div class="scroll">
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
						</div>` : html`<div class="empty">
							<p class="empty-title">No target yet.</p>
							<p>Record one with <code>checkmate target open</code>.</p>
						</div>`}
		</div>`;
  return settingsPage("/settings/targets", "Targets", ["*"], body);
}
function entryPointsTable(entryPoints) {
  return html`<div class="scroll">
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
    (entry) => html`<tr>
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
  if (!profile.tools.length) return html`<p class="empty-line">No tools.</p>`;
  return html`<div class="scroll">
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
    (tool) => html`<tr>
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
  const approvals = profile.approvals ?? { plan: "required", result: "required" };
  return html`<dl class="facts">
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
			<dd>plan <code>${approvals.plan}</code> · result <code>${approvals.result}</code></dd>
		</div>
		<div>
			<dt>Startup</dt>
			<dd>
				${profile.startup.owner}${profile.startup.command ? html` · <code>${profile.startup.command.join(" && ")}</code>` : ""}
			</dd>
		</div>
		<div>
			<dt>Cleanup</dt>
			<dd>${profile.cleanup}</dd>
		</div>
		${profile.reset ? html`<div>
						<dt>Reset</dt>
						<dd>
							${profile.reset.owner}${profile.reset.command ? html` · <code>${profile.reset.command.join(" && ")}</code>` : ""}
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
  if (!revisions.length) return html`<p class="empty-line">No profile yet.</p>`;
  return html`<ol class="history">
		${revisions.map(
    (item) => html`<li class="${item.revision === shown ? "current" : ""}">
					<div class="record-h">
						<a class="mono rev" href="/settings/targets/${targetId}?revision=${item.revision}"
							>${targetId}@${item.revision}</a
						>
						<span class="muted">by ${item.actor} · ${time(item.at)}</span>
						<code class="muted small" title="${item.sha256}">${short2(item.sha256)}</code>
						<span class="muted small"
							>${item.changed.length ? html`changed ${item.changed.join(", ")}` : "first revision"}</span
						>
					</div>
				</li>`
  )}
	</ol>`;
}
function entryList2(instance) {
  return html`<dl class="entries">
		${Object.entries(instance.entries).map(
    ([name, value2]) => html`<div>
					<dt class="mono">${name}</dt>
					<dd>
						<code
							>${join3(
      value2.split(" ").map((word) => html`<span class="word">${word}</span>`),
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
  return html`<div class="field-group">
		<label class="lab" for="${id2}">Your name</label>
		<input id="${id2}" name="actor" required autocomplete="name" />
	</div>`;
}
function retireControl(context, targetId, instance, retire) {
  if (instance.retired) return html`<span class="muted small">retired by ${instance.retired.actor}</span>`;
  const failed = retire?.instanceId === instance.instanceId ? retire.error : null;
  return html`<details class="retire" ${failed ? html`open` : ""} data-open-key="retire:${instance.instanceId}">
		<summary class="btn small" aria-label="Retire ${instance.instanceId}">Retire</summary>
		<form
			method="post"
			action="/settings/targets/${targetId}/instances/${instance.instanceId}/retire"
			class="confirm-box"
		>
			<input type="hidden" name="csrf" value="${context.csrf}" />
			<input type="hidden" name="confirmed" value="1" />
			<p>Retire <code>${instance.instanceId}</code>? No new change can name it. Its changes stay as they are.</p>
			${failed ? html`<p class="form-error" role="alert">${failed}</p>` : ""}
			${actorInput(context, `retire-actor-${instance.instanceId}`)}
			<div class="btns"><button class="btn primary">Confirm retire</button></div>
		</form>
	</details>`;
}
function instancesTable(context, targetId, instances, retire) {
  if (!instances.length) return html`<p class="empty-line">No instance yet.</p>`;
  return html`<div class="scroll">
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
    (instance) => html`<tr id="instance-${instance.instanceId}" data-key="instance:${instance.instanceId}">
							<td class="mono">${instance.instanceId}</td>
							<td>${entryList2(instance)}</td>
							<td>${instance.environment ?? none()}</td>
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
  return html`<section
		class="panel decision"
		aria-labelledby="add-instance"
		data-region="instance-form"
		data-stale-message="${targetId} changed. Review it before you add the instance."
	>
		<h2 class="lab" id="add-instance">Add instance</h2>
		<p class="help">An instance is one place where the target runs. Adding one needs no new revision.</p>
		<div data-stale-slot>${form?.error ? html`<p class="form-error" role="alert">${form.error}</p>` : ""}</div>
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
    (entry) => html`<div class="field-group">
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
  const older = html` · <a href="/settings/targets/${targetId}">latest is ${latest}</a>`;
  const revisionText = shown ? `Revision ${shown.revision}` : "";
  const sub = shown ? html`${revisionText}${shown.revision === latest ? " (latest)" : older} · ${instancesText}` : html`No profile yet. Save one with <code>checkmate target save ${targetId}</code>. ${instancesText}.`;
  const shape = shown ? html`<section aria-labelledby="tools">
					<h2 id="tools">Tools <span class="n">${shown.profile.tools.length}</span></h2>
					${toolsTable(shown.profile)}
				</section>
				<section aria-labelledby="profile">
					<h2 id="profile">Profile</h2>
					${profileFacts(shown.profile)}
				</section>` : banner("info", html`The setup request is recorded. The profile is not saved yet.`);
  const body = html`${heading(
    targetId,
    sub,
    html`<div class="meta">
				${shown ? html`<span class="pill" title="${shown.sha256}">sha256 <span class="mono">${short2(shown.sha256)}</span></span>` : ""}
			</div>`
  )}
		<div class="split">
			<div class="main-col">
				<nav class="jump" aria-label="On this page">
					<a href="#entry-points">Entry points</a
					><a href="#instances">Instances</a
					>${shown ? html`<a href="#tools">Tools</a><a href="#profile">Profile</a>` : ""}<a href="#history"
						>History</a
					>
				</nav>
				<section aria-labelledby="entry-points">
					<h2 id="entry-points">Entry points <span class="n">${request.entryPoints.length}</span></h2>
					${entryPointsTable(request.entryPoints)}
				</section>
				<section aria-labelledby="instances" data-region="instances">
					<h2 id="instances">Instances <span class="n">${instances.length}</span></h2>
					${retire && !instances.some((instance) => instance.instanceId === retire.instanceId && !instance.retired) ? html`<p class="form-error" role="alert">${retire.error}</p>` : ""}
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
  const references = (form.get("references") ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  return {
    entries: Object.fromEntries(
      entryPoints.map((entry) => [entry.name, (form.get(`entry.${entry.name}`) ?? "").trim()])
    ),
    ...environment ? { environment } : {},
    references
  };
}

// plugin/src/ui/server.ts
var id = "[A-Za-z0-9][A-Za-z0-9_-]{0,95}";
var routes = {
  target: new RegExp(`^/settings/targets/(${id})$`),
  addInstance: new RegExp(`^/settings/targets/(${id})/instances$`),
  retireInstance: new RegExp(`^/settings/targets/(${id})/instances/(${id})/retire$`),
  font: /^\/assets\/fonts\/(inter|space-grotesk|jetbrains-mono)\.woff2$/
};
var contentSecurityPolicy = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'self'";
var themes = ["system", "light", "dark"];
var maxForm = 256 * 1024;
function directory(candidates, file) {
  for (const candidate of candidates) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync3(path + file)) return path;
  }
  throw new Error(`Checkmate UI files are missing: ${file} not found in ${candidates.join(", ")}`);
}
function assets() {
  const files2 = directory(["./assets/", "../src/ui/assets/", "../plugin/src/ui/assets/"], "style.css");
  const fonts = `${files2}fonts/`;
  const read = (name) => readFileSync2(files2 + name);
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
function same2(a, b2) {
  const x2 = Buffer.from(a);
  const y = Buffer.from(b2);
  return x2.length === y.length && timingSafeEqual(x2, y);
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
function notFoundError(message) {
  return /^Unknown|has no revision|not found/i.test(message);
}
function plainMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
async function startUi(options2) {
  const files2 = assets();
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
      subjects: [],
      status,
      body: html`${heading(title, message)}
				<p class="actions">
					<a class="btn primary" href="/log">Log</a> <a class="btn" href="/settings/targets">Targets</a>
				</p>`
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
    const asset = files2[pathname];
    if (asset && typeof asset === "object")
      return send(request.res, 200, asset.type, asset.body, { "Cache-Control": "no-cache" });
    const font = routes.font.exec(pathname);
    if (font)
      return send(request.res, 200, "font/woff2", files2.font(font[1]), {
        "Cache-Control": "public, max-age=31536000, immutable"
      });
    if (pathname === "/events") return events(request);
    const shown = context(request);
    if (pathname === "/") return redirect(request.res, "/log");
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
    return errorPage(request, 404, "Page not found", `Checkmate has no page at ${pathname}. Start from the log.`);
  }
  function actorPage(shown, back) {
    return {
      title: "Your name",
      section: null,
      subjects: [],
      body: html`${heading("Your name", "Checkmate records this name with each decision you make in this browser.")}
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
  function values(form, names2) {
    return Object.fromEntries(names2.map((name) => [name, form.get(name) ?? ""]));
  }
  function refuse(request, page, cookies = []) {
    const shown = page();
    render(request, { ...shown, status: shown.status ?? 422 }, cookies);
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
import { existsSync as existsSync4, mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync } from "node:fs";
import { dirname, resolve as resolve2 } from "node:path";
import { constants as constants2 } from "node:sqlite";
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
    requireWellFormed(kind.includes(text), `Invalid ${token}: ${text}. Use one of: ${kind.join(", ")}.`);
  else if (typeof kind === "object" && "min" in kind)
    requireWellFormed(
      /^[0-9]+$/.test(text) && Number(text) >= kind.min && Number(text) <= kind.max,
      `Invalid ${token}: ${text}. Use a whole number from ${kind.min} to ${kind.max}.`
    );
}
function toolSpec(spec) {
  const match = /^(.+?):(cli|mcp|skill):(.+)$/.exec(spec);
  requireWellFormed(match, `Invalid --tool: ${spec}. Use <name>:<cli|mcp|skill>:<purpose>.`);
  return { name: match[1], kind: match[2], purpose: match[3] };
}
function entryPointSpec(spec) {
  const match = /^([^:]+):([^:]+):(.+)$/.exec(spec);
  requireWellFormed(
    match && entryPointKinds.includes(match[2]),
    `Invalid --entry-point: ${spec}. Use <name>:<url|command|value>:<purpose>.`
  );
  return { name: match[1], kind: match[2], purpose: match[3] };
}
function instanceInput(args, stdin) {
  const entries = list(args, "entry");
  const environment = value(args, "environment");
  const references = list(args, "reference");
  if (entries === void 0) {
    requireWellFormed(
      environment === void 0 && !references,
      "Give --entry with --environment and --reference, or send the instance on standard input"
    );
    return stdin();
  }
  const values = {};
  for (const entry of entries) {
    const at = entry.indexOf("=");
    requireWellFormed(at > 0, `Invalid --entry: ${entry}. Use <entryPoint>=<value>.`);
    const name = entry.slice(0, at);
    requireWellFormed(!(name in values), `Entry point ${name} is given twice`);
    values[name] = entry.slice(at + 1);
  }
  return {
    entries: values,
    ...environment === void 0 ? {} : { environment },
    ...references ? { references } : {}
  };
}
function instanceLines(instance) {
  return [
    ...Object.entries(instance.entries).map(([name, entry]) => ["entry", name, entry]),
    ...instance.environment ? [["environment", instance.environment]] : [],
    ...instance.references.map((reference) => ["reference", reference])
  ];
}
function short3(sha256) {
  return typeof sha256 === "string" ? sha256.slice(0, 8) : sha256;
}
function gapLines(gaps, build, total = gaps.length) {
  return [
    ...gaps.map((gap) => ["gap", gap.kind, gap.subject, gap.idea]),
    ["count", total, `open items on ${build}: things your record does not show yet.`]
  ];
}
function kindCounts(counts) {
  return Object.entries(counts).filter(([, count]) => count).map(([kind, count]) => `${kind} ${count}`).join(", ");
}
function notShownLines(changeId, open) {
  const cut = { ...open.counts };
  for (const gap of open.gaps) cut[gap.kind]--;
  const count = open.total - open.gaps.length;
  if (!count) return [];
  return [
    [
      "not_shown",
      count,
      kindCounts(cut),
      open.tester ? "Run checkmate gaps again after you log entries." : `Run checkmate gaps ${changeId} --build ${open.build} --all to see all of them.`
    ]
  ];
}
function fieldText(fields, described) {
  return fields.map((field) => {
    const name = `${field.path}${field.type.includes("|") ? ` (${field.type})` : ""}${field.required ? " (required)" : ""}`;
    if (described.has(field.description)) return `${name}.`;
    described.add(field.description);
    return `${name}: ${field.description}`;
  }).join(" ");
}
function cellText(cell2) {
  const parts = Object.entries(cell2).filter(([, count]) => count);
  return parts.length ? parts.map(([name, count]) => `${name}${count}`).join(",") : "-";
}
function statusText(on) {
  if (on.basis === "none") return on.status;
  if (on.basis === "verified") return `${on.status} (verified)`;
  const votes = on.status === "fixed" ? on.votes.fixed : on.votes.not_fixed;
  const mark2 = on.basis === "majority" ? "" : `, ${on.basis}`;
  return `${on.status} (${votes} of ${on.votes.fixed + on.votes.not_fixed}${mark2})`;
}
function nextLines(next) {
  return next.map((line) => [`next: ${line}`]);
}
var commands = {
  init: {
    positionals: [],
    creates: true,
    run: (store) => completed(".checkmate/checkmate.db", { path: store.path })
  },
  "target open": {
    positionals: ["targetId"],
    flags: { "entry-point": "repeat", capabilities: "list", operations: "list", tool: "repeat" },
    required: ["entry-point", "capabilities", "operations"],
    write: true,
    creates: true,
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
    print: (reply) => ({ facts: { sha256: short3(reply.data.sha256), recorded: reply.data.recorded } })
  },
  "target list": {
    positionals: [],
    run: (store) => completed("targets", { targets: targetList(store) }),
    print: (reply) => ({
      facts: { count: reply.data.targets.length },
      lines: reply.data.targets.map((target) => [
        target.revision === null ? target.targetId : `${target.targetId}@${target.revision}`,
        `capabilities=${cell(target.capabilities)}`,
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
      const approvals = reply.data.approvals;
      const instance = reply.data.instance;
      return {
        facts: {
          sha256: short3(reply.data.sha256),
          ready: profile.readyForLiveExecution,
          instance: instance?.instanceId,
          retired: instance ? Boolean(instance.retired) : void 0
        },
        lines: [
          ...profile.entryPoints.map((entry) => ["entryPoint", entry.name, entry.kind, entry.purpose]),
          ["authentication", profile.authentication.kind, profile.authentication.references],
          ["capabilities", profile.capabilities],
          ["operations", profile.allowedOperations],
          ["approvals", `plan=${approvals.plan}`, `result=${approvals.result}`],
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
    print: (reply) => ({ facts: { recorded: reply.data.recorded } })
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
  open: {
    positionals: ["changeId"],
    flags: { target: "value", instance: "value" },
    required: ["target"],
    write: true,
    run: (store, args, { actor }) => openChange(store, actor, {
      changeId: value(args, "changeId"),
      target: value(args, "target"),
      instance: value(args, "instance")
    }),
    print: (reply) => ({
      facts: { target: reply.data.targetId, instance: reply.data.instanceId },
      lines: nextLines(reply.data.next)
    })
  },
  log: {
    positionals: ["changeId"],
    flags: { build: "value", from: "value" },
    write: true,
    stdin: true,
    run: (store, args, { actor, text, cwd }) => {
      const from = value(args, "from");
      return logEntries(store, actor, {
        changeId: value(args, "changeId"),
        build: value(args, "build"),
        entries: readEntries(from === void 0 ? text() : entriesFile(store, from, cwd)),
        cwd
      });
    },
    print: (reply) => {
      const saved = reply.data.saved;
      const refused2 = reply.data.refused;
      const ids = saved.map((entry) => entry.id);
      if (!refused2.length) return { facts: { saved: ids } };
      return {
        facts: { saved: ids, refused: refused2.length },
        lines: [
          ...refused2.map((entry) => [
            "refused",
            entry.field,
            entry.reason,
            ...entry.fix ? [`send: ${JSON.stringify(entry.fix)}`] : [],
            entry.hint
          ]),
          ...nextLines(["Fix each refused entry. Send only those entries again. The saved entries stay."])
        ]
      };
    }
  },
  gaps: {
    positionals: ["changeId"],
    flags: { build: "value", all: "switch" },
    run: (store, args, { viewer }) => changeGaps(store, value(args, "changeId"), value(args, "build"), viewer()),
    print: (reply) => {
      const open = reply.data;
      return {
        facts: { build: open.build },
        lines: [...gapLines(open.gaps, open.build, open.total), ...notShownLines(reply.subject, open)]
      };
    }
  },
  guide: {
    positionals: ["changeId?"],
    flags: { role: guideRoles, build: "value" },
    check: (args) => requireWellFormed(
      value(args, "build") === void 0 || value(args, "role") === "recorder",
      "--build is only for --role recorder."
    ),
    run: (store, args, { viewer, env }) => guideJournal(
      store,
      value(args, "changeId"),
      value(args, "role"),
      viewer(),
      value(args, "build"),
      recorderShell(env)
    ),
    print: (reply) => {
      const data = reply.data;
      const described = /* @__PURE__ */ new Set();
      return {
        lines: [
          ...data.steps.map((step) => ["step", step]),
          ["entries", `${data.about} Every entry has: ${fieldText(data.common, described)}`],
          ...data.kinds.map((kind) => [
            "kind",
            kind.kind,
            `${kind.about} ${fieldText(kind.fields, described)}`
          ]),
          [
            "example",
            {
              preformatted: data.from ? `Write to ${data.from}:
${JSON.stringify(data.example)}
Then run: ${data.command}` : `${data.command} <<'EOF'
${JSON.stringify(data.example)}
EOF`
            }
          ],
          ...data.answers.map((answer) => ["answer", answer.id, answer.question, answer.answer]),
          ...data.openDefects.map((defect) => [
            "open_defect",
            defect.id,
            defect.build,
            defect.severity,
            defect.title
          ])
        ]
      };
    }
  },
  record: {
    positionals: ["changeId"],
    flags: { build: "value", session: "value", timeout: { min: 1, max: 86400 } },
    write: true,
    run: (store, args, { actor, env, script }) => recordSession(
      store,
      actor,
      {
        changeId: value(args, "changeId"),
        build: value(args, "build"),
        session: value(args, "session"),
        timeoutSeconds: integer(args, "timeout") ?? defaultRecorderTimeout
      },
      { env, script }
    ),
    print: (reply) => ({
      facts: {
        session: reply.data.session,
        recorder: reply.data.recorder,
        entries: reply.data.entries,
        costUsd: reply.data.costUsd,
        durationMs: reply.data.durationMs
      },
      lines: Object.entries(reply.data.added).map(([kind, count]) => [
        "added",
        kind,
        count
      ])
    })
  },
  show: {
    positionals: ["changeId"],
    flags: { all: "switch" },
    run: (store, args, { viewer }) => showChange(store, value(args, "changeId"), viewer()),
    print: (reply) => {
      const data = reply.data;
      return {
        facts: { target: data.targetId, instance: data.instanceId, builds: data.builds },
        lines: [
          ...data.criteria.map((criterion) => [
            "criterion",
            criterion.id,
            criterion.text,
            criterion.source ?? "-"
          ]),
          ...data.matrix.map((row) => [
            "matrix",
            row.about,
            ...data.builds.map((build) => `${build}=${cellText(row.cells[build])}`)
          ]),
          ...data.defects.map((defect) => [
            defect.suspected ? "suspected_defect" : "defect",
            defect.id,
            defect.build,
            defect.severity,
            defect.title,
            defect.verdicts.map((verdict) => `${verdict.build}=${verdict.result}`)
          ]),
          ...data.questions.map((question) => [
            "question",
            question.id,
            question.status,
            question.question,
            ...question.answer ? [question.answer] : []
          ]),
          ...data.decisions.map((decision) => [
            "decision",
            decision.id,
            decision.build,
            decision.decision,
            decision.rationale,
            `gaps=${decision.gaps}`
          ])
        ]
      };
    }
  },
  answer: {
    positionals: ["changeId", "questionId"],
    flags: { answer: "value" },
    required: ["answer"],
    write: true,
    run: (store, args, { actor }) => answerQuestion(store, actor, {
      changeId: value(args, "changeId"),
      questionId: value(args, "questionId"),
      answer: value(args, "answer")
    }),
    print: (reply) => ({ facts: { id: reply.data.id, question: reply.data.question } })
  },
  accept: decisionCommand("accepted"),
  reject: decisionCommand("rejected"),
  merge: {
    positionals: ["changeId"],
    flags: { build: "value" },
    required: ["build"],
    run: (store, args) => mergeBuild(store, value(args, "changeId"), value(args, "build")),
    print: (reply) => {
      const data = reply.data;
      const hidden = data.total - data.defects.length;
      const again = data.issues.length > 0;
      const suggestions = [
        ...data.groups.map((group) => ["suggest", group.reports.join(","), group.reason]),
        ...data.candidates.length ? [["singles that may belong to a larger issue"]] : [],
        ...data.candidates.map((item) => ["may_belong", item.report, item.into, item.reason])
      ];
      const checks = [
        ["check", `${data.ungrouped.length} defects are in no issue: ${data.ungrouped.join(",") || "-"}`],
        ["check", `${data.groups.length} suggest lines are not logged as issues`],
        ["check", `${data.candidates.length} singles may belong to a larger issue`]
      ];
      if (again)
        return {
          facts: { build: data.build, defects: data.total, issues: data.issues.length },
          lines: [...suggestions, ...checks]
        };
      return {
        facts: { build: data.build, defects: data.total },
        lines: [
          ...data.defects.map((defect) => [
            "defect",
            defect.id,
            defect.severity,
            defect.title,
            `expected: ${defect.expected}`,
            `actual: ${defect.actual}`,
            `criteria: ${defect.criteria.join(",") || "-"}`
          ]),
          ...hidden > 0 ? [["not_shown", hidden, `Run checkmate export ${reply.subject} --all to read all defects.`]] : [],
          ...suggestions,
          ...nextLines([
            "The suggest and may_belong lines are ideas from the same criterion, words, steps, or path. Read the defects and decide.",
            "Log one issue for each defect that two or more reports describe. A defect that is in no issue is its own issue.",
            'To change an issue, log it again with "supersedes".'
          ]),
          ["example", { preformatted: `${data.command} <<'EOF'
${JSON.stringify(data.example)}
EOF` }],
          ...checks
        ]
      };
    }
  },
  issues: {
    positionals: ["changeId"],
    flags: { build: "value" },
    run: (store, args) => changeIssues(store, value(args, "changeId"), value(args, "build")),
    print: (reply) => {
      const issues = reply.data.issues;
      return {
        facts: { issues: issues.length, confirmed: issues.filter((issue) => issue.confirmed).length },
        lines: issues.map((issue) => [
          "issue",
          issue.id,
          issue.severity,
          issue.title,
          `reporters=${issue.reporters}`,
          issue.actors.join(","),
          ...Object.entries(issue.statuses).map(([build, status]) => `${build}=${statusText(status)}`),
          issueStatus(issue)
        ])
      };
    }
  },
  verify: {
    positionals: ["changeId"],
    flags: { build: "value" },
    required: ["build"],
    run: (store, args) => verifyBuild(store, value(args, "changeId"), value(args, "build")),
    print: (reply) => {
      const items = reply.data.items;
      return {
        facts: { build: reply.data.build, items: items.length },
        lines: [
          ...items.flatMap((issue) => [
            ["verify", issue.id, issue.severity, issue.title, issue.reason],
            ["steps", [issue.steps ?? "-"].flat().join(" ")],
            ["expected", issue.expected],
            ["actual", issue.actual],
            ...issue.evidence.map((item) => ["evidence", "path" in item ? item.path : item.text])
          ]),
          ...nextLines([
            "Reproduce each item on the running application.",
            'Log one observation for each item: "confirms" when you see the defect, "refutes" when you do not, and "saw" with what you saw.',
            "Do not explore beyond the list."
          ]),
          [
            "example",
            {
              preformatted: `${reply.data.command} <<'EOF'
${JSON.stringify(reply.data.example)}
EOF`
            }
          ]
        ]
      };
    }
  },
  export: {
    positionals: ["changeId"],
    flags: { out: "value", all: "switch" },
    run: (store, args, { viewer }) => {
      const changeId = value(args, "changeId");
      const content = exportChange(store, changeId, viewer());
      const out = value(args, "out");
      if (out === void 0) return completed(changeId, { format: "json", content });
      return completed(changeId, { format: "json", out: writeOutput(store, out, content) });
    },
    print: (reply) => ({ facts: { out: reply.data.out } })
  },
  operations: {
    positionals: [],
    flags: { subject: "value", limit: { min: 1, max: 1e3 }, after: { min: 0, max: Number.MAX_SAFE_INTEGER } },
    check: (args) => {
      const subject = value(args, "subject");
      requireWellFormed(
        subject === void 0 || /^(target|change):./.test(subject),
        `Invalid --subject: ${subject}. Use target:<targetId> or change:<changeId>.`
      );
    },
    run: (store, args) => {
      return completed("operations", {
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
            const field = row[column];
            return [column, field instanceof Uint8Array ? `<blob ${field.length} bytes>` : field];
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
function recorderShell(env) {
  const command = env.CHECKMATE_RECORDER_COMMAND;
  const files2 = env.CHECKMATE_RECORDER_FILES;
  return env.CHECKMATE_RECORDER && command && files2 ? { command, files: files2 } : void 0;
}
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
    if (isBusy(error) || !(error instanceof Error) || !("errcode" in error)) throw error;
    if ([8, 23].includes(Number(error.errcode))) throw new Refusal("prohibited", readOnlyReason);
    throw new Refusal("malformed", `SQL error: ${error.message}`, "Send one valid SQLite SELECT statement.");
  }
}
function queryStatement(store, sql) {
  store.db.setAuthorizer(
    (action, name, argument) => action === constants2.SQLITE_PRAGMA && argument !== null && !readPragmas.includes(name) ? constants2.SQLITE_DENY : constants2.SQLITE_OK
  );
  const statement = readOnly(() => store.db.prepare(sql));
  requireCondition(statement.columns().length > 0, readOnlyReason);
  const rest = sql.slice(statement.sourceSQL.length);
  requireWellFormed(
    /^(\s|--[^\n]*|\/\*[\s\S]*?\*\/)*$/.test(rest),
    "query runs one SQL statement. Send each statement in its own query."
  );
  return statement;
}
function decisionCommand(decision) {
  return {
    positionals: ["changeId"],
    flags: { build: "value", rationale: "value" },
    required: ["build", "rationale"],
    write: true,
    run: (store, args, { actor }) => decideBuild(store, actor, {
      changeId: value(args, "changeId"),
      build: value(args, "build"),
      decision,
      rationale: value(args, "rationale")
    }),
    print: (reply) => ({
      facts: { decision: reply.data.decision, build: reply.data.build },
      lines: gapLines(reply.data.gaps, String(reply.data.build))
    })
  };
}
function rationaleOf(input) {
  const rationale = input.rationale;
  return typeof rationale === "string" && rationale ? [rationale] : [];
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
function cell(field) {
  if (field === null || field === void 0) return "-";
  if (Array.isArray(field)) return field.length ? field.map(cell).join(",") : "-";
  if (typeof field === "object" && "preformatted" in field) return String(field.preformatted);
  if (typeof field === "object") return JSON.stringify(field);
  return String(field).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}
function compact(reply, printed) {
  const facts = Object.entries(printed.facts ?? {}).filter(([, field]) => field !== void 0).map(([key, field]) => `${key}=${cell(field)}`);
  return [
    [reply.status, reply.subject, ...reply.refusal ? [`refusal=${reply.refusal}`] : [], ...facts].join(" "),
    ...(printed.lines ?? []).map((line) => line.map(cell).join("	")),
    ...reply.reasons.map((reason) => `reason: ${cell(reason)}`),
    ...reply.hint ? [`hint: ${cell(reply.hint)}`] : []
  ].join("\n");
}
function format(reply, json, print) {
  if (json)
    return JSON.stringify({
      status: reply.status,
      subject: reply.subject,
      reasons: reply.reasons,
      ...reply.refusal ? { refusal: reply.refusal } : {},
      ...reply.hint ? { hint: reply.hint } : {},
      ...reply.data
    });
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
  throw unknownCommand(words4);
}
function unknownCommand(words4) {
  const groups = words4.map((_, i) => {
    const prefix = words4.slice(0, words4.length - i).join(" ");
    return Object.keys(commands).filter((name) => name.startsWith(`${prefix} `));
  });
  const names2 = groups.find((group) => group.length) ?? [
    .../* @__PURE__ */ new Set([...Object.keys(commands).map((name) => name.split(" ")[0]), "ui"])
  ];
  return new Refusal(
    "malformed",
    `Unknown command: ${words4.join(" ") || "(none)"}`,
    `Use one of: ${names2.join(", ")}. Run checkmate --help for the usage of each command.`
  );
}
function parse(name, tokens) {
  const command = commands[name];
  const flags = {
    ...globalFlags,
    ...command.flags,
    ...command.write ? { actor: "value" } : {}
  };
  const wrong = (message) => new Refusal("malformed", message, usage(name));
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
    if (!kind) throw wrong(`Unknown option ${token} for ${name}`);
    if (kind === "switch") {
      args[flag] = true;
      continue;
    }
    const next = tokens[++i];
    if (next === void 0 || next.startsWith("--")) throw wrong(`Missing value for ${token}`);
    optionValue(token, kind, next);
    if (kind !== "list" && kind !== "repeat") {
      if (flag in args) throw wrong(`Option ${token} is given twice`);
      args[flag] = next;
    } else if (kind === "list") {
      if (flag in args) throw wrong(`Option ${token} is given twice`);
      args[flag] = next.split(",").map((item) => item.trim()).filter(Boolean);
    } else args[flag] = [...args[flag] ?? [], next];
  }
  const needed = command.positionals.filter((positional) => !positional.endsWith("?")).length;
  if (positionals.length < needed || positionals.length > command.positionals.length)
    throw wrong(
      `${name} needs ${needed === command.positionals.length ? needed : `${needed} to ${command.positionals.length}`} argument(s), not ${positionals.length}: ${command.positionals.map(positionalUsage).join(" ") || "none"}`
    );
  for (const flag of command.required ?? []) if (!(flag in args)) throw wrong(`Missing --${flag}`);
  positionals.forEach((positional, i) => args[command.positionals[i].replace(/\?$/, "")] = positional);
  command.check?.(args);
  return args;
}
function positionalUsage(positional) {
  return positional.endsWith("?") ? `[<${positional.slice(0, -1)}>]` : `<${positional}>`;
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
    ...command.positionals.map(positionalUsage),
    ...flags,
    ...command.write ? ["[--actor <name>]"] : [],
    ...command.stdin ? ["<<'EOF' <json> EOF"] : []
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
    const names2 = Object.keys(commands).filter((name) => name === prefix || name.startsWith(`${prefix} `));
    if (names2.length) return completed(prefix, { usage: names2.map((name) => usage(name).replace("Usage: ", "")) });
  }
  return { ...refused("invalid_request", "checkmate", unknownCommand(words4)), data: { usage: [] } };
}
function version() {
  return JSON.parse(readFileSync3(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8")).version;
}
function readJson(text) {
  requireWellFormed(
    text.trim().length > 0,
    "Missing JSON payload on standard input",
    "Send the JSON payload on standard input, in a quoted heredoc: checkmate <command> <arguments> <<'EOF', the JSON, then EOF"
  );
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Refusal(
      "malformed",
      `Standard input is not valid JSON: ${error.message}`,
      "Send one JSON object on standard input. Use double quotes for keys and strings, and no trailing commas."
    );
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
    return { code: 1, output: format(refused("invalid_request", name, error), json) };
  }
  const command = commands[name];
  const first = command.positionals[0]?.replace(/\?$/, "");
  const subject = first && name !== "query" ? String(args[first] ?? name) : name;
  const found = workspaceOf(io.cwd, value(args, "workspace"), io.env);
  const { workspace } = found;
  let store;
  try {
    if (!command.creates && !existsSync4(databasePath(workspace))) throw missingStore(found);
    store = command.readOnly ? openReadOnlyStore(workspace) : command.creates ? createStore(workspace) : openStore(workspace);
    const actor = command.write ? value(args, "actor") ?? defaultActor(workspace, io.env) : void 0;
    const reply = command.run(store, args, {
      actor,
      stdin: () => readJson(io.stdin()),
      text: io.stdin,
      cwd: resolve2(io.cwd),
      viewer: () => args.all === true ? void 0 : defaultActor(workspace, io.env),
      env: io.env,
      script: io.script
    });
    const code = reply.status === "completed" || reply.status === "needs_decision" ? 0 : 1;
    if (!json && typeof reply.data.content === "string")
      return { code, output: reply.data.content.replace(/\n$/, "") };
    return { code, output: format(reply, json, command.print) };
  } catch (error) {
    const reply = isBusy(error) ? { status: "operational_error", subject, reasons: [error.message, busyReason], data: {} } : refused("rejected", subject, error);
    return { code: 1, output: format(reply, json) };
  } finally {
    if (store) closeStore(store);
  }
}
function workspaceOf(cwd, given, env) {
  if (given !== void 0) return { workspace: resolve2(cwd, given), from: "--workspace" };
  const named = env.CHECKMATE_WORKSPACE;
  if (named) return { workspace: resolve2(cwd, named), from: "CHECKMATE_WORKSPACE" };
  for (let directory2 = resolve2(cwd); ; directory2 = dirname(directory2)) {
    if (existsSync4(databasePath(directory2))) return { workspace: directory2, from: "search" };
    if (dirname(directory2) === directory2) return { workspace: resolve2(cwd), from: "search" };
  }
}
function missingStore({ workspace, from }) {
  const searched = from === "search" ? `${workspace} and its parent directories` : `${workspace}, the directory that ${from} names`;
  return new Refusal(
    "prohibited",
    `No Checkmate store in ${searched}. Nothing changed.`,
    "Run the command in the project directory, or set CHECKMATE_WORKSPACE to the project directory, or pass --workspace <path>."
  );
}
function uiOptions(tokens, cwd) {
  const values = {};
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--json") continue;
    const flag = token.startsWith("--") ? token.slice(2) : "";
    if (!["workspace", "port"].includes(flag))
      throw new Refusal("malformed", `Unknown argument ${token} for ui`, uiUsage);
    const next = tokens[++i];
    if (next === void 0 || next.startsWith("--"))
      throw new Refusal("malformed", `Missing value for ${token}`, uiUsage);
    if (flag in values) throw new Refusal("malformed", `Option ${token} is given twice`, uiUsage);
    values[flag] = next;
  }
  const port = values.port === void 0 ? void 0 : Number(values.port);
  requireWellFormed(
    port === void 0 || /^[0-9]+$/.test(values.port) && port <= 65535,
    `Invalid --port: ${values.port}. Use 0 to 65535.`
  );
  return { found: workspaceOf(cwd, values.workspace, process.env), port };
}
async function serveUi(tokens) {
  const json = tokens.includes("--json");
  let options2;
  try {
    options2 = uiOptions(tokens, process.cwd());
  } catch (error) {
    process.stdout.write(format(refused("invalid_request", "ui", error), json) + "\n");
    process.exitCode = 1;
    return;
  }
  const { workspace } = options2.found;
  if (!existsSync4(databasePath(workspace))) {
    process.stdout.write(format(refused("rejected", "ui", missingStore(options2.found)), json) + "\n");
    process.exitCode = 1;
    return;
  }
  const ui = await startUi({ workspace, port: options2.port });
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
    stdin: () => readFileSync3(0, "utf8"),
    script: process.argv[1]
  });
  process.stdout.write(outcome.output + "\n");
  process.exitCode = outcome.code;
}

// plugin/bin/checkmate.ts
await main(process.argv.slice(2));
