export interface QuarkWebItem { id: string; name: string; directory: boolean; video: boolean; size: number | null }
export interface QuarkWebStatus {
  state: 'not_checked' | 'login_required' | 'verified' | 'unavailable';
  error: string | null;
  loginOpen: boolean;
}
export interface QuarkWebDirectory { items: QuarkWebItem[]; total: number }
