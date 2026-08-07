import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { Runtime } from '../core/runtime';
import { fileURLToPath } from 'url';
import child_process from 'child_process';
import config from '../../config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 获取 PHP include 目录
 */
function getPhpIncludes() {
	const platform = Runtime.settings.platform.toLowerCase();

	// Windows php-sdk
	if (platform === 'win32') {
		const phpDev = config.deps.phpDev ?? process.env.PHP_DEV_PATH;

		const phpHeader = path.join(phpDev, 'main', 'php.h');

		if (!fs.existsSync(phpHeader)) {
			throw new Error(`Windows: php.h not found: ${phpHeader}`);
		}

		return [
			phpDev,
			path.resolve(phpDev, 'main'),
			path.resolve(phpDev, 'TSRM'),
			path.resolve(phpDev, 'Zend'),
		];
	}

	// Linux php-dev
	else {
		const includes = [
			'/usr/include/php',
			'/usr/include/php/main',
			'/usr/include/php/TSRM',
			'/usr/include/php/Zend',
		];

		const exists = fs.existsSync('/usr/include/php/main/php.h');

		if (!exists) {
			throw new Error('Linux: php-dev not installed. Run: sudo apt install php-dev');
		}

		return includes;
	}
}

/**
 * OpenSSL路径
 */
function getOpenSSL() {
	const platform = Runtime.settings.platform.toLowerCase();

	if (platform === 'win32') {
		const opensslLib = config.deps.opensslLib ?? process.env.OPENSSL_LIB_PATH;

		const file = path.join(opensslLib, 'libcrypto.lib');

		if (!fs.existsSync(file)) {
			throw new Error(`Windows OpenSSL lib not found: ${file}`);
		}

		return opensslLib;
	}

	return null;
}

/**
 * 创建 binding.gyp
 */
async function createBindingGyp(dirPathC: string) {
	const phpIncludes = getPhpIncludes();

	const opensslLib = getOpenSSL();

	const platform = Runtime.settings.platform.toLowerCase();

	const target = Runtime.buildC.KA_C_RUNTIME_DLL_NAME;

	const binding: any = {
		targets: [
			{
				target_name: target,

				sources: ['runtime.c'],

				include_dirs: phpIncludes,

				defines: ['COMPILE_DL_RUNTIME'],

				conditions: [
					[
						'OS!="win"',

						{
							cflags: ['-O2', '-fPIC', '-std=c11'],

							libraries: ['-lcrypto'],
						},
					],

					[
						'OS=="win"',

						{
							msvs_settings: {
								VCCLCompilerTool: {
									AdditionalOptions: ['/O2', '/std:c11'],
								},

								VCLinkerTool: {
									AdditionalLibraryDirectories: [opensslLib],
								},
							},

							libraries: ['libcrypto.lib'],
						},
					],
				],
			},
		],
	};

	const file = path.resolve(dirPathC, 'binding.gyp');

	await fsp.writeFile(file, JSON.stringify(binding, null, 2));

	console.log('✅ binding.gyp generated');

	console.log('PHP includes:', phpIncludes);

	console.log('OpenSSL:', opensslLib);

	return file;
}

/**
 * 生成 runtime.c
 */
async function createRuntimeFile() {
	const template = path.resolve(__dirname, '../buildC/template.c');

	const fileC = await fsp.readFile(template, 'utf-8');

	const lines = fileC.split('\n');

	const result: string[] = [];

	const reps = Object.keys(Runtime.buildC);

	for (const line of lines) {
		let newline = line;

		for (const rep of reps) {
			if (newline.includes(rep)) {
				newline = newline.replaceAll(rep, (Runtime.buildC as any)[rep]);
			}
		}

		result.push(newline);
	}

	const output = path.resolve(path.dirname(template), 'runtime.c');

	await fsp.writeFile(output, result.join('\n'), 'utf-8');

	return output;
}

/**
 * 执行 node-gyp
 */
function runNodeGyp(cwd: string) {
	return new Promise((resolve, reject) => {
		const isWin = process.platform === 'win32';

		const command = isWin ? 'cmd.exe' : 'node-gyp';

		const args = isWin ? ['/c', 'node-gyp.cmd', 'rebuild'] : ['rebuild'];

		console.log('Run:', command, args.join(' '));

		const child = child_process.spawn(command, args, {
			cwd,
			stdio: 'inherit',
			shell: false,
		});

		child.on('error', (err) => {
			console.error('spawn error:', err);
			reject(err);
		});

		child.on('close', (code) => {
			if (code === 0) {
				resolve(1);
			} else {
				reject(new Error(`node-gyp exited ${code}`));
			}
		});
	});
}

/**
 * 主编译入口
 */
export async function buildC() {
	const platform = Runtime.settings.platform.toLowerCase();

	const ext = platform === 'win32' ? 'dll' : 'so';

	console.log(`🔨 Target platform: ${platform}, .${ext}`);

	const pathC = await createRuntimeFile();

	const dirPathC = path.dirname(pathC);

	await createBindingGyp(dirPathC);

	try {
		await runNodeGyp(dirPathC);

		console.log(`\n🎉 Build succeeded`);

		console.log(`Output: build/Release/${Runtime.buildC.KA_C_RUNTIME_DLL_NAME}.${ext}`);
	} catch (e: any) {
		console.error('\n💥 Build failed:', e.message);
	}
}

/**
 * ArrayBuffer 转 C 数组
 */
export function toBufC(buf: ArrayBuffer) {
	const keyBytes = new Uint8Array(buf);

	return Array.from(keyBytes)
		.map((v) => `0x${v.toString(16).padStart(2, '0')}`)
		.join(', ');
}
