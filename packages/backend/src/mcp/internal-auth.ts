import type { AuthInfo } from "../lib/auth";

export class InternalAuthBridge {
  private readonly authByRequest = new WeakMap<Request, AuthInfo>();

  get(request: Request) {
    return this.authByRequest.get(request);
  }

  async run<T>(request: Request, auth: AuthInfo, callback: () => T | Promise<T>): Promise<T> {
    this.authByRequest.set(request, auth);
    try {
      return await callback();
    } finally {
      this.authByRequest.delete(request);
    }
  }
}
