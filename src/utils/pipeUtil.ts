import {
	encrypt,
	base64ToArrayBuffer,
	decrypt,
	aesEncrypt,
	arrayBufferToBase64,
	aesDecrypt,
	md5,
	sha256,
} from '@ka-libs/crypto';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { STRING_OPT } from '../config/constans';
import { Runtime } from '../core/runtime';
import { AstNode } from '../types';
import { isKind } from './typeGard';
import type PhpParser from 'php-parser';
import logger from './logger';
import { fileURLToPath } from 'url';
import { BuildContext } from '../core/buildOption';
import {
	generateConstantName,
	generateVariableName,
	getNodeName,
	phpString,
	stripPhpComments,
} from './helper';
import { mkdirp } from 'mkdirp';
import { gzipSync } from 'zlib';
import utils, { normalizePath } from './utils';
import { buildC, toBufC } from './buildC';
const __filename = fileURLToPath(import.meta.url);

const { ENABLE_STRING_POOL, ENABLE_POOL_COMPRESS, MIN_STRING_LENGTH } = STRING_OPT;

export function combinedDCode(valid: ArrayBuffer, data: ArrayBuffer) {}
export async function generateStringPoolFunction(buildContext: BuildContext): Promise<string> {
	const { stringPoolFunction } = buildContext.runtime;
	const { symbols } = Runtime.options;
	const pool: Record<number, string> = {};
	for (const [value, id] of buildContext.strings.entries()) {
		pool[id] = value;
	}

	let poolValue = /* php */ `json_decode(${phpString(JSON.stringify(pool))}, true)`;

	if (Runtime.settings.encrypt) {
		const encrypted = await encrypt(pool, Runtime.publicKey, true);
		if (encrypted) {
			const chunkName = getRelativeFileKey(Runtime.distEntry) + '.string';
			await updateChunks(chunkName, encrypted);
		}

		poolValue = `${symbols.getStringPool}()`;
	}

	return /* php */ `
/* KA_RUNTIME_START */
if (!function_exists('${stringPoolFunction}')) {
    function ${stringPoolFunction}($id) {
        static $pool = ${poolValue};
        return $pool[$id] ?? '';
    }
}
/* KA_RUNTIME_END */
`;
}

export function findInsertIndex(lines: string[]): number {
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes('/* KA_PHP_START */')) return i + 1;
		if (lines[i].includes("if (!defined('ABSPATH'))")) {
			for (let j = i; j < lines.length; j++) {
				if (lines[j].trim() === '}') return j + 1;
			}
		}
	}
	return 1;
}

export async function injectRuntimeCode(buildContext: BuildContext) {
	const entryPath = path.resolve(Runtime.distDir, Runtime.entryFile); // 根据实际入口调整

	let content = fs.readFileSync(entryPath, 'utf8');
	if (content.includes('KA_RUNTIME_START')) return;

	try {
		const runtime = await generateStringPoolFunction(buildContext);
		const lines = content.split(/\r?\n/);
		const insertIndex = findInsertIndex(lines);

		lines.splice(insertIndex, 0, '', runtime, '');
		fs.writeFileSync(entryPath, lines.join('\n'), 'utf-8');
	} catch (err: any) {
		logger.error(`❌ Runtime 注入失败: ${__filename}:${err.lineNumber}:${err.columnNumber}`);
	}
}

/**
 * 从 AST 节点递归提取纯字符串值
 * - 普通字符串字面量：直接返回
 * - Encapsed / Heredoc / Nowdoc：递归拼接所有子片段
 * - 包含变量插值或无法识别的节点：返回 null（不参与字符串池）
 */
export function extractStringValue(node: AstNode | null | undefined): string | null {
	if (!node || !isKind(node, 'string')) return null;
	// 1. 普通字符串字面量
	return node.value ?? '';
}

/**
 * 获取某个 part 在 encapsed.raw 字符串中的真实片段内容
 * @param encapsedRaw encapsed 节点本身的 raw 字符串（例如：`<<<HTML\n内容\nHTML;`）
 * @param part 需要提取内容的 part 节点
 * @param encapsedStartOffset encapsed 节点在源码中的起始偏移量 (encapsed.loc.start.offset)
 */
