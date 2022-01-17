import fs from 'fs-extra';
import path from 'path';
import glob from 'glob';
import globParent from 'glob-parent';
import { print } from '@arco-design/arco-dev-utils';
import getMainConfig from './getMainConfig';
import { DocumentInfo } from '../interface';
import { PLACEHOLDER_ARCO_SITE_MODULE_INFO } from '../constant';
import getTitleOfMarkdown from './getTitleOfMarkdown';

export const ENTRY_DIR_NAME = '__temp__';
export const LIBRARY_MODULE_NAME = 'arcoSite';
const VARIABLE_PREFIX = LIBRARY_MODULE_NAME;

const FUNCTION_LABEL = '#FUNC#';

const { build: buildConfig, site: siteConfig } = getMainConfig();
const entryFileDir = path.resolve(ENTRY_DIR_NAME);

function transformObjectToExpression(obj: Object | Array<any>): string {
  return (
    JSON.stringify(obj || {}, null, 2)
      .replace(/^"(.*)"$/s, (_, $1) => $1)
      // Convert "#FUNC#() => true;#FUNC#" to () => true;
      .replace(new RegExp(`"?${FUNCTION_LABEL}"?`, 'g'), '')
  );
}

function generateDocTree(options: {
  entry: string;
  baseDir: string;
  filter?: (filePath: string) => boolean;
  onFile?: (filePath: string, info: DocumentInfo) => void;
}) {
  const { entry, baseDir, filter, onFile } = options;
  const result: Array<DocumentInfo> = [];
  const files = fs.readdirSync(entry);

  for (const file of files) {
    const filePath = path.resolve(entry, file);
    const filePathToBaseDir = `/${path.relative(baseDir, filePath)}`;
    const stats = fs.lstatSync(filePath);
    const isFile = stats.isFile();
    const isDirectory = stats.isDirectory();

    if (isFile) {
      if (!filter || filter(filePath)) {
        const info = {
          name: getTitleOfMarkdown(filePath),
          path: filePathToBaseDir,
        };
        result.push(info);
        onFile(filePath, info);
      }
    }

    if (isDirectory) {
      result.push({
        name: file,
        path: filePathToBaseDir,
        children: generateDocTree({
          ...options,
          entry: filePath,
        }),
      });
    }
  }

  const relativePath = path.relative(baseDir, entry);
  const sortRule = siteConfig?.menu?.sortRule && siteConfig?.menu?.sortRule[relativePath];
  if (Array.isArray(sortRule)) {
    return result.sort(({ name: nameA }, { name: nameB }) => {
      const indexA = sortRule.indexOf(nameA);
      const indexB = sortRule.indexOf(nameB);
      if (indexA > -1 && indexB > -1) {
        return indexA > indexB ? 1 : -1;
      }
      return indexB > -1 ? 1 : -1;
    });
  }

  return result;
}

export function getPathEntryByLanguage(language: string) {
  return path.resolve(entryFileDir, `index.js`.replace(/.js$/, `.${language}.js`));
}

