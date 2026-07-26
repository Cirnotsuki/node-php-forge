import fs from 'fs';
import path from 'path';
import { MAP_DIR } from './config/constans';

import phpMerge from './lib/php-merge';
import phpHooks from './lib/php-hooks';
import phpOptimize from './lib/php-optimize';
import phpDefine from './lib/php-define';
import phpString from './lib/php-string-ast';
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

export * as PhpParser from 'php-parser'

export default async function (entryDir: string, distDir: string, options: BuildOption) {
	const buildContext = new BuildContext(entryDir, distDir, options);

	options.contexts.push(buildContext);
	// set root
	Runtime.distDir = buildContext.distDir;
	Runtime.sourceDir = buildContext.entryDir;

	try {
		fs.rmSync(buildContext.distDir, { recursive: true, force: true });
	} finally {
		Runtime.period = 'merge';
		await phpMerge(buildContext);

		Runtime.period = 'define';
		await phpDefine(buildContext);

		Runtime.period = 'variable';
		await phpVariable(buildContext);

		Runtime.period = 'class';
		await phpClass(buildContext);

		Runtime.period = 'function';
		// await phpFunction(buildContext);

		Runtime.period = 'hooks';
		//   await phpHooks(buildContext);

		Runtime.period = 'string';
		await phpStringAst(buildContext);

		Runtime.period = 'optimize';
		await phpOptimize(buildContext);
	}
}
