// Hợp đồng chung giữa app và hạ tầng: Supabase (staging/production) hoặc PGlite (máy local, không cần Docker).
// Mọi logic nghiệp vụ vẫn nằm trong hàm SQL api.* — hai backend chạy CÙNG migrations.

export interface BackendError {
  code?: string;
  message: string;
  details?: string;
  status?: number;
}

/** Thông tin tài khoản đăng nhập (Supabase Auth / local) — để đối chiếu với profile */
export interface AuthUserInfo {
  id: string;
  email: string | null;
  confirmed: boolean;
  banned: boolean;
  last_sign_in_at: string | null;
}

export interface RpcResponse<T> {
  data: T | null;
  error: BackendError | null;
}

export interface Backend {
  readonly kind: "supabase" | "local";
  /** id người dùng của phiên hiện tại (đã xác thực), null nếu chưa đăng nhập */
  currentUserId(): Promise<string | null>;
  /** Gọi api.<fn> bằng quyền của người dùng hiện tại */
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<RpcResponse<T>>;
  signIn(email: string, password: string): Promise<{ error: BackendError | null }>;
  signOut(): Promise<void>;
  /** Đổi mật khẩu của người đang đăng nhập */
  updatePassword(password: string): Promise<{ error: BackendError | null }>;
  admin: {
    createUser(email: string, password: string, meta: Record<string, unknown>): Promise<{ id: string | null; error: BackendError | null }>;
    deleteUser(id: string): Promise<{ error: BackendError | null }>;
    /** email: đổi email đăng nhập (và xác nhận luôn) */
    updateUser(id: string, patch: { password?: string; banned?: boolean; email?: string }): Promise<{ error: BackendError | null }>;
    listAuthUsers(): Promise<{ users: AuthUserInfo[]; error: BackendError | null }>;
    /** Tìm tài khoản đăng nhập theo username (không ghép email) — null nếu không có */
    findLoginEmail(username: string): Promise<{ email: string | null; error: BackendError | null }>;
    /** Bật/tắt cờ bắt đổi mật khẩu trên profile */
    setMustChangePassword(id: string, value: boolean): Promise<{ error: BackendError | null }>;
    /** Gọi với quyền service_role (cron đối soát) */
    serviceRpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<RpcResponse<T>>;
  };
}
