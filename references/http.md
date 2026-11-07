# HTTP recipe

Use the project's HTTP tool or Node.js `fetch`. Use an explicit timeout.
Resolve credentials from the profile's environment references. Do not save their values.

```js
const started = performance.now()
const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
const body = await response.json()
const observation = {
	method: 'GET',
	path: new URL(url).pathname,
	status: response.status,
	totalPLN: body.totalPLN,
	durationMs: Math.round(performance.now() - started),
}
```

Save only the fields needed for the assertion. Do not save request headers, cookies, query credentials, or a full response by default.
Compare the observed value with the approved expected value. A timeout or failed connection is an operational error.
Do not retry a request that can change application state without caller authorization.
