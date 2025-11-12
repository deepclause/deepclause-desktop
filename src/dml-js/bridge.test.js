/* eslint-disable no-console */
import assert from 'assert';
import * as bridge from './bridge.js';

async function collect(gen) {
	// Helper to collect all yields from an async generator
	const out = [];
	for await (const v of gen) out.push(v);
	return out;
}

async function testInstruction() {
	for await (const o of bridge.instruction('Do X', 0, [])) 
        console.log('Yield:', o);

	console.log('✓ instruction passed');
}

async function testQuestionToProlog() {
	for await (const o of bridge.questionToProlog('hello world', 0, []))
        console.log('Yield:', o);

	console.log('✓ questionToProlog passed');
}

async function testToolAgent() {
	for await (const o of bridge.toolAgent("google_search(default_response)",0,[],"sess_engine_file_2025_09_23T09_30_13_809Z_c08bcdd8",[]))
        console.log('Yield:', o);
	
	console.log('✓ toolAgent passed');
}

async function main() {
	await testInstruction();
	await testQuestionToProlog();
	await testToolAgent();
	console.log('All tests passed.');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
