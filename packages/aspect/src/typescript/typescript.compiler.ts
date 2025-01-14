import path from 'path';
import fs from 'fs-extra';
import ts from 'typescript';
import { mergeWith, cloneDeep, get, set } from 'lodash';
import { Logger } from '@arco-cli/core/dist/logger';
import { Compiler } from '@arco-cli/service/dist/compiler';
import ArcoError from '@arco-cli/legacy/dist/error/arcoError';
import { BuildContext, BuildTaskResult } from '@arco-cli/service/dist/builder';
import { ComponentResult } from '@arco-cli/legacy/dist/workspace/componentResult';
import {
  DEFAULT_DIST_DIRNAME,
  DEFAULT_BUILD_IGNORE_PATTERNS,
} from '@arco-cli/legacy/dist/constants';
import { toFsCompatible } from '@arco-cli/legacy/dist/utils';

import { TypescriptCompilerOptions } from './compilerOptions';
import TypescriptAspect from './typescript.aspect';
import { tsconfigMergeCustomizer } from './typescriptConfigMutator';
import { flatTSConfig } from './utils/flatTSConfig';

const FILENAME_TSCONFIG = 'tsconfig.json';
const FILENAME_TSCONFIG_BUILD = 'tsconfig.build.json';

export class TypescriptCompiler implements Compiler {
  displayName = 'TypeScript';

  deleteDistDir = false;

  distDir: string;

  artifactName: string;

  ignorePatterns = DEFAULT_BUILD_IGNORE_PATTERNS;

  private componentTsConfigMap: Record<string, string> = {};

  constructor(
    readonly id: string,
    private options: TypescriptCompilerOptions,
    private tsModule: typeof ts,
    private logger: Logger
  ) {
    this.distDir = options.distDir || DEFAULT_DIST_DIRNAME;
    this.artifactName = options.artifactName || DEFAULT_DIST_DIRNAME;
    this.options.tsconfig ||= {};
    this.options.tsconfig.compilerOptions ||= {};
  }

  private stringifyTsconfig(tsconfig) {
    return JSON.stringify(tsconfig, undefined, 2);
  }

  private replaceFileExtToJs(filePath: string): string {
    if (!this.isFileSupported(filePath)) return filePath;
    const fileExtension = path.extname(filePath);
    return filePath.replace(new RegExp(`${fileExtension}$`), '.js');
  }

  private getCacheDir(context: BuildContext) {
    return context.workspace.getCacheDir(TypescriptAspect.id);
  }

  private async writeComponentTsConfig(context: BuildContext) {
    const workspacePath = context.workspace.path;
    await Promise.all(
      context.components.map(async ({ id: componentId, rootDir, packageDirAbs }) => {
        const rootDirAbs = path.join(workspacePath, rootDir);
        const outDirAbs = path.join(packageDirAbs, this.distDir);
        const tsconfig: Record<string, any> = cloneDeep(this.options.tsconfig);

        // try to merge tsconfig.json from component package
        // we will find file named tsconfig.json/tsconfig.build.json from package dir
        try {
          const tsconfigPathFromPackage = [FILENAME_TSCONFIG, FILENAME_TSCONFIG_BUILD]
            .map((filename) => path.join(packageDirAbs, filename))
            .find((filePathAbs) => fs.existsSync(filePathAbs));
          if (tsconfigPathFromPackage) {
            const tsconfigFromPackage = flatTSConfig(tsconfigPathFromPackage);
            // TSCompilerCJS will compile source files to CommonJS modules
            // we don't allow package tsconfig to overwrite its module configuration
            if (
              tsconfig.compilerOptions.module?.toLowerCase() === 'commonjs' &&
              tsconfigFromPackage?.compilerOptions?.module
            ) {
              delete tsconfigFromPackage.compilerOptions.module;
            }
            mergeWith(tsconfig, tsconfigFromPackage, tsconfigMergeCustomizer);
          }
        } catch (err) {
          this.logger.consoleFailure(err.toString());
        }

        // avoid change this.options.config directly
        // different components might have different ts configs
        mergeWith(
          tsconfig,
          {
            include: [rootDirAbs],
            exclude: this.ignorePatterns,
            compilerOptions: {
              outDir: outDirAbs,
              rootDir: rootDirAbs,
            },
          },
          tsconfigMergeCustomizer
        );

        // this func will change original object directly
        const convertRelativePathsToAbs = (
          obj: Record<string, any>,
          keysToConvert: string[],
          relativePathChecker?: (str) => boolean
        ) => {
          relativePathChecker ||= (str) => !path.isAbsolute(str);

          for (const key of keysToConvert) {
            const value = get(obj, key);
            if (typeof value === 'string') {
              set(
                obj,
                key,
                relativePathChecker(value) ? path.resolve(packageDirAbs, value) : value
              );
            } else if (Array.isArray(value)) {
              set(
                obj,
                key,
                value.map((filePath) =>
                  relativePathChecker(filePath) ? path.resolve(packageDirAbs, filePath) : filePath
                )
              );
            } else if (typeof value === 'object' && value !== null) {
              convertRelativePathsToAbs(value, Object.keys(value), relativePathChecker);
            }
          }
        };

        // convert tsconfig relative paths to absolute path
        convertRelativePathsToAbs(tsconfig, [
          'include',
          'exclude',
          'files',
          'compilerOptions.baseUrl',
          'compilerOptions.paths',
          'compilerOptions.typeRoots',
        ]);

        const tsconfigPath = path.join(
          this.getCacheDir(context),
          toFsCompatible(componentId),
          `${this.distDir}.${FILENAME_TSCONFIG}`
        );
        await fs.ensureFile(tsconfigPath);
        await fs.writeFile(tsconfigPath, this.stringifyTsconfig(tsconfig));
        this.componentTsConfigMap[componentId] = tsconfigPath;
      })
    );
  }

