#!/usr/bin/env bash
set -euo pipefail

lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin_root="${CLAUDE_PLUGIN_ROOT:-$(cd "$lib_dir/../.." && pwd)}"
export CHECKMATE_ACTOR=oracle

cm() {
	node "$plugin_root/dist/checkmate.js" "$@"
}

write_app() {
	mkdir -p docs
	cat > AGENTS.md <<'EOF'
# Inventory

The inventory app is a command-line program. Run it from this directory with `node inventory.mjs <command>`.

- `node inventory.mjs list` prints every product as JSON.
- `node inventory.mjs show <name>` prints one product as JSON.
- `node inventory.mjs create <name> <stock>` adds a product.
- `node inventory.mjs set <name> <stock>` changes the stock of a product.
- `node inventory.mjs reset` restores the seed data.

The product documentation is in `docs/inventory.md`.
EOF
	cat > docs/inventory.md <<'EOF'
# Inventory rules

## Create

A new product keeps the stock that it was created with. A product name is unique.

## Limits

Stock cannot be negative. `set` with a stock below 0 exits with code 3 and does not change the product.

## List

`list` sorts the products by name.

## Audit

Each `create` and `set` appends one line to `audit.log`.

## Restock level

Each product has a restock level of 10 units.
EOF
	cat > ticket.md <<'EOF'
# INV-7: Restock badge

When the stock of a product drops to the restock level, `show` and `list` add `"badge": "restock"` to the product.

The badge shows for all products in the selected warehouse.
EOF
	cat > inventory.mjs <<'EOF'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

const seed = [
	{ name: 'bolt', stock: 40 },
	{ name: 'nut', stock: 12 },
	{ name: 'washer', stock: 9 },
]
const file = 'inventory.json'
const load = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : structuredClone(seed))
const save = (products) => writeFileSync(file, JSON.stringify(products, null, 2))
const fail = (code, message) => {
	console.error(message)
	process.exit(code)
}
const [command, name, value] = process.argv.slice(2)
const products = load()
const product = products.find((item) => item.name === name)
if (command === 'list') console.log(JSON.stringify(products.sort((a, b) => a.name.localeCompare(b.name))))
else if (command === 'show') product ? console.log(JSON.stringify(product)) : fail(2, `Unknown product: ${name}`)
else if (command === 'create') {
	if (!name || product) fail(2, `Name is missing or in use: ${name}`)
	products.push({ name, stock: Number(value) })
	save(products)
	appendFileSync('audit.log', `create ${name} ${value}\n`)
	console.log(JSON.stringify({ name, stock: Number(value) }))
} else if (command === 'set') {
	if (!product) fail(2, `Unknown product: ${name}`)
	if (Number(value) < 0) fail(3, 'Stock must be 0 or more')
	product.stock = Number(value)
	save(products)
	appendFileSync('audit.log', `set ${name} ${value}\n`)
	console.log(JSON.stringify(product))
} else if (command === 'reset') {
	save(structuredClone(seed))
	console.log('reset')
} else fail(1, 'Use list, show, create, set, or reset.')
EOF
	node inventory.mjs reset > /dev/null
}

setup_target() {
	cm target open shop --entry-point "app:value:Command that runs the inventory app." --capabilities cli \
		--operations read_products,create_product,change_stock --tool "node:cli:Run the inventory app." > /dev/null
	cm target save shop --actor claude:setup > /dev/null <<EOF
{
	"contractVersion": "toolkit-2",
	"targetId": "shop",
	"revision": 1,
	"entryPoints": [{ "name": "app", "kind": "value", "purpose": "Command that runs the inventory app." }],
	"capabilities": ["cli"],
	"tools": [{ "name": "node", "kind": "cli", "purpose": "Run the inventory app.", "version": "$(node --version)", "reachable": true }],
	"authentication": { "kind": "none", "references": [] },
	"allowedOperations": ["read_products", "create_product", "change_stock"],
	"startup": { "owner": "factory", "command": null },
	"cleanup": "No cleanup is necessary. Each test uses its own product names.",
	"reset": { "owner": "checkmate", "command": ["node inventory.mjs reset"] },
	"readyForLiveExecution": true
}
EOF
	cm target instance add shop local --actor claude:setup --entry "app=node inventory.mjs" --environment "Eval workspace" > /dev/null
}

open_ticket_plan() {
	cm plan open inventory --target shop@1 --objective "Verify the restock badge of INV-7." \
		--source ticket.md --source docs/inventory.md \
		--instructions "ticket.md gives the change. docs/inventory.md gives the existing rules." > /dev/null
}

