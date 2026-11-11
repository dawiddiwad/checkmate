# HTTP recipe

Use the project's HTTP tool or Node.js `fetch`. Use an explicit timeout.
Resolve credentials from the profile's environment references. Do not save their values.
This is an optional recipe. Use the `evidenceDirectory` returned by `run show --json` in place of the placeholder. Run the script from the workspace:

```sh
node --input-type=module -e '
import { writeFileSync } from "node:fs"
const url = "http://127.0.0.1:4173/quote?promotion=true"
const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
const body = await response.json()
const exchange = { method: "GET", path: new URL(url).pathname, status: response.status, totalPLN: body.totalPLN }
writeFileSync("<evidenceDirectory>/T2-A1.json", JSON.stringify(exchange))
console.log(JSON.stringify(exchange))
'
```

- Save only the fields that the assertion needs. Do not save request headers, cookies, query credentials, or a full response.
- Compare the observed value with the exact check of the assertion.
- A timeout or a failed connection is a tool failure, not a product defect.
- Do not repeat a request that can change application state without caller authorization.
