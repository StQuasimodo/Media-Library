import type { IconName } from './icons';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  shortcut?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '首页', icon: 'home', end: true },
  { to: '/library', label: '影视库', icon: 'library', shortcut: 'Ctrl+F' },
  { to: '/collections', label: '专题', icon: 'layers' },
  { to: '/watchlist', label: '想看', icon: 'clock' },
  { to: '/settings', label: '设置', icon: 'settings' },
];
