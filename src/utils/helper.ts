import { uuidv4 } from '@ka-libs/crypto';
import { CONST_PREFIX } from '../config/constans';
import { randomPrefix } from './randomPrefix';
import { isKind } from './typeGard';
import { PhpParser } from '..';

export function generateConstantName() {
	const hash = uuidv4(true);
	return CONST_PREFIX + hash.slice(-6).toUpperCase();
}

export function generateVariableName() {
	const hash = uuidv4(true);
	return randomPrefix().slice(1, 3) + hash.slice(-6).toLowerCase();
}

export function getNodeName(nameNode: PhpParser.Node | PhpParser.Identifier | string) {
	if (typeof nameNode === 'string') {
		return nameNode;
	}
	if (isKind(nameNode, 'identifier')) {
		return nameNode.name;
	}
	return '';
}

export function toPhpBinary(value: ArrayBuffer) {
	const bytes = Buffer.from(value);

	return [...bytes].map((v) => `\\x${v.toString(16).padStart(2, '0')}`).join('');
}

export function phpString(value: string) {
	return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

// ========================================
// Strip PHP Comments
// ========================================
export function stripPhpComments(content: string) {
	let result = '';
	let inString = false;
	let stringChar = '';
	let inLineComment = false;
	let inBlockComment = false;
	for (let i = 0; i < content.length; i++) {
		const char = content[i];
		const next = content[i + 1];
		const prev = content[i - 1];
		// ====================================
		// Block Comment
		// ====================================
		if (inBlockComment) {
			if (char === '*' && next === '/') {
				inBlockComment = false;
				i++;
			}
			continue;
		}
		// ====================================
		// Line Comment
		// ====================================
		if (inLineComment) {
			if (char === '\n') {
				inLineComment = false;
				result += '\n';
			}
			continue;
		}
		// ====================================
		// String
		// ====================================
		if (inString) {
			result += char;
			if (char === stringChar && prev !== '\\') {
				inString = false;
			}
			continue;
		}
		// ====================================
		// String Start
		// ====================================
		if (char === '"' || char === "'") {
			inString = true;
			stringChar = char;
			result += char;
			continue;
		}
		// ====================================
		// #
		// ====================================
		if (char === '#') {
			inLineComment = true;
			continue;
		}
		// ====================================
		// //
		// ====================================
		if (char === '/' && next === '/') {
			/**
			 * Avoid URL
			 */
			const recent = result.slice(-10);
			if (recent.endsWith('http:') || recent.endsWith('https:')) {
				result += char;
				continue;
			}
			inLineComment = true;
			i++;
			continue;
		}
		// ====================================
		// /*
		// ====================================
		if (char === '/' && next === '*') {
			/**
			 * Preserve License
			 */
			const ahead = content.substring(i, i + 15);
			if (ahead.includes('@license')) {
				result += char;
				continue;
			}
			inBlockComment = true;
			i++;
			continue;
		}
		result += char;
	}
	return cleanupEmptyLines(result);
}
// ========================================
// Cleanup Empty Lines
// ========================================
export function cleanupEmptyLines(content: string) {
	const lines = content.split(/\n/);
	const cleaned = [];
	for (const line of lines) {
		/**
		 * 去除行尾空格
		 */
		const trimmed = line.trim();
		/**
		 * 去除首尾后为空
		 */
		if (!trimmed) {
			continue;
		}
		cleaned.push(trimmed);
	}
	/**
	 * 压缩连续空格
	 */
	return cleaned
		.join('\n')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{2,}/g, '\n')
		.trim();
}

export * as default from './helper';
