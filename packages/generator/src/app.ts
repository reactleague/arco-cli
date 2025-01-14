/* eslint-disable no-console */
import path from 'path';
import chalk from 'chalk';
import yargs from 'yargs';
import fs from 'fs-extra';
import ora from 'ora';

import { Generator } from './generator';
import isInGitRepository from './utils/isInGitRepository';
import execQuick from './utils/execQuick';
import { installDependencies } from './utils/installDependencies';

type NewCommandOptions = {
  name: string;
  path?: string;
  template?: string;
  templateArgs?: string;
  packageName?: string;
  packageVersion?: string;
  description?: string;
  force?: boolean;
};

async function newCommandHandler({
  name: workspaceName,
  path: parentDirPath = './',
  packageName,
  packageVersion,
  description,
  force,
  template = 'react-workspace',
  templateArgs = '',
}: NewCommandOptions) {
  const generator = new Generator(workspaceName, {
    path: parentDirPath,
    packageName,
    description,
    version: packageVersion,
    template,
    templateArgs,
  });
  const workspacePath = generator.getTargetPath();

  if (fs.existsSync(workspacePath)) {
    if (force) {
      fs.removeSync(workspacePath);
    } else {
      console.log(
        chalk.red(
          `Already a workspace exist at ${workspacePath}, use the ${chalk.yellow(
            '--force'
          )} flag to overwrite it`
        )
      );
      return;
    }
  }

  const spinner = ora();

  spinner.start('copying workspace files...');
  await generator.generate();
  spinner.succeed('workspace files has been successfully copied');

  // change cwd to workspace directory
  process.chdir(path.resolve(workspacePath));

  if (!(await isInGitRepository())) {
    try {
      spinner.start('initializing the Git repository');
      const { stderr, code } = await execQuick('git init');
      if (code !== 0) {
        spinner.warn(
          `[WARNING] failed to initialize git repository${stderr ? `, details:\n${stderr}` : ''}`
        );
      } else {
        spinner.succeed('Git repository has been successfully initialized');
      }
    } catch (err) {}
  }

  try {
    spinner.start('installing workspace npm dependencies, this may take a few minutes...');
    const { stderr, code, command } = await installDependencies();
    if (code !== 0) {
      spinner.warn(
        `[WARNING] failed to install workspace dependencies via command [${command}]${
          stderr ? `, details:\n${stderr}` : ''
        }`
      );
    } else {
      spinner.succeed('workspace dependencies has been successfully installed');
    }
  } catch (err) {}

  const userGuideTips = chalk.white(
    `${chalk.green(`
Congrats! A new workspace has been created successfully at '${workspacePath}'`)}

Inside the directory '${workspaceName}' you can run various commands including:

   ${chalk.yellow('npx arco create ComponentName')}
     Create your first component

   ${chalk.yellow('npx arco start')}
     Starts the workspace in development mode

   ${chalk.yellow('npx arco help')}
     Shows all available commands
   `
  );

  console.log(userGuideTips);
}

// eslint-disable-next-line no-unused-expressions
yargs
  .scriptName('arco-generate')
  .command(
    'new <name>',
    'create an empty arco material workspace',
    (yargs) => {
      return yargs
        .positional('name', {
          type: 'string',
          describe: 'Workspace directory name',
        })
        .option('path', {
          alias: 'p',
          type: 'string',
          describe: 'Path to new workspace (default to current dir)',
        })
        .option('package-name', {
          type: 'string',
          describe: 'Package name of workspace root NPM package',
        })
        .option('package-version', {
          type: 'string',
          describe: 'Package version of workspace root NPM package',
        })
        .option('description', {
          type: 'string',
          describe: 'Package description of workspace root NPM package',
        })
        .option('force', {
          type: 'boolean',
          describe: 'Force overwrite directory, if it already exists',
        })
        .option('template', {
          type: 'string',
          describe: 'The template to generating a new workspace',
        })
        .option('templateArgs', {
          type: 'string',
          describe: 'The arguments for template to generating a new workspace',
        });
    },
    // eslint-disable-next-line no-return-await
    async (options) => await newCommandHandler(options)
  )
  .help().argv;
