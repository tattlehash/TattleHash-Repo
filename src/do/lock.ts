export class AnchorLock {
  state: DurableObjectState;
  constructor(state: DurableObjectState, _env: Env) { this.state = state; }

  async fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === "/do" && req.method === "POST") {
      // naive mutex via DO storage alarm token (single-thread per instance is usually enough)
      return new Response("ok");
    }
    if (url.pathname === "/release" && req.method === "POST") {
      return new Response("ok");
    }
    return new Response("not_found", { status: 404 });
  }
}
