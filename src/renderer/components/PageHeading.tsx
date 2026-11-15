import type { ReactNode } from 'react';
export function PageHeading({ title, description, children, className = '' }: {title: string;description?: ReactNode;children?: ReactNode;className?: string}) {
  return <header className={`gallery-heading ${className}`}><div className="gallery-heading-copy"><h1 tabIndex={-1}>{title}</h1>{description ? <p className="gallery-description">{description}</p> : null}</div>{children ? <div className="gallery-heading-actions">{children}</div> : null}</header>;
}
