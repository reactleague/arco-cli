import gql from 'graphql-tag';

import { Component } from '@aspect/component';

import { DocsMain } from './docs.main.runtime';

export default function (docs: DocsMain) {
  return {
    typeDefs: gql`
      extend type Component {
        description: String
        labels: [String]
        outline: [ComponentOutline]
      }

      type ComponentOutline {
        depth: Int
        text: String
      }
    `,
    resolvers: {
      Component: {
        description: (component: Component) => {
          const doc = docs.getDoc(component);
          return doc?.description || '';
        },

        labels: (component: Component) => {
          const labels = component.labels || [];
          const doc = docs.getDoc(component);
          const docLabels = doc?.labels || [];

          return [
            ...labels,
            ...docLabels,
          ];
        },

        outline: (component: Component) => {
          const doc = docs.getDoc(component);
          return doc?.outline || [];
        },
      },
    },
  };
}