  private async writeProjectReferencesTsConfig(context): Promise<string> {
    const cacheDir = this.getCacheDir(context);
    const references = context.components.map((com) => {
      return { path: this.componentTsConfigMap[com.id] || com.packageDirAbs };
    });
    const tsconfig = { files: [], references };
    const tsconfigStr = this.stringifyTsconfig(tsconfig);
    await fs.writeFile(path.join(cacheDir, FILENAME_TSCONFIG), tsconfigStr);
    return cacheDir;
  }

  private async runTscBuild(context: BuildContext): Promise<ComponentResult[]> {
    const { components } = context;

    if (!components.length) {
      return [];
    }

    const componentsResults: ComponentResult[] = [];
    const formatHost = {
      getCanonicalFileName: (p) => p,
      getCurrentDirectory: () => '', // it helps to get the files with absolute paths
      getNewLine: () => this.tsModule.sys.newLine,
    };

    let currentComponentResult: Partial<ComponentResult> = { errors: [] };
    const reportDiagnostic = (diagnostic: ts.Diagnostic) => {
      const errorStr = process.stdout.isTTY
        ? this.tsModule.formatDiagnosticsWithColorAndContext([diagnostic], formatHost)
        : this.tsModule.formatDiagnostic(diagnostic, formatHost);
      if (!diagnostic.file) {
        // the error is general and not related to a specific file. e.g. tsconfig is missing.
        throw new ArcoError(errorStr);
      }
      this.logger.consoleFailure(errorStr);
      if (!currentComponentResult.id || !currentComponentResult.errors) {
        throw new Error(`currentComponentResult is not defined yet for ${diagnostic.file}`);
      }
      currentComponentResult.errors.push(errorStr);
    };

    // this only works when `verbose` is `true` in the `ts.createSolutionBuilder` function.
    const reportSolutionBuilderStatus = (diag: ts.Diagnostic) => {
      const msg = diag.messageText as string;
      this.logger.debug(msg);
    };
    const errorCounter = (errorCount: number) => {
      this.logger.info(`total error found: ${errorCount}`);
    };
    const host = this.tsModule.createSolutionBuilderHost(
      undefined,
      undefined,
      reportDiagnostic,
      reportSolutionBuilderStatus,
      errorCounter
    );

    const rootDir = await this.writeProjectReferencesTsConfig(context);
    const solutionBuilder = this.tsModule.createSolutionBuilder(host, [rootDir], {
      verbose: true,
    });
    const longProcessLogger = this.logger.createLongProcessLogger(
      'compile typescript components',
      components.length
    );

    let nextProject;
    // eslint-disable-next-line no-cond-assign
    while ((nextProject = solutionBuilder.getNextInvalidatedProject())) {
      // nextProject is path of its tsconfig.json
      const projectPath = path.dirname(nextProject.project);
      const component = components.find((com) => {
        // tsconfig.json for component building will be generated in cache dir named component_id
        // find target component of this tsconfig.json
        return path.basename(projectPath) === toFsCompatible(com.id);
      });
      if (!component) throw new Error(`unable to find component for ${projectPath}`);

      longProcessLogger.logProgress(component.id);
      currentComponentResult.id = component.id;
      currentComponentResult.startTime = Date.now();
      nextProject.done();
      currentComponentResult.endTime = Date.now();
      componentsResults.push({ ...currentComponentResult } as ComponentResult);
      currentComponentResult = { errors: [] };
    }

    longProcessLogger.end();
    return componentsResults;
  }

  version() {
    return this.tsModule.version;
  }

  displayConfig() {
    return this.stringifyTsconfig(this.options.tsconfig);
  }

  getDistDir() {
    return this.distDir;
  }

  getDistPathBySrcPath(srcPath: string) {
    const fileWithJSExtIfNeeded = this.replaceFileExtToJs(srcPath);
    return path.join(this.distDir, fileWithJSExtIfNeeded);
  }

  isFileSupported(filePath: string): boolean {
    const isJsAndCompile = !!this.options.compileJs && filePath.endsWith('.js');
    const isJsxAndCompile = !!this.options.compileJsx && filePath.endsWith('.jsx');
    return (
      (filePath.endsWith('.ts') ||
        filePath.endsWith('.tsx') ||
        isJsAndCompile ||
        isJsxAndCompile) &&
      !filePath.endsWith('.d.ts')
    );
  }

  async preBuild(context: BuildContext) {
    await this.writeComponentTsConfig(context);
  }

  async build(context: BuildContext): Promise<BuildTaskResult> {
    const componentsResults = await this.runTscBuild(context);
    return {
      componentsResults,
    };
  }
}
