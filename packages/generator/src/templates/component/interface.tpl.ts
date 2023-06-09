import { TemplateFunction } from '../../types';

const templateFn: TemplateFunction = function ({ name: componentName }) {
  return {
    filename: 'interface.ts',
    contents: `import { CSSProperties } from 'react';

/**
 * ${componentName}
 */
export interface ${componentName}Props {
  style?: CSSProperties;
  className?: string | string[];
  /**
   * @zh 组件尺寸
   * @en Component Size
   * @defaultValue default
   * @version 1.1.0
   */
  size?: 'small' | 'default' | 'large';
}
`,
  };
};

export default templateFn;