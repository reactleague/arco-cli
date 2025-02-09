import type { Component } from '@arco-cli/aspect/dist/component';

import { BuildContext, BuildTaskResult, TaskResultsList } from '@service/builder';

export interface CompilerAspectConfig {
  /**
   * whether to skip deleting the component product directory before compiling
   */
  skipDeleteDistDir?: boolean;
  /**
   * specify the component compilation order, receive component id or Glob string
   * when some components depend on other components, specifying the compilation order is useful
   * e.g. ['base-package/**', 'second-base-package/**']
   */
  componentCompilationOrders?: Array<string>;
}

export interface CompilerOptions {
  /**
   * name of the compiler.
   */
  name?: string;

  /**
   * relative path of the dist directory inside the capsule. e.g. "dist".
   */
  distDir?: string;

  /**
   * determines which ones of the generated files will be saved while building
   * e.g. distGlobPatterns = [`${this.distDir}/**`, `!${this.distDir}/tsconfig.tsbuildinfo`];
   * see https://github.com/mrmlnc/fast-glob for the supported glob patters syntax.
   */
  distGlobPatterns?: string[];

  /**
   * determines which files will be ignored while building
   * e.g. ignorePatterns = ['__docs__', '__test__'];
   */
  ignorePatterns?: string[];

  /**
   * optional. default to "dist".
   * useful when the build pipeline has multiple compiler tasks of the same compiler.
   * e.g. using the same Babel compiler for two different tasks, one for creating "es5" files, and
   * the second for creating "esm". the artifact names would be "es5" and "esm" accordingly.
   */
  artifactName?: string;
}

/**
 * info of style file to compile
 */
export type StyleFileToCompile = {
  /**
   * absolute path of source file
   */
  pathSource: string;
  /**
   * absolute path of compiled file
   */
  pathTarget: string;
  /**
   * get file contents string to compile
   */
  getContents: () => string;
};

export interface StyleCompilerOptions {
  /**
   * compile
   */
  compile?: (
    fileInfo: StyleFileToCompile,
    defaultCompileFn: (fileInfo: StyleFileToCompile) => Promise<string>
  ) => Promise<string>;

  /**
   * whether to combine all raw style files to one
   */
  combine?: boolean | { filename: string; sorter: (depPathA: string, depPathB: string) => number };
}

export interface Compiler extends CompilerOptions {
  /**
   * id of the compiler.
   */
  id: string;

  /**
   * returns the version of the current compiler instance (e.g. '4.0.1').
   */
  version(): string;

  /**
   * returns the display name of the current compiler instance (e.g. 'TypeScript')
   */
  displayName: string;

  /**
   * Delete dist folder before writing the new compiled files
   */
  deleteDistDir?: boolean;

  /**
   * whether source files (such as .less/.scss) should be copied into the dist directory
   */
  shouldCopySourceFiles?: boolean;

  /**
   * serialized config of the compiler.
   */
  displayConfig?(): string;

  /**
   * only supported files matching get compiled. others, are copied to the dist dir.
   */
  isFileSupported(filePath: string): boolean;

  /**
   * return the dist dir of the compiled files (relative path from the component root dir)
   */
  getDistDir?(): string;

  /**
   * given a source file, return its parallel in the dists. e.g. "index.ts" => "dist/index.js"
   * both, the return path and the given path are relative paths.
   */
  getDistPathBySrcPath(srcPath: string): string;

  /**
   * given a component, returns the path to the source folder to use for the preview, uses the one
   * in node_modules by default
   */
  getPreviewComponentRootPath?(component: Component): string;

  /**
   * compile components inside isolated capsules. this being used during tag for the release.
   * meaning, the final package of the component has the dists generated by this method.
   */
  build?(context: BuildContext): Promise<BuildTaskResult>;

  /**
   * run before the build pipeline has started. this is useful when souiuime preparation are needed to
   * be done on all envs before the build starts.
   */
  preBuild?(context: BuildContext): Promise<void>;

  /**
   * run after the build pipeline completed for all envs. useful for some cleanups
   */
  postBuild?(context: BuildContext, tasksResults: TaskResultsList): Promise<void>;
}
