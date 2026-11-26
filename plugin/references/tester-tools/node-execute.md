HTTP: node --input-type=module -e 'const r = await fetch("<url><path>", { signal: AbortSignal.timeout(10000) }); console.log(JSON.stringify({ status: r.status, body: await r.text() }))'
