import {
	encrypt,
	base64ToArrayBuffer,
	decrypt,
	aesEncrypt,
	arrayBufferToBase64,
	aesDecrypt,
	md5,
	sha256,
	uuidv4,
	getRandomBytes,
} from '@ka-libs/crypto';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { BUILD_ARGS, STRING_OPT } from '../config/constans';
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
import { crc32, gzipSync } from 'zlib';
import utils, { normalizePath } from './utils';

import { BuildC, extractArchive } from '../';
// import { buildC, createFooter, toBuf, toBufC } from '../../../ka-buildc/src/core/build';
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
	const fileType = Runtime.settings.debugRuntime ? '.php' : '.tmp';

	return wrapPhpCode(/* php */ `
	function ${symbols.createTempFile}($${contents}, $${prefix}, $${tempDir}) {
		@mkdir($${tempDir}, 0700, true);
		$${tempFile} = $${tempDir} . '/ka_' . $${prefix} . bin2hex(random_bytes(6)) . '${fileType}';
		touch($${tempFile});

		file_put_contents($${tempFile}, $${contents});
		return $${tempFile};
	}`);
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
	return wrapPhpCode(/* php */ `
	function ${symbols.getRelativeFileKey}($${file}) {
		$${absPath} = str_replace(['/', '\\\\'], '.', ABSPATH);
		$${relative} = str_replace(['/', '\\\\'], '.', $${file});

		$${relative} = str_replace($${absPath}, '', $${relative});
		$${relative} = preg_replace('/\\.php$/i', '', $${relative});

		return trim($${relative}, '.');
	}`);
}

export function Build_Function_AesDecrypt() {
	const { symbols } = Runtime.options;

	const encrypted = generateVariableName();
	const payload = generateVariableName();
	const plainText = generateVariableName();
	return wrapPhpCode(/* php */ `
	function ${symbols.aesDecrypt}($${encrypted}, $${payload}) {
		$${plainText} = openssl_decrypt($${encrypted}, 'aes-256-gcm', substr($${payload}, 0, 32), OPENSSL_RAW_DATA, substr($${payload}, 32, 12), substr($${payload}, 44, 16));
		if($${plainText} === false) {
			return '';
		}
		
		return json_decode($${plainText}, true);
	}`);
}

export function Build_Function_FindBinariesDir() {
	const { symbols } = Runtime.options;
	const { resource } = Runtime.options;

	const phpFile = generateVariableName();
	const dir = generateVariableName();
	const candidate = generateVariableName();

	return wrapPhpCode(/* php */ `
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
	}`);
}

export function Build_Function_FileSeek() {
	const { symbols } = Runtime.options;

	const source = generateVariableName();
	const offset = generateVariableName();
	const length = generateVariableName();
	const fileSize = generateVariableName();

	const fileOpen = generateVariableName();
	const data = generateVariableName();
	return wrapPhpCode(/* php */ `
	function ${symbols.fileSeek}($${source}, $${offset} = 0, $${length} = 0) {
		$${fileSize} = filesize($${source});
		if ($${fileSize} === false || $${fileSize} === 0) {
			return '';
		}

		if($${offset} < 0) {
			$${offset} = $${fileSize} + $${offset};
		}

		if ($${offset} < 0) {
			return '';
		}

		if ($${offset} >= $${fileSize}) {
			return '';
		}

		if ($${length} <= 0) {
			$${length} = $${fileSize} - $${offset};
			if ($${length} <= 0) return '';
		}

		$${fileOpen} = fopen($${source}, 'rb');
		if (!$${fileOpen}) {
			return '';
		}
		
		try {
			fseek($${fileOpen}, $${offset}, SEEK_SET);
			$${data} = fread($${fileOpen}, $${length});
			return $${data} !== false ? $${data} : '';
		} finally {
			fclose($${fileOpen});
		}
	}`);
}

export function Build_Function_Decrypt() {
	const { symbols } = Runtime.options;

	const source = generateVariableName();
	const privateKey = generateVariableName();
	const binary = generateVariableName();
	const payload = generateVariableName();
	const offset = generateVariableName();
	const length = generateVariableName();

	return wrapPhpCode(/* php */ `
	function ${symbols.decrypt}(string $${source}, int $${offset} = 0, int $${length} = 0) {
		static $${privateKey} = ${JSON.stringify(Runtime.privateKey)};

		$${binary} = ${symbols.fileSeek}($${source}, $${offset}, $${length});
		
		// 切分数据：前 256 字节是 RSA 加密的载荷，剩余的是 AES 密文 
		if (!openssl_private_decrypt(substr($${binary}, 0, 256), $${payload}, $${privateKey}, OPENSSL_PKCS1_OAEP_PADDING)) {
			return '';
		}
		return ${symbols.aesDecrypt}(substr($${binary}, 256), substr($${payload}, -60));
	}`);
}

