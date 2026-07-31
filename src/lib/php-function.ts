import { Ast } from '../core/ast';
import { BuildContext } from '../core/buildOption';
import { RecordFunction } from '../core/recordNode';
import { Runtime } from '../core/runtime';
import { generateConstantName, getNodeName } from '../utils/helper';
import { isKind, isScopeNode } from '../utils/typeGard';
import { fileIterator, scanPHPFile } from '../utils/utils';

export default async function (buildContext: BuildContext) {
	const ROOT_DIR = buildContext.distDir;
	const functions = Runtime.options.functions;

	// 纯记录，函数和实体类的追踪比较复杂
	await fileIterator(await scanPHPFile(ROOT_DIR), async (file) => {
		const ast = Ast.create(file);

		// 收集函数名
		ast.walk((node) => {
			if (!isKind(node, 'function') && !isKind(node, 'closure')) return;

			const functionRecord = new RecordFunction(node, generateConstantName().toLocaleLowerCase());

			if (isScopeNode(node)) {
				node.setCache(functionRecord);
			}

			// 如果函数是在当前项目创建的话可以将它重命名
			if (isKind(node, 'function')) {
				if (getNodeName(node.name).length < 2) return;

				functions.set(getNodeName(node.name), functionRecord);
			}
		});
	});

	await fileIterator(await scanPHPFile(ROOT_DIR), async (file) => {
		const ast = Ast.create(file);

		// 收集函数名
		ast.walk((node) => {
			if (!isKind(node, 'identifier')) return;
			if (!isKind(node.parent, 'function')) return;

			const record = functions.get(node.name);
			if (record) {
				ast.recordReplacement(node, record.replace);
			}
		});
	});
}
