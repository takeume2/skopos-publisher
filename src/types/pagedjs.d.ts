declare module "pagedjs" {
  export class Previewer {
    constructor(options?: Record<string, unknown>);
    preview(
      content: string | HTMLElement | DocumentFragment,
      stylesheets?: Array<string | Record<string, string>>,
      renderTo?: HTMLElement
    ): Promise<{
      total: number;
      size: number;
      pages: Array<{
        id: string;
        element: HTMLElement;
        page: number;
      }>;
    }>;
  }

  export class Handler {
    constructor(
      chunker: unknown,
      polisher: unknown,
      caller: unknown
    );
  }
}
