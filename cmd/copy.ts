import phpMerge from '..';
// import fs from 'fs';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { mkdirp } from 'mkdirp';
import logger from '../src/utils/logger';
import config from '../config';
import copy from '../src/handle/copy';

function cp(source: string, dist: string) {
	fsSync.readdirSync(source).forEach((file) => {
		const sourceFile = path.resolve(source, file);
		const distFile = path.resolve(dist, file);

		mkdirp.sync(dist);
		try {
			fsSync.cpSync(sourceFile, distFile);
		} catch (e) {
			cp(sourceFile, distFile);
		}
	});
}

(async function () {
	const { source, dist } = config.pathes;

	for (const dir of config.buildDirs) {
		const sourceDir = path.resolve(source, dir);
		const distDir = path.resolve(dist, dir);

		try {
			await fs.rm(distDir, { recursive: true });
		} catch (error) {}

		cp(sourceDir, distDir);
	}

	await copy(config.copyFiles, config.pathes);

	console.log('复制完成');
})();
