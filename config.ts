import path from 'path';
import os, { platform } from 'os';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTOCAL = 'http';
const ASSETS_IP = '114.132.229.184';
const ASSETS_PORT = '5000';

export default {
	debug: false,
	phpFileEncrypt: true,
	stringPoolEncrypt: true,

	prefix: 'KA_',

	rootDir: __dirname,
	randomNumberSize: 2,

	excludes: ['vendor', 'node_modules', '.git', 'languages'],
	reserved: ['languages'],

	excludeString: ['/mu-plugins/index.php', '/wp-load.php'],
	external: [],
	entries: ['functions.php', 'index.php'],

	pathes:
		os.hostname().toLocaleLowerCase() === 'cirnotsuki'
			? {
					source: 'X:/ChengdaGlass/@wp',
					dist: 'X:/ChengdaGlass/laragon/www',
				}
			: {
					source: 'F:/@My-Projects/wp-website',
					dist: 'D:/laragon2/www',
				},

	binariesDir: 'binaries',
	runtimeDir: './wp-content/mu-plugins',
	buildDirs: ['./wp-content/mu-plugins', './api', './wp-content/themes/cirnotob'],
	copyFiles: ['./wp-config.php', './.htaccess'],

	replace: {
		'http://localhost:5000/': `${PROTOCAL}://${ASSETS_IP}:${ASSETS_PORT}/`,
	},

	db: {
		host: 'localhost',
		database: 'wordpress',
		user: 'wordpress',
		password: '123456',
	},

	settings: {
		constants: true,
		variables: true,
		strings: true,
		functions: true,
		classes: true,
		encrypt: true,
		debugRuntime: false,
		buildRuntimeC: true,
		injectExe: true,
	},

	build: {
		magic: 'CHNK',
		footerSize: 64,
		platform: 'linux',
		url: {
			win32: 'http://localhost:2000/build',
			linux: 'http://192.168.0.166:2000/build',
		},
	},
};