export function getPartContentInEncapsedRaw(
	encapsedRaw: string,
	part: AstNode<PhpParser.EncapsedPart>,
	encapsedStartOffset: number,
): string {
	if (!part.loc?.start?.offset || !part.loc?.end?.offset) {
		return '';
	}

	// 1. 计算 part 相对于 encapsedRaw 起始位置的偏移量
	const relativeStart = part.loc.start.offset - encapsedStartOffset;
	const relativeEnd = part.loc.end.offset - encapsedStartOffset;

	// 2. 在 encapsedRaw 中精准截取该片段
	return encapsedRaw.slice(relativeStart, relativeEnd);
}

export function findBuildClass(what: string | AstNode) {
	if (typeof what === 'string') {
		return Runtime.options.classes.get(what);
	}

	if (isKind(what, 'name')) {
		return Runtime.options.classes.get(getNodeName(what.name));
	}

	if (isKind(what, 'selfreference')) {
		return findSelfBuildClass(what);
	}
}

export function findSelfBuildClass(node: AstNode) {
	let parent = node.parent;

	while (parent) {
		if (isKind(parent, 'class')) {
			break;
		}
		parent = parent.parent;
	}

	if (parent) {
		try {
			return Runtime.options.classes.get(getNodeName(parent.name));
		} catch (error) {
			console.error(error);
			parent.trace();
		}
	}
}

export function Build_Function_CreateTempFile() {
	const { symbols } = Runtime.options;

	const prefix = generateVariableName();
	const contents = generateVariableName();
	const tempDir = generateVariableName();
	const tempFile = generateVariableName();
	const fileType = Runtime.settings.debugRuntime ? '.php' : '.dat';

	return /* php */ `
	function ${symbols.createTempFile}($${contents}, $${prefix}, $${tempDir}) {
		@mkdir($${tempDir}, 0700, true);
		$${tempFile} = $${tempDir} . '/ka_' . $${prefix} . bin2hex(random_bytes(6)) . '${fileType}';
		touch($${tempFile});

		file_put_contents($${tempFile}, $${contents});
		return $${tempFile};
	}`;
}

