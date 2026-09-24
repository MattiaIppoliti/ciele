'use client';

import { createOpenAPIPage } from 'fumadocs-openapi/ui';

export const OpenAPIPage = createOpenAPIPage({
  playground: { enabled: false },
  showResponseSchema: true,
  generateTypeScriptDefinitions: false,
  content: {
    renderPageLayout: ({ operations, webhooks }) => (
      <div className="ciele-openapi-page">
        {operations?.map(({ item, children }) => (
          <div key={`${item.method} ${item.path}`}>{children}</div>
        ))}
        {webhooks?.map(({ item, children }) => (
          <div key={`${item.method} ${item.name}`}>{children}</div>
        ))}
      </div>
    ),
    renderOperationLayout: (slots) => (
      <div className="ciele-openapi-operation-layout">
        <div className="ciele-openapi-operation-content">
          {slots.header}
          {slots.apiPlayground}
          {slots.description}
          {slots.authSchemes}
          {slots.parameters}
          {slots.body}
          {slots.responses && (
            <section className="ciele-openapi-response-section">
              {slots.responses}
            </section>
          )}
          {slots.callbacks}
        </div>
        <div className="ciele-openapi-operation-example">
          {slots.apiExample}
        </div>
      </div>
    ),
  },
});
