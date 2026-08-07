import path from 'path';
import os, { platform } from 'os';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
	debug: false,
	phpFileEncrypt: true,
	stringPoolEncrypt: true,

	prefix: 'KA_',

	rootDir: path.resolve('./'),
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
		'http://localhost:5000/': 'http://114.132.229.184:5000/',
	},

	db: {
		host: 'localhost',
		database: 'wordpress',
		user: 'wordpress',
		password: '123456',
	},

	settings: {
		constants: false,
		variables: false,
		strings: true,
		functions: false,
		classes: false,
		encrypt: true,
		debugRuntime: true,
		buildRuntimeC: true,
		platform: 'WIN32',
	},

	deps: {
		phpDev: path.resolve(__dirname, './deps/php-8.3.33/include'),
		opensslLib: path.resolve(__dirname, './deps/openssl/lib'),
	},
};
