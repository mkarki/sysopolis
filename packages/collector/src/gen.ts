import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { generateSyntheticIR, validateIR } from '@sysopolis/core';

/** Milestone-1 CLI: generate a synthetic city.json and validate it against the IR contract. */
const seedArg = process.argv.indexOf('--seed');
const outArg = process.argv.indexOf('--out');
const seed = seedArg >= 0 ? Number(process.argv[seedArg + 1]) : 42;
const out = outArg >= 0 ? process.argv[outArg + 1] : 'city.json';

const ir = generateSyntheticIR(seed);
const result = validateIR(ir);

console.log(`Generated "${ir.meta.name}" (seed ${seed})`);
console.log(`  districts: ${ir.districts.length}`);
console.log(`  systems:   ${ir.systems.length}`);
console.log(`  links:     ${ir.links.length}`);
console.log(`  valid IR:  ${result.ok ? 'YES' : 'NO'}`);
if (!result.ok) {
  for (const err of result.errors) console.error(`  - ${err}`);
  process.exit(1);
}
writeFileSync(out, JSON.stringify(ir, null, 2));
console.log(`  written:   ${out}`);
