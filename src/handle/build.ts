import phpMerge from '..';
import fs from 'fs';
import path from 'path';
import { mkdirp } from 'mkdirp';

import logger from '../utils/logger';
import { Runtime } from '../core/runtime';
import { MAP_DIR } from '../config/constans';
import { BuildContext, BuildOption } from '../core/buildOption';
import { normalizePath } from '../utils/utils';
import { RecordBase } from '../core/recordNode';
import { arrayBufferToBase64, keyPairs } from '@ka-libs/crypto';
import { generateVariableName, getNodeName, toPhpBinary } from '../utils/helper';

import config from '../../config';
import { mergeAllBinaries } from '../utils/pipeUtil';

import { BuildC } from '../../../ka-buildc/src';

export default async function (
	buildDirs: string[],
	pathes: { source: string; dist: string },
	replace?: { [key: string]: string },
) {
	const buildOption = new BuildOption({
		replace,
		fileType: config.settings.encrypt ? '.dat' : '.php',
		binariesDir: config.binariesDir,
	});

	Runtime.distRoot = pathes.dist;
	Runtime.sourceRoot = pathes.source;
	Runtime.DEBUG = Boolean(config.debug);
	Runtime.runtimeDir = config.runtimeDir || '';

	Runtime.settings = {
		...Runtime.settings,
		...config.settings,
	};

	if (!Runtime.settings.encrypt) {
		Runtime.settings.debugRuntime = false;
		Runtime.settings.buildRuntimeC = false;
	} else {
		Runtime.tempDir = Runtime.settings.debugRuntime ? 'temp' : 'KA_TEMP';
	}

	if (Runtime.settings.buildRuntimeC) {
		BuildC.Replacement.KA_C_FOOTER_MAGIC_NAME = generateVariableName();

		BuildC.Replacement.KA_C_FOOTER_RUNTIME_OFFSET_NAME = generateVariableName();
		BuildC.Replacement.KA_C_FOOTER_RUNTIME_LENGTH_NAME = generateVariableName();

		BuildC.Replacement.KA_C_FOOTER_CHUNKS_OFFSET_NAME = generateVariableName();
		BuildC.Replacement.KA_C_FOOTER_CHUNKS_LENGTH_NAME = generateVariableName();
		BuildC.Replacement.KA_C_TEMPDIR = Runtime.settings.debugRuntime ? 'temp' : 'KA_TEMP';
		BuildC.Replacement.KA_C_TEMP_FILETYPE = Runtime.settings.debugRuntime ? '.php' : '.tmp';
		BuildC.Replacement.KA_C_RUNTIME_EXE_NAME = Runtime.settings.debugRuntime
			? 'runtime'
			: generateVariableName();

		BuildC.Replacement.KA_C_RUNTIME_DEBUG_VALUE = `${Number(Runtime.settings.debugRuntime)}`;
	} else {
		Runtime.settings.injectExe = false;
	}

	Runtime.options = buildOption;

	[Runtime.publicKey, Runtime.privateKey] = await keyPairs();

	// const [publicKey, privateKey] = await keyPairs('der');

	// Runtime.privateKey = arrayBufferToBase64(privateKey);
	// Runtime.publicKey = arrayBufferToBase64(publicKey);

	for (const dir of buildDirs) {
		const source = path.join(pathes.source, dir);
		const dist = path.join(pathes.dist, dir);

		try {
			fs.rmSync(dist, { recursive: true });
		} catch (error) {
			logger.error(error);
		}

		mkdirp.sync(dist);

		await phpMerge(source, dist, buildOption);

		// 如果没有设定统一入口，则每个目录合并一个 Runtime Exe
		if (!Runtime.runtimeDir) {
			await mergeAllBinaries();
		}
	}

	// 如果有统一入口则全流程结束后才进行合并
	if (Runtime.runtimeDir) {
		await mergeAllBinaries();
	}

	const jsonDir = path.join(MAP_DIR, new Date(buildOption.time).toLocaleDateString());

	mkdirp.sync(jsonDir);

	// console.log(buildOption);

	try {
		const options = { ...buildOption } as any;
		delete options.hooks;
		options.classes = Object.fromEntries(
			Array.from(buildOption.classes).map(([key, value]) => {
				return [
					key,
					{
						replace: value.name.replace,
						location: normalizePath(path.relative(Runtime.distRoot, value.name.location)),
						methods: value.methods,
						properties: value.properties,
					},
				];
			}),
		);

		options.constants = Object.fromEntries(buildOption.constants.entries());

		options.contexts.forEach((context: any, index: number) => {
			delete context.classes;
			delete context.entryDir;
			context.distDir = normalizePath(path.relative(Runtime.distRoot, context.distDir));

			delete context.runtime;
			delete context.options;
			delete context.guid;
			delete context.date;
			delete context.time;

			context.strings = Object.fromEntries(
				Array.from(context.strings as BuildContext['strings'])
					.sort(([_a, a], [_b, b]) => b - a)
					.map(([key, val]) => [val, key]),
			);
		});

		const json = JSON.stringify(
			options,
			function (key, value) {
				if (value instanceof Map) {
					if (value.size === 0) {
						return undefined;
					}
					return Array.from(value).map(([_, val]) => val);
				}

				if (value instanceof RecordBase) {
					return {
						name: getNodeName(value.node.name),
						replace: value.replace,
						location: normalizePath(path.relative(Runtime.distRoot, value.location)),
					};
				}

				if (typeof value === 'object' && value && Object.keys(value).length === 0) {
					return undefined;
				}
				if (Array.isArray(value) && value.length === 0) {
					return undefined;
				}

				return value;
			},
			2,
		);

		fs.writeFileSync(path.join(jsonDir, buildOption.guid + '.json'), json);

		Runtime.DEBUG = true;

		logger.log(
			'所有任务均已完成：',
			JSON.parse(
				JSON.stringify(
					JSON.parse(json),
					function (key, value) {
						if (key === 'classes') return Object.keys(value).length;
						if (key === 'contexts') return value;
						if (key === 'strings') return Object.keys(value).length;
						if (value instanceof Array) {
							return value.length;
						}
						return value;
					},
					2,
				),
			),
		);
	} catch (error) {
		console.error(error);
	}
}
