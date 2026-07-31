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

export * as default from './helper';
