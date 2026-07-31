import { encrypt, base64ToArrayBuffer, decrypt } from '@ka-libs/crypto';
import path from 'path';
import fs from 'fs';
import { PACKAGE_REPLACEMENT, STRING_OPT, STRING_POOL_ENCRYPT } from '../config/constans';
import { Runtime } from '../core/runtime';
import { AstNode } from '../types';
import { isKind } from './typeGard';
import type PhpParser from 'php-parser';
import logger from './logger';
import { fileURLToPath } from 'url';
import { BuildContext } from '../core/buildOption';
import { getNodeName, phpString } from './helper';
import { mkdirp } from 'mkdirp';
const __filename = fileURLToPath(import.meta.url);

const { ENABLE_STRING_POOL, ENABLE_POOL_COMPRESS, MIN_STRING_LENGTH } = STRING_OPT;

export async function generateRuntimeCode(buildContext: BuildContext): Promise<string> {
	const runtimeFunctionName = buildContext.runtime.stringPoolFunction;

	const pool: Record<number, string> = {};
	for (const [value, id] of buildContext.strings.entries()) {
		pool[id] = value;
	}

	let poolValue = phpString(JSON.stringify(pool));

	if (STRING_POOL_ENCRYPT) {
		const result = await encrypt(pool, Runtime.publicKey, false);
		const valid = base64ToArrayBuffer(result!.valid);
		const data = base64ToArrayBuffer(result!.data);

		const combined = new Uint8Array(256 + data.byteLength);
		combined.set(new Uint8Array(valid), 0);
		combined.set(new Uint8Array(data), 256);

		console.log(await decrypt(combined.buffer, Runtime.privateKey));

		const filePath = path.resolve(Runtime.distDir, PACKAGE_REPLACEMENT.KA_STRING_POOL);
		mkdirp.sync(path.dirname(filePath));

		fs.writeFileSync(filePath, combined);

		poolValue = 'p()';
	}

	return `
/* KA_RUNTIME_START */
/* ========================================
* KA String Pool Runtime
* ======================================== */
if (!function_exists('${runtimeFunctionName}')) {
    function ${runtimeFunctionName}($id) {
        static $pool = json_decode(${poolValue}, true);

        return $pool[$id] ?? '';
    }
}
/* ======================================== */
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

export * as default from './pipeUtil';
