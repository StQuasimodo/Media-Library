import { Link, useLocation, useNavigate, type LinkProps } from 'react-router-dom';
import type { MouseEvent } from 'react';
import type { Film } from '@shared/types';
export function BrowseLink(props: LinkProps) {
  const location = useLocation();
  return <Link {...props} state={{ ...(typeof props.state === 'object' ? props.state : {}), browseFrom: location.pathname + location.search }} />;
}
export function FilmLink({ film, ...props }: Omit<LinkProps, 'to'> & { film: Pick<Film, 'id'> }) { return <BrowseLink data-browse-key={`film:${film.id}`} {...props} to={`/film/${film.id}`} />; }
export function useBrowseBack(fallback: string, fallbackLabel: string) {
  const location = useLocation(), navigate = useNavigate();
  const source: unknown = location.state?.browseFrom;
  const from = typeof source === 'string' && /^\/(?:$|library(?:\?|$)|watchlist(?:\?|$)|collections(?:\/[^?#]+)?(?:\?|$))/.test(source) ? source : null;
  const to = from ?? fallback;
  const label = !from ? fallbackLabel : from === '/' ? '返回首页' : from.startsWith('/watchlist') ? '返回想看清单' : from.startsWith('/collections/') ? '返回专题' : from.startsWith('/collections') ? '返回专题目录' : '返回影视库';
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => { if (from && window.history.state?.idx > 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); navigate(-1); } };
  return { to, label, onClick };
}
