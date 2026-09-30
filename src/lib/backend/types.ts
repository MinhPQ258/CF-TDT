// Hợp đồng chung giữa app và hạ tầng: Supabase (staging/production) hoặc PGlite (máy local, không cần Docker).
// Mọi logic nghiệp vụ vẫn nằm trong hàm SQL api.* — hai backend chạy CÙNG migrations.

export interface BackendError {
  code?: string;
  message: string;
  details?: string;
  status?: number;
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
    updateUser(id: string, patch: { password?: string; banned?: boolean }): Promise<{ error: BackendError | null }>;
    /** Gọi với quyền service_role (cron đối soát) */
    serviceRpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<RpcResponse<T>>;
  };
}
