import type ConfigType from '../config';
import { Runtime } from '../src/core/runtime';

import build from '../src/handle/build';
import copy from '../src/handle/copy';
import fs from 'fs';
import path from 'path';

export default function (config: typeof ConfigType) {
	// Change wp-config.php
	const configPath = path.resolve(config.pathes.dist, 'wp-config.php');
	const configLines = fs
		.readFileSync(configPath, 'utf-8')
		.split('\n')
		.map((_line) => {
			const line = _line.trim();
			if (!line.startsWith('define(')) return _line;

			const name = line.replace(/define\(['"](.+)['"],.+/, '$1');
			const { db } = config;

			switch (name) {
				case 'DB_NAME':
					return `define('${name}', '${db.database}');`;
				case 'DB_USER':
					return `define('${name}', '${db.user}');`;
				case 'DB_PASSWORD':
					return `define('${name}', '${db.password}');`;
				case 'DB_HOST':
					return `define('${name}', '${db.host}');`;
				case 'WP_DEBUG':
					return `define('${name}', ${Runtime.settings.debugRuntime});`;
				case 'WP_DEBUG_LOG':
					return `define('${name}', ${Runtime.settings.debugRuntime});`;
				case 'WP_DEBUG_DISPLAY':
					return `define('${name}', ${Runtime.settings.debugRuntime});`;
				default:
					return _line;
			}
		});
	fs.writeFileSync(configPath, configLines.join('\n'), 'utf-8');
}