approved_stock_plan() {
	cm plan open stock --target shop@1 > /dev/null <<'EOF'
{
	"objective": "Verify product stock.",
	"requirements": [
		{ "id": "R1", "text": "A new product keeps the stock that it was created with.", "source": "docs/inventory.md#create" },
		{ "id": "R2", "text": "Stock cannot be negative.", "source": "docs/inventory.md#limits" }
	],
	"tools": ["node", { "name": "stock-report", "kind": "cli", "purpose": "Print the stock report." }]
}
EOF
	cm plan save stock --actor claude:plan > /dev/null <<'EOF'
{
	"tests": [
		{
			"id": "T1",
			"title": "New product keeps its stock",
			"requirementIds": ["R1"],
			"capability": "cli",
			"operations": ["create_product", "read_products"],
			"dependsOn": [],
			"preconditions": ["Use the unique name qa-<runId>-T1."],
			"action": "Run `node inventory.mjs create qa-<runId>-T1 5`, then `node inventory.mjs show qa-<runId>-T1`.",
			"assertions": [{ "id": "A1", "check": "The show output has stock 5.", "checkKind": "deterministic" }]
		},
		{
			"id": "T2",
			"title": "Negative stock is refused (regression)",
			"requirementIds": ["R2"],
			"capability": "cli",
			"operations": ["create_product", "change_stock"],
			"dependsOn": [],
			"preconditions": ["Create the product qa-<runId>-T2 with stock 3."],
			"action": "Run `node inventory.mjs set qa-<runId>-T2 -1`, then `node inventory.mjs show qa-<runId>-T2`.",
			"assertions": [
				{ "id": "A1", "check": "The set command exits with code 3.", "checkKind": "deterministic" },
				{ "id": "A2", "check": "The show output still has stock 3.", "checkKind": "deterministic" }
			],
			"metadata": { "type": "regression" }
		},
		{
			"id": "T3",
			"title": "Stock report lists a new product",
			"requirementIds": ["R1"],
			"capability": "cli",
			"operations": ["create_product", "read_products"],
			"dependsOn": [],
			"preconditions": ["Create the product qa-<runId>-T3 with stock 2."],
			"action": "Run `stock-report --json` and read the product list.",
			"assertions": [{ "id": "A1", "check": "The report lists qa-<runId>-T3 with stock 2.", "checkKind": "deterministic" }]
		}
	],
	"gaps": []
}
EOF
	cm plan approve stock@1 --rationale "Ready for the eval." > /dev/null
}

begun_run() {
	cm run begin "$1" stock@1 --tests "$2" --build "$3" --instance local --timeout 900 --actor claude:execute > /dev/null
}

finished_defect_run() {
	begun_run run-1 T1,T2 b1
	cm run check run-1 T1 A1 --actor claude:execute --result passed --observed '{"name":"qa-run-1-T1","stock":5}' --evidence - > /dev/null <<'EOF'
{"name":"qa-run-1-T1","stock":5}
EOF
	cm run close run-1 T1 --actor claude:execute > /dev/null
	cm run check run-1 T2 A1 --actor claude:execute --result failed --observed "set exited with code 0." --evidence - > /dev/null <<'EOF'
$ node inventory.mjs set qa-run-1-T2 -1
{"name":"qa-run-1-T2","stock":-1}
exit 0
EOF
	local evidence
	evidence="$(cm run show run-1 --json | node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(d.tests[1].assertions[0].evidence[0].id)')"
	cm run check run-1 T2 A2 --actor claude:execute --result failed --observed '{"stock":-1}' --evidence - > /dev/null <<'EOF'
{"name":"qa-run-1-T2","stock":-1}
EOF
	cm run close run-1 T2 --actor claude:execute > /dev/null
	cm run finding run-1 --actor claude:execute > /dev/null <<EOF
{
	"id": "F1",
	"type": "defect",
	"severity": "high",
	"assertionIds": ["T2.A1", "T2.A2"],
	"requirementIds": ["R2"],
	"title": "Negative stock is accepted",
	"expected": "set exits with code 3 and keeps stock 3.",
	"observed": "set exits with code 0 and stores stock -1.",
	"reproduction": ["node inventory.mjs create qa-run-1-T2 3", "node inventory.mjs set qa-run-1-T2 -1"],
	"evidenceIds": ["$evidence"]
}
EOF
	cm run finish run-1 --actor claude:execute --completion completed --cleanup not_applicable \
		--cleanup-reason "Each test uses its own product names." > /dev/null
}