export default function generateEntryFiles() {
  if (!buildConfig || !buildConfig.globs || !buildConfig.globs.component) {
    print.error('[arco-doc-site]', `Failed to get glob info of component, check your config file.`);
    process.exit(0);
  }

  const getRequirePath = (absolutePath) => {
    return path.relative(entryFileDir, absolutePath).replace(/^[^.]/, (str) => `./${str}`);
  };

  const generateEntry = (language) => {
    const entryFilePath = getPathEntryByLanguage(language);
    const exportModuleInfoList: Array<{
      name: string;
      statement: string;
    }> = [];

    // Final content of entry file
    const fileContent = [
      `// Do NOT edit this file manually, it's generated by @arco-design/arco-doc-site.

/* eslint-disable */

function decodeInfo(infoStr) {
  try {
    const decoder = new TextDecoder();
    const jsonStr = decoder.decode(new Uint8Array(infoStr.split(',')));
    return JSON.parse(jsonStr);
  } catch (e) {}

  return {};
}

const moduleInfoStr = '${PLACEHOLDER_ARCO_SITE_MODULE_INFO}';
const ${LIBRARY_MODULE_NAME} = {};
`,
    ];

    exportModuleInfoList.push({
      name: `${VARIABLE_PREFIX}ModuleInfo`,
      statement: 'decodeInfo(moduleInfoStr)',
    });

    exportModuleInfoList.push({
      name: `${VARIABLE_PREFIX}Config`,
      statement: transformObjectToExpression(siteConfig),
    });

    if (buildConfig.globs?.doc) {
      // Glob info about pure document
      const globDocBasePath = globParent(buildConfig.globs.doc);
      const globDocMagicPath = buildConfig.globs.doc.replace(`${globDocBasePath}/`, '');
      const docEntryPath = path.resolve(globDocBasePath, language);
      const validDocPathList = glob.sync(path.resolve(docEntryPath, globDocMagicPath));

      const documentInfo = generateDocTree({
        entry: docEntryPath,
        baseDir: docEntryPath,
        filter: (filePath) => validDocPathList.indexOf(filePath) > -1,
        onFile: (filePath, info) => {
          const componentName = `Doc${validDocPathList.indexOf(filePath)}`;
          const statement = `_${componentName}`;

          // import document
          fileContent.push(`\n// Import document from ${filePath}`);
          fileContent.push(`import * as ${statement} from '${getRequirePath(filePath)}';\n`);

          // export document
          exportModuleInfoList.push({
            name: componentName,
            statement,
          });

          // write component name of document to docInfo
          info.moduleName = componentName;
        },
      });

      exportModuleInfoList.push({
        name: `${VARIABLE_PREFIX}DocumentInfo`,
        statement: transformObjectToExpression(documentInfo),
      });
    }

    // Import hook
    const hookNameList: string[] = [];
    Object.entries(buildConfig.globs.hook || {}).forEach(([hookName, hookPattern]) => {
      const [hookPath] = glob.sync(hookPattern);
      if (hookPath) {
        hookNameList.push(hookName);
        fileContent.push(`import ${hookName} from '${getRequirePath(hookPath)}';`);
      }
    });
    if (hookNameList.length) {
      exportModuleInfoList.push({
        name: `${VARIABLE_PREFIX}Hook`,
        statement: `{ ${hookNameList.join(', ')} }`,
      });
    }

    // Import component demos
    glob
      .sync(buildConfig.globs.component.base)
      .map((p) => {
        const { demo, doc, style } = buildConfig.globs.component;
        return {
          componentName: path.basename(p).replace(/-(\w)/g, (_, $1) => $1.toUpperCase()),
          pathDemo: demo && path.resolve(p, demo),
          pathDoc: doc && path.resolve(p, doc),
          pathStyle: style && path.resolve(p, style),
        };
      })
      .forEach(({ componentName: moduleName, pathDemo, pathDoc, pathStyle }) => {
        let demoModuleName;
        let docModuleName;
        const tempFileContent = [`// Import demos and document of ${moduleName}`];

        if (fs.existsSync(pathDemo)) {
          demoModuleName = `_${moduleName}`;
          tempFileContent.push(`import * as ${demoModuleName} from '${getRequirePath(pathDemo)}';`);
        }

        if (fs.existsSync(pathDoc)) {
          docModuleName = `_${moduleName}Doc`;
          tempFileContent.push(`import ${docModuleName} from '${getRequirePath(pathDoc)}';`);
        }

        if (buildConfig.withMaterialStyle && fs.existsSync(pathStyle)) {
          tempFileContent.push(`import '${pathStyle}';`);
        }

        if (demoModuleName || docModuleName) {
          fileContent.push(`\n${tempFileContent.join('\n')}\n`);
          exportModuleInfoList.push({
            name: moduleName,
            statement: `{ ${demoModuleName ? `...${demoModuleName}, ` : ''}${
              docModuleName ? `_SITE_DOC: ${docModuleName} ` : ''
            }}`,
          });
        }
      });

    const exportExpressions = exportModuleInfoList
      .map(({ name, statement }) => {
        return `export const ${name} = ${statement};\n${LIBRARY_MODULE_NAME}.${name} = ${name};\n`;
      })
      .join('\n');

    fileContent.push(`
// Export submodules
${exportExpressions}

// Only used by team site development mode
if (window.arcoMaterialTeamSite && window.arcoMaterialTeamSite.renderPage) {
  const siteDevOptions = ${transformObjectToExpression({
    ...buildConfig.devOptions,
    withArcoStyle: siteConfig.arcoDesignLabTheme
      ? `${FUNCTION_LABEL}() => import('${siteConfig.arcoDesignLabTheme}/css/arco.css')${FUNCTION_LABEL}`
      : buildConfig.devOptions?.withArcoStyle,
  })};
  window.arcoMaterialTeamSite.renderPage(${LIBRARY_MODULE_NAME}, siteDevOptions);
}
`);

    fs.ensureDirSync(entryFileDir);
    fs.writeFileSync(entryFilePath, fileContent.join('\n'));
  };

  siteConfig.languages.forEach(generateEntry);
}
