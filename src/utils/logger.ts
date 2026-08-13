import { DEBUG } from '../config/constans';
import chalk from 'chalk';
import { Runtime } from '../core/runtime';

// import WebSocket from 'ws';
// const wss = new WebSocket.OPEN({ port: 3001 });

// function broadcast(msg) {
// 	wss.clients.forEach((client) => {
// 		if (client.readyState === 1) client.send(msg);
// 	});
// }
export function log(...args: any[]) {
	if (Runtime.DEBUG) {
		console.log('\n[INFO]', ...args);
	}
}

export function instance(...args: any[]) {
	if (Runtime.DEBUG) {
		console.warn('\n[INST]', ...args);
	}
}

export function warn(...args: any[]) {
	if (Runtime.DEBUG) {
		console.warn(...args);
	}
}

export function error(...args: any[]) {
	console.error(...args);

	return new Error(...args);
}

export * as default from './logger';