export function getRelativeFileKey(filePath: string) {
	const relative = normalizePath(path.relative(Runtime.distRoot, filePath));
	return relative.replace(/\//g, '.').replace(/\.php$/, '');
}

export function Build_Function_GetRelativeFileKey() {
	const { symbols } = Runtime.options;
	const file = generateVariableName();
	const relative = generateVariableName();
	const absPath = generateVariableName();
	return /* php */ `
	function ${symbols.getRelativeFileKey}($${file}) {
		$${absPath} = str_replace(['/', '\\\\'], '.', ABSPATH);
		$${relative} = str_replace(['/', '\\\\'], '.', $${file});

		$${relative} = str_replace($${absPath}, '', $${relative});
		$${relative} = preg_replace('/\\.php$/i', '', $${relative});

		return trim($${relative}, '.');
	}`;
}

export function Build_Function_AesDecrypt() {
	const { symbols } = Runtime.options;

	const encrypted = generateVariableName();
	const payload = generateVariableName();
	const plainText = generateVariableName();
	return /* php */ `
	function ${symbols.aesDecrypt}($${encrypted}, $${payload}) {
		$${plainText} = openssl_decrypt($${encrypted}, 'aes-256-gcm', substr($${payload}, 0, 32), OPENSSL_RAW_DATA, substr($${payload}, 32, 12), substr($${payload}, 44, 16));
		if($${plainText} === false) {
			return '';
		}
		
		return json_decode($${plainText}, true);
	}`;
}

export function Build_Function_FindBinariesDir() {
	const { symbols } = Runtime.options;
	const { resource } = Runtime.options;

	const phpFile = generateVariableName();
	const dir = generateVariableName();
	const candidate = generateVariableName();

	return /* php */ `
	function ${symbols.findBinariesDir}($${phpFile}) {
		$${dir} = is_dir($${phpFile}) ? $${phpFile} : dirname($${phpFile});

		while ($${dir} !== dirname($${dir})) {
			$${candidate} = $${dir} . DIRECTORY_SEPARATOR . '${resource.KA_BINARIES_DIR}';
			if (is_dir($${candidate})) {
				return $${candidate};
			}

			$${dir} = dirname($${dir});
		}

		return '';
	}`;
}

export function Build_Function_Decrypt() {
	const { symbols } = Runtime.options;

	const source = generateVariableName();
	const privateKey = generateVariableName();
	const binary = generateVariableName();
	const payload = generateVariableName();
	const offset = generateVariableName();
	const length = generateVariableName();

	return /* php */ `
	function ${symbols.decrypt}(string $${source}, int $${offset} = 0, int $${length} = 0) {
		static $${privateKey} = ${JSON.stringify(Runtime.privateKey)};
		$${binary} = file_get_contents($${source});
		
		if($${length} > 0) {
			$${binary} = substr($${binary}, $${offset}, $${length});
		}
		// 切分数据：前 256 字节是 RSA 加密的载荷，剩余的是 AES 密文 
		if (!openssl_private_decrypt(substr($${binary}, 0, 256), $${payload}, $${privateKey}, OPENSSL_PKCS1_OAEP_PADDING)) {
			return '';
		}
		return ${symbols.aesDecrypt}(substr($${binary}, 256), substr($${payload}, -60));
	}`;
}

export function Build_Function_getBinaryFileChunk() {
	const { symbols } = Runtime.options;
	const { resource } = Runtime.options;

	const phpFile = generateVariableName();
	const chunks = generateVariableName();
	const binDir = generateVariableName();
	const runtimeKey = generateVariableName();
	const chunkFile = generateVariableName();
	const chunkName = generateVariableName();
	const sub = generateVariableName();

	const defineBinDir = Runtime.runtimeDir
		? ''
		: `$${binDir} = ${symbols.findBinariesDir}($${phpFile});`;

	const runtimeKeyValue = Runtime.runtimeDir
		? /* php */ `'${resource.KA_RUMTIME_KEY}'`
		: /* php */ `${symbols.getRelativeFileKey}($${binDir})`;

	const chunkFileValue = Runtime.runtimeDir
		? /* php */ `realpath(ABSPATH . DIRECTORY_SEPARATOR . '${Runtime.runtimeDir}' . DIRECTORY_SEPARATOR . '${resource.KA_PHP_CHUNK_RECORD}')`
		: /* php */ `$${binDir} . '/${resource.KA_PHP_CHUNK_RECORD}'`;

	return /* php */ `
	function ${symbols.getBinaryFileChunk}($${phpFile}, $${sub} = '') {
		static $${chunks} = [];

		${defineBinDir}
		$${runtimeKey} = ${runtimeKeyValue};
		$${chunkFile} = ${chunkFileValue};

		if (!array_key_exists($${runtimeKey} , $${chunks})) {
			if ($${chunkFile} && is_file($${chunkFile})) {
				$${chunks}[$${runtimeKey}] = ${symbols.decrypt}($${chunkFile});
			} else {
				$${chunks}[$${runtimeKey}] = [];
			}
		}

		$${chunkName} = ${symbols.getRelativeFileKey}($${phpFile}) . $${sub};
		return $${chunks}[$${runtimeKey}][md5($${chunkName})] ?? [0, 0];
	}`;
}

export function Build_Function_GetPhpFile() {
	if (!Runtime.settings.encrypt) return '';

	const { symbols } = Runtime.options;

	const KA_CONTEXT = generateConstantName().toUpperCase();
	const { resource } = Runtime.options;

	const phpFile = generateVariableName();
	const tmpFile = generateVariableName();
	const binFile = generateVariableName();
	const contents = generateVariableName();
	const sourceDir = generateVariableName();

	const fileKey = generateVariableName();
	const prefix = generateVariableName();

	const offset = generateVariableName();
	const length = generateVariableName();

	const binFileValue = Runtime.runtimeDir
		? /* php */ `realpath(ABSPATH . DIRECTORY_SEPARATOR . '${Runtime.runtimeDir}' . DIRECTORY_SEPARATOR . '${resource.KA_PHP_BINARIES}')`
		: /* php */ `$${sourceDir} . '/${resource.KA_PHP_BINARIES}'`;

	const sourceDirValue = Runtime.runtimeDir
		? /* php */ `realpath(ABSPATH . DIRECTORY_SEPARATOR . '${Runtime.runtimeDir}')`
		: /* php */ `dirname(${symbols.findBinariesDir}($${phpFile}))`;

	let execFunction = /* php */ `
		function ${symbols.getStringPool}() {
			$${binFile} = ${binFileValue};

			[$${offset}, $${length}] = ${symbols.getBinaryFileChunk}($GLOBALS['${KA_CONTEXT}'], '.string');
			$${contents} = ${symbols.decrypt}($${binFile}, $${offset}, $${length});

			if (empty($${contents})) {
				return '[]';
			}

			return $${contents};
		}`;

	execFunction += /* php */ `
		function ${symbols.getPhpFile}(string $${phpFile}) {
			$${fileKey} = ${symbols.getRelativeFileKey}($${phpFile});
			$${prefix} = md5($${fileKey}) . '_';
			$${sourceDir} = ${sourceDirValue};

			$${binFile} = ${binFileValue};

			[$${offset}, $${length}] = ${symbols.getBinaryFileChunk}($${phpFile});
			$${contents} = ${symbols.decrypt}($${binFile}, $${offset}, $${length});

			$${tmpFile} = ${symbols.createTempFile}($${contents}, $${prefix}, ${buildTempDir(sourceDir)});

			$GLOBALS['${KA_CONTEXT}'] = $${phpFile};
			return $${tmpFile};
		}`;

	return execFunction;
}

export async function Build_Include_Runtime(innerRuntime: string, dataPath: string) {
	const { symbols } = Runtime.options;
	const { KA_RUNTIME_INNER_DATA } = Runtime.options.resource;

	const phpScript = buildAutoUnlinkScript() + '<?php\n' + innerRuntime;
	const result = await aesEncrypt(stripPhpComments(phpScript), true);
	const buf = new Uint8Array(result.data.byteLength + result.payload.byteLength);
	buf.set(new Uint8Array(result.payload), 0);
	buf.set(new Uint8Array(result.data), result.payload.byteLength);
	fs.writeFileSync(dataPath, buf, 'binary');

	const binary = generateVariableName();
	const tmpFile = generateVariableName();
	const contents = generateVariableName();

	return /* php */ `
	$${binary} = file_get_contents(__DIR__ . '/${KA_RUNTIME_INNER_DATA}');
	$${contents} = ${symbols.aesDecrypt}(substr($${binary}, 60), substr($${binary}, 0, 60));

	$${tmpFile} = ${symbols.createTempFile}($${contents}, '', ${buildTempDir()});
	include $${tmpFile};`;
}

export async function buildRuntimeFile(entryFilePath: string) {
	if (!Runtime.isRuntimeEntry) return '';
	const { resource } = Runtime.options;

	const runtimeFile = path.resolve(path.dirname(entryFilePath), resource.KA_RUNTIME_DATA);
	mkdirp.sync(path.dirname(runtimeFile));

	// 外层的 runtime 定义基础的 Aes 解密和临时文件引用函数
	let runtime = '';
	// 解密的文件需要保存成临时文件引用
	runtime += Build_Function_CreateTempFile();
	// Aes 解密是不能进一步加密的第一个入口文件
	runtime += Build_Function_AesDecrypt();

	// 内层的 runtime 定义 RSA 混合解密，临时文件引用等
	let innerRuntime = '';
	// 获取文件路径的函数
	innerRuntime += Build_Function_GetRelativeFileKey();
	// 获取文件目录下的 binaries 文件
	innerRuntime += Build_Function_FindBinariesDir();
	// 解密 dat 文件
	innerRuntime += Build_Function_Decrypt();
	// 获取文件在 BinaryFile 中的 chunk 位置
	innerRuntime += Build_Function_getBinaryFileChunk();
	// 根据要不要加密入口代码生成不一样的runtime文件
	innerRuntime += Build_Function_GetPhpFile();

	const dataFile = path.resolve(path.dirname(entryFilePath), resource.KA_RUNTIME_INNER_DATA);
	innerRuntime = await Build_Include_Runtime(innerRuntime, dataFile);

	runtime += '\n' + innerRuntime;

	const data = new TextEncoder().encode(runtime);
	fs.writeFileSync(runtimeFile, gzipSync(Buffer.from(data)));

	return /* php */ `eval(gzdecode(file_get_contents(__DIR__ . '/${resource.KA_RUNTIME_DATA}')));`;
}


export async function buildRuntimeFileC(entryFilePath: string) {
	if (!Runtime.isRuntimeEntry) return '';
	const { resource } = Runtime.options;
	const runtimeFile = path.resolve(path.dirname(entryFilePath), resource.KA_RUNTIME_DATA);
	mkdirp.sync(path.dirname(runtimeFile));

	// 外层的 runtime 定义基础的 Aes 解密和临时文件引用函数
	let runtime = '';

	// Aes 解密是不能进一步加密的第一个入口文件
	runtime += Build_Function_AesDecrypt();
	// 获取文件路径的函数
	runtime += Build_Function_GetRelativeFileKey();
	// 获取文件目录下的 binaries 文件
	runtime += Build_Function_FindBinariesDir();
	// 解密 dat 文件
	runtime += Build_Function_Decrypt();
	// 获取文件在 BinaryFile 中的 chunk 位置
	runtime += Build_Function_getBinaryFileChunk();
	// 根据要不要加密入口代码生成不一样的runtime文件
	runtime += Build_Function_GetPhpFile();

	const data = new TextEncoder().encode(runtime);
	const aes = await aesEncrypt(data, true);

	fs.writeFileSync(runtimeFile, new Uint8Array(aes.data));

	Runtime.buildC.KA_C_BINFILE = path.basename(runtimeFile);
	Runtime.buildC.KA_C_AES_KEY = toBufC(aes.payload.slice(0, 32));
	Runtime.buildC.KA_C_AES_IV = toBufC(aes.payload.slice(32, 32 + 12));
	Runtime.buildC.KA_C_AES_TAG = toBufC(aes.payload.slice(-16));

	await buildC();
	
	return /* php */ `
		dl(__DIR__ . '/${resource.KA_BINARIES_DIR}' . '/${Runtime.buildC.KA_C_RUNTIME_DLL_NAME}${Runtime.buildC.KA_C_TEMP_FILETYPE}');
		include (${Runtime.buildC.KA_C_RUNTIME_FUNCTION_NAME}());
	`;
}

export async function handlePhpFile(phpFilePath: string, phpFile: string) {
	const encryptedPhpFile = await encrypt(
		buildAutoUnlinkScript() + phpFile,
		Runtime.publicKey,
		true,
	);
	if (!encryptedPhpFile) return;

	const chunkName = getRelativeFileKey(phpFilePath);
	await updateChunks(chunkName, encryptedPhpFile);
}

export async function updateChunks(chunkName: string, data: ArrayBuffer) {
	const { resource } = Runtime.options;

	const binFile = Runtime.runtimeDir
		? path.resolve(Runtime.distRoot, Runtime.runtimeDir, resource.KA_PHP_BINARIES)
		: path.resolve(Runtime.distDir, resource.KA_PHP_BINARIES);

	mkdirp.sync(path.dirname(binFile));

	const chunkRecordFile = Runtime.runtimeDir
		? path.resolve(Runtime.distRoot, Runtime.runtimeDir, resource.KA_PHP_CHUNK_RECORD)
		: path.resolve(Runtime.distDir, resource.KA_PHP_CHUNK_RECORD);

	let chunkRecord: Record<string, [number, number, string]> = {};
	if (fs.existsSync(chunkRecordFile)) {
		const recordBuffer = await fsp.readFile(chunkRecordFile);
		chunkRecord = await decrypt(recordBuffer.buffer, Runtime.privateKey);
	}

	// console.log(chunkRecord);
	let offset = 0;
	if (fs.existsSync(binFile)) {
		const stat = fs.statSync(binFile);
		offset = stat.size;
	}

	chunkRecord[md5(chunkName)] = [offset, data.byteLength, await sha256(new Uint8Array(data))];

	// console.log(chunkRecord);
	const chunkRecordEncrypted = await encrypt(chunkRecord, Runtime.publicKey, true);

	if (!chunkRecordEncrypted) return;

	if (fs.existsSync(binFile)) {
		await fsp.appendFile(binFile, new Uint8Array(data));
	} else {
		await fsp.writeFile(binFile, new Uint8Array(data));
	}

	await fsp.writeFile(chunkRecordFile, new Uint8Array(chunkRecordEncrypted));
}

export function buildAutoUnlinkScript() {
	if (Runtime.settings.debugRuntime) {
		return '';
	}

	const code = /* php */ `
	$thePhpFile = __FILE__;
	@unlink($thePhpFile);
	register_shutdown_function(function () {
		@unlink($thePhpFile);
	});`;

	return '<?php ' + code + ' ?>\n';
}

export function buildTempDir(source: string = '') {
	if (Runtime.settings.debugRuntime) {
		const dir = source ? `$${source}` : '__DIR__';
		return /* php */ `${dir} . '/${Runtime.options.resource.KA_BINARIES_DIR}/${Runtime.tempDir}'`;
	}
	return /* php */ `sys_get_temp_dir() . '/${Runtime.tempDir}'`;
}

export * as default from './pipeUtil';
