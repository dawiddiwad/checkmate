import { writeFileSync } from 'node:fs'

const [seedPath, basePLN = '400', loyaltyPLN = '0'] = process.argv.slice(2)
if (!seedPath) throw Error('Usage: reset.mjs <seed-path> [basePLN] [loyaltyPLN]')
writeFileSync(
	seedPath,
	JSON.stringify({ seeded: 'SHOP-12-v1', basePLN: Number(basePLN), loyaltyPLN: Number(loyaltyPLN) }) + '\n'
)