export function Build_Function_ExtractFooter() {
	const { symbols } = Runtime.options;
	const { Replacement } = BuildC;
	const footer = BuildC.createFooter();

	const phpFile = generateVariableName();
	const binFile = generateVariableName();
	const sourceDir = generateVariableName();
	const rawFooter = generateVariableName();
	const footerArr = generateVariableName();

	return wrapPhpCode(/* php */ `
	function ${symbols.extractFooter}($${phpFile}) {
		$${sourceDir} = ${buildSourceDirValue(phpFile)};
		$${binFile} = ${buildBinFileValue(sourceDir)};
		$${rawFooter} = ${symbols.fileSeek}($${binFile}, -${footer.size}, ${footer.size});

		if ($${rawFooter} === '' || strlen($${rawFooter}) !== ${footer.size}) {
			throw new Exception('Failed to read complete File');
		}

		$${footerArr} = unpack('${footer.unpacker}', $${rawFooter});
		if($${footerArr}['${Replacement.KA_C_FOOTER_MAGIC_NAME}'] !== '${Replacement.KA_C_FOOTER_MAGIC_STR}') {
			throw new Exception('Invalid Data');
		}
		return $${footerArr};
	}`);
}

export function Build_Function_getBinaryFileChunk() {
	const { symbols, resource } = Runtime.options;
	const { Replacement } = BuildC;

	const phpFile = generateVariableName();
	const chunks = generateVariableName();
	const binDir = generateVariableName();
	const runtimeKey = generateVariableName();
	const binFile = generateVariableName();
	const chunkName = generateVariableName();
	const sub = generateVariableName();
	const footerArr = generateVariableName();

	return wrapPhpCode(/* php */ `
	function ${symbols.getBinaryFileChunk}($${phpFile}, $${sub} = '') {
		static $${chunks} = [];

		${Runtime.runtimeDir ? '' : `$${binDir} = ${buildSourceDirValue(phpFile)};`}

		$${runtimeKey} = ${
			Runtime.runtimeDir
				? /* php */ `'${resource.KA_RUMTIME_KEY}'`
				: /* php */ `${symbols.getRelativeFileKey}($${binDir})`
		};
		$${binFile} = ${buildBinFileValue(binDir)};

		if (!array_key_exists($${runtimeKey} , $${chunks})) {
			if ($${binFile} && is_file($${binFile})) {
				$${footerArr} = ${symbols.extractFooter}($${phpFile});
				$${chunks}[$${runtimeKey}] = ${symbols.decrypt}($${binFile}, $${footerArr}['${Replacement.KA_C_FOOTER_CHUNKS_OFFSET_NAME}'], $${footerArr}['${Replacement.KA_C_FOOTER_CHUNKS_LENGTH_NAME}']);
			} else {
				$${chunks}[$${runtimeKey}] = [];
			}
		}

		$${chunkName} = ${symbols.getRelativeFileKey}($${phpFile}) . $${sub};
		return $${chunks}[$${runtimeKey}][md5($${chunkName})] ?? [0, 0];
	}`);
}

export function Build_Function_GetStringPool() {
	const { symbols, contextName } = Runtime.options;
	const binFile = generateVariableName();
	const contents = generateVariableName();
	const sourceDir = generateVariableName();

	const offset = generateVariableName();
	const length = generateVariableName();

	return wrapPhpCode(/* php */ `
	function ${symbols.getStringPool}() {
		$${sourceDir} = ${buildSourceDirValue()};
		$${binFile} = ${buildBinFileValue(sourceDir)};

		[$${offset}, $${length}] = ${symbols.getBinaryFileChunk}($GLOBALS['${contextName}'], '.string');
		$${contents} = ${symbols.decrypt}($${binFile}, $${offset}, $${length});

		if (empty($${contents})) {
			return '[]';
		}

		return $${contents};
	}`);
}

