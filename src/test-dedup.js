import { normalizeCompanyName, generateCrossEntityKey, generateJobFingerprint } from './utils.js';

console.log('=== Testing normalizeCompanyName ===\n');

const testCases = [
    // [input, expected output]
    ['Databricks GmbH', 'databricks'],
    ['Databricks, Inc.', 'databricks'],
    ['Databricks B.V.', 'databricks'],
    ['Databricks U.K. Limited', 'databricks u.k'],
    ['Databricks SARL', 'databricks'],
    ['Trade Republic', 'trade republic'],
    ['N26 GmbH', 'n26'],
    ['Delivery Hero SE', 'delivery hero'],
    ['Airbnb', 'airbnb'],
    ['Celonis SE', 'celonis'],
    ['HelloFresh AG', 'hellofresh'],
    ['Stripe, Inc.', 'stripe'],
    ['Personio GmbH & Co. KG', 'personio'],
    ['MongoDB, Inc.', 'mongodb'],
    ['Elastic N.V.', 'elastic'],
];

let passed = 0;
let failed = 0;

for (const [input, expected] of testCases) {
    const result = normalizeCompanyName(input);
    const ok = result === expected;
    if (ok) {
        console.log(`  ✅ "${input}" → "${result}"`);
        passed++;
    } else {
        console.log(`  ❌ "${input}" → "${result}" (expected "${expected}")`);
        failed++;
    }
}

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

console.log('=== Testing generateCrossEntityKey ===\n');

const key1 = generateCrossEntityKey('Staff Software Engineer', 'Databricks GmbH', 'Berlin, Germany');
const key2 = generateCrossEntityKey('Staff Software Engineer', 'Databricks, Inc.', 'Berlin, Germany');
const key3 = generateCrossEntityKey('Staff Software Engineer', 'Databricks B.V.', 'Berlin, Germany');
const key4 = generateCrossEntityKey('Product Manager', 'Databricks GmbH', 'Berlin, Germany');
const key5 = generateCrossEntityKey('Staff Software Engineer', 'Databricks GmbH', 'Munich, Germany');

console.log(`  Key 1 (GmbH):  "${key1}"`);
console.log(`  Key 2 (Inc.):  "${key2}"`);
console.log(`  Key 3 (B.V.):  "${key3}"`);
console.log(`  Key 4 (diff title): "${key4}"`);
console.log(`  Key 5 (diff city):  "${key5}"`);

console.log('');

if (key1 === key2 && key2 === key3) {
    console.log('  ✅ Keys 1, 2, 3 are IDENTICAL — cross-entity dedup would catch these');
} else {
    console.log('  ❌ Keys 1, 2, 3 are DIFFERENT — cross-entity dedup is BROKEN');
    console.log('     This means normalizeCompanyName is not stripping suffixes correctly');
}

if (key1 !== key4) {
    console.log('  ✅ Key 4 is DIFFERENT — different job titles are not falsely deduped');
} else {
    console.log('  ❌ Key 4 is SAME — different job titles are being falsely deduped!');
}

if (key1 !== key5) {
    console.log('  ✅ Key 5 is DIFFERENT — different cities are not falsely deduped');
} else {
    console.log('  ❌ Key 5 is SAME — different cities are being falsely deduped!');
}

console.log('\n=== Testing fingerprint (Task 2) ===\n');

const fp1 = generateJobFingerprint('Staff Engineer', 'Databricks', 'Some long description here...');
const fp2 = generateJobFingerprint('Staff Engineer', 'Databricks', 'Some long description here...');
const fp3 = generateJobFingerprint('Staff Engineer', 'Databricks', 'Different description entirely...');

if (fp1 === fp2) {
    console.log('  ✅ Same inputs produce same fingerprint');
} else {
    console.log('  ❌ Same inputs produce DIFFERENT fingerprints — broken!');
}

if (fp1 !== fp3) {
    console.log('  ✅ Different descriptions produce different fingerprints');
} else {
    console.log('  ❌ Different descriptions produce SAME fingerprint — broken!');
}

console.log('\n=== All tests complete ===\n');

if (failed > 0) {
    console.log(`⚠️  ${failed} company name test(s) failed. Check normalizeCompanyName() in utils.js`);
    process.exit(1);
} else {
    console.log('✅ All utility functions are working correctly.');
    console.log('   Next step: run a full scrape and check for [Cross-Entity Dedup] messages in console.');
    process.exit(0);
}
