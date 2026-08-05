import { uuidv4 } from '@ka-libs/crypto';
import { Runtime } from '../core/runtime';
import { Ast } from '../core/ast';
import { BuildClass, BuildContext } from '../core/buildOption';
import {
	RecordVariable,
	RecordFunction,
	RecordIdentifier,
	RecordProperty,
	RecordClass,
	RecordMethod,
	RecordConstant,
} from '../core/recordNode';
import { isKind, typedAstNode } from '../utils/typeGard';
import { fileIterator, scanPHPFile } from '../utils/utils';
import { CONST_PREFIX } from '../config/constans';
import { AstNode } from '../types';
import PhpParser from 'php-parser';
import { randomPrefix } from '../utils/randomPrefix';
import { generateConstantName, generateVariableName, getNodeName } from '../utils/helper';
import { findSelfBuildClass, findBuildClass } from '../utils/pipeUtil';

export default async function (buildContext: BuildContext) {
	const ROOT_DIR = buildContext.distDir;
	const classes = Runtime.options.classes;
	const { settings } = Runtime;

	await fileIterator(await scanPHPFile(ROOT_DIR), async (file) => {
		const ast = Ast.create(file);

		// 记录所有类
		ast.walk((node) => {
			if (!isKind(node, 'identifier') && !isKind(node, 'variable')) return;
			if (isKind(node.parent, 'class')) {
				if (!node.name) return;

				const classRecord = new RecordClass(node, generateConstantName());
				classes.set(node.name, new BuildClass(classRecord));
				return;
			}

			if (isKind(node.parent, 'method')) {
				const buildClass = findSelfBuildClass(node);
				if (!buildClass) return;

				const methodRecord = new RecordMethod(node.parent, generateVariableName(), buildClass.name);
				buildClass.methods.set(node.name, methodRecord);
				return;
			}

			if (isKind(node.parent, 'property')) {
				const buildClass = findSelfBuildClass(node);
				if (!buildClass) return;

				const propertyRecord = new RecordProperty(node, generateVariableName(), buildClass.name);
				buildClass.properties.set(node.name, propertyRecord);
				return;
			}

			if (isKind(node.parent, 'constant') && isKind(node.parent.parent, 'classconstant')) {
				const buildClass = findSelfBuildClass(node);
				if (!buildClass) return;

				const constantRecord = new RecordConstant(
					node,
					generateVariableName().toUpperCase(),
					buildClass.name,
				);
				buildClass.constants.set(node.name, constantRecord);
				return;
			}
		});

		// 当一个类extends了一个未定义的类时，删除记录该类
		ast.walk((node) => {
			if (!isKind(node, 'identifier') && !isKind(node, 'variable')) return;
			if (isKind(node.parent, 'class')) {
				if (node.parent.extends && !classes.has(node.parent.extends.name)) {
					classes.delete(node.name);
				}
			}
		});

		// 追踪类引用
		ast.walk((node) => {
			if (isKind(node, 'new')) {
				// node.trace();
			}
		});

		// ast.applyReplacements();
	});

	if (!settings.classes) return;
	// 记录替换，只处理静态属性
	await fileIterator(await scanPHPFile(ROOT_DIR), async (file) => {
		const ast = Ast.create(file);

		ast.walk((node) => {
			if (isKind(node, 'name')) {
				const buildClass = findBuildClass(node.name);

				if (!buildClass) return;

				node.recordReplacement(buildClass.name.replace);
				return;
			}

			// 处理变量
			if (!isKind(node, 'identifier') && !isKind(node, 'variable')) return;

			if (isKind(node.parent, 'class')) {
				const buildClass = findBuildClass(node.name);
				if (!buildClass) return;

				node.recordReplacement(buildClass.name.replace);

				return;
			}

			if (isKind(node.parent, 'method')) {
				if (!node.parent.isStatic) return;

				const buildClass = findSelfBuildClass(node);
				if (!buildClass) return;

				const record = buildClass.methods.get(node.name);
				if (!record) return;

				node.recordReplacement(record.replace);

				return;
			}

			if (isKind(node.parent, 'property') && isKind(node.parent.parent, 'propertystatement')) {
				if (!node.parent.parent.isStatic) return;

				const buildClass = findSelfBuildClass(node);
				if (!buildClass) return;

				const record = buildClass.properties.get(node.name);
				if (!record) return;
				node.recordReplacement(record.replace);
				return;
			}

			if (isKind(node.parent, 'constant') && isKind(node.parent.parent, 'classconstant')) {
				const buildClass = findSelfBuildClass(node);
				if (!buildClass) return;

				const record = buildClass.constants.get(node.name);
				if (!record) return;
				node.recordReplacement(record.replace);
				return;
			}

			if (isKind(node.parent, 'staticlookup')) {
				const what = typedAstNode(node.parent.what);

				const buildClass = findBuildClass(what);
				if (!buildClass) return;

				if (isKind(node.parent.parent, 'call')) {
					const record = buildClass.methods.get(node.name);
					if (record) {
						node.recordReplacement(record.replace);
						return;
					}
				}

				if (buildClass.properties.has(node.name)) {
					const record = buildClass.properties.get(node.name)!;
					node.recordReplacement(record.replace);
				}

				if (buildClass.constants.has(node.name)) {
					const record = buildClass.constants.get(node.name)!;
					node.recordReplacement(record.replace);
				}
				return;
			}
		});
	});
}
