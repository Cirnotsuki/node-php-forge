import {
	encrypt,
	base64ToArrayBuffer,
	decrypt,
	aesEncrypt,
	arrayBufferToBase64,
	aesDecrypt,
} from '@ka-libs/crypto';
import path from 'path';
import fs from 'fs';
import {
	PACKAGE_RESOURCE,
	PHP_FILE_ENCRYPT,
	STRING_OPT,
	STRING_POOL_ENCRYPT,
} from '../config/constans';
import { Runtime } from '../core/runtime';
import { AstNode } from '../types';
import { isKind } from './typeGard';
import type PhpParser from 'php-parser';
import logger from './logger';
import { fileURLToPath } from 'url';
import { BuildContext } from '../core/buildOption';
import { generateVariableName, getNodeName, phpString } from './helper';
import { mkdirp } from 'mkdirp';
import { gzipSync } from 'zlib';
const __filename = fileURLToPath(import.meta.url);

const { ENABLE_STRING_POOL, ENABLE_POOL_COMPRESS, MIN_STRING_LENGTH } = STRING_OPT;

export function combinedDCode(valid: ArrayBuffer, data: ArrayBuffer) {}
export async function generateRuntimeCode(buildContext: BuildContext): Promise<string> {
	const runtimeFunctionName = buildContext.runtime.stringPoolFunction;
	const { symbols } = Runtime.options;
	const pool: Record<number, string> = {};
	for (const [value, id] of buildContext.strings.entries()) {
		pool[id] = value;
	}

	let poolValue = /* php */ `json_decode(${phpString(JSON.stringify(pool))}, true)`;

	if (STRING_POOL_ENCRYPT) {
		const encrypted = await encrypt(pool, Runtime.publicKey, true);

		const filePath = path.resolve(Runtime.distDir, PACKAGE_RESOURCE.KA_STRING_POOL);
		mkdirp.sync(path.dirname(filePath));

		if (encrypted) {
			fs.writeFileSync(filePath, new Uint8Array(encrypted));
		}

		poolValue = `${symbols.getStringPool}()`;
	}

	return /* php */ `
/* KA_RUNTIME_START */
if (!function_exists('${runtimeFunctionName}')) {
    function ${runtimeFunctionName}($id) {
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
		const runtime = await generateRuntimeCode(buildContext);
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
	const tempDir = generateVariableName();
	const tempFile = generateVariableName();
	const fileType = Runtime.settings.devMode ? '.php' : '.dat';

	return /* php */ `
	function ${symbols.createTempFile}($${tempDir}, $${prefix}) {
		@mkdir($${tempDir}, 0700, true);
		$${tempFile} = $${tempDir} . '/' . $${prefix} . bin2hex(random_bytes(6)) . '${fileType}';
		touch($${tempFile});
		return $${tempFile};
	}`;
}

export function buildTempDir(source: string = '') {
	if (Runtime.settings.devMode) {
		return /* php */ `${source ? '$' + source : '__DIR__'} . '/KA_TEMP'`;
	}
	return /* php */ `sys_get_temp_dir() . '/KA_TEMP'`;
}

export function Build_Function_GetRelativeFikeKey() {
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

export function Build_Function_Decrypt() {
	const { symbols } = Runtime.options;

	const source = generateVariableName();
	const privateKey = generateVariableName();
	const binary = generateVariableName();
	const payload = generateVariableName();

	return /* php */ `
	function ${symbols.decrypt}(string $${source}) {
		static $${privateKey} = ${JSON.stringify(Runtime.privateKey)};
		$${binary} = file_get_contents($${source});

		// 切分数据：前 256 字节是 RSA 加密的载荷，剩余的是 AES 密文 
		if (!openssl_private_decrypt(substr($${binary}, 0, 256), $${payload}, $${privateKey}, OPENSSL_PKCS1_OAEP_PADDING)) {
			return '';
		}
		return ${symbols.aesDecrypt}(substr($${binary}, 256), substr($${payload}, -60));
	}`;
}

export function Build_Function_GetPhpFile() {
	const { symbols } = Runtime.options;

	const KA_CONTEXT = Runtime.options.contextName;

	const stringPoolFunction = /* php */ `
	function ${symbols.getStringPool}() {
		$dict = ${symbols.decrypt}($GLOBALS['${KA_CONTEXT}'] . '/${PACKAGE_RESOURCE.KA_STRING_POOL}');

		if (empty($dict)) {
			return '[]';
		}

		return $dict;
	}`;

	const source = generateVariableName();
	const tmpFile = generateVariableName();
	const phpfile = generateVariableName();
	const contents = generateVariableName();
	const prefix = generateVariableName();

	let execFunction = /* php */ `
	function ${symbols.getPhpFile}(string $${source}) {
		$${phpfile} = $${source} . '/${PACKAGE_RESOURCE.KA_PHP_BINARIES}';
		$GLOBALS['${KA_CONTEXT}'] = $${source};
		return $${phpfile};
	}`;

	if (Runtime.settings.encrypt) {
		execFunction = /* php */ `
		function ${symbols.getPhpFile}(string $${source}) {
			$${prefix} = ${symbols.getRelativeFileKey}($${source}) . '_';

			@mkdir(${buildTempDir(source)}, 0700, true);
			$${tmpFile} = ${symbols.createTempFile}(${buildTempDir(source)}, $${prefix});
			$${phpfile} = $${source} . '/${PACKAGE_RESOURCE.KA_PHP_BINARIES}';

			$GLOBALS['${KA_CONTEXT}'] = $${source};
			$${contents} = ${symbols.decrypt}($${phpfile});

			file_put_contents($${tmpFile}, $${contents});
			return $${tmpFile};
		}`;
	}

	return stringPoolFunction + execFunction;
}

export async function Build_Include_Runtime(runtime: string, dataPath: string) {
	const { symbols } = Runtime.options;
	const phpScript = '<?php\n' + buildAutoUnlinkScript() + runtime;
	const result = await aesEncrypt(phpScript, true);
	const buf = new Uint8Array(result.data.byteLength + result.payload.byteLength);
	buf.set(new Uint8Array(result.payload), 0);
	buf.set(new Uint8Array(result.data), result.payload.byteLength);
	fs.writeFileSync(dataPath, buf, 'binary');

	const binary = generateVariableName();
	const tmpFile = generateVariableName();

	return /* php */ `
	$${binary} = file_get_contents(__DIR__ . '/${PACKAGE_RESOURCE.KA_RUNTIME_INNER_DATA}');
	$${tmpFile} = ${symbols.createTempFile}(${buildTempDir()}, 'runtime_');
	file_put_contents($${tmpFile}, ${symbols.aesDecrypt}(substr($${binary}, 60), substr($${binary}, 0, 60)));
	include $${tmpFile};`;
}

export async function buildRuntimeFile(entryFilePath: string) {
	const { symbols } = Runtime.options;

	let runtimeIncludeText = '';

	if (Runtime.isRuntimeEntry) {
		const runtimeFile = path.resolve(path.dirname(entryFilePath), PACKAGE_RESOURCE.KA_RUNTIME_DATA);
		mkdirp.sync(path.dirname(runtimeFile));

		let runtime = '';

		runtime += Build_Function_CreateTempFile();
		// Aes 解密是不能进一步加密的第一个入口文件
		runtime += Build_Function_AesDecrypt();

		let innerRuntime = '';
		// 获取文件路径的函数
		innerRuntime += Build_Function_GetRelativeFikeKey();
		// 解密函数
		innerRuntime += Build_Function_Decrypt();
		// 根据要不要加密入口代码生成不一样的runtime文件
		innerRuntime += Build_Function_GetPhpFile();

		// 将混合解密和引入脚本都一起加密
		if (Runtime.settings.encrypt) {
			const dataFile = path.resolve(
				path.dirname(entryFilePath),
				PACKAGE_RESOURCE.KA_RUNTIME_INNER_DATA,
			);
			innerRuntime = await Build_Include_Runtime(innerRuntime, dataFile);
		}

		runtime += '\n' + innerRuntime;

		if (Runtime.settings.encrypt) {
			const data = new TextEncoder().encode(runtime);
			fs.writeFileSync(runtimeFile, gzipSync(Buffer.from(data)));

			runtimeIncludeText = /* php */ `eval(gzdecode(file_get_contents(__DIR__ . '/${PACKAGE_RESOURCE.KA_RUNTIME_DATA}')));`;
		} else {
			fs.writeFileSync(runtimeFile, runtime);
			runtimeIncludeText = /* php */ `include __DIR__ . '/${PACKAGE_RESOURCE.KA_RUNTIME_DATA}';`;
		}
	}

	// 注入 runtime 引用
	return runtimeIncludeText + '\n' + /* php */ `include ${symbols.getPhpFile}(__DIR__);`;
}

export async function handlePhpFile(phpFilePath: string, phpFile: string) {
	const binFile = path.resolve(path.dirname(phpFilePath), PACKAGE_RESOURCE.KA_PHP_BINARIES);
	mkdirp.sync(path.dirname(binFile));

	if (PHP_FILE_ENCRYPT) {
		const encrypted = await encrypt(buildAutoUnlinkScript() + phpFile, Runtime.publicKey, true);
		if (encrypted) {
			fs.writeFileSync(binFile, new Uint8Array(encrypted));
		}
	} else {
		fs.writeFileSync(binFile, phpFile, 'utf-8');
	}
}

export function buildAutoUnlinkScript() {
	if (Runtime.settings.devMode) {
		return '';
	}
	return '<?php @unlink(__FILE__); ?>\n';
}

export * as default from './pipeUtil';
