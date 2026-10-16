import type { HydratedDocument } from "mongoose";

declare global {
  namespace Express {
    interface Request {
      user?: HydratedDocument<any>;
      sessionDoc?: HydratedDocument<any>;
    }
  }
}

export {};
