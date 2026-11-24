export type RegisteredUserSummary = {
  name: string | null;
  email: string;
  created_at: string;
  active_sessions: number;
};

export type RegisteredUsersResult =
  | { status: "not_configured" }
  | { status: "forbidden" }
  | { status: "ready"; total: number; users: RegisteredUserSummary[]; truncated: boolean };
