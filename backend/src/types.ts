import type { User, Session } from "./db/schema";

export type AppEnv = {
  Variables: {
    user: User;
    session: Session;
  };
};
