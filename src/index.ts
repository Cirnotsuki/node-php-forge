import fs from 'fs';
import path from 'path';
import { MAP_DIR } from './config/constans';

import phpMerge from './lib/php-merge';
import phpOptimize from './lib/php-optimize';
import phpDefine from './lib/php-define';
import phpStringAst from './lib/php-string-ast';
import phpFunction from './lib/php-function';

import phpVariable from './lib/php-variable';
import { uuidv4 } from '@ka-libs/crypto/uuidv4';
import { mkdirp } from 'mkdirp';

import utils, { normalizePath } from './utils/utils';
import { Runtime } from './core/runtime';
import { log } from './utils/logger';
import { BuildContext, BuildOption } from './core/buildOption';
import phpClass from './lib/php-class';
import phpFinnally from './lib/php-finnally';
import config from '../config';

export * as PhpParser from 'php-parser';

export * from '../../ka-buildc/src';

export default async function (entryDir: string, distDir: string, options: BuildOption) {
	const buildContext = new BuildContext(options, entryDir, distDir);

	options.contexts.push(buildContext);
	// set root
	Runtime.distDir = buildContext.distDir;
	Runtime.sourceDir = buildContext.entryDir;

	const { settings } = Runtime;
	try {
		fs.rmSync(buildContext.distDir, { recursive: true, force: true });
	} finally {
		Runtime.period = 'merge';
		await phpMerge(buildContext);

		Runtime.period = 'define';
		await phpDefine(buildContext);

		if (settings.variables) {
			Runtime.period = 'variable';
			await phpVariable(buildContext);
		}

		Runtime.period = 'class';
		await phpClass(buildContext);

		Runtime.period = 'function';
		await phpFunction(buildContext);

		Runtime.period = 'finnally';
		await phpFinnally(buildContext);

		Runtime.period = 'string';
		await phpStringAst(buildContext);

		Runtime.period = 'optimize';
		await phpOptimize(buildContext);
	}
}
