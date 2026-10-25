export interface QuarkWebItem { id: string; name: string; directory: boolean; video: boolean }
export interface QuarkWebStatus {
  state: 'not_checked' | 'login_required' | 'verified' | 'unavailable';
  error: string | null;
  loginOpen: boolean;
}
export interface QuarkWebDirectory { items: QuarkWebItem[]; total: number }
