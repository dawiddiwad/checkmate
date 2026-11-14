# HTTP recipe

Use this recipe when the plan lists the `node` tool for HTTP. For another HTTP tool, use the same rules for evidence.

Use Node.js `fetch` with an explicit timeout.
Resolve credentials from the authentication references of the profile and the instance. Do not save their values.
Run the script from the workspace. It prints the exchange. It writes no file:

```sh
node --input-type=module -e '
const url = "http://127.0.0.1:4173/quote?promotion=true"
const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
const body = await response.json()
const exchange = { method: "GET", path: new URL(url).pathname, status: response.status, totalPLN: body.totalPLN }
console.log(JSON.stringify(exchange))
'
```

Record the assertion with the printed exchange as evidence. Copy the printed line exactly:

```sh
checkmate run check <runId> T2 A1 --result passed --observed "totalPLN is 240" --evidence -:http_exchange <<'EOF'
{"method":"GET","path":"/quote","status":200,"totalPLN":240}
EOF
```

- Save only the fields that the assertion needs. Do not save request headers, cookies, query credentials, or a full response.
- Compare the observed value with the exact check of the assertion.
- A timeout or a failed connection is a tool failure, not a product defect.
- Do not repeat a request that can change application state without oracle authorization.
