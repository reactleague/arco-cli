import { ComponentType } from 'react';
import { ProxyEntry } from './uiRoot';

export type StartPluginOptions = {
  /**
   * indicates whether the start in on verbose mode.
   */
  verbose?: boolean;

  /**
   * component pattern it applies on.
   */
  pattern?: string;
};

export interface StartPlugin {
  initiate(startOptions: StartPluginOptions): void;

  getProxy?(): ProxyEntry[];

  render: ComponentType;

  /** promise that resolves when the plugin completed initiation */
  readonly whenReady: Promise<void>;
}
