import path from 'path';
import os from 'os';

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

	runtimeDir: 'wp-content/mu-plugins',
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
		constants: true,
		variables: true,
		strings: true,
		functions: true,
		classes: true,
		encrypt: true,
		devMode: true,
	},
};