export function Build_Function_GetPhpFile() {
	if (!Runtime.settings.encrypt) return '';

	const { symbols, contextName } = Runtime.options;

	const phpFile = generateVariableName();
	const tmpFile = generateVariableName();
	const binFile = generateVariableName();
	const contents = generateVariableName();
	const sourceDir = generateVariableName();

	const fileKey = generateVariableName();
	const prefix = generateVariableName();

	const offset = generateVariableName();
	const length = generateVariableName();

	const process = generateVariableName();
	const pipes = generateVariableName();

	// /* php */ `
	// $${process} = proc_open(
	// 	'"' . $GLOBALS['${Runtime.options.runtimeDirName}'] . DIRECTORY_SEPARATOR . '${Replacement.KA_C_RUNTIME_EXE_NAME}${Replacement.KA_C_RUNTIME_EXE_FILETYPE}' . '"' . ' --write ' . $${prefix},
	// 	[
	// 		0 => ['pipe', 'r'],
	// 		1 => ['pipe', 'w'],
	// 		2 => ['pipe', 'w'],
	// 	],
	// 	$${pipes}
	// );

	// if (is_resource($${process})) {
	// 	fwrite($${pipes}[0], $${contents});
	// 	fclose($${pipes}[0]);

	// 	$${tmpFile} = trim(stream_get_contents($${pipes}[1]));
	// 	fclose($${pipes}[1]);

	// 	fclose($${pipes}[2]);

	// 	proc_close($${process});
	// }
	// `;
	return wrapPhpCode(/* php */ `
	function ${symbols.getPhpFile}(string $${phpFile}) {

		$${fileKey} = ${symbols.getRelativeFileKey}($${phpFile});
		$${prefix} = md5($${fileKey}) . '_';

		$${sourceDir} = ${buildSourceDirValue(phpFile)};
		$${binFile} = ${buildBinFileValue(sourceDir)};

		[$${offset}, $${length}] = ${symbols.getBinaryFileChunk}($${phpFile});
		$${contents} = ${symbols.decrypt}($${binFile}, $${offset}, $${length});

		$${tmpFile} = ${symbols.createTempFile}($${contents}, $${prefix}, ${buildTempDir(sourceDir)});
		$GLOBALS['${contextName}'] = $${phpFile};

		${
			Runtime.settings.debugRuntime
				? ''
				: /* php */ `
			register_shutdown_function(function () use ($${tmpFile}) {
				@unlink($${tmpFile});
			});`
		}

		return $${tmpFile};
	}`);
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

	return wrapPhpCode(/* php */ `
	$${binary} = file_get_contents(__DIR__ . '/${KA_RUNTIME_INNER_DATA}');
	$${contents} = ${symbols.aesDecrypt}(substr($${binary}, 60), substr($${binary}, 0, 60));

	$${tmpFile} = ${symbols.createTempFile}($${contents}, '', ${buildTempDir()});
	include $${tmpFile};`);
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
	// 使用 fileSeek 减少一定量的内存消耗
	innerRuntime += Build_Function_FileSeek();
	// 解密 dat 文件
	innerRuntime += Build_Function_Decrypt();
	// 获取 Footer 数据
	innerRuntime += Build_Function_ExtractFooter();
	// 获取文件在 BinaryFile 中的 chunk 位置
	innerRuntime += Build_Function_getBinaryFileChunk();
	// 根据要不要加密入口代码生成不一样的runtime文件
	innerRuntime += Build_Function_GetPhpFile();
	// 获取字符串的函数
	innerRuntime += Build_Function_GetStringPool();

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
	const { Replacement } = BuildC;

	const runtimeFile = path.resolve(path.dirname(entryFilePath), resource.KA_RUNTIME_DATA);
	mkdirp.sync(path.dirname(runtimeFile));

	// 外层的 runtime 定义基础的 Aes 解密和临时文件引用函数
	let runtime = buildAutoUnlinkScript();
	// 解密的文件需要保存成临时文件引用
	runtime += Build_Function_CreateTempFile();
	// Aes 解密是不能进一步加密的第一个入口文件
	runtime += Build_Function_AesDecrypt();
	// 获取文件路径的函数
	runtime += Build_Function_GetRelativeFileKey();
	// 获取文件目录下的 binaries 文件
	runtime += Build_Function_FindBinariesDir();
	// 使用 fileSeek 减少一定量的内存消耗
	runtime += Build_Function_FileSeek();
	// 解密 dat 文件
	runtime += Build_Function_Decrypt();
	// 获取 Footer 数据
	runtime += Build_Function_ExtractFooter();
	// 获取文件在 BinaryFile 中的 chunk 位置
	runtime += Build_Function_getBinaryFileChunk();
	// 根据要不要加密入口代码生成不一样的runtime文件
	runtime += Build_Function_GetPhpFile();
	// 获取字符串的函数
	runtime += Build_Function_GetStringPool();

	// const data = new TextEncoder().encode(runtime);
	const aes = await aesEncrypt(stripPhpComments(runtime), true);

	// fs.writeFileSync(runtimeFile, new Uint8Array(aes.data));

	// 将 runtime 硬编码进 EXE
	// if (BUILD_ARGS.INJECT_EXE) {
	Replacement.KA_C_BINFILE = '';
	Replacement.KA_C_AES_DATA_VALUE = BuildC.toBufC(aes.data);
	Replacement.KA_C_AES_DATA_LEN = aes.data.byteLength + '';
	// } else {
	// Replacement.KA_C_BINFILE = path.basename(resource.KA_PHP_BINARIES);
	// Replacement.KA_C_AES_DATA_LEN = '0';

	// 更新 chunks 记录
	// Replacement.KA_C_RUMTIME_HEX = uuidv4(true);
	// await updateChunks(Replacement.KA_C_RUMTIME_HEX, aes.data);
	// }
	// 原始随机密钥（不变）
	const realKey = new Uint8Array(aes.payload.slice(0, 32));
	const realIv = new Uint8Array(aes.payload.slice(32, 32 + 12));
	const realTag = new Uint8Array(aes.payload.slice(-16)); // GCM tag 也建议混淆
	// 生成一次性 XOR 掩码（每次构建随机）
	const xorMaskKey = getRandomBytes(32);
	const xorMaskIv = getRandomBytes(12);
	const xorMaskTag = getRandomBytes(16);

	// 预计算混淆后的值
	const obfKey = Buffer.alloc(32);
	const obfIv = Buffer.alloc(12);
	const obfTag = Buffer.alloc(16);
	for (let i = 0; i < 32; i++) obfKey[i] = realKey[i] ^ xorMaskKey[i];
	for (let i = 0; i < 12; i++) obfIv[i] = realIv[i] ^ xorMaskIv[i];
	for (let i = 0; i < 16; i++) obfTag[i] = realTag[i] ^ xorMaskTag[i];

	Replacement.KA_C_AES_KEY = BuildC.toBufC(obfKey.buffer);
	Replacement.KA_C_AES_IV = BuildC.toBufC(obfIv.buffer);
	Replacement.KA_C_AES_TAG = BuildC.toBufC(obfTag.buffer);
	Replacement.KA_C_AES_MASK_KEY = BuildC.toBufC(xorMaskKey.buffer);
	Replacement.KA_C_AES_MASK_IV = BuildC.toBufC(xorMaskIv.buffer);
	Replacement.KA_C_AES_MASK_TAG = BuildC.toBufC(xorMaskTag.buffer);

	Replacement.KA_C_RUNTIME_DIR_NAME = Runtime.options.runtimeDirName;
	Replacement.KA_C_TEMP_PREFIX_STR = '';
	Replacement.KA_C_TEMP_PREFIX_LEN = Replacement.KA_C_TEMP_PREFIX_STR.length + '';

	const cName = Replacement.KA_C_RUNTIME_EXE_NAME;

	if (!BUILD_ARGS.url) {
		throw new Error('Remote BuildC url is required');
	}
	const zipPath = await BuildC.buildRemote(cName, BUILD_ARGS.url);

	// 解压编译的程序到目标文件夹
	await extractArchive(zipPath, path.dirname(runtimeFile));

	for (const file of await fsp.readdir(path.dirname(runtimeFile))) {
		if (file.includes(cName)) {
			// 记录 exe 路径
			Replacement.KA_C_RUMTIME_PATH = path.resolve(path.dirname(runtimeFile), file);
			Replacement.KA_C_RUNTIME_EXE_FILETYPE = path.extname(file);
		}
	}

	await fsp.unlink(zipPath);

	const output = generateVariableName();
	return /* php */ `
		exec(escapeshellarg(__DIR__ . '/${resource.KA_BINARIES_DIR}/${Replacement.KA_C_RUNTIME_EXE_NAME}${Replacement.KA_C_RUNTIME_EXE_FILETYPE}') . ' 2>' . (PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null'), $${output});
		include (trim($${output}[0] ?? ''));
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

export async function getChunksRecord() {
	const { resource } = Runtime.options;

	const binFile = Runtime.runtimeDir
		? path.resolve(Runtime.distRoot, Runtime.runtimeDir, resource.KA_PHP_BINARIES)
		: path.resolve(Runtime.distDir, resource.KA_PHP_BINARIES);

	await mkdirp(path.dirname(binFile));

	const chunkRecordFile = Runtime.runtimeDir
		? path.resolve(Runtime.distRoot, Runtime.runtimeDir, resource.KA_PHP_CHUNK_RECORD)
		: path.resolve(Runtime.distDir, resource.KA_PHP_CHUNK_RECORD);

	let chunkRecord: Record<string, [number, number, string]> = {};
	if (fs.existsSync(chunkRecordFile)) {
		const recordBuffer = await fsp.readFile(chunkRecordFile);
		chunkRecord = await decrypt(recordBuffer.buffer, Runtime.privateKey);

		return {
			binFile,
			chunkRecordFile,
			chunkRecord,
			chunkBuffer: new Uint8Array(recordBuffer.buffer),
		};
	}
	return { binFile, chunkRecordFile, chunkRecord, chunkBuffer: new Uint8Array(0) };
}

export async function updateChunks(chunkName: string, data: ArrayBuffer) {
	const { binFile, chunkRecordFile, chunkRecord } = await getChunksRecord();

	// console.log(chunkRecord);
	let offset = 0;
	if (fs.existsSync(binFile)) {
		const stat = await fsp.stat(binFile);
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

export async function mergeChunks(targetBinFile: string) {
	const { resource } = Runtime.options;

	const { binFile, chunkRecordFile, chunkRecord } = await getChunksRecord();
	if (!fs.existsSync(targetBinFile)) return;
	if (!fs.existsSync(binFile)) return;
	if (!fs.existsSync(chunkRecordFile)) return;

	// console.log(chunkRecord);
	let offset = 0;

	const stat = await fsp.stat(targetBinFile);
	offset = stat.size;

	for (const key of Object.keys(chunkRecord)) {
		chunkRecord[key][0] += offset;
	}

	const chunkRecordEncrypted = await encrypt(chunkRecord, Runtime.publicKey, true);

	if (!chunkRecordEncrypted) return;
	await fsp.writeFile(chunkRecordFile, new Uint8Array(chunkRecordEncrypted));

	await fsp.appendFile(targetBinFile, await fsp.readFile(binFile));
	resource.KA_PHP_BINARIES = `${resource.KA_BINARIES_DIR}/${path.basename(targetBinFile)}`;

	console.log(`🔐 ==> Merge ${binFile} -> ${targetBinFile}`);

	await fsp.unlink(binFile);
}

export async function appendChunksToBinFile() {
	const { Replacement } = BuildC;

	// 获取新的信息
	const { binFile, chunkRecordFile, chunkRecord, chunkBuffer } = await getChunksRecord();

	if (!fs.existsSync(chunkRecordFile)) return;

	const binFileBuffer = await fsp.readFile(binFile);

	const chunkName = md5(Replacement.KA_C_RUMTIME_HEX);
	const [runtimeOffset, runtimeLength] = chunkRecord[chunkName] ?? [0, 0];

	// 1. 从 binaryFile(exe) 中精确读取 runtime 区段用于 CRC
	const runtimeBuffer = binFileBuffer.buffer.slice(runtimeOffset, runtimeOffset + runtimeLength);

	// 构建 64 字节 Footer
	const footer = BuildC.createFooter(
		runtimeOffset,
		runtimeLength,
		// Chunks Offset
		binFileBuffer.byteLength,
		// Chunks Length
		chunkBuffer.byteLength,
		crc32(new Uint8Array(runtimeBuffer)),
		crc32(chunkBuffer),
	);

	// 拼接 Chunks
	await fsp.appendFile(binFile, chunkBuffer);
	await fsp.unlink(chunkRecordFile);

	// 拼接 Footer
	await fsp.appendFile(binFile, footer.buffer);

	await checkBinaryData();

	console.log(`✅ Runtime ${path.basename(binFile)} Appended:`);
	console.log(`   Runtime: offset=${runtimeOffset}, len=${runtimeBuffer.byteLength}`);
	console.log(`   Chunks:  offset=${binFileBuffer.byteLength}, len=${chunkBuffer.byteLength}`);
}

export async function checkBinaryData() {
	const { resource } = Runtime.options;
	const {
		KA_C_AES_KEY,
		KA_C_AES_IV,
		KA_C_AES_TAG,
		KA_C_FOOTER_RUNTIME_OFFSET_NAME,
		KA_C_FOOTER_RUNTIME_LENGTH_NAME,
		KA_C_FOOTER_CHUNKS_OFFSET_NAME,
		KA_C_FOOTER_CHUNKS_LENGTH_NAME,
	} = BuildC.Replacement;

	const binFile = Runtime.runtimeDir
		? path.resolve(Runtime.distRoot, Runtime.runtimeDir, resource.KA_PHP_BINARIES)
		: path.resolve(Runtime.distDir, resource.KA_PHP_BINARIES);

	const binFileBuffer = await fsp.readFile(binFile);

	const footer = BuildC.createFooter();

	const result = footer.unpack(Buffer.from(binFileBuffer.buffer.slice(-footer.size)));
	console.log({ result });

	const runtime = binFileBuffer.buffer.slice(
		result[KA_C_FOOTER_RUNTIME_OFFSET_NAME],
		result[KA_C_FOOTER_RUNTIME_OFFSET_NAME] + result[KA_C_FOOTER_RUNTIME_LENGTH_NAME],
	);

	if (runtime.byteLength > 0) {
		console.log('\nAesDecrypt runtime checkBinaryData');
		try {
			const payload = BuildC.toBuf([KA_C_AES_KEY, KA_C_AES_IV, KA_C_AES_TAG].join(', '));
			await aesDecrypt(runtime, payload);
			console.log('AesDecrypt runtime Success\n');
		} catch (e) {
			console.log(e);
		}
	}

	const chunksRecord = binFileBuffer.buffer.slice(
		result[KA_C_FOOTER_CHUNKS_OFFSET_NAME],
		result[KA_C_FOOTER_CHUNKS_OFFSET_NAME] + result[KA_C_FOOTER_CHUNKS_LENGTH_NAME],
	);

	console.log('\ndecrypt chunksRecord checkBinaryData');
	try {
		await decrypt(chunksRecord, Runtime.privateKey);
		console.log('decrypt chunksRecord Success\n');
	} catch (e) {
		console.log(e);
	}
}

export async function mergeAllBinaries() {
	// 创建 exe 入口时，合并 binaryFile 到 exe
	if (Runtime.settings.injectExe) {
		const { KA_C_RUMTIME_PATH } = BuildC.Replacement;

		if (!fs.existsSync(KA_C_RUMTIME_PATH)) return;
		// 将 binaryFile 合并追加到 RuntimeExe 尾部
		await mergeChunks(KA_C_RUMTIME_PATH);
	}
	await appendChunksToBinFile();
}

export function buildSourceDirValue(phpFile?: string) {
	const { symbols, contextName } = Runtime.options;

	if (Runtime.runtimeDir) {
		return /* php */ `realpath(ABSPATH . DIRECTORY_SEPARATOR . '${Runtime.runtimeDir}')`;
	}
	if (phpFile) {
		return /* php */ `dirname(${symbols.findBinariesDir}($${phpFile}))`;
	}
	return /* php */ `dirname(${symbols.findBinariesDir}($GLOBALS['${contextName}']))`;
}

export function buildBinFileValue(sourceDir: string) {
	const { resource } = Runtime.options;
	const { Replacement } = BuildC;

	if (Runtime.settings.injectExe) {
		return /* php */ `$GLOBALS['${Runtime.options.runtimeDirName}'] . DIRECTORY_SEPARATOR . '${Replacement.KA_C_RUNTIME_EXE_NAME}${Replacement.KA_C_RUNTIME_EXE_FILETYPE}'`;
	}
	if (Runtime.runtimeDir) {
		return /* php */ `realpath(ABSPATH . DIRECTORY_SEPARATOR . '${Runtime.runtimeDir}' . DIRECTORY_SEPARATOR . '${resource.KA_PHP_BINARIES}')`;
	}
	return /* php */ `$${sourceDir} . '/${resource.KA_PHP_BINARIES}'`;
}

export function buildAutoUnlinkScript() {
	if (Runtime.settings.debugRuntime) {
		return '';
	}

	const thePhpFile = generateVariableName();
	const code = /* php */ `
	$${thePhpFile} = __FILE__;
	@unlink($${thePhpFile});
	register_shutdown_function(function () use ($${thePhpFile}) {
		@unlink($${thePhpFile});
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

export function wrapPhpCode(code: string) {
	return `<?php
	${code}
	?>`;
}

export * as default from './pipeUtil';
